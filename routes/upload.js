const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const archiver = require('archiver');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { db } = require('../firebase');
const logger = require('../logger');
const { PDFDocument } = require('pdf-lib');
const notificationService = require('../services/notificationService');

// Carregar variáveis de ambiente
require('dotenv').config();

const router = express.Router();
const STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB in bytes

// Configure Cloudflare R2 (S3-compatible)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || 'https://d7b9b5a573a5e3fd526fa80de7a24989.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || 'a291d152dbc8c42c2cb5d0ce90251ccc',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '5dde04cdabb3d67d74ec1833ecba51c7f238e451c27758bd1864a0de59eda9cf',
  },
});

// Cloudflare R2 bucket name
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'client-documents';

// Cloudinary configuration
const CLOUDINARY_CLOUD_NAME = 'decjkocpj';
const CLOUDINARY_UPLOAD_PRESET = 'client_documents';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado. Use JPG, PNG ou PDF.'));
    }
  },
});

router.post('/upload-profile-image', upload.single('profileImage'), async (req, res) => {
  try {
    const { userId } = req.body;
    const file = req.file;
    if (!userId || !file) {
      logger.error('Dados incompletos:', { userId, file: !!file });
      return res.status(400).json({ error: 'userId e imagem são obrigatórios' });
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      logger.error('Usuário não encontrado:', { userId });
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const formData = new FormData();
    formData.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('cloud_name', CLOUDINARY_CLOUD_NAME);

    const uploadResponse = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      formData,
      { headers: formData.getHeaders() }
    );
    const downloadURL = uploadResponse.data.secure_url;
    await userRef.update({ profileImageUrl: downloadURL });

    logger.info('Imagem de perfil salva com sucesso:', { userId, downloadURL });
    res.json({ profileImageUrl: downloadURL });
  } catch (error) {
    logger.error('Erro ao salvar imagem de perfil:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Erro ao salvar imagem', details: error.message });
  }
});

router.post('/upload-client-document', upload.single('document'), async (req, res) => {
  try {
    const { userId, clientId, documentName, tag, dueDate } = req.body;
    const file = req.file;

    // Validate required fields
    if (!userId || !clientId || !documentName || !file) {
      logger.error('Dados incompletos:', { userId, clientId, documentName, file: !!file });
      return res.status(400).json({
        error: 'userId, clientId, documentName e arquivo são obrigatórios',
      });
    }

    // Check storage limit
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      logger.error('Usuário não encontrado:', { userId });
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const currentStorageUsed = userDoc.data().storageUsed || 0;
    if (currentStorageUsed + file.size > STORAGE_LIMIT) {
      logger.error('Limite de armazenamento excedido:', { userId, currentStorageUsed, fileSize: file.size });
      return res.status(400).json({ error: 'Limite de armazenamento de 10 GB excedido' });
    }

    logger.info('Arquivo recebido:', { mimetype: file.mimetype, size: file.size, name: file.originalname });

    // Verify client existence in Firestore
    const clientRef = userRef.collection('clients').doc(clientId);
    const clientDoc = await clientRef.get();
    if (!clientDoc.exists) {
      logger.error('Cliente não encontrado:', { clientId });
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Determine number of pages for PDFs
    let totalPages = 1;
    if (file.mimetype === 'application/pdf') {
      try {
        const pdfDoc = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
        totalPages = pdfDoc.getPageCount();
        logger.info('PDF processado:', { totalPages, filename: file.originalname });
      } catch (pdfError) {
        logger.error('Erro ao extrair número de páginas do PDF:', {
          message: pdfError.message,
          stack: pdfError.stack,
          filename: file.originalname,
        });
        return res.status(400).json({
          error: 'Erro ao processar PDF: não foi possível determinar o número de páginas',
          details: pdfError.message,
        });
      }
    }

    let fileUrl, previewUrl;
    let r2FileKey; // Guardar fileKey para PDFs
    const uniqueFileName = `${Date.now()}-${documentName.replace(/\s+/g, '-')}`;

    if (file.mimetype === 'application/pdf') {
      // Upload to Cloudflare R2
      try {
        const fileKey = `pdfs/${clientId}/${uniqueFileName}.pdf`;
        r2FileKey = fileKey;
        const putCommand = new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: fileKey,
          Body: file.buffer,
          ContentType: 'application/pdf',
        });

        await r2Client.send(putCommand);
        logger.info('PDF enviado para R2:', { fileKey });

        // Generate presigned URL for access
        const getCommand = new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: fileKey,
        });
        fileUrl = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 * 24 * 7 }); // 7 days
        previewUrl = fileUrl; // For PDFs, use same URL for preview
        logger.info('Presigned URL gerada para PDF:', { fileUrl });
      } catch (r2Error) {
        logger.error('Erro ao enviar PDF para R2:', {
          message: r2Error.message,
          stack: r2Error.stack,
          filename: file.originalname,
        });
        return res.status(500).json({
          error: 'Erro ao enviar PDF para Cloudflare R2',
          details: r2Error.message,
        });
      }
    } else {
      // Upload to Cloudinary (Images)
      try {
        const formData = new FormData();
        formData.append('file', file.buffer, {
          filename: `${uniqueFileName}.${file.mimetype.split('/')[1]}`,
          contentType: file.mimetype,
        });
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('cloud_name', CLOUDINARY_CLOUD_NAME);
        formData.append('resource_type', 'auto');

        const uploadResponse = await axios.post(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
          formData,
          { headers: formData.getHeaders() }
        );

        fileUrl = uploadResponse.data.secure_url;
        previewUrl = fileUrl;
        logger.info('Imagem enviada para Cloudinary com sucesso:', { fileUrl, previewUrl });
      } catch (cloudinaryError) {
        logger.error('Erro ao enviar imagem para Cloudinary:', {
          message: cloudinaryError.message,
          stack: cloudinaryError.stack,
          filename: file.originalname,
        });
        return res.status(500).json({
          error: 'Erro ao enviar imagem para Cloudinary',
          details: cloudinaryError.message,
        });
      }
    }

    // Validate and format dueDate
    let formattedDueDate = null;
    if (dueDate && dueDate.trim() !== '' && !isNaN(Date.parse(dueDate))) {
      formattedDueDate = new Date(dueDate).toISOString();
    } else if (dueDate && dueDate.trim() !== '') {
      logger.warn('Data de vencimento inválida fornecida:', { dueDate });
      return res.status(400).json({ error: 'Data de vencimento inválida' });
    }

    // Save data to Firestore
    const documentData = {
      documentName,
      fileUrl,
      previewUrl,
      createdAt: new Date().toISOString(),
      fileType: file.mimetype,
      fileSize: file.size,
      totalPages,
      dueDate: formattedDueDate,
      size: file.size,
      ...(file.mimetype === 'application/pdf' && { r2FileKey }),
    };

    if (tag) {
      documentData.tag = tag;
    }

    const documentRef = await clientRef.collection('documents').add(documentData);

    // Update storageUsed in user document
    const newStorageUsed = currentStorageUsed + file.size;
    await userRef.update({ storageUsed: newStorageUsed });

    // Notify document upload
    notificationService.notifyDocumentUpload(userId, clientId, documentName).catch((err) =>
      console.error('Erro ao notificar upload:', err)
    );

    logger.info('Documento salvo com sucesso:', { documentId: documentRef.id, totalPages, storageUsed: newStorageUsed });
    res.json({
      success: true,
      documentId: documentRef.id,
      ...documentData,
    });
  } catch (error) {
    logger.error('Erro ao salvar documento:', { message: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message,
    });
  }
});

router.post('/download-document', async (req, res) => {
  const { userId, clientId, documentId, documentName, fileUrl, fileType } = req.body;
  if (!userId || !clientId || !documentId || !documentName || !fileUrl || !fileType) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }
  try {
    // Update lastAccessedAt in Firestore
    const docRef = db.collection('users').doc(userId).collection('clients').doc(clientId).collection('documents').doc(documentId);
    await docRef.update({ lastAccessedAt: new Date().toISOString() });
    logger.info('lastAccessedAt atualizado:', { documentId });

    if (fileType === 'application/pdf') {
      // Para PDFs no Cloudflare R2, redirecionar para a URL pré-assinada
      res.setHeader('Content-Type', fileType);
      res.setHeader('Content-Disposition', `attachment; filename="${documentName}.pdf"`);
      res.redirect(fileUrl);
    } else {
      // Para imagens no Cloudinary
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      
      const extension = fileType === 'image/jpeg' ? '.jpg' : '.png';
      res.setHeader('Content-Type', fileType);
      res.setHeader('Content-Disposition', `attachment; filename="${documentName}${extension}"`);
      res.send(response.data);
    }

    // Notify document download
    if (userId) {
      notificationService.notifyDocumentDownload(userId, documentName).catch((err) =>
        logger.error('Erro ao notificar download:', err)
      );
    }
  } catch (error) {
    logger.error('Erro ao baixar documento:', { message: error.message });
    return res.status(500).json({ error: 'Erro ao baixar o documento', details: error.message });
  }
});

