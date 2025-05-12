const express = require('express');
const axios = require('axios');
const router = express.Router();

router.get('/:number', async (req, res) => {
    try {
        // 1. Corrigir a regex de limpeza do CNPJ
        const cleanNumber = req.params.number.replace(/[.\/-]/g, '');
        
        // 2. Validação básica do CNPJ
        if (!/^\d{14}$/.test(cleanNumber)) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }

        // 3. Adicionar logs para diagnóstico
        console.log(`[${new Date().toISOString()}] Consultando CNPJ: ${cleanNumber}`);
        
        // 4. Fazer a requisição com timeout
        const response = await axios.get(`https://www.receitaws.com.br/v1/cnpj/${cleanNumber}`, {
            timeout: 5000
        });

        // 5. Tratar resposta da API
        if (response.data.status === 'ERROR') {
            if (response.data.message.includes('too many requests')) {
                return res.status(429).json({ 
                    error: 'Limite de consultas excedido',
                    details: 'Máximo de 3 consultas por minuto'
                });
            }
            return res.status(404).json({ error: response.data.message });
        }

        res.json(response.data);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro:`, error.message);
        
        // 6. Tratamento de erros aprimorado
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || 'Erro na consulta';

        res.status(statusCode).json({ 
            error: 'Falha na consulta',
            details: errorMessage
        });
    }
});

module.exports = router;