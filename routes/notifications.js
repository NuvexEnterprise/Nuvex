const express = require('express');
const { db, admin } = require('../firebase');
const winston = require('winston');
const logger = require('../logger');

const router = express.Router();

const notificationService = require('../services/notificationService');

// Middleware para verificar autenticação
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Tentativa de acesso sem token de autenticação', { ip: req.ip });
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    logger.info('Token verificado com sucesso', { userId: decodedToken.uid });
    next();
  } catch (error) {
    logger.error('Erro ao verificar token de autenticação:', { message: error.message, stack: error.stack });
    return res.status(401).json({ error: 'Token de autenticação inválido' });
  }
};

// Nova rota para notificação sobre plano de assinatura:
router.post('/subscription', verifyAuth, async (req, res) => {
  const { userId, planInfo } = req.body;
  if (!userId || !planInfo) {
    return res.status(400).json({ error: 'userId e planInfo são obrigatórios' });
  }
  try {
    await notificationService.notifySubscriptionPlan(userId, planInfo);
    logger.info('Notificação de plano enviada', { userId, planInfo });
    res.status(201).json({ message: 'Notificação de plano criada com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar notificação de plano:', { message: error.message });
    res.status(500).json({ error: 'Erro ao criar notificação de plano', details: error.message });
  }
});

// Nova rota para notificação de documento com vencimento próximo:
router.post('/document-due', verifyAuth, async (req, res) => {
  const { userId, clientName, documentName, dueDate } = req.body;
  if (!userId || !clientName || !documentName || !dueDate) {
    return res.status(400).json({ error: 'userId, clientName, documentName e dueDate são obrigatórios' });
  }
  try {
    await notificationService.notifyDocumentDue(userId, clientName, documentName, dueDate);
    logger.info('Notificação de documento em vencimento enviada', { userId, clientName, documentName });
    res.status(201).json({ message: 'Notificação de vencimento criada com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar notificação de vencimento:', { message: error.message });
    res.status(500).json({ error: 'Erro ao criar notificação de vencimento', details: error.message });
  }
});

// Rota para criar uma notificação
router.post('/', verifyAuth, async (req, res) => {
  const { message, type, category, priority, metadata } = req.body;

  // Validações
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'A mensagem é obrigatória e deve ser uma string não vazia' });
  }

  if (!type || !['system', 'user', 'alert'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido. Use: system, user ou alert' });
  }

  if (!category || !['client_import', 'team_update', 'payment', 'general'].includes(category)) {
    return res.status(400).json({ error: 'Categoria inválida. Use: client_import, team_update, payment ou general' });
  }

  if (!priority || !['low', 'normal', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Prioridade inválida. Use: low, normal ou high' });
  }

  if (metadata && typeof metadata !== 'object') {
    return res.status(400).json({ error: 'Metadados devem ser um objeto' });
  }

  try {
    const userId = req.user.uid;
    const notificationData = {
      receiverId: userId,
      message: message.trim(),
      type,
      category,
      priority,
      read: false,
      archived: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
      icon: category, // Usar a categoria como identificador do ícone
      metadata: metadata || {},
    };

    const notificationRef = db.collection('users').doc(userId).collection('notifications');
    const docRef = await notificationRef.add(notificationData);

    logger.info(`Notificação criada para o usuário ${userId}: ${message}`, { notificationId: docRef.id });
    return res.status(201).json({ id: docRef.id, message: 'Notificação criada com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar notificação:', error);
    return res.status(500).json({ error: 'Erro ao criar notificação no servidor' });
  }
});

module.exports = router;