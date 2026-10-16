const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = require('C:/Users/robert geronimo jr/Downloads/thefold-pizza-firebase-adminsdk-fbsvc-6113f5f096.json');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'thefold-pizza',
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };