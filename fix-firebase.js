const fs = require('fs');
const lines = [
  "const admin = require('firebase-admin');",
  "",
  "if (!admin.apps.length) {",
  "  admin.initializeApp({",
  "    credential: admin.credential.cert({",
  "      projectId: process.env.FIREBASE_PROJECT_ID,",
  "      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,",
  "      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/[\\][\\]n/g, '\n'),",
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
console.log('Done! Check config/firebase.js');
