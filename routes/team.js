const express = require('express');
const nodemailer = require('nodemailer');
const { db } = require('../firebase'); // Importe o db do firebase.js
const router = express.Router();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'nuvexemterprise@gmail.com', pass: 'yqgj xmcs qnth fflj' },
});

function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

router.post('/create-team-member', async (req, res) => {
    try {
        const { userId, name, domain } = req.body;
        if (!userId || !name || !domain) {
            return res.status(400).json({ error: 'userId, name e domain são obrigatórios' });
        }

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        const userData = userDoc.data();
        const planName = userData.planName;
        const planLimits = { 'Adamantium': 1, 'Ouro': 3, 'Platina': 10 };
        const accountLimit = planLimits[planName] || 0;

        const teamCollection = db.collection('users').doc(userId).collection('team');
        const teamSnapshot = await teamCollection.get();
        if (teamSnapshot.size >= accountLimit) {
            return res.status(400).json({ error: 'Limite de contas atingido para o plano atual' });
        }

        const email = `${name.toLowerCase().replace(/\s+/g, '.')}@${domain}`;
        const password = generateRandomPassword();

        const teamMemberRef = await teamCollection.add({
            email,
            password,
            createdAt: new Date().toISOString(),
            role: 'team_member',
        });

        const mailOptions = {
            from: 'nuvexemterprise@gmail.com',
            to: email,
            subject: 'Bem-vindo à equipe!',
            html: `<p>Seu acesso foi criado:</p><p>Email: ${email}</p><p>Senha: ${password}</p>`,
        };
        await transporter.sendMail(mailOptions);

        res.json({ email, password });
    } catch (error) {
        console.error('Erro ao criar membro da equipe:', error.message);
        res.status(500).json({ error: 'Erro ao criar membro' });
    }
});

module.exports = router;