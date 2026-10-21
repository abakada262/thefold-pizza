const fs = require('fs');
const lines = [
  "const admin = require('firebase-admin');",
  "",
  "if (!admin.apps.length) {",
  "  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';",
  "  const key = rawKey.split('\r\n').join('\n').split('\r').join('\n');",
  "  admin.initializeApp({",
  "    credential: admin.credential.cert({",
  "      projectId: process.env.FIREBASE_PROJECT_ID,",
  "      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,",
  "      privateKey: key,",
  "      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,",
  "    }),",
  "    projectId: 'thefold-pizza',",
  "  });",
  "}",
  "",
  "const db = admin.firestore();",
  "const auth = admin.auth();",
  "",
  "module.exports = { admin, db, auth };",
].join('\n') + '\n';
fs.writeFileSync('config/firebase.js', lines);
console.log('Done!');
