const admin = require('firebase-admin');

let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
    console.log('Firebase Admin usando credenciais das variáveis de ambiente');
  } catch (error) {
    console.error('Erro ao analisar as credenciais Firebase das variáveis de ambiente:', error);
    process.exit(1);
  }
} else {
  try {
    const serviceAccount = require('./nuvexenterprise-firebase-adminsdk-fbsvc-0107aa5acf.json');
    credential = admin.credential.cert(serviceAccount);
    console.log('Firebase Admin usando credenciais do arquivo local');
  } catch (error) {
    console.error('Erro ao carregar credenciais do arquivo:', error);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: credential
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db, admin };