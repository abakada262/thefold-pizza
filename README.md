# 🍕 The Fold Pizza — Ordering System

A full-stack pizza ordering system built with **JavaScript**, **Node.js**, and **Firebase**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES Modules) |
| Backend | Node.js + Express |
| Database | Firebase Firestore |
| Auth | Firebase Authentication |
| Session | express-session |

---

## Project Structure

```
thefold-pizza/
├── config/
│   └── firebase.js          # Firebase Admin SDK init
├── server/
│   ├── index.js             # Express app entry point
│   └── routes/
│       ├── auth.js          # Login, register, session
│       ├── orders.js        # Customer order routes
│       ├── menu.js          # Menu routes
│       └── admin.js         # Admin-only routes
├── public/
│   ├── index.html           # Landing page
│   ├── css/style.css        # Shared styles
│   ├── js/app.js            # Firebase + shared utils
│   └── pages/
│       ├── login.html       # Sign in / Sign up / Admin login
│       ├── dashboard.html   # Customer ordering dashboard
│       ├── orders.html      # Customer order tracking
│       └── admin.html       # Admin management dashboard
├── .env.example             # Environment variable template
├── package.json
└── README.md
```

---

## Setup Instructions

### 1. Firebase Setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project: **thefold-pizza**
3. Enable **Authentication** → Email/Password
4. Create a **Firestore Database** in production mode
5. Go to **Project Settings** → **Service accounts** → **Generate new private key**
6. Download the JSON file

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Fill in `.env` with your Firebase values:
- From the service account JSON: `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, etc.
- From Firebase Console → Project Settings → Your apps → Web app config: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, etc.

### 3. Configure Frontend Firebase

Edit `public/js/app.js` and replace the `firebaseConfig` object at the top with your actual Firebase web config.

### 4. Install Dependencies & Run

```bash
npm install
npm run dev    # development (with nodemon)
npm start      # production
```

Open [http://localhost:3000](http://localhost:3000)

---

## First-Time Setup Flow

### 1. Register your admin account
- Go to `/login` → Create Account
- Use the email you want as admin

### 2. Get your Firebase UID
- Firebase Console → Authentication → Users → Copy the UID

### 3. Temporarily make yourself admin (in Firestore)
- Go to Firestore → `users` collection → Find your document → Edit `role` field to `"admin"`

### 4. Seed the menu
- Sign in as admin at `/login` (Admin Login tab)
- Go to Admin Dashboard → Settings → Seed Menu Items

### 5. You're ready!
- Customer flow: `/login` → Sign up → Browse menu → Order → Track at `/orders`
- Admin flow: `/login` → Admin Login → Manage orders, menu, customers

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Landing page |
| `/login` | Customer login / signup |
| `/login?tab=admin` | Admin login |
| `/dashboard` | Customer menu + ordering |
| `/orders` | Customer order tracking |
| `/admin` | Admin dashboard |

---

## Admin Features

- 📊 Real-time stats (orders, revenue, customers)
- 🛒 Order management with status updates
- 🍕 Menu management (add items, toggle availability)
- 👥 Customer list
- ⚙️ Settings (seed menu, grant admin)

## Customer Features

- 🔐 Email/password authentication
- 🍕 Browse menu by category
- 🛒 Cart with quantity controls
- 📍 Place orders with delivery address
- 📱 Track order status with progress bar

---

## Firestore Collections

```
users/          { name, email, phone, role, totalOrders, createdAt }
orders/         { userId, items, total, address, status, paymentMethod, createdAt }
menu/           { name, category, price, description, available, image }
```

---

## Security Notes

- Change `SESSION_SECRET` in production
- Set Firestore security rules to restrict direct client access
- Use HTTPS in production
- Consider Firebase App Check for additional security
