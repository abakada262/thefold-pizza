const express = require('express');
const router = express.Router();
const { db } = require('../../config/firebase');

// Get all menu items
router.get('/', async (req, res) => {
  try {
    const snap = await db.collection('menu').where('available', '==', true).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Seed default menu (run once)
router.post('/seed', async (req, res) => {
  const defaultMenu = [
    { name: 'Margherita Classic', category: 'pizza', price: 420, description: 'San Marzano tomato, fresh mozzarella, basil', available: true, image: '🍕' },
    { name: 'Pepperoni Fold', category: 'pizza', price: 490, description: 'Double pepperoni, mozzarella, oregano', available: true, image: '🍕' },
    { name: 'BBQ Chicken', category: 'pizza', price: 520, description: 'Smoked chicken, BBQ sauce, red onion', available: true, image: '🍕' },
    { name: 'Four Cheese', category: 'pizza', price: 550, description: 'Mozzarella, cheddar, gorgonzola, parmesan', available: true, image: '🍕' },
    { name: 'Veggie Supreme', category: 'pizza', price: 460, description: 'Bell peppers, mushrooms, olives, spinach', available: true, image: '🍕' },
    { name: 'Truffle Mushroom', category: 'pizza', price: 580, description: 'Wild mushrooms, truffle oil, mozzarella', available: true, image: '🍕' },
    { name: 'Garlic Knots', category: 'sides', price: 150, description: 'Buttery garlic knots with marinara dip', available: true, image: '🧄' },
    { name: 'Caesar Salad', category: 'sides', price: 180, description: 'Romaine, croutons, parmesan, caesar dressing', available: true, image: '🥗' },
    { name: 'Chicken Wings', category: 'sides', price: 280, description: '6 pcs crispy wings, choice of sauce', available: true, image: '🍗' },
    { name: 'Soft Drinks', category: 'drinks', price: 80, description: 'Coke, Sprite, Royal, same price', available: true, image: '🥤' },
    { name: 'Iced Tea', category: 'drinks', price: 90, description: 'Freshly brewed, sweetened or unsweetened', available: true, image: '🧋' },
    { name: 'Tiramisu', category: 'desserts', price: 180, description: 'Classic Italian coffee dessert', available: true, image: '🍰' },
  ];
  try {
    const batch = db.batch();
    defaultMenu.forEach(item => {
      const ref = db.collection('menu').doc();
      batch.set(ref, item);
    });
    await batch.commit();
    res.json({ success: true, message: 'Menu seeded!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
