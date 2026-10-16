// fix-recipe-ids2.js
// Fixes the remaining 5 unmatched recipe groups using direct ID mapping.
// Run: node server/routes/fix-recipe-ids2.js

const { db } = require('../../config/firebase');

// Direct mapping: recipe menuItemName → correct Firestore menu doc ID
// IDs taken from the menu collection output in the previous run.
const DIRECT_MAP = {
  'Veggies':       'GA5eynYUBQKcqGcRr6im',  // The Veggie
  'Luau Chicken':  'm9pq5MASx1Qe5Ah3hx8H',  // The Luau Ckhicken
  'The Hawaiian':  'rQTBhA6MIRhCZHAhqdeE',  // The Haiiawan
  'BBQ Chicken':   'PXzjl7s9Ly17X7WCvhvN',  // The BBQ chickem
  'Four Cheese':   'qe8p0OukNsHhvMjPFl69',  // Four Cheese (HHGJHMFM)
};

async function main() {
  const recipesSnap = await db.collection('recipes').get();
  console.log(`Recipe docs loaded: ${recipesSnap.size}`);

  const batch = db.batch();
  let updated = 0;
  let skipped = 0;

  recipesSnap.forEach(doc => {
    const data = doc.data();
    const correctId = DIRECT_MAP[data.menuItemName];

    if (!correctId) { skipped++; return; }
    if (data.menuItemId === correctId) { skipped++; return; }

    batch.update(doc.ref, { menuItemId: correctId });
    console.log(`  ✓ "${data.menuItemName}" ${data.size}" : ${data.menuItemId} → ${correctId}`);
    updated++;
  });

  if (updated === 0) {
    console.log('Nothing to update — all already correct.');
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