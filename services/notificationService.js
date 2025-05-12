const { db } = require('../firebase');

async function sendNotification(userId, notificationData) {
	return db.collection('users').doc(userId)
	  .collection('notifications')
	  .add({
		 read: false,
		 archived: false,
		 timestamp: new Date().toISOString(),
		 ...notificationData
	  });
}

async function notifyStorageLimit(userId, storageUsed) {
	const message = `Atenção! Você está quase atingindo o limite de armazenamento. Já foram usados ${(storageUsed / (1024*1024*1024)).toFixed(2)} GB.`;
	return sendNotification(userId, {
		message,
		type: 'alert',
		category: 'storage',
		priority: 'high',
		icon: 'storage'
	});
}

async function notifySubscriptionPlan(userId, planInfo) {
	const message = planInfo.isTrial 
	  ? `Seu período de teste expira em ${planInfo.daysLeft} dia(s). Ative um plano para continuar utilizando o serviço.` 
	  : `Seu plano "${planInfo.name}" expira em ${planInfo.daysLeft} dia(s).`;
	return sendNotification(userId, {
		message,
		type: 'system',
		category: 'subscription',
		priority: 'normal',
		icon: 'subscriptions',
		metadata: planInfo
	});
}

async function notifyDocumentUpload(userId, clientId, documentName) {
	const message = `O documento "${documentName}" foi enviado com sucesso.`;
	return sendNotification(userId, {
		message,
		type: 'user',
		category: 'upload',
		priority: 'normal',
		icon: 'file_upload',
		metadata: { clientId, documentName }
	});
}

async function notifyDocumentDownload(userId, documentName) {
	const message = `O documento "${documentName}" foi baixado.`;
	return sendNotification(userId, {
		message,
		type: 'user',
		category: 'download',
		priority: 'low',
		icon: 'file_download',
		metadata: { documentName }
	});
}

async function notifyDocumentDue(userId, clientName, documentName, dueDate) {
	// Calcular quantos dias faltam para o vencimento
	const daysLeft = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
	// Só envia a notificação se faltar exatamente 4 dias
	if (daysLeft !== 4) {
		return;
	}
	const message = `O documento "${documentName}" do cliente "${clientName}" estará vencendo em 4 dias (vencimento: ${new Date(dueDate).toLocaleDateString('pt-BR')}).`;
	return sendNotification(userId, {
		message,
		type: 'alert',
		category: 'document-due',
		priority: 'high',
		icon: 'event',
		metadata: { clientName, documentName, dueDate, daysLeft }
	});
}

module.exports = {
	sendNotification,
	notifyStorageLimit,
	notifySubscriptionPlan,
	notifyDocumentUpload,
	notifyDocumentDownload,
	notifyDocumentDue,
};