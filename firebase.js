const admin = require('firebase-admin');
const serviceAccount = require('./nuvex-88148-firebase-adminsdk-fbsvc-217ea656ef.json');

try {
  if (!admin.apps.length) { 
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin inicializado com sucesso');
  }
} catch (error) {
  console.error('Erro ao inicializar Firebase Admin:', error);
  process.exit(1); 
}

const db = admin.firestore();
module.exports = { db, admin };