router.post('/download-all-documents', async (req, res) => {
  const { userId, clientId } = req.body;
  if (!userId || !clientId) {
    return res.status(400).json({ error: 'userId e clientId são obrigatórios' });
  }
  try {
    const userRef = db.collection('users').doc(userId);
    const clientRef = userRef.collection('clients').doc(clientId);
    const docsSnapshot = await clientRef.collection('documents').get();
    if (docsSnapshot.empty) {
      return res.status(404).json({ error: 'Nenhum documento encontrado' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="documentos.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);
    for (const doc of docsSnapshot.docs) {
      const data = doc.data();
      const extension = data.fileType === 'application/pdf' ? '.pdf' : data.fileType === 'image/jpeg' ? '.jpg' : '.png';
      const filename = data.documentName + extension;
      try {
        const fileResponse = await axios.get(data.fileUrl, { responseType: 'arraybuffer' });
        archive.append(fileResponse.data, { name: filename });
        // Update lastAccessedAt for each document
        await clientRef.collection('documents').doc(doc.id).update({ lastAccessedAt: new Date().toISOString() });
      } catch (fileErr) {
        logger.error('Erro ao baixar arquivo para ZIP:', { message: fileErr.message });
      }
    }
    await archive.finalize();
  } catch (error) {
    logger.error('Erro ao compactar documentos:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Erro ao gerar o ZIP', details: error.message });
  }
});

router.post('/download-all-clients-documents', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    console.error('Erro: userId não fornecido na requisição.');
    return res.status(400).json({ error: 'userId é obrigatório' });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const clientsSnapshot = await userRef.collection('clients').get();
    if (clientsSnapshot.empty) {
      console.error('Erro: Nenhum cliente encontrado para o userId:', userId);
      return res.status(404).json({ error: 'Nenhum cliente encontrado' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="all_clients_documents.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    for (const clientDoc of clientsSnapshot.docs) {
      const clientData = clientDoc.data();
      const clientName = clientData.name || `Cliente_${clientDoc.id}`;
      const sanitizedClientName = clientName.replace(/[<>:"/\\|?*]+/g, '_');
      const clientFolder = `${sanitizedClientName}/`;

      const docsSnapshot = await userRef.collection('clients').doc(clientDoc.id).collection('documents').get();
      if (!docsSnapshot.empty) {
        for (const doc of docsSnapshot.docs) {
          const data = doc.data();
          const extension = data.fileType === 'application/pdf' ? '.pdf' : data.fileType === 'image/jpeg' ? '.jpg' : '.png';
          const filename = `${clientFolder}${data.documentName}${extension}`;
          try {
            const fileResponse = await axios.get(data.fileUrl, { responseType: 'arraybuffer' });
            archive.append(fileResponse.data, { name: filename });
            await userRef.collection('clients').doc(clientDoc.id).collection('documents').doc(doc.id).update({
              lastAccessedAt: new Date().toISOString(),
            });
          } catch (fileErr) {
            console.error('Erro ao baixar arquivo para ZIP:', { message: fileErr.message, clientId: clientDoc.id, documentId: doc.id });
          }
        }
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Erro ao compactar documentos de todos os clientes:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Erro ao gerar o ZIP', details: error.message });
  }
});

router.post('/download-selected-documents', async (req, res) => {
  const { userId, clientId, documentIds } = req.body;
  if (!userId || !clientId || !Array.isArray(documentIds) || documentIds.length === 0) {
    return res.status(400).json({ error: 'userId, clientId e documentIds são obrigatórios' });
  }
  try {
    const userRef = db.collection('users').doc(userId);
    const clientRef = userRef.collection('clients').doc(clientId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="documentos_selecionados.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    for (const docId of documentIds) {
      const docSnap = await clientRef.collection('documents').doc(docId).get();
      if (!docSnap.exists) continue;
      const data = docSnap.data();
      const extension = data.fileType === 'application/pdf' ? '.pdf' : data.fileType === 'image/jpeg' ? '.jpg' : '.png';
      const filename = data.documentName + extension;
      try {
        const fileResponse = await axios.get(data.fileUrl, { responseType: 'arraybuffer' });
        archive.append(fileResponse.data, { name: filename });
        // Atualiza lastAccessedAt
        await clientRef.collection('documents').doc(docId).update({ lastAccessedAt: new Date().toISOString() });
      } catch (fileErr) {
        logger.error('Erro ao baixar arquivo para ZIP:', { message: fileErr.message, docId });
      }
    }
    await archive.finalize();
  } catch (error) {
    logger.error('Erro ao compactar documentos selecionados:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Erro ao gerar o ZIP', details: error.message });
  }
});

router.post('/delete-document', async (req, res) => {
  try {
    const { userId, clientId, documentId } = req.body;
    if (!userId || !clientId || !documentId) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }
    // Obter referência do usuário e do documento no Firestore
    const userRef = db.collection('users').doc(userId);
    const clientRef = userRef.collection('clients').doc(clientId);
    const docRef = clientRef.collection('documents').doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    const data = docSnap.data();
    // Se for PDF e possuir campo r2FileKey, excluir do Cloudflare R2
    if (data.fileType === 'application/pdf' && data.r2FileKey) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: data.r2FileKey,
        });
        await r2Client.send(deleteCommand);
        logger.info('PDF excluído do Cloudflare R2:', { key: data.r2FileKey });
      } catch (cloudError) {
        logger.error('Erro ao excluir PDF do Cloudflare R2:', { message: cloudError.message });
        // Prosseguir com a exclusão no Firestore mesmo se houver erro no R2
      }
    }
    // Atualizar storageUsed do usuário
    const userDoc = await userRef.get();
    const currentStorageUsed = userDoc.data().storageUsed || 0;
    const newStorageUsed = Math.max(0, currentStorageUsed - (data.size || 0));
    await userRef.update({ storageUsed: newStorageUsed });
    // Excluir documento do Firestore
    await docRef.delete();
    logger.info('Documento excluído com sucesso:', { documentId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao excluir documento:', { message: error.message });
    res.status(500).json({ error: 'Erro ao excluir o documento', details: error.message });
  }
});

module.exports = router;