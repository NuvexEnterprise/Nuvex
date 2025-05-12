const admin = require('firebase-admin');
const serviceAccount = require('./nuvexenterprise-firebase-adminsdk-fbsvc-a93a5eb355.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db, admin };