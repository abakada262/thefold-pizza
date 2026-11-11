const express = require('express');
const router = express.Router();
const { db } = require('../../config/firebase');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const requireAdmin = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ message: 'Forbidden: Admin only' });
  }
  next();
};

// Upload image — uses memory storage, uploads to Cloudinary (works on Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(file.mimetype) && allowed.test(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Images only!'));
  }
});

router.post('/upload-image', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'thefold-pizza/menu' },
        (error, result) => error ? reject(error) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    res.json({ success: true, imageUrl: result.secure_url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// orders
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders').get();
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper: deduct ingredients when order moves to "preparing"
async function deductIngredients(db, orderId, order) {
  const items = order.items || [];
  if (!items.length) return;

  const [recipesSnap, menuSnap] = await Promise.all([
    db.collection('recipes').get(),
    db.collection('menu').where('availableInCustom', '==', true).get(),
  ]);
  const recipes = recipesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const customMenuItems = menuSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Helper: find recipe for a custom flavor by name, using menuItemId when available
  const findFlavorRecipe = (flavorName, sizeKey) => {
    const menuItem = customMenuItems.find(m => m.name && m.name.toLowerCase() === flavorName.toLowerCase());
    return recipes.find(r => {
      if (menuItem) {
        if (r.menuItemId !== menuItem.id) return false;
      } else {
        if (!r.menuItemName || r.menuItemName.toLowerCase() !== flavorName.toLowerCase()) return false;
      }
      if (r.size && r.size !== 'all' && r.size !== sizeKey) return false;
      return true;
    });
  };

  // All recipes used for deduction (custom pizza flavors now use Recipes/BOM too)
  const regularRecipes = recipes;

  const deductionLog = [];
  const batch = db.batch();

  // Helper: deduct a list of ingredients for a given qty multiplier
  const deductIngList = async (ingList, qty, reasonLabel) => {
    for (const ing of ingList) {
      const needed = (parseFloat(ing.qty) || parseFloat(ing.amount) || 0) * qty;
      if (!needed || !ing.ingredientId) continue;

      const ingRef = db.collection('ingredients').doc(ing.ingredientId);
      const ingDoc = await ingRef.get();
      if (!ingDoc.exists) continue;

      const current = parseFloat(ingDoc.data().currentStock) || 0;
      batch.update(ingRef, {
        currentStock: Math.max(0, current - needed),
        updatedAt: new Date().toISOString(),
      });

      const logRef = db.collection('ingredient_logs').doc();
      batch.set(logRef, {
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName || ingDoc.data().name || '',
        unit: ingDoc.data().unit || '',
        action: 'deducted',
        qty: -needed,
        amount: needed,
        balanceBefore: current,
        balanceAfter: Math.max(0, current - needed),
        reason: `Order #${orderId.slice(0,8).toUpperCase()} — ${reasonLabel}`,
        orderId,
        menuItem: reasonLabel,
        createdAt: new Date().toISOString(),
      });

      deductionLog.push({
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName || ingDoc.data().name || '',
        amountDeducted: needed,
      });
    }
  };

  for (const item of items) {
    const itemQty = parseInt(item.qty) || 1;

    // ── CUSTOM PIZZA: deduct per flavor using Recipes/BOM ──
    // Each flavor slot corresponds to a menu item; find its recipe and divide by slot count
    if (item.isCustom && Array.isArray(item.customFlavors) && item.customFlavors.length) {
      const pizzaInches = item.sizeKey
        ? parseInt(item.sizeKey)
        : (item.id ? parseInt((item.id.match(/\d+$/) || ['30'])[0]) : 30);
      const sizeKey = String(pizzaInches); // '30' or '36'
      const slotCount = Math.max(1, item.customFlavors.length);

      for (const flavorName of item.customFlavors) {
        if (!flavorName) continue;
        const fRecipe = findFlavorRecipe(flavorName, sizeKey);
        if (!fRecipe) continue;
        // Divide each ingredient qty by slot count (shared crust/resources)
        const scaledIngs = (fRecipe.ingredients || []).map(ing => ({
          ...ing,
          qty: (parseFloat(ing.qty) || parseFloat(ing.amount) || 0) / slotCount,
        }));
        await deductIngList(scaledIngs, itemQty, `${item.name} · ${flavorName}`);
      }
      continue; // skip regular recipe lookup for custom pizza
    }

    // ── REGULAR MENU ITEM ──
    const menuItemId = item.menuItemId || item.id;

    // Extract size from item name (e.g. 'BBQ Chicken (30")')
    const sizeMatch = item.name && item.name.match(/\((\d+)[""]/);
    const itemSize = item.size || (sizeMatch ? sizeMatch[1] : null);

    // ── Use Recipes/BOM ──
    const recipe = regularRecipes.find(r => {
      if (menuItemId && r.menuItemId !== menuItemId) return false;
      if (!menuItemId && r.menuItemName !== item.name) return false;
      if (itemSize && r.size !== 'all' && r.size !== itemSize) return false;
      return true;
    });
    if (!recipe) continue;

    await deductIngList(recipe.ingredients || [], itemQty, item.name);
  }

  await batch.commit();
  await db.collection('orders').doc(orderId).update({
    ingredientsDeducted: true,
    ingredientDeductions: deductionLog,
  });
}

// Helper: restore ingredients when order is cancelled
async function restoreIngredients(db, orderId, order) {
  const deductions = order.ingredientDeductions || [];
  if (!deductions.length) return;

  const batch = db.batch();
  for (const d of deductions) {
    if (!d.ingredientId || !d.amountDeducted) continue;
    const ingRef = db.collection('ingredients').doc(d.ingredientId);
    const ingDoc = await ingRef.get();
    if (!ingDoc.exists) continue;

    const current = parseFloat(ingDoc.data().currentStock) || 0;
    batch.update(ingRef, {
      currentStock: current + d.amountDeducted,
      updatedAt: new Date().toISOString(),
    });

    const ingData = ingDoc.data();
    const logRef = db.collection('ingredient_logs').doc();
    batch.set(logRef, {
      ingredientId: d.ingredientId,
      ingredientName: d.ingredientName || '',
      unit: ingData.unit || '',
      action: 'restocked',
      qty: d.amountDeducted,
      amount: d.amountDeducted,
      balanceBefore: current,
      balanceAfter: current + d.amountDeducted,
      reason: `Cancelled Order #${orderId.slice(0,8).toUpperCase()} — restored`,
      orderId,
      createdAt: new Date().toISOString(),
    });
  }
  await batch.commit();
}

// Preview ingredient levels before moving to preparing
router.get('/orders/:id/prepare-preview', requireAdmin, async (req, res) => {
  try {
    const orderDoc = await db.collection('orders').doc(req.params.id).get();
    if (!orderDoc.exists) return res.status(404).json({ message: 'Order not found' });
    const order = orderDoc.data();

    if (order.ingredientsDeducted) {
      return res.json({ success: true, alreadyDeducted: true, ingredients: [], allSufficient: true });
    }

    const items = order.items || [];
    if (!items.length) return res.json({ success: true, ingredients: [], allSufficient: true });

    const [recipesSnap, menuSnap] = await Promise.all([
      db.collection('recipes').get(),
      db.collection('menu').where('availableInCustom', '==', true).get(),
    ]);
    const recipes = recipesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const customMenuItems = menuSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const findFlavorRecipe = (flavorName, sizeKey) => {
      const menuItem = customMenuItems.find(m => m.name && m.name.toLowerCase() === flavorName.toLowerCase());
      return recipes.find(r => {
        if (menuItem) {
          if (r.menuItemId !== menuItem.id) return false;
        } else {
          if (!r.menuItemName || r.menuItemName.toLowerCase() !== flavorName.toLowerCase()) return false;
        }
        if (r.size && r.size !== 'all' && r.size !== sizeKey) return false;
        return true;
      });
    };

    // Build a map of needed ingredients: ingredientId -> { needed, name, unit }
    const needed = {};

    const addNeeded = (ingList, qty, divideBy = 1) => {
      for (const ing of ingList) {
        if (!ing.ingredientId) continue;
        const q = ((parseFloat(ing.qty) || parseFloat(ing.amount) || 0) / divideBy) * qty;
        if (!q) continue;
        if (!needed[ing.ingredientId]) {
          needed[ing.ingredientId] = { needed: 0, name: ing.ingredientName || '', unit: '' };
        }
        needed[ing.ingredientId].needed += q;
      }
    };

    for (const item of items) {
      const itemQty = parseInt(item.qty) || 1;

      if (item.isCustom && Array.isArray(item.customFlavors) && item.customFlavors.length) {
        const pizzaInches = item.sizeKey ? parseInt(item.sizeKey) : 30;
        const sizeKey = String(pizzaInches);
        const slotCount = Math.max(1, item.customFlavors.length);
        for (const flavorName of item.customFlavors) {
          if (!flavorName) continue;
          const fRecipe = findFlavorRecipe(flavorName, sizeKey);
          if (!fRecipe) continue;
          addNeeded(fRecipe.ingredients || [], itemQty, slotCount);
        }
        continue;
      }

      const menuItemId = item.menuItemId || item.id;
      const sizeMatch = item.name && item.name.match(/\((\d+)[""]/);
      const itemSize = item.size || (sizeMatch ? sizeMatch[1] : null);
      const recipe = recipes.find(r => {
        if (menuItemId && r.menuItemId !== menuItemId) return false;
        if (!menuItemId && r.menuItemName !== item.name) return false;
        if (itemSize && r.size !== 'all' && r.size !== itemSize) return false;
        return true;
      });
      if (!recipe) continue;
      addNeeded(recipe.ingredients || [], itemQty);
    }

    if (!Object.keys(needed).length) {
      return res.json({ success: true, ingredients: [], allSufficient: true });
    }

    // Fetch current stock for each ingredient
    const ingIds = Object.keys(needed);
    const ingDocs = await Promise.all(ingIds.map(id => db.collection('ingredients').doc(id).get()));

    let allSufficient = true;
    let hasLowStock = false;
    const ingredients = ingDocs.map((doc, i) => {
      const id = ingIds[i];
      const info = needed[id];
      const data = doc.exists ? doc.data() : {};
      const currentStock = parseFloat(data.currentStock) || 0;
      const lowStockAlert = parseFloat(data.lowStockAlert) || 0;
      const unit = data.unit || info.unit || '';
      const name = data.name || info.name || id;
      const neededQty = Math.round(info.needed * 100) / 100;
      const sufficient = currentStock >= neededQty;
      const isLow = sufficient && lowStockAlert > 0 && currentStock <= lowStockAlert;

      if (!sufficient) allSufficient = false;
      if (isLow) hasLowStock = true;

      return {
        ingredientId: id,
        name,
        unit,
        needed: neededQty,
        currentStock: Math.round(currentStock * 100) / 100,
        sufficient,
        isLow,
        lowStockAlert,
      };
    });

    res.json({ success: true, ingredients, allSufficient, hasLowStock });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
  const { status, reason } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  try {
    const orderRef = db.collection('orders').doc(req.params.id);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, message: 'Order not found' });
    const order = orderDoc.data();

    const update = { status, updatedAt: new Date().toISOString() };
    if (status === 'cancelled' && reason) update.cancellationReason = reason;

    if (status === 'preparing' && order.status !== 'preparing' && !order.ingredientsDeducted) {
      await deductIngredients(db, req.params.id, order);
    }

    if (status === 'cancelled' && order.ingredientsDeducted) {
      await restoreIngredients(db, req.params.id, order);
      update.ingredientsDeducted = false;
    }

    await orderRef.update(update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [ordersSnap, usersSnap, menuSnap] = await Promise.all([
      db.collection('orders').get(),
      db.collection('users').get(),
      db.collection('menu').get(),
    ]);
    const orders = ordersSnap.docs.map(d => d.data());
    const delivered = orders.filter(o => o.status === 'delivered');
    const totalRevenue = delivered.reduce((sum, o) => sum + (o.total || 0), 0);
    const today = new Date();
    const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today.toDateString());
    const todayDelivered = todayOrders.filter(o => o.status === 'delivered');
    res.json({
      success: true,
      stats: {
        totalOrders: orders.length,
        totalRevenue,
        totalCustomers: usersSnap.size,
        totalMenuItems: menuSnap.size,
        todayOrders: todayOrders.length,
        todayRevenue: todayDelivered.reduce((sum, o) => sum + (o.total || 0), 0),
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        deliveringOrders: orders.filter(o => o.status === 'out_for_delivery').length,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('users').get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/backfill-order-counts', requireAdmin, async (req, res) => {
  try {
    const [ordersSnap, usersSnap] = await Promise.all([
      db.collection('orders').get(),
      db.collection('users').get(),
    ]);
    const counts = {};
    ordersSnap.docs.forEach(d => {
      const uid = d.data().userId;
      if (uid) counts[uid] = (counts[uid] || 0) + 1;
    });
    const batch = db.batch();
    usersSnap.docs.forEach(d => {
      batch.update(d.ref, { totalOrders: counts[d.id] || 0 });
    });
    await batch.commit();
    res.json({ success: true, updated: usersSnap.size, counts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── BAN / UNBAN ─────────────────────────────────────────────────────────────
router.post('/users/:id/ban', requireAdmin, async (req, res) => {
  // Superadmin only
  if (req.session.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin only' });
  }
  const { reason } = req.body;
  try {
    const userRef = db.collection('users').doc(req.params.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });
    const userData = userDoc.data();
    // Prevent banning admins
    if (userData.role === 'admin' || userData.role === 'superadmin') {
      return res.status(400).json({ success: false, message: 'Cannot ban admin accounts' });
    }
    await userRef.update({
      isBanned: true,
      banReason: reason || '',
      bannedAt: new Date().toISOString(),
      bannedBy: req.session.user.email,
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/users/:id/unban', requireAdmin, async (req, res) => {
  if (req.session.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin only' });
  }
  try {
    await db.collection('users').doc(req.params.id).update({
      isBanned: false,
      banReason: '',
      unbannedAt: new Date().toISOString(),
      unbannedBy: req.session.user.email,
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/make-admin', requireAdmin, async (req, res) => {
  const { uid } = req.body;
  try {
    await db.collection('users').doc(uid).update({ role: 'admin' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/remove-admin', requireAdmin, async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ success: false, message: 'uid required' });
  if (req.session.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin only' });
  }
  try {
    await db.collection('users').doc(uid).update({ role: 'customer' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// menu
router.post('/menu', requireAdmin, async (req, res) => {
  const { name, category, price, description, available, image, sizes, addons } = req.body;
  try {
    const ref = await db.collection('menu').add({
      name, category, price: Number(price), description,
      available: available !== false,
      image: image || '🍕',
      sizes: sizes || {},
      addons: addons || {}
    });
    res.json({ success: true, id: ref.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/menu/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('menu').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/menu/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('menu').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/stock/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('stock').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// stock inventory
router.get('/stock', requireAdmin, async (req, res) => {
  try {
    const [menuSnap, stockSnap] = await Promise.all([
      db.collection('menu').get(),
      db.collection('stock').get(),
    ]);
    const stockMap = {};
    stockSnap.docs.forEach(d => { stockMap[d.id] = d.data(); });
    const items = menuSnap.docs.map(d => {
      const menu = { id: d.id, ...d.data() };
      const stock = stockMap[d.id] || { quantity: 50, threshold: 10, notes: '', updatedAt: null };
      return { ...menu, ...stock };
    });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/stock/:id', requireAdmin, async (req, res) => {
  const { quantity, threshold, notes } = req.body;
  const menuId = req.params.id;
  try {
    const stockData = {
      quantity: parseInt(quantity) || 0,
      threshold: parseInt(threshold) || 10,
      notes: notes || '',
      updatedAt: new Date().toISOString(),
      updatedBy: req.session.user.email,
    };
    await db.collection('stock').doc(menuId).set(stockData, { merge: true });
    if (stockData.quantity === 0) {
      await db.collection('menu').doc(menuId).update({ available: false });
    } else {
      await db.collection('menu').doc(menuId).update({ available: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/stock/:id/log', requireAdmin, async (req, res) => {
  const { quantity, threshold, notes, previousQty } = req.body;
  try {
    await db.collection('stock_log').add({
      menuId: req.params.id,
      quantity, previousQty, threshold, notes,
      action: quantity > previousQty ? 'restock' : 'adjustment',
      updatedBy: req.session.user.email,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/stock/:id/logs', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('stock_log')
      .where('menuId', '==', req.params.id)
      .limit(20)
      .get();
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// custom pizza prices
router.get('/custom-prices', requireAdmin, async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('custom_pizza_prices').get();
    if (!doc.exists) {
      return res.json({ success: true, prices: {
        '30_combo': 830, '30_nopork': 880, '30_nine': 950,
        '36_combo': 1100, '36_nopork': 1150, '36_nine': 1200, '36_eleven': 1300,
      }});
    }
    res.json({ success: true, prices: doc.data() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/custom-prices', requireAdmin, async (req, res) => {
  try {
    const keys = ['30_combo','30_nopork','30_nine','36_combo','36_nopork','36_nine','36_eleven'];
    const prices = {};
    keys.forEach(k => { if (req.body[k] !== undefined) prices[k] = Number(req.body[k]); });
    prices.updatedAt = new Date().toISOString();
    prices.updatedBy = req.session.user?.email;
    await db.collection('settings').doc('custom_pizza_prices').set(prices, { merge: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// cancellation requests
router.get('/cancellation-requests', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .where('cancellationRequested', '==', true)
      .get();
    const snap2 = await db.collection('orders')
      .where('status', 'in', ['cancellation_requested', 'cancelled'])
      .get();
    const seen = new Set();
    const all = [];
    for (const d of [...snap.docs, ...snap2.docs]) {
      if (!seen.has(d.id)) { seen.add(d.id); all.push({ id: d.id, ...d.data() }); }
    }
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, requests: all });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/cancellation-requests/count', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .where('status', '==', 'cancellation_requested')
      .get();
    res.json({ success: true, count: snap.size });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/cancellation-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const ref = db.collection('orders').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'Order not found' });
    await ref.update({
      status: 'cancelled',
      cancellationAction: 'approved',
      cancellationResolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/cancellation-requests/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    const ref = db.collection('orders').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'Order not found' });
    await ref.update({
      cancellationAction: 'rejected',
      cancellationReason: reason || '',
      cancellationResolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// refunds
router.get('/refunds', requireAdmin, async (req, res) => {
  try {
    let refunds = [];
    try {
      const snap = await db.collection('refunds').get();
      refunds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}
    if (!refunds.length) {
      const snap = await db.collection('orders')
        .where('refundRequested', '==', true)
        .get();
      refunds = snap.docs.map(d => ({ id: d.id, orderId: d.id, ...d.data() }));
    }
    refunds.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, refunds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/refunds', requireAdmin, async (req, res) => {
  try {
    const {
      orderId, orderShortId, customerName, customerEmail,
      amount, paymentMethod, paymentRef, reason, refundStatus,
    } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId required' });
    const ref = db.collection('refunds').doc();
    await ref.set({
      orderId,
      orderShortId: orderShortId || orderId.slice(0, 8).toUpperCase(),
      customerName: customerName || '',
      customerEmail: customerEmail || '',
      amount: Number(amount) || 0,
      paymentMethod: paymentMethod || 'gcash',
      paymentRef: paymentRef || '',
      reason: reason || '',
      status: refundStatus || 'pending_review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.session.user?.email || '',
    });
    res.json({ success: true, id: ref.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/refunds/:id/status', requireAdmin, async (req, res) => {
  const { status, refundRef, notes } = req.body;
  try {
    const update = {
      refundStatus: status,
      refundReference: refundRef || '',
      refundNotes: notes || '',
      refundResolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const ref = db.collection('refunds').doc(req.params.id);
      const doc = await ref.get();
      if (doc.exists) {
        await ref.update({ status, refundReference: refundRef || '', notes: notes || '', resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return res.json({ success: true });
      }
    } catch (e) {}
    await db.collection('orders').doc(req.params.id).update(update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const notifications = snap.docs.map(d => {
      const o = d.data();
      const items = o.items || [];
      const itemSummary = items.slice(0, 2).map(i => `${i.qty}× ${i.name}`).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
      return {
        id: d.id,
        orderId: d.id,
        orderShortId: d.id.slice(0, 6).toUpperCase(),
        customerName: o.userName || o.customerName || 'Customer',
        customerEmail: o.userEmail || o.email || '',
        address: o.address || o.deliveryAddress || '',
        itemSummary,
        items: items.map(i => ({ name: i.name, qty: i.qty, price: i.price || 0 })),
        total: o.total || 0,
        paymentMethod: o.paymentMethod || 'cash',
        notes: o.notes || '',
        read: o.notifRead || false,
        createdAt: o.createdAt || new Date().toISOString(),
      };
    });
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/notifications/:id/read', requireAdmin, async (req, res) => {
  try {
    await db.collection('orders').doc(req.params.id).update({ notifRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/notifications/read-all', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const unread = snap.docs.filter(d => !d.data().notifRead);
    if (unread.length > 0) {
      const batch = db.batch();
      unread.forEach(d => batch.update(d.ref, { notifRead: true }));
      await batch.commit();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ingredients
router.get('/ingredients', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('ingredients').orderBy('name').get();
    const ingredients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, ingredients });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/ingredients', requireAdmin, async (req, res) => {
  const { name, unit, currentStock, lowStockThreshold, cost } = req.body;
  if (!name || !unit) return res.status(400).json({ message: 'Name and unit required' });
  try {
    const ref = db.collection('ingredients').doc();
    await ref.set({
      name, unit,
      currentStock: parseFloat(currentStock) || 0,
      lowStockThreshold: parseFloat(lowStockThreshold) || 0,
      cost: parseFloat(cost) || 0,
      createdAt: new Date().toISOString(),
    });
    res.json({ success: true, id: ref.id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/ingredients/:id', requireAdmin, async (req, res) => {
  const { name, unit, currentStock, lowStockThreshold, cost } = req.body;
  try {
    await db.collection('ingredients').doc(req.params.id).update({
      name, unit,
      currentStock: parseFloat(currentStock) || 0,
      lowStockThreshold: parseFloat(lowStockThreshold) || 0,
      cost: parseFloat(cost) || 0,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/ingredients/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('ingredients').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// recipes
router.get('/recipes', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('recipes').get();
    const recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, recipes });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/recipes', requireAdmin, async (req, res) => {
  const { menuItemId, menuItemName, size, ingredients } = req.body;
  if (!menuItemId || !ingredients?.length) return res.status(400).json({ message: 'Item and ingredients required' });
  try {
    const existing = await db.collection('recipes')
      .where('menuItemId', '==', menuItemId)
      .where('size', '==', size || 'all')
      .get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ menuItemName, size: size || 'all', ingredients, updatedAt: new Date().toISOString() });
      return res.json({ success: true, id: existing.docs[0].id });
    }
    const ref = db.collection('recipes').doc();
    await ref.set({ menuItemId, menuItemName, size: size || 'all', ingredients, createdAt: new Date().toISOString() });
    res.json({ success: true, id: ref.id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/recipes/:id', requireAdmin, async (req, res) => {
  const { menuItemId, menuItemName, size, ingredients } = req.body;
  try {
    await db.collection('recipes').doc(req.params.id).update({
      menuItemId, menuItemName, size: size || 'all', ingredients, updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/recipes/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('recipes').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PIZZA FLAVORS ──────────────────────────────────────────────────────────
// GET is intentionally public (no requireAdmin) so the customer dashboard
// can fetch the live flavor list without being logged-in as admin.
router.get('/flavors', async (req, res) => {
  // Flavors are now sourced from menu items with availableInCustom: true
  try {
    const snap = await db.collection('menu').where('availableInCustom', '==', true).get();
    const flavors = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || '',
        color: data.color || '#C62828',
        isPorkFree: !!data.isPorkFree,
        active: data.active !== false,
      };
    });
    res.json({ success: true, flavors });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/flavors', requireAdmin, async (req, res) => {
  const { name, color, isPorkFree, active, sortOrder } = req.body;
  if (!name) return res.status(400).json({ message: 'Name required' });
  try {
    const ref = db.collection('flavors').doc();
    await ref.set({
      name,
      color: color || '#C62828',
      isPorkFree: isPorkFree === true || isPorkFree === 'true',
      active: active !== false && active !== 'false',
      sortOrder: parseInt(sortOrder) || 99,
      createdAt: new Date().toISOString(),
    });
    res.json({ success: true, id: ref.id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/flavors/:id', requireAdmin, async (req, res) => {
  const { name, color, isPorkFree, active, sortOrder } = req.body;
  try {
    const update = { updatedAt: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (color !== undefined) update.color = color;
    if (isPorkFree !== undefined) update.isPorkFree = isPorkFree === true || isPorkFree === 'true';
    if (active !== undefined) update.active = active === true || active === 'true';
    if (sortOrder !== undefined) update.sortOrder = parseInt(sortOrder) || 99;
    await db.collection('flavors').doc(req.params.id).update(update);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/flavors/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('flavors').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── FLAVOR RECIPES ─────────────────────────────────────────────────────────
// Stored in the same 'recipes' collection with type:'flavor' for unified
// deduction. The admin UI uses these separate endpoints for clarity.
router.get('/flavor-recipes', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('recipes').where('type', '==', 'flavor').get();
    const recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, recipes });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/flavor-recipes', requireAdmin, async (req, res) => {
  const { flavorId, flavorName, ingredients } = req.body;
  if (!flavorName || !ingredients?.length) return res.status(400).json({ message: 'Flavor and ingredients required' });
  try {
    // Upsert: one recipe per flavor name
    const existing = await db.collection('recipes').where('type', '==', 'flavor').where('flavorName', '==', flavorName).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ flavorId: flavorId || '', flavorName, ingredients, updatedAt: new Date().toISOString() });
      return res.json({ success: true, id: existing.docs[0].id });
    }
    const ref = db.collection('recipes').doc();
    await ref.set({ type: 'flavor', flavorId: flavorId || '', flavorName, ingredients, createdAt: new Date().toISOString() });
    res.json({ success: true, id: ref.id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/flavor-recipes/:id', requireAdmin, async (req, res) => {
  const { flavorId, flavorName, ingredients } = req.body;
  try {
    await db.collection('recipes').doc(req.params.id).update({
      type: 'flavor', flavorId: flavorId || '', flavorName, ingredients, updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/flavor-recipes/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('recipes').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ingredient logs
router.get('/ingredient-logs', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('ingredient_logs')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, logs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;