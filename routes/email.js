const express = require('express');
const nodemailer = require('nodemailer');
const { db } = require('../firebase'); 
const router = express.Router();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'nuvexemterprise@gmail.com', pass: 'yqgj xmcs qnth fflj' },
});

router.post('/send-verification-email', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'userId e code obrigatórios' });

    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        const userEmail = userDoc.data().email;
        const mailOptions = {
            from: 'nuvexemterprise@gmail.com',
            to: userEmail,
            subject: 'Código de Verificação',
            html: `<h2>Código de Verificação</h2><p>Seu código é: <strong>${code}</strong></p>`,
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar e-mail:', error.message);
        res.status(500).json({ error: 'Erro ao enviar e-mail' });
    }
});

// Nova rota para envio de código de recuperação de senha
router.post('/send-recovery-code', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' });

    try {
        // Gerar código de 6 dígitos
        const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
        const codeExpiry = new Date(Date.now() + 30 * 60000); // 30 minutos

        // Buscar usuário pelo email
        const userSnapshot = await db.collection('users')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (userSnapshot.empty) {
            return res.status(404).json({ error: 'Email não encontrado' });
        }

        const userDoc = userSnapshot.docs[0];
        
        // Salvar có    digo e expiração no documento do usuário
        await userDoc.ref.update({
            recoveryCode,
            recoveryCodeExpiry: codeExpiry
        });

        // Template do email melhorado
        const emailTemplate = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <img src="https://nuvex.com.br/logo.png" alt="Nuvex Logo" style="width: 150px; margin-bottom: 20px;">
                <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h2 style="color: #4B66B7; margin-bottom: 20px;">Recuperação de Senha</h2>
                    <p style="color: #333; margin-bottom: 15px;">Você solicitou a recuperação de senha da sua conta Nuvex.</p>
                    <p style="color: #333; margin-bottom: 25px;">Use o código abaixo para continuar o processo:</p>
                    <div style="background-color: #f5f5f5; padding: 15px; text-align: center; margin: 20px 0; border-radius: 4px;">
                        <h1 style="color: #4B66B7; letter-spacing: 5px; font-size: 32px; margin: 0;">${recoveryCode}</h1>
                    </div>
                    <p style="color: #666; font-size: 14px;">Este código expira em 30 minutos.</p>
                    <p style="color: #666; font-size: 14px;">Se você não solicitou esta recuperação, ignore este email.</p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} Nuvex. Todos os direitos reservados.</p>
                </div>
            </div>
        `;

        // Enviar email
        await transporter.sendMail({
            from: {
                name: 'Nuvex',
                address: 'nuvexemterprise@gmail.com'
            },
            to: email,
            subject: 'Código de Recuperação de Senha - Nuvex',
            html: emailTemplate
        });

        res.status(200).json({ 
            success: true,
            message: 'Código de recuperação enviado com sucesso'
        });

    } catch (error) {
        console.error('Erro ao enviar código de recuperação:', error);
        res.status(500).json({ error: 'Erro ao enviar código de recuperação' });
    }
});

module.exports = router;