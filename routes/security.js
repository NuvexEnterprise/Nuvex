const express = require('express');
const { db } = require('../firebase');
const router = express.Router();

router.post('/verify-password', async (req, res) => {
    const { userId, currentPassword } = req.body;
    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Aqui você implementaria a lógica de verificação de senha
        // Por questões de segurança, isso deve ser feito no lado do cliente usando Firebase Auth

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/update-2fa', async (req, res) => {
    const { userId, enabled } = req.body;
    
    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        await userRef.update({
            twoFactorEnabled: enabled,
            twoFactorCode: null,
            twoFactorCodeExpiry: null
        });

        res.json({
            success: true,
            message: enabled ? '2FA ativado com sucesso' : '2FA desativado com sucesso'
        });

    } catch (error) {
        console.error('Erro ao atualizar 2FA:', error);
        res.status(500).json({ error: 'Erro ao atualizar configuração 2FA' });
    }
});

module.exports = router;
