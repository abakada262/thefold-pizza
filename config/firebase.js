const admin = require('firebase-admin');

if (!admin.apps.length) {
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  const key = rawKey.split(String.fromCharCode(13,10)).join(String.fromCharCode(10)).split(String.fromCharCode(13)).join(String.fromCharCode(10));
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: key,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    projectId: 'thefold-pizza',
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };