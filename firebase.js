const admin = require('firebase-admin');

// Corrige a private_key escapando \n corretamente
const raw = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
raw.private_key = raw.private_key.replace(/\\n/g, '\n');

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(raw)
    });
    console.log('Firebase Admin inicializado com sucesso');
  }
} catch (error) { 
  console.error('Erro ao inicializar Firebase Admin:', error);
  process.exit(1);
}

const db = admin.firestore();
module.exports = { db, admin };