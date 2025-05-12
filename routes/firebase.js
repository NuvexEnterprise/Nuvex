const admin = require('firebase-admin');
const serviceAccount = require('../nuvex-5c9f4-firebase-adminsdk-fbsvc-f54a279822.json');

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
db.settings({ ignoreUndefinedProperties: true });
module.exports = { db, admin };