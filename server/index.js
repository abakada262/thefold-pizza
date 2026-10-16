const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Prevent browser from caching protected pages
app.use((req, res, next) => {
  const protectedPaths = ['/dashboard', '/orders', '/account', '/admin', '/superadmin'];
  if (protectedPaths.some(p => req.path.startsWith(p))) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
  }
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'thefold-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const menuRoutes = require('./routes/menu');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/payments');

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);

// Page routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/admin.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/superadmin.html')));
app.get('/menu', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/menu.html')));
app.get('/orders', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/orders.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/account.html')));
app.get('/payment-success', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/payment-success.html')));
app.get('/payment-result', (req, res) => res.sendFile(path.join(__dirname, '../public/pages/payment-result.html')));

app.listen(PORT, () => {
  console.log(`🍕 The Fold Pizza server running on http://localhost:${PORT}`);
});

module.exports = app;