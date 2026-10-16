const express = require('express');
const router = express.Router();
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ message: 'Unauthorized' });
  next();
};

// ============================================================
// resolveRecipe — find the best recipe for an order item.
// For regular items: match by menuItemId + size string.
// For custom pizzas: custom items carry their toppings in
// addonNames and use a special menuItemId like "custom_pizza_30"
// which maps to recipe docs with menuItemId="custom_pizza".
// ============================================================
async function resolveRecipe(item) {
  // Extract size from item name: e.g. "The Pepperoni (Regular)" → null
  // or "Custom Heart 30\" Pizza (30\" · Combination)" → "30"
  const sizeMatch = item.name && item.name.match(/\((\d+)["”]/);
  const size = sizeMatch ? sizeMatch[1] : null;

  // For custom pizzas the id is like "custom_pizza_30" or "custom_pizza_36"
  const isCustom = item.isCustom || (item.id && item.id.startsWith('custom_pizza'));
  const lookupId = isCustom ? 'custom_pizza' : item.id;

  // Try exact size match first
  if (size) {
    const snap = await db.collection('recipes')
      .where('menuItemId', '==', lookupId)
      .where('size', '==', size)
      .limit(1).get();
    if (!snap.empty) return snap.docs[0].data();
  }

  // Fallback: size='all' (recipe covers all sizes of that item)
  const snap2 = await db.collection('recipes')
    .where('menuItemId', '==', lookupId)
    .where('size', '==', 'all')
    .limit(1).get();
  if (!snap2.empty) return snap2.docs[0].data();

  return null;
}

// ============================================================
// previewIngredients — calculate what will be consumed for an
// order without touching any stock. Returns an array of:
//   { ingredientId, name, unit, needed, currentStock, sufficient }
// ============================================================
async function previewIngredients(items) {
  // Aggregate total consumption per ingredient across all items
  const consumption = {}; // ingredientId → { name, unit, needed }

  for (const item of items) {
    const recipe = await resolveRecipe(item);
    if (!recipe) continue;

    const orderQty = item.qty || 1;
    for (const ing of (recipe.ingredients || [])) {
      const id = ing.ingredientId;
      if (!id) continue;
      const needed = (ing.qty || 0) * orderQty;
      if (!consumption[id]) {
        consumption[id] = { ingredientId: id, name: ing.name || '', unit: ing.unit || 'g', needed: 0 };
      }
      consumption[id].needed += needed;
    }
  }

  if (Object.keys(consumption).length === 0) return [];

  // Fetch current stock for each ingredient
  const result = [];
  await Promise.all(
    Object.values(consumption).map(async (c) => {
      const doc = await db.collection('ingredients').doc(c.ingredientId).get();
      const currentStock = doc.exists ? (doc.data().currentStock || 0) : 0;
      result.push({
        ingredientId: c.ingredientId,
        name: c.name,
        unit: c.unit,
        needed: c.needed,
        currentStock,
        sufficient: currentStock >= c.needed,
      });
    })
  );

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ============================================================
// deductIngredients — atomically deduct stock once per order.
// Uses Firestore transaction on the order doc itself as an
// idempotency flag (inventoryDeducted: true).
// Returns { success, logs, insufficientIngredients }
// ============================================================
async function deductIngredients(orderId, items, adminEmail) {
  const orderRef = db.collection('orders').doc(orderId);

  // ── Collect what we need across ALL items ─────────────────
  const consumption = {}; // ingredientId → { name, unit, needed }
  for (const item of items) {
    const recipe = await resolveRecipe(item);
    if (!recipe) continue;
    const orderQty = item.qty || 1;
    for (const ing of (recipe.ingredients || [])) {
      const id = ing.ingredientId;
      if (!id) continue;
      const needed = (ing.qty || 0) * orderQty;
      if (!consumption[id]) {
        consumption[id] = { ingredientId: id, name: ing.name || '', unit: ing.unit || 'g', needed: 0 };
      }
      consumption[id].needed += needed;
    }
  }

  if (Object.keys(consumption).length === 0) {
    // No recipes defined — just mark as processed and proceed
    await orderRef.update({ inventoryDeducted: true, inventoryDeductedAt: new Date().toISOString() });
    return { success: true, logs: [], insufficientIngredients: [] };
  }

  const ingredientIds = Object.keys(consumption);
  const ingRefs = ingredientIds.map(id => db.collection('ingredients').doc(id));

  // ── Single Firestore transaction ──────────────────────────
  const logs = [];
  const insufficientIngredients = [];

  try {
    await db.runTransaction(async (t) => {
      // Read order doc and all ingredient docs inside transaction
      const orderDoc = await t.get(orderRef);
      if (!orderDoc.exists) throw new Error('Order not found');

      // Idempotency check
      if (orderDoc.data().inventoryDeducted === true) {
        throw Object.assign(new Error('ALREADY_DEDUCTED'), { alreadyDeducted: true });
      }

      const ingDocs = await Promise.all(ingRefs.map(r => t.get(r)));

      // Validate stock before touching anything
      const shortfall = [];
      ingDocs.forEach((doc, i) => {
        const id = ingredientIds[i];
        const c = consumption[id];
        const current = doc.exists ? (doc.data().currentStock || 0) : 0;
        if (current < c.needed) {
          shortfall.push({ ingredientId: id, name: c.name, needed: c.needed, available: current, unit: c.unit });
        }
      });

      if (shortfall.length > 0) {
        throw Object.assign(
          new Error('INSUFFICIENT_STOCK'),
          { insufficientIngredients: shortfall }
        );
      }

      // All stock is sufficient — perform deductions
      const now = new Date().toISOString();
      ingDocs.forEach((doc, i) => {
        const id = ingredientIds[i];
        const c = consumption[id];
        const current = doc.data().currentStock || 0;
        const after = current - c.needed;

        t.update(ingRefs[i], {
          currentStock: after,
          updatedAt: now,
        });

        const logRef = db.collection('ingredient_logs').doc();
        t.set(logRef, {
          ingredientId: id,
          ingredientName: c.name,
          orderId,
          action: 'order_deduction',
          qty: -c.needed,
          unit: c.unit,
          reason: `Order #${orderId.slice(0, 8).toUpperCase()} → Preparing`,
          balanceBefore: current,
          balanceAfter: after,
          isLow: after <= 0,
          processedBy: adminEmail || 'admin',
          createdAt: now,
        });

        logs.push({
          ingredientId: id,
          name: c.name,
          unit: c.unit,
          deducted: c.needed,
          before: current,
          after,
        });
      });

      // Mark the order so we never deduct again
      t.update(orderRef, {
        inventoryDeducted: true,
        inventoryDeductedAt: now,
        inventoryDeductedBy: adminEmail || 'admin',
      });
    });

    return { success: true, logs, insufficientIngredients: [] };

  } catch (err) {
    if (err.alreadyDeducted) {
      return { success: true, logs: [], insufficientIngredients: [], alreadyDeducted: true };
    }
    if (err.insufficientIngredients) {
      return { success: false, logs: [], insufficientIngredients: err.insufficientIngredients };
    }
    throw err;
  }
}

// ============================================================
// Place a new order (customer-facing)
// Stock (menu-item quantity) is deducted here on order creation.
// Ingredient BOM deduction happens later on → Preparing.
// ============================================================
router.post('/', requireAuth, async (req, res) => {
  const { items, address, paymentMethod, notes } = req.body;
  const user = req.session.user;
  try {
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const orderRef = await db.collection('orders').add({
      userId: user.uid,
      userName: user.name,
      userEmail: user.email,
      items,
      total,
      address,
      paymentMethod,
      notes: notes || '',
      status: 'pending',
      inventoryDeducted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Update user total orders
    await db.collection('users').doc(user.uid).update({
      totalOrders: admin.firestore.FieldValue.increment(1),
    });

    // Deduct stock (menu-item level) for each item ordered
    const stockPromises = items.map(async (item) => {
      try {
        const stockDoc = await db.collection('stock').doc(item.id).get();
        const currentQty = stockDoc.exists ? (stockDoc.data().quantity ?? 50) : 50;
        const newQty = Math.max(0, currentQty - item.qty);
        await db.collection('stock').doc(item.id).set({
          quantity: newQty,
          threshold: stockDoc.exists ? (stockDoc.data().threshold ?? 10) : 10,
          notes: stockDoc.exists ? (stockDoc.data().notes ?? '') : '',
          updatedAt: new Date().toISOString(),
          updatedBy: 'system (order)',
        }, { merge: true });
        await db.collection('stock_log').add({
          menuId: item.id,
          quantity: newQty,
          previousQty: currentQty,
          action: 'order',
          notes: `Order #${orderRef.id.slice(0, 8).toUpperCase()} - ${item.qty} sold`,
          updatedBy: user.email,
          updatedAt: new Date().toISOString(),
        });
        if (newQty === 0) {
          await db.collection('menu').doc(item.id).update({ available: false });
        }
      } catch (e) {
        console.error('Stock deduct error for item', item.id, ':', e.message);
      }
    });
    await Promise.all(stockPromises);

    // ── Create admin notification (fire-and-forget, never blocks the response) ──
    (async () => {
      try {
        const itemSummary = items.map(i => `${i.qty}× ${i.name}`).join(', ');
        await db.collection('notifications').add({
          type: 'new_order',
          orderId: orderRef.id,
          orderShortId: orderRef.id.slice(0, 8).toUpperCase(),
          customerName: user.name,
          customerEmail: user.email,
          itemSummary,
          items,
          total,
          paymentMethod: paymentMethod || 'cash',
          paymentStatus: 'unpaid',
          address: address || '',
          notes: notes || '',
          read: false,
          recipient: 'admin',
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Notification create error:', e.message);
      }
    })();

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get orders for current user
router.get('/my', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('orders')
      .where('userId', '==', req.session.user.uid)
      .limit(20)
      .get();
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single order
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Order not found' });
    res.json({ success: true, order: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// Helper: restore menu-item stock when order is cancelled
// ============================================================
async function restoreMenuStock(order) {
  const restorePromises = (order.items || []).map(async (item) => {
    try {
      const stockRef = db.collection('stock').doc(item.id);
      const stockDoc = await stockRef.get();
      const current = stockDoc.exists ? (stockDoc.data().quantity ?? 0) : 0;
      const restored = current + (item.qty || 1);
      await stockRef.set({
        quantity: restored,
        threshold: stockDoc.exists ? (stockDoc.data().threshold ?? 10) : 10,
        notes: stockDoc.exists ? (stockDoc.data().notes ?? '') : '',
        updatedAt: new Date().toISOString(),
        updatedBy: 'system (cancel)',
      }, { merge: true });
      await db.collection('menu').doc(item.id).update({ available: true }).catch(() => {});
    } catch (e) {
      console.error('Stock restore error for item', item.id, ':', e.message);
    }
  });
  await Promise.all(restorePromises);
}

// ============================================================
// PATCH /api/orders/:id/cancel
// Direct cancel — only for UNPAID orders (pending + not gcash-paid).
// COD pending or GCash-pending (payment not yet received).
// ============================================================
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const user = req.session.user;
  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, message: 'Order not found.' });

    const order = orderDoc.data();
    if (order.userId !== user.uid) return res.status(403).json({ success: false, message: 'Not your order.' });

    // Direct cancel only for unpaid pending orders
    const isPaid = order.paymentMethod === 'gcash' && order.paymentStatus === 'paid';
    if (isPaid) {
      return res.status(422).json({
        success: false,
        message: 'This order has been paid. Please submit a cancellation request instead.',
        requiresRequest: true,
      });
    }
    if (!['pending'].includes(order.status)) {
      return res.status(422).json({
        success: false,
        message: `Cannot directly cancel an order with status "${order.status}".`,
      });
    }

    await restoreMenuStock(order);

    await orderRef.update({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: user.email,
      cancellationReason: req.body.reason || 'Customer cancelled',
      updatedAt: new Date().toISOString(),
    });

    // Notify admin
    db.collection('notifications').add({
      type: 'order_cancelled',
      orderId,
      orderShortId: orderId.slice(0, 8).toUpperCase(),
      customerName: user.name,
      customerEmail: user.email,
      message: `Order #${orderId.slice(0, 8).toUpperCase()} was cancelled by customer (unpaid).`,
      read: false,
      recipient: 'admin',
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// POST /api/orders/:id/cancel-request
// Cancellation request — for paid GCash orders or confirmed orders.
// Creates a cancellation_requests record for admin review.
// ============================================================
router.post('/:id/cancel-request', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const user = req.session.user;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: 'Please provide a reason for cancellation.' });
  }

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, message: 'Order not found.' });

    const order = orderDoc.data();
    if (order.userId !== user.uid) return res.status(403).json({ success: false, message: 'Not your order.' });

    // Only allow request for pending/confirmed orders
    const requestable = ['pending', 'confirmed'];
    if (!requestable.includes(order.status)) {
      return res.status(422).json({
        success: false,
        message: `Cannot request cancellation for an order with status "${order.status}".`,
      });
    }

    // Prevent duplicate open requests
    const existing = await db.collection('cancellation_requests')
      .where('orderId', '==', orderId)
      .where('status', '==', 'pending')
      .limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ success: false, message: 'A cancellation request is already pending for this order.' });
    }

    const now = new Date().toISOString();
    const reqRef = await db.collection('cancellation_requests').add({
      orderId,
      orderShortId: orderId.slice(0, 8).toUpperCase(),
      userId: user.uid,
      userName: user.name,
      userEmail: user.email,
      reason: reason.trim(),
      status: 'pending', // pending | approved | rejected
      orderStatus: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus || 'unpaid',
      paymentRef: order.paymongoRef || '',
      total: order.total,
      items: order.items,
      createdAt: now,
      updatedAt: now,
    });

    // Mark the order as having a pending cancellation request
    await orderRef.update({
      cancellationRequestId: reqRef.id,
      cancellationRequestStatus: 'pending',
      updatedAt: now,
    });

    // Notify admin
    const isPaidGcash = order.paymentMethod === 'gcash' && order.paymentStatus === 'paid';
    db.collection('notifications').add({
      type: 'cancellation_request',
      cancellationRequestId: reqRef.id,
      orderId,
      orderShortId: orderId.slice(0, 8).toUpperCase(),
      customerName: user.name,
      customerEmail: user.email,
      paymentMethod: order.paymentMethod,
      isPaidGcash,
      total: order.total,
      message: `Cancellation request for Order #${orderId.slice(0, 8).toUpperCase()} from ${user.name}${isPaidGcash ? ' (PAID GCash — refund may be required)' : ''}.`,
      read: false,
      recipient: 'admin',
      createdAt: now,
    }).catch(() => {});

    res.json({ success: true, requestId: reqRef.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GET /api/orders/:id/cancel-request
// Get cancellation request status for an order (customer view)
// ============================================================
router.get('/:id/cancel-request', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  const user = req.session.user;
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (orderDoc.data().userId !== user.uid) return res.status(403).json({ success: false, message: 'Not your order.' });

    const snap = await db.collection('cancellation_requests')
      .where('orderId', '==', orderId)
      .orderBy('createdAt', 'desc')
      .limit(1).get();

    if (snap.empty) return res.json({ success: true, request: null });
    const doc = snap.docs[0];
    res.json({ success: true, request: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.previewIngredients = previewIngredients;
module.exports.deductIngredients = deductIngredients;
module.exports.restoreMenuStock = restoreMenuStock;