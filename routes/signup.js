const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');
const logger = require('../logger');

// Rota de cadastro
router.post('/', async (req, res) => {
  const { email, fullName, password, trial } = req.body;
  const trialPeriod = trial === 'extended' ? 14 : 7;

  // Validação básica
  if (!email || !fullName || !password) {
    logger.warn('Campos obrigatórios faltando no cadastro');
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    // Verificar se o e-mail já existe
    try {
      const userExists = await admin.auth().getUserByEmail(email);
      if (userExists) {
        logger.warn(`Tentativa de cadastro com email já existente: ${email}`);
        return res.status(400).json({ error: 'Este email já está em uso' });
      }
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    // Criar usuário no Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email: email.trim(),
      password: password,
      displayName: fullName.trim(),
    });

    // Salvar dados no Firestore com o período de trial apropriado
    await db.collection('users').doc(userRecord.uid).set({
      fullName: fullName.trim(),
      email: email.trim(),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      role: 'user',
      autoBilling: true,
      trialPeriod: trialPeriod,
    }, { merge: true });

    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    logger.info(`Usuário ${email} cadastrado com sucesso (trial: ${trialPeriod} dias), UID: ${userRecord.uid}`);
    res.status(201).json({
      userId: userRecord.uid,
      message: 'Cadastro concluído com sucesso',
      customToken,
      trialDays: trialPeriod,
    });
  } catch (error) {
    logger.error('Erro no cadastro:', error);

    const errorMessages = {
      'auth/email-already-exists': 'Este email já está em uso',
      'auth/invalid-email': 'Email inválido',
      'auth/weak-password': 'Senha muito fraca',
      'auth/operation-not-allowed': 'Operação não permitida',
    };

    const message = errorMessages[error.code] || 'Ocorreu um erro durante o cadastro';
    res.status(400).json({ error: message });
  }
});

module.exports = router;