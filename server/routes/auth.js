const express = require('express');
const router = express.Router();
const { db, auth } = require('../../config/firebase');

// ──────────────────────────────────────────────────────────────────────────────
// EMAIL VALIDATION HELPER
// Validates format strictly: local@domain.tld
// ──────────────────────────────────────────────────────────────────────────────
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  // Must have exactly one @, non-empty local part, domain with at least one dot
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(trimmed)) return false;
  // Local part cannot start or end with a dot
  const [local] = trimmed.split('@');
  if (local.startsWith('.') || local.endsWith('.')) return false;
  // No consecutive dots
  if (/\.{2,}/.test(trimmed)) return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/session
// Called after Firebase client auth (signInWithEmailAndPassword).
// Accepts a `loginType` param: "customer" | "admin" | "superadmin"
// Enforces role separation — wrong role for the portal gets a 403.
// ──────────────────────────────────────────────────────────────────────────────
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

    // ── Role-portal enforcement ─────────────────────────────────────────────
    if (loginType === 'customer') {
      // Customer portal: only 'customer' role allowed
      if (role !== 'customer') {
        return res.status(403).json({
          success: false,
          message: 'This account is not authorized to access the Customer Portal. Please use the appropriate Admin Login page.',
        });
      }
    } else if (loginType === 'admin') {
      // Admin portal: only 'admin' role allowed (not superadmin either)
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
      // Super Admin portal: only 'superadmin' role allowed
      if (role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Super Admin access only. Please use your Super Admin credentials.',
        });
      }
    }
    // If loginType is omitted (legacy), we skip portal enforcement and just
    // create the session so existing code keeps working.

    req.session.user = {
      uid:   decoded.uid,
      email: decoded.email,
      name:  userData.name || decoded.email,
      role,
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ──────────────────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.status(401).json({ success: false, message: 'Not authenticated' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ──────────────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Public registration always creates a 'customer' account.
// The role field is IGNORED from the request body — cannot self-assign admin.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { uid, email, name, phone } = req.body;

  // Validate email format server-side
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
    // Always set role to 'customer' — never trust client-supplied role
    await db.collection('users').doc(uid).set({
      name:        name.trim(),
      email:       email.trim().toLowerCase(),
      phone:       (phone || '').trim(),
      role:        'customer',
      createdAt:   new Date().toISOString(),
      totalOrders: 0,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/validate-email
// Frontend can call this to validate email format before attempting Firebase auth.
// ──────────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/fix-role  (admin use — sets role for an existing account)
// ──────────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/update-profile
// ──────────────────────────────────────────────────────────────────────────────
router.post('/update-profile', async (req, res) => {
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

module.exports = router;