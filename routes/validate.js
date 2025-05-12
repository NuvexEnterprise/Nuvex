const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

router.post('/document', async (req, res) => {
    try {
        const { type, number } = req.body;

        if (!type || !number) {
            return res.status(400).json({ error: 'Tipo e número do documento são obrigatórios' });
        }

        if (!['cpf', 'cnpj'].includes(type)) {
            return res.status(400).json({ error: 'Tipo de documento inválido' });
        }

        // Busca usuários com o mesmo documento que estejam ativos ou em trial
        const existingDocs = await db.collection('users')
            .where(type, '==', number)
            .where('status', 'in', ['trial', 'active'])
            .get();

        if (!existingDocs.empty) {
            return res.status(409).json({
                error: 'Documento já registrado',
                message: `Este ${type.toUpperCase()} já está em uso por outra conta ativa ou em período de teste.`
            });
        }

        res.json({ valid: true });
    } catch (error) {
        console.error('Erro ao validar documento:', error);
        res.status(500).json({ 
            error: 'Erro interno',
            message: 'Erro ao validar documento'
        });
    }
});

module.exports = router;
