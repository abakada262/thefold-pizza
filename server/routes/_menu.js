const { db } = require('../../config/firebase');
db.collection('menu').get().then(s => {
  s.docs.forEach(d => console.log(d.id + ' -> ' + d.data().name));
  process.exit(0);
});