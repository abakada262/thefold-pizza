/**
 * seed-recipes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Run once to populate Firestore with:
 *   - /ingredients  — one doc per unique ingredient
 *   - /recipes      — one doc per pizza variant (flavor × size)
 *
 * Usage:
 *   node seed-recipes.js
 *
 * Place this file in your project root (next to server/) and run from there.
 * It reads your existing firebase config so no extra setup is needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { db } = require('../../config/firebase');

// ── Ingredient master list ────────────────────────────────────────────────────
// Keys are used internally to link recipes → ingredients.
// name: display name  |  unit: storage unit  |  defaultStock: initial grams
const INGREDIENTS = {
  dough:          { name: 'Dough',            unit: 'g',  defaultStock: 10000 },
  red_sauce:      { name: 'Red Sauce',         unit: 'oz', defaultStock: 500   },
  mozzarella:     { name: 'Mozzarella',        unit: 'g',  defaultStock: 5000  },
  cheddar:        { name: 'Cheddar',           unit: 'g',  defaultStock: 3000  },
  cream_cheese:   { name: 'Cream Cheese',      unit: 'g',  defaultStock: 2000  },
  pepperoni:      { name: 'Pepperoni',         unit: 'g',  defaultStock: 3000  },
  ham:            { name: 'Ham',               unit: 'g',  defaultStock: 2000  },
  pineapple:      { name: 'Pineapple',         unit: 'g',  defaultStock: 2000  },
  green_bell:     { name: 'Green Bell Pepper', unit: 'g',  defaultStock: 1500  },
  mushroom:       { name: 'Mushroom',          unit: 'g',  defaultStock: 1500  },
  onions:         { name: 'Onions',            unit: 'g',  defaultStock: 1500  },
  black_olives:   { name: 'Black Olives',      unit: 'g',  defaultStock: 1000  },
  tomato:         { name: 'Tomato',            unit: 'g',  defaultStock: 2000  },
  jalapeno:       { name: 'Jalapeño',          unit: 'g',  defaultStock: 1000  },
  bacon:          { name: 'Bacon',             unit: 'g',  defaultStock: 2000  },
  spinach:        { name: 'Spinach',           unit: 'g',  defaultStock: 2000  },
  chicken:        { name: 'Chicken',           unit: 'g',  defaultStock: 3000  },
  shrimp:         { name: 'Shrimp',            unit: 'g',  defaultStock: 2000  },
  italian_sausage:{ name: 'Italian Sausage',   unit: 'g',  defaultStock: 2000  },
  beef_toppings:  { name: 'Beef Toppings',     unit: 'g',  defaultStock: 2000  },
};

// ── Size key → inches string (matches how resolveRecipe parses item names) ───
// Your menu item names contain sizes like:
//   "The Pepperoni (Regular)"  → no numeric size → 'all'
//   "The Hawaiin (30\" Party)" → '30'
//   "The Hawaiin (36\" Fiesta)"→ '36'
// We create one recipe per size so the backend can match either.
//
// For sizes not in your menu (10", 12", 16", 20") the per-unit figures
// from the spreadsheet are stored but the menu currently only sells
// Regular (≈12"), 30", and 36". Add more if you add those sizes later.

const SIZES = {
  '10': 10, '12': 12, '16': 16, '20': 20, '30': 30, '36': 36,
};

// ── Helper: build ingredient array for one recipe row ────────────────────────
function ing(key, qty) {
  return { ingredientKey: key, qty };  // ingredientId filled in during seeding
}

// ── Recipe definitions ────────────────────────────────────────────────────────
// Format: { menuItemId, menuItemName, sizes: { '10': [...ings], '12': [...], ... } }
//
// menuItemId must match the id of the corresponding doc in your Firestore
// 'menu' collection. Set these to your real Firestore IDs before running.
//
// For flavors that appear on custom pizzas (30" / 36"), we also include a
// "custom_pizza" entry — the custom pizza resolver looks for menuItemId="custom_pizza".

const RECIPES = [
  // ── FOUR CHEESE ────────────────────────────────────────────────────────────
  {
    menuItemId: 'qe8p0OukNsHhvMjPFl69',
    menuItemName: 'Four Cheese',
    sizes: {
      '10': [ ing('dough',200),   ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('cream_cheese',30)  ],
      '12': [ ing('dough',300),   ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('cream_cheese',50)  ],
      '16': [ ing('dough',500),   ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('cream_cheese',75)  ],
      '20': [ ing('dough',800),   ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('cream_cheese',125) ],
      '30': [ ing('dough',1800),  ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('cream_cheese',237.5)],
      '36': [ ing('dough',2200),  ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('cream_cheese',337.5)],
    }
  },

  // ── PEPPERONI ──────────────────────────────────────────────────────────────
  {
    menuItemId: 'vdsMSTOPxvgxPHydMerD',
    menuItemName: 'The Pepperoni',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('pepperoni',36) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('pepperoni',60) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('pepperoni',90) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('pepperoni',150)],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('pepperoni',285)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('pepperoni',405)],
    }
  },

  // ── HAWAIIAN ───────────────────────────────────────────────────────────────
  {
    menuItemId: 'rQTBhA6MIRhCZHAhqdeE',
    menuItemName: 'The Hawaiian',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('ham',30),   ing('pineapple',30)  ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('ham',50),   ing('pineapple',50)  ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('ham',75),   ing('pineapple',75)  ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('ham',125),  ing('pineapple',125) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('ham',237.5),ing('pineapple',237.5)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('ham',337.5),ing('pineapple',337.5)],
    }
  },

  // ── VEGGIE ─────────────────────────────────────────────────────────────────
  {
    menuItemId: 'GA5eynYUBQKcqGcRr6lm',
    menuItemName: 'Veggies',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('green_bell',12), ing('mushroom',12), ing('onions',9),  ing('black_olives',9),  ing('tomato',30) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('green_bell',20), ing('mushroom',20), ing('onions',15), ing('black_olives',15), ing('tomato',50) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('green_bell',30), ing('mushroom',30), ing('onions',22.5),ing('black_olives',22.5),ing('tomato',75)],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('green_bell',50), ing('mushroom',50), ing('onions',37.5),ing('black_olives',37.5),ing('tomato',125)],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('green_bell',95), ing('mushroom',95), ing('onions',71.25),ing('black_olives',71.25),ing('tomato',237.5)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('green_bell',135),ing('mushroom',135),ing('onions',101.25),ing('black_olives',101.25),ing('tomato',337.5)],
    }
  },

  // ── JALAPEÑO ───────────────────────────────────────────────────────────────
  {
    menuItemId: 'KUepStUmOlVbu5oRkZBp',
    menuItemName: 'Jalapeño',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('ham',24), ing('jalapeno',18), ing('bacon',18) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('ham',40), ing('jalapeno',30), ing('bacon',30) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('ham',60), ing('jalapeno',45), ing('bacon',45) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('ham',100),ing('jalapeno',75), ing('bacon',75) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('ham',190),ing('jalapeno',142.5),ing('bacon',142.5)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('ham',270),ing('jalapeno',202.5),ing('bacon',202.5)],
    }
  },

  // ── CREAMY SPINACH ─────────────────────────────────────────────────────────
  {
    menuItemId: 'b8gM55pvt6bxTLqGD5EU',
    menuItemName: 'Creamy Spinach',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('spinach',60)  ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('spinach',100) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('spinach',150) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('spinach',250) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('spinach',475) ],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('spinach',675) ],
    }
  },

  // ── LUAU CHICKEN ───────────────────────────────────────────────────────────
  {
    menuItemId: 'm9pq5MASxIQe5Ah3hx8H',
    menuItemName: 'Luau Chicken',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('chicken',30), ing('pineapple',24), ing('bacon',18) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('chicken',50), ing('pineapple',40), ing('bacon',30) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('chicken',75), ing('pineapple',60), ing('bacon',45) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('chicken',125),ing('pineapple',100),ing('bacon',75) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('chicken',237.5),ing('pineapple',190),ing('bacon',142.5)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('chicken',337.5),ing('pineapple',270),ing('bacon',202.5)],
    }
  },

  // ── BBQ CHICKEN ────────────────────────────────────────────────────────────
  {
    menuItemId: 'PXzjl7s9Ly17X7WCvhvN',
    menuItemName: 'BBQ Chicken',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('chicken',36), ing('green_bell',12),ing('mushroom',18),ing('onions',9),   ing('black_olives',9)   ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('chicken',60), ing('green_bell',20),ing('mushroom',30),ing('onions',15),  ing('black_olives',15)  ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('chicken',90), ing('green_bell',30),ing('mushroom',45),ing('onions',22.5),ing('black_olives',22.5) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('chicken',150),ing('green_bell',50),ing('mushroom',75),ing('onions',37.5),ing('black_olives',37.5) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('chicken',285),ing('green_bell',95),ing('mushroom',142.5),ing('onions',71.25),ing('black_olives',71.25)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('chicken',405),ing('green_bell',135),ing('mushroom',202.5),ing('onions',101.25),ing('black_olives',101.25)],
    }
  },

  // ── ALL MEAT ───────────────────────────────────────────────────────────────
  {
    menuItemId: 'Kl3d2PCQXtcl3XBemAks',
    menuItemName: 'All Meat',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('pepperoni',21), ing('ham',15),   ing('italian_sausage',18), ing('bacon',18) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('pepperoni',35), ing('ham',25),   ing('italian_sausage',30), ing('bacon',30) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('pepperoni',52.5),ing('ham',37.5),ing('italian_sausage',45), ing('bacon',45) ],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('pepperoni',87.5),ing('ham',62.5),ing('italian_sausage',75), ing('bacon',75) ],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('pepperoni',166.25),ing('ham',118.75),ing('italian_sausage',142.5),ing('bacon',142.5)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('pepperoni',236.25),ing('ham',168.75),ing('italian_sausage',202.5),ing('bacon',202.5)],
    }
  },

  // ── THE FOLD SPECIAL ───────────────────────────────────────────────────────
  {
    menuItemId: 'IBqnAKgs14ZuuowWkkkW',
    menuItemName: 'The Fold Special',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('pepperoni',18),ing('italian_sausage',15),ing('bacon',24),ing('green_bell',9), ing('mushroom',15),ing('onions',6),  ing('black_olives',7.2) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('pepperoni',30),ing('italian_sausage',25),ing('bacon',40),ing('green_bell',15),ing('mushroom',25),ing('onions',10), ing('black_olives',12)  ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('pepperoni',45),ing('italian_sausage',37.5),ing('bacon',60),ing('green_bell',22.5),ing('mushroom',37.5),ing('onions',15),ing('black_olives',18)],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('pepperoni',75),ing('italian_sausage',62.5),ing('bacon',100),ing('green_bell',37.5),ing('mushroom',62.5),ing('onions',25),ing('black_olives',30)],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('pepperoni',142.5),ing('italian_sausage',118.75),ing('bacon',190),ing('green_bell',71.25),ing('mushroom',118.75),ing('onions',47.5),ing('black_olives',57)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('pepperoni',202.5),ing('italian_sausage',168.75),ing('bacon',270),ing('green_bell',101.25),ing('mushroom',168.75),ing('onions',67.5),ing('black_olives',81)],
    }
  },

  // ── SHRIMP ─────────────────────────────────────────────────────────────────
  {
    menuItemId: 'O1V7gOZllwYjy1FzUEMA',
    menuItemName: 'The Shrimp',
    sizes: {
      '10': [ ing('dough',200),  ing('red_sauce',61.41),  ing('mozzarella',46),    ing('cheddar',20),    ing('shrimp',36), ing('green_bell',15),ing('onions',15) ],
      '12': [ ing('dough',300),  ing('red_sauce',89),     ing('mozzarella',67.2),  ing('cheddar',28.8),  ing('shrimp',60), ing('green_bell',25),ing('onions',25) ],
      '16': [ ing('dough',500),  ing('red_sauce',157.53), ing('mozzarella',118.9), ing('cheddar',50.98), ing('shrimp',90), ing('green_bell',37.5),ing('onions',37.5)],
      '20': [ ing('dough',800),  ing('red_sauce',246.53), ing('mozzarella',186.1), ing('cheddar',79.78), ing('shrimp',150),ing('green_bell',62.5),ing('onions',62.5)],
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('shrimp',285),ing('green_bell',118.75),ing('onions',118.75)],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('shrimp',405),ing('green_bell',168.75),ing('onions',168.75)],
    }
  },

  // ── CUSTOM PIZZA — 9 FLAVORS (30" and 36") ────────────────────────────────
  // Used for custom pizza orders. menuItemId = "custom_pizza" is looked up
  // by resolveRecipe when item.isCustom is true.
  {
    menuItemId: 'custom_pizza',
    menuItemName: 'Custom Pizza — 9 Flavors',
    sizes: {
      '30': [ ing('dough',1800), ing('red_sauce',556.25), ing('mozzarella',420),   ing('cheddar',180),   ing('bacon',85.8),  ing('black_olives',27.72),ing('chicken',72.6), ing('cream_cheese',50),   ing('green_bell',36.3),ing('ham',75.9),  ing('italian_sausage',36.3),ing('jalapeno',19.8),ing('mushroom',49.5),ing('onions',26.4),ing('pepperoni',82.5),ing('pineapple',59.4),ing('tomato',33) ],
      '36': [ ing('dough',2200), ing('red_sauce',801),    ing('mozzarella',604.8), ing('cheddar',259.2), ing('bacon',117),    ing('black_olives',37.8),  ing('chicken',99),   ing('cream_cheese',75),    ing('green_bell',49.5),ing('ham',103.5),ing('italian_sausage',49.5),  ing('jalapeno',27), ing('mushroom',67.5),ing('onions',36),  ing('pepperoni',112.5),ing('pineapple',81),    ing('tomato',45) ],
    }
  },

  // ── CUSTOM PIZZA — 11 FLAVORS (36" only) ──────────────────────────────────
  {
    menuItemId: 'custom_pizza_11',
    menuItemName: 'Custom Pizza — 11 Flavors',
    sizes: {
      '36': [ ing('dough',2600), ing('red_sauce',1019.94),ing('mozzarella',770.1), ing('cheddar',330.05), ing('bacon',124.8), ing('black_olives',40.32),ing('chicken',105.6),ing('cream_cheese',96),    ing('green_bell',76.8),ing('ham',110.4),ing('italian_sausage',52.8),   ing('jalapeno',28.8),ing('mushroom',72), ing('onions',62.4), ing('pepperoni',120),   ing('pineapple',86.4),  ing('shrimp',57.6),ing('spinach',96), ing('tomato',48)  ],
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SEED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding ingredients...');

  // 1. Create / upsert ingredient docs and collect id map
  const ingIdMap = {}; // ingredientKey → Firestore doc id
  const batch1 = db.batch();

  for (const [key, data] of Object.entries(INGREDIENTS)) {
    // Check if ingredient already exists by name
    const existing = await db.collection('ingredients')
      .where('name', '==', data.name).limit(1).get();

    if (!existing.empty) {
      ingIdMap[key] = existing.docs[0].id;
      console.log(`  ↩ Ingredient already exists: ${data.name} (${existing.docs[0].id})`);
    } else {
      const ref = db.collection('ingredients').doc();
      ingIdMap[key] = ref.id;
      batch1.set(ref, {
        id: ref.id,
        name: data.name,
        unit: data.unit,
        currentStock: data.defaultStock,
        lowStockThreshold: Math.round(data.defaultStock * 0.1),
        cost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`  + ${data.name} → ${ref.id}`);
    }
  }

  await batch1.commit();
  console.log('✅ Ingredients done.\n');

  // 2. Create recipe docs
  console.log('🍕 Seeding recipes...');
  const batch2 = db.batch();
  let count = 0;

  for (const recipe of RECIPES) {
    for (const [sizeStr, ings] of Object.entries(recipe.sizes)) {
      // Check for duplicate
      const existing = await db.collection('recipes')
        .where('menuItemId', '==', recipe.menuItemId)
        .where('size', '==', sizeStr).limit(1).get();
      if (!existing.empty) {
        console.log(`  ↩ Recipe exists: ${recipe.menuItemName} ${sizeStr}"`);
        continue;
      }

      const ref = db.collection('recipes').doc();
      const ingredients = ings.map(i => ({
        ingredientId: ingIdMap[i.ingredientKey],
        name: INGREDIENTS[i.ingredientKey].name,
        unit: INGREDIENTS[i.ingredientKey].unit,
        qty: i.qty,
      }));

      batch2.set(ref, {
        id: ref.id,
        menuItemId: recipe.menuItemId,
        menuItemName: recipe.menuItemName,
        size: sizeStr,
        ingredients,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: 'seed-script',
      });

      console.log(`  + ${recipe.menuItemName} ${sizeStr}"`);
      count++;
    }
  }

  await batch2.commit();
  console.log(`✅ Recipes done — ${count} docs created.\n`);
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('⚠️  Remember to replace all REPLACE_WITH_*_MENU_ID placeholders');
  console.log('   with the real Firestore document IDs from your /menu collection.');
}

seed().catch(e => { console.error(e); process.exit(1); });