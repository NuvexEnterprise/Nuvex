const express = require('express');
const { db } = require('../firebase');
const logger = require('../logger');
const cloudinary = require('cloudinary').v2;
const notificationService = require('../services/notificationService');

const router = express.Router();

// Configurar Cloudinary
cloudinary.config({
  cloud_name: 'decjkocpj',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const storageUsed = userDoc.data().storageUsed || 0;
    const documents = [];

    const clientsSnapshot = await userRef.collection('clients').get();
    
    for (const clientDoc of clientsSnapshot.docs) {
      const documentsSnapshot = await userRef.collection('clients').doc(clientDoc.id).collection('documents').get();
      
      documentsSnapshot.forEach(doc => {
        const data = doc.data();
        const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : Date.now();
        const now = Date.now();
        const documentAge = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24)); // Age in days
        documents.push({
          id: doc.id,
          documentName: data.documentName,
          clientName: clientDoc.data().fullName,
          clientId: clientDoc.id,
          size: data.size || data.fileSize,
          uploadDate: createdAt,
          lastAccessedAt: data.lastAccessedAt ? new Date(data.lastAccessedAt).getTime() : null,
          documentAge: documentAge,
          fileUrl: data.fileUrl,
          fileType: data.fileType,
        });
      });
    }

    // Se uso >= 9GB, aciona notificação
    const NINE_GB = 9 * 1024 * 1024 * 1024;
    if (storageUsed >= NINE_GB) {
      notificationService.notifyStorageLimit(userId, storageUsed)
       .catch(err => console.error('Erro ao notificar storage:', err));
    }

    res.status(200).json({ storageUsed, documents });
  } catch (error) {
    logger.error('Erro ao buscar dados de armazenamento:', { message: error.message, stack: error.stack, code: error.code });
    res.status(500).json({ error: 'Erro ao buscar dados de armazenamento', details: error.message });
  }
});

router.delete('/:userId/document/:documentId', async (req, res) => {
  const { userId, documentId } = req.params;

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let documentRef, documentDoc, clientId;
    const clientsSnapshot = await userRef.collection('clients').get();

    for (const clientDoc of clientsSnapshot.docs) {
      const docRef = userRef.collection('clients').doc(clientDoc.id).collection('documents').doc(documentId);
      const docSnapshot = await docRef.get();
      if (docSnapshot.exists) {
        documentRef = docRef;
        documentDoc = docSnapshot;
        clientId = clientDoc.id;
        break;
      }
    }

    if (!documentDoc) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    const { fileUrl, size, fileSize } = documentDoc.data();
    const documentSize = size || fileSize;

    // Deletar arquivo do Cloudinary
    let publicId;
    try {
      publicId = fileUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/)[1];
      await cloudinary.uploader.destroy(publicId, { resource_type: fileUrl.includes('.pdf') ? 'raw' : 'image' });
    } catch (cloudinaryError) {
      logger.error('Erro ao deletar arquivo do Cloudinary:', { message: cloudinaryError.message, stack: cloudinaryError.stack });
      return res.status(500).json({ error: 'Erro ao deletar arquivo do Cloudinary', details: cloudinaryError.message });
    }

    // Deletar documento do Firestore
    await documentRef.delete();

    // Atualizar storageUsed
    const newStorageUsed = Math.max(0, (userDoc.data().storageUsed || 0) - documentaStorageUsed);
    await userRef.update({ storageUsed: newStorageUsed });

    logger.info('Documento deletado com sucesso:', { userId, documentId, publicId, newStorageUsed });
    res.status(200).json({ message: 'Documento deletado com sucesso' });
  } catch (error) {
    logger.error('Erro ao deletar documento:', { message: error.message, stack: error.stack, code: error.code });
    res.status(500).json({ error: 'Erro ao deletar documento', details: error.message });
  }
});

module.exports = router;