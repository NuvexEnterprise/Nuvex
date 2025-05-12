const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');
const nodemailer = require('nodemailer');
const logger = require('../logger');

// Configurar o transporter do nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nuvexemterprise@gmail.com',
        pass: 'yqgj xmcs qnth fflj'
    },
});

// Função para enviar código 2FA
async function sendTwoFactorCode(email, code) {
    const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #ffffff; border-radius: 8px; padding: 20px;">
                <h2 style="color: #4B66B7;">Código de Verificação 2FA</h2>
                <p>Seu código de verificação em duas etapas é:</p>
                <div style="background-color: #f5f5f5; padding: 15px; text-align: center; margin: 20px 0;">
                    <h1 style="color: #4B66B7; letter-spacing: 5px; font-size: 32px;">${code}</h1>
                </div>
                <p>Este código expira em 5 minutos.</p>
                <p>Se você não tentou fazer login, alguém pode estar tentando acessar sua conta.</p>
            </div>
        </div>
    `;

    await transporter.sendMail({
        from: {
            name: 'Nuvex Security',
            address: 'nuvexemterprise@gmail.com'
        },
        to: email,
        subject: 'Código de Verificação 2FA - Nuvex',
        html: emailTemplate
    });
}

router.post('/', async (req, res) => {
    const { email, userId } = req.body;

    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const userData = userDoc.data();
        const twoFactorEnabled = userData.twoFactorEnabled || false;

        if (twoFactorEnabled) {
            const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
            const codeExpiry = new Date(Date.now() + 5 * 60000); // 5 minutos

            await userRef.update({
                twoFactorCode,
                twoFactorCodeExpiry: codeExpiry,
                lastLoginAttempt: new Date().toISOString()
            });

            await sendTwoFactorCode(email, twoFactorCode);

            return res.json({
                requires2FA: true,
                message: 'Código 2FA enviado para o email'
            });
        }

        // Login sem 2FA
        const customToken = await admin.auth().createCustomToken(userId);
        await userRef.update({
            lastLogin: new Date().toISOString(),
            lastLoginSuccess: true
        });

        res.json({
            customToken,
            requires2FA: false,
            message: 'Login realizado com sucesso'
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno ao processar login' });
    }
});

router.post('/verify-2fa', async (req, res) => {
  const { email, code } = req.body;

  try {
    const userSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    if (!userData.twoFactorCode || userData.twoFactorCode !== code) {
      await userDoc.ref.update({
        failedLoginAttempts: admin.firestore.FieldValue.increment(1)
      });
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date() > new Date(userData.twoFactorCodeExpiry)) {
      return res.status(400).json({ error: 'Código expirado' });
    }

    // Gerar token e atualizar dados
    const customToken = await admin.auth().createCustomToken(userDoc.id);
    await userDoc.ref.update({
      lastLogin: new Date().toISOString(),
      lastLoginSuccess: true,
      failedLoginAttempts: 0,
      twoFactorCode: null,
      twoFactorCodeExpiry: null
    });

    res.json({
      customToken,
      message: 'Verificação 2FA concluída'
    });

  } catch (error) {
    console.error('Erro na verificação 2FA:', error);
    res.status(500).json({ error: 'Erro na verificação' });
  }
});

// Atualizar rota de recuperação de senha
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório' });
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    
    // Gerar código de 6 dígitos
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpiry = new Date(Date.now() + 30 * 60000); // 30 minutos

    // Salvar código no documento do usuário
    await db.collection('users').doc(userRecord.uid).update({
      resetCode,
      resetCodeExpiry
    });

    // TODO: Implementar envio de email com o código
    logger.info(`Código de recuperação gerado para ${email}: ${resetCode}`);

    res.json({ 
      message: 'Código de recuperação enviado com sucesso',
      // Em ambiente de desenvolvimento, retornar o código para teste
      code: process.env.NODE_ENV === 'development' ? resetCode : undefined
    });

  } catch (error) {
    logger.error('Erro no processo de recuperação de senha:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'Email não encontrado' });
    }
    
    res.status(400).json({ error: 'Erro ao processar recuperação de senha' });
  }
});

// Adicionar nova rota para verificação do código
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userData = userDoc.data();
    if (userData.recoveryCode !== code) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date() > new Date(userData.recoveryCodeExpiry)) {
      return res.status(400).json({ error: 'Código expirado' });
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('Erro na verificação do código:', error);
    res.status(500).json({ error: 'Erro ao verificar código' });
  }
});

// Adicionar nova rota para atualização de senha
router.post('/update-password', async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    
    await admin.auth().updateUser(userRecord.uid, {
      password: newPassword
    });

    // Limpar códigos de recuperação
    await db.collection('users').doc(userRecord.uid).update({
      recoveryCode: null,
      recoveryCodeExpiry: null
    });

    res.json({ 
      success: true,
      message: 'Senha atualizada com sucesso' 
    });

  } catch (error) {
    logger.error('Erro na atualização de senha:', error);
    res.status(500).json({ error: 'Erro ao atualizar senha' });
  }
});

module.exports = router;
