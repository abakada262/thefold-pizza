const { db } = require('../../config/firebase');

async function main() {
  const snap = await db.collection('recipes').get();
  const summary = {};
  snap.forEach(doc => {
    const d = doc.data();
    const key = `${d.menuItemName} (${d.menuItemId})`;
    if (!summary[key]) summary[key] = [];
    summary[key].push(d.size);
  });
  console.log('\nRecipes by pizza:\n');
  for (const [key, sizes] of Object.entries(summary).sort()) {
    console.log(`  ${key}`);
    console.log(`    sizes: ${sizes.sort().join(', ')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });