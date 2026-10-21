// fix-recipe-ids.js
// Run: node server/routes/fix-recipe-ids.js
// Fixes menuItemId in all recipe docs by fuzzy-matching recipe names to real menu IDs.

const { db } = require('../../config/firebase');

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')  // remove special chars
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns true if every word in `query` appears somewhere in `target`
function fuzzyMatch(query, target) {
  const qWords = normalize(query).split(' ').filter(Boolean);
  const tNorm  = normalize(target);
  return qWords.every(w => tNorm.includes(w));
}

async function main() {
  // 1. Fetch all menu items
  const menuSnap = await db.collection('menu').get();
  const menuItems = []; // { id, name }
  menuSnap.forEach(doc => {
    menuItems.push({ id: doc.id, name: doc.data().name || '' });
  });
  console.log(`\nMenu items loaded: ${menuItems.length}`);
  menuItems.forEach(m => console.log(`  ${m.id}  →  ${m.name}`));

  // 2. Fetch all recipes
  const recipesSnap = await db.collection('recipes').get();
  console.log(`\nRecipe docs loaded: ${recipesSnap.size}`);

  const batch = db.batch();
  let updated = 0;
  let skipped = 0;
  const noMatch = new Set();

  recipesSnap.forEach(doc => {
    const data = doc.data();
    const recName = data.menuItemName || '';

    // Skip custom pizza entries — they use a fixed string ID
    if (recName.toLowerCase().includes('custom')) {
      skipped++;
      return;
    }

    // Find best menu item match using fuzzy word matching
    const match = menuItems.find(m => fuzzyMatch(recName, m.name) || fuzzyMatch(m.name, recName));

    if (!match) {
      noMatch.add(recName);
      skipped++;
      return;
    }

    if (data.menuItemId === match.id) {
      skipped++; // already correct
      return;
    }

    batch.update(doc.ref, { menuItemId: match.id });
    console.log(`  ✓ "${recName}" ${data.size}" : ${data.menuItemId} → ${match.id}  (${match.name})`);
    updated++;
  });

  if (noMatch.size > 0) {
    console.log('\n⚠ Could not match these recipe names to any menu item:');
    noMatch.forEach(n => console.log(`    "${n}"`));
  }

  if (updated === 0) {
    console.log('\nAll recipe IDs are already correct. Nothing to update.');
    process.exit(0);
  }

  await batch.commit();
  console.log(`\nDone! Updated ${updated} recipe docs. Skipped ${skipped}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});