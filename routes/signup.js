const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');
const logger = require('../logger');

const errorMessages = {
  'auth/email-already-exists': 'Este email já está em uso',
  'auth/invalid-password': 'A senha deve ter pelo menos 6 caracteres',
  'auth/invalid-email': 'Email inválido',
  'auth/invalid-credential': 'Credencial inválida',
  'auth/invalid-argument': 'Argumento inválido',
  'auth/network-request-failed': 'Erro de rede, tente novamente',
  'auth/internal-error': 'Erro interno do servidor',
  'app/invalid-credential': 'Problema com as credenciais do servidor. Contate o suporte.',
};

router.post('/', async (req, res) => {
  const { email, fullName, password, trial } = req.body;

  logger.info('Received signup request', { email, trial });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trialPeriod = trial === 'extended' ? 14 : 7;

  // Validações...

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedFullName = fullName.trim();

  try {
    logger.info('Checking if email exists', { email: normalizedEmail });
    try {
      await admin.auth().getUserByEmail(normalizedEmail);
      logger.warn('Signup attempt with existing email', { email: normalizedEmail });
      return res.status(400).json({ error: 'Este email já está em uso' });
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    logger.info('Creating user', { email: normalizedEmail });
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password,
      displayName: normalizedFullName,
    });
    logger.info('User created', { uid: userRecord.uid });

    logger.info('Saving user data to Firestore', { uid: userRecord.uid });
    await db.collection('users').doc(userRecord.uid).set({
      fullName: normalizedFullName,
      email: normalizedEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      role: 'user',
      autoBilling: true,
      trialPeriod,
    });

    logger.info('Generating custom token', { uid: userRecord.uid });
    const customToken = await admin.auth().createCustomToken(userRecord.uid);
    logger.info('Custom token generated', { uid: userRecord.uid });

    logger.info('User signed up successfully', {
      email: normalizedEmail,
      uid: userRecord.uid,
      trialPeriod,
    });

    res.status(201).json({
      userId: userRecord.uid,
      message: 'Cadastro concluído com sucesso',
      customToken,
      trialDays: trialPeriod,
    });
  } catch (error) {
    logger.error('Signup error', {
      email: normalizedEmail,
      errorCode: error.code,
      errorMessage: error.message,
      stack: error.stack,
    });
    const message = errorMessages[error.code] || 'Ocorreu um erro durante o cadastro';
    res.status(400).json({ error: message });
  }
});

module.exports = router;