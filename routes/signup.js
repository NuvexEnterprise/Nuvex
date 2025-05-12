const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');
const logger = require('../logger');

router.post('/', async (req, res) => {
  const { email, fullName, password, trial } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trialPeriod = trial === 'extended' ? 14 : 7;

  if (!email || !fullName || !password) {
    logger.warn('Missing required fields in signup request', { email, fullName });
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  if (!emailRegex.test(email)) {
    logger.warn('Invalid email format', { email });
    return res.status(400).json({ error: 'Email inválido' });
  }

  if (fullName.trim().length < 2) {
    logger.warn('Invalid fullName length', { fullName });
    return res.status(400).json({ error: 'Nome completo deve ter pelo menos 2 caracteres' });
  }

  


  if (password.length < 6) {
    logger.warn('Password too short', { email });
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }

  if (trial && !['standard', 'extended'].includes(trial)) {
    logger.warn('Invalid trial value', { trial });
    return res.status(400).json({ error: 'Tipo de trial inválido' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedFullName = fullName.trim();

  try {
    logger.info('Processing signup request', { email: normalizedEmail, trial });

    try {
      await admin.auth().getUserByEmail(normalizedEmail);
      logger.warn('Signup attempt with existing email', { email: normalizedEmail });
      return res.status(400).json({ error: 'Este email já está em uso' });
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password,
      displayName: normalizedFullName,
    });
    logger.info('User created', { uid: userRecord.uid });

    await db.collection('users').doc(userRecord.uid).set({
      fullName: normalizedFullName,
      email: normalizedEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      role: 'user',
      autoBilling: true,
      trialPeriod,
    });

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

    const errorMessages = {
      'auth/email-already-exists': 'Este email já está em uso',
      'auth/invalid-email': 'Email inválido',
      'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres',
      'auth/operation-not-allowed': 'Operação não permitida',
      'auth/invalid-credential': 'Erro de configuração do servidor. Contate o suporte.',
    };

    const message = errorMessages[error.code] || 'Ocorreu um erro durante o cadastro';
    res.status(400).json({ error: message });
  }
});

module.exports = router;