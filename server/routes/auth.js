const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'thefold-jwt-2024';
const { db, auth } = require('../../config/firebase');

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(trimmed)) return false;
  const [local] = trimmed.split('@');
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (/\.{2,}/.test(trimmed)) return false;
  return true;
}

router.post('/session', async (req, res) => {
  const { idToken, loginType } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'Missing token' });
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const userDoc  = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const role     = userData.role || 'customer';

    // ── Ban check (customers only) ───────────────────────────────
    if (userData.isBanned) {
      return res.status(403).json({
        success: false,
        banned: true,
        message: userData.banReason
          ? `Your account has been suspended: ${userData.banReason}`
          : 'Your account has been suspended. Please contact support.',
        bannedAt: userData.bannedAt || null,
      });
    }

    if (loginType === 'customer') {
      if (role !== 'customer') {
        return res.status(403).json({
          success: false,
          message: 'This account is not authorized to access the Customer Portal. Please use the appropriate Admin Login page.',
        });
      }
    } else if (loginType === 'admin') {
      if (role !== 'admin') {
        if (role === 'superadmin') {
          return res.status(403).json({
            success: false,
            message: 'Super Admin accounts must log in through the Super Admin portal.',
          });
        }
        return res.status(403).json({
          success: false,
          message: 'You do not have Admin access. Please sign in with a customer account instead.',
        });
      }
    } else if (loginType === 'superadmin') {
      if (role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Super Admin access only. Please use your Super Admin credentials.',
        });
      }
    }

    const userPayload = { uid: decoded.uid, email: decoded.email, name: userData.name || decoded.email, role };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('thefold_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    req.session.user = userPayload;
    res.json({ success: true, user: userPayload });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
});

router.get('/me', (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.status(401).json({ success: false, message: 'Not authenticated' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('thefold_token');
    res.json({ success: true });
  });
});

router.post('/register', async (req, res) => {
  const { uid, email, name, phone } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address format.',
    });
  }
  if (!uid || !name) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = (phone || '').trim();

    // ── Ban check: block registration with banned email or phone ──
    const banChecks = [
      db.collection('users').where('email', '==', cleanEmail).where('isBanned', '==', true).limit(1).get(),
    ];
    if (cleanPhone) {
      banChecks.push(
        db.collection('users').where('phone', '==', cleanPhone).where('isBanned', '==', true).limit(1).get()
      );
    }
    const banResults = await Promise.all(banChecks);
    for (const snap of banResults) {
      if (!snap.empty) {
        const banned = snap.docs[0].data();
        return res.status(403).json({
          success: false,
          banned: true,
          message: banned.banReason
            ? `Registration blocked: ${banned.banReason}`
            : 'Registration blocked. This account has been suspended.',
        });
      }
    }

    await db.collection('users').doc(uid).set({
      name:        name.trim(),
      email:       cleanEmail,
      phone:       cleanPhone,
      role:        'customer',
      createdAt:   new Date().toISOString(),
      totalOrders: 0,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/check-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });
  try {
    const snap = await db.collection('users').where('phone', '==', phone.trim()).get();
    if (!snap.empty) {
      const user = snap.docs[0].data();
      if (user.isBanned) {
        return res.status(403).json({ success: false, banned: true, message: 'This phone number is associated with a suspended account.' });
      }
      return res.json({ success: false, exists: true, message: 'This phone number is already registered.' });
    }
    res.json({ success: true, exists: false });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/validate-email', (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address. Please enter a valid email (e.g. name@domain.com).',
    });
  }
  res.json({ success: true });
});

router.post('/fix-role', async (req, res) => {
  const { uid, role } = req.body;
  const allowedRoles = ['admin', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }
  try {
    await db.collection('users').doc(uid).set(
      { role, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    if (req.session.user && req.session.user.uid === uid) {
      req.session.user.role = role;
    }
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/update-profile', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Unauthorized' });
  const { name, phone, address } = req.body;
  try {
    await db.collection('users').doc(req.session.user.uid).update({
      name:    name    || req.session.user.name,
      phone:   phone   || '',
      address: address || '',
    });
    req.session.user.name  = name  || req.session.user.name;
    req.session.user.phone = phone;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/delete-account', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ success: false, message: 'ID token required' });
  try {
    // Verify fresh token to confirm password was just entered
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.uid !== req.session.user.uid) {
      return res.status(403).json({ success: false, message: 'Token mismatch' });
    }
    // Delete Firestore user document
    await db.collection('users').doc(req.session.user.uid).delete();
    // Delete Firebase Auth account
    await auth.deleteUser(req.session.user.uid);
    // Clear session cookie
    res.clearCookie('thefold_token');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;