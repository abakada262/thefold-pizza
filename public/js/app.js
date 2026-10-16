// ============================================================
// app.js — shared utilities for The Fold Pizza
// ============================================================

// Toast notifications
function toast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// API helper
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

// Format currency (PHP)
function formatCurrency(amount) {
  return '₱' + Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

// Format date
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

// Status label
function statusLabel(s) {
  const map = {
    pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled'
  };
  return map[s] || s;
}

// ============================================================
// BACK BUTTON BLOCKER
// ============================================================
(function blockBackButton() {
  try {
    window.history.pushState({ blocked: true }, '', window.location.href);
  } catch(e) {}
  window.addEventListener('popstate', function(e) {
    try { window.history.pushState({ blocked: true }, '', window.location.href); } catch(e) {}
  });
})();

// ============================================================
// AUTO LOGOUT — 15 minutes of inactivity
// ============================================================
(function autoLogout() {
  const TIMEOUT_MS   = 15 * 60 * 1000;  // 15 minutes
  const WARNING_MS   = 14 * 60 * 1000;  // warn at 14 minutes
  const EXEMPT_PAGES = ['/login', '/'];  // don't run on login or homepage

  // Only run on protected pages
  const path = window.location.pathname;
  if (EXEMPT_PAGES.some(p => path === p)) return;

  let logoutTimer, warnTimer, warningEl;

  function removeWarning() {
    if (warningEl) { warningEl.remove(); warningEl = null; }
  }

  function showWarning() {
    removeWarning();
    warningEl = document.createElement('div');
    warningEl.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1B5E20', 'color:white', 'padding:14px 24px', 'border-radius:8px',
      'font-family:Inter,sans-serif', 'font-size:14px', 'font-weight:500',
      'z-index:99999', 'box-shadow:0 8px 32px rgba(0,0,0,0.25)',
      'display:flex', 'align-items:center', 'gap:14px', 'max-width:90vw'
    ].join(';');
    warningEl.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>You'll be logged out in <strong>1 minute</strong> due to inactivity.</span>
      <button onclick="window._resetInactivity()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:white;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif;font-size:13px;font-weight:600;white-space:nowrap;">
        Stay logged in
      </button>`;
    document.body.appendChild(warningEl);
  }

  async function doLogout() {
    removeWarning();
    try { await api('/auth/logout', 'POST'); } catch(e) {}
    // Show message before redirect
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
    msg.innerHTML = `<div style="background:white;border-radius:10px;padding:32px 40px;text-align:center;max-width:320px;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1B5E20" stroke-width="1.5" style="margin-bottom:12px;"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1A1714;margin-bottom:6px;">Session expired</div>
      <div style="font-size:13px;color:#6B6560;">You were logged out due to 15 minutes of inactivity.</div>
    </div>`;
    document.body.appendChild(msg);
    setTimeout(() => window.location.replace('/login'), 1800);
  }

  function resetTimers() {
    clearTimeout(logoutTimer);
    clearTimeout(warnTimer);
    removeWarning();
    warnTimer   = setTimeout(showWarning, WARNING_MS);
    logoutTimer = setTimeout(doLogout,    TIMEOUT_MS);
  }

  // Expose reset so "Stay logged in" button works
  window._resetInactivity = resetTimers;

  // Track activity events
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  events.forEach(ev => document.addEventListener(ev, resetTimers, { passive: true }));

  // Start timers
  resetTimers();
})();

// ============================================================
// AUTH GUARDS
// ============================================================

// requireLogin — customer pages only.
// Redirects unauthenticated users to /login.
// Redirects admin/superadmin who land here back to their own dashboard.
async function requireLogin() {
  try {
    const data = await api('/auth/me');
    if (!data.user) throw new Error('No user');
    const role = data.user.role;
    // Admin/superadmin must not access customer pages
    if (role === 'admin') {
      window.location.replace('/admin');
      return null;
    }
    if (role === 'superadmin') {
      window.location.replace('/superadmin');
      return null;
    }
    return data.user;
  } catch {
    window.location.replace('/login');
    return null;
  }
}

// requireAdmin — allows both admin AND superadmin.
// Redirects customers to /login (not /dashboard — they have no business here).
async function requireAdmin() {
  try {
    const data = await api('/auth/me');
    if (!data.user) throw new Error('No user');
    const role = data.user.role;
    if (role !== 'admin' && role !== 'superadmin') {
      window.location.replace('/login');
      return null;
    }
    return data.user;
  } catch {
    window.location.replace('/login');
    return null;
  }
}

// requireSuperAdmin — superadmin-only pages.
// Admins are redirected to their own dashboard; customers to /login.
async function requireSuperAdmin() {
  try {
    const data = await api('/auth/me');
    if (!data.user) throw new Error('No user');
    const role = data.user.role;
    if (role === 'admin') {
      window.location.replace('/admin');
      return null;
    }
    if (role !== 'superadmin') {
      window.location.replace('/login');
      return null;
    }
    return data.user;
  } catch {
    window.location.replace('/login');
    return null;
  }
}