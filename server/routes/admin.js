const express = require('express');
const router = express.Router();
const { db } = require('../../config/firebase');
const multer = require('multer');
const path = require('path');

const requireAdmin = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ message: 'Forbidden: Admin only' });
  }
  next();
};

// ==================== IMAGE UPLOAD ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../public/images/menu'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
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
    const imageUrl = '/images/menu/' + req.file.filename;
    res.json({ success: true, imageUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ORDERS ====================
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

router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  try {
    await db.collection('orders').doc(req.params.id).update({
      status, updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== STATS ====================
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

// ==================== USERS ====================
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('users').get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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
  // Only superadmin can remove admins
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

// ==================== MENU ====================
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

// ==================== STOCK / INVENTORY ====================
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

// ==================== CUSTOM PIZZA PRICES ====================
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

// ==================== CANCELLATION REQUESTS ====================
router.get('/cancellation-requests', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .where('cancellationRequested', '==', true)
      .get();
    // Also include orders with status 'cancellation_requested' or 'cancelled'
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

// ==================== REFUNDS ====================
router.get('/refunds', requireAdmin, async (req, res) => {
  try {
    // Try dedicated refunds collection first, fall back to orders with refund fields
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
    // Try dedicated refunds collection first, fall back to orders
    try {
      const ref = db.collection('refunds').doc(req.params.id);
      const doc = await ref.get();
      if (doc.exists) { await ref.update({ status, refundReference: refundRef || '', notes: notes || '', resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); return res.json({ success: true }); }
    } catch (e) {}
    await db.collection('orders').doc(req.params.id).update(update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== NOTIFICATIONS ====================
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    // Get recent orders as notifications (last 50, sorted newest first)
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
    // Fetch recent unread orders and mark them read
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

// ==================== INGREDIENTS ====================
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

// ==================== RECIPES / BOM ====================
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

// ==================== INGREDIENT LOGS ====================
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