# 🌿 HERBIX – Full Stack Hair Gel Website
## MongoDB + Razorpay UPI + Order Tracking  |  v3.1.0 (Fixed)

---

## 🐛 Bugs Fixed in This Version

| # | Bug | Fix |
|---|-----|-----|
| 1 | MongoDB crashes server on first connect failure | Auto-retry with 5 attempts + backoff |
| 2 | Secrets hardcoded in server.js | Moved to `.env` file (dotenv added to dependencies) |
| 3 | Missing `dotenv` in package.json | Added `"dotenv": "^16.4.5"` |
| 4 | Admin page only checked localStorage (bypassable) | Added `/api/verify-admin` endpoint — server-side token check |
| 5 | Login error said "awaiting approval" unclearly | Clear message: explains admin must approve |
| 6 | Razorpay crash if keys not set | Safe init — server starts fine, UPI disabled gracefully |
| 7 | JWT_SECRET hardcoded | From `.env`, with warning if default used |

---

## 🚀 Step-by-Step Setup

### Step 1 — Install Node.js
Make sure Node.js v18+ is installed:
```bash
node -v   # should show v18.x or higher
npm -v
```
Download at: https://nodejs.org

---

### Step 2 — Get MongoDB

**Option A: Local MongoDB (easiest for development)**
1. Download from https://www.mongodb.com/try/download/community
2. Install and start it:
   ```bash
   # macOS (with Homebrew)
   brew tap mongodb/brew
   brew install mongodb-community
   brew services start mongodb-community

   # Ubuntu/Linux
   sudo systemctl start mongod

   # Windows: MongoDB runs as a service after install
   ```
3. Verify it's running: `mongosh` should connect

**Option B: MongoDB Atlas (free cloud — no install needed)**
1. Go to https://www.mongodb.com/cloud/atlas/register
2. Create a free cluster (M0 — free forever)
3. Create a database user (Settings → Database Access → Add User)
4. Allow your IP (Network Access → Add IP Address → "Allow from anywhere" for dev)
5. Click "Connect" → "Drivers" → copy the connection string
6. It looks like: `mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/?retryWrites=true`

---

### Step 3 — Configure .env
Open `.env` and set your values:

```env
# Choose ONE of these:
MONGO_URI=mongodb://localhost:27017/herbix         # Local MongoDB
# MONGO_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/herbix  # Atlas

# Change this to a long random string in production:
JWT_SECRET=herbix_super_secret_change_me_in_production

PORT=3000

# Optional — only needed for UPI payments:
# Get free test keys at: https://dashboard.razorpay.com/app/keys
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXX
```

---

### Step 4 — Install Dependencies
```bash
cd herbix_corrected
npm install
```

---

### Step 5 — Start the Server
```bash
node server.js
# OR for auto-reload during development:
npm run dev
```

You should see:
```
✅  MongoDB connected → mongodb://localhost:27017/herbix
✅  Admin seeded  →  admin@herbix.com / admin123

🌿  HERBIX  →  http://localhost:3000
🔑  Admin   →  admin@herbix.com  /  admin123
💳  Razorpay: NOT configured (COD works fine)
```

---

### Step 6 — Open the Website
- **Store:**  http://localhost:3000
- **Admin:**  http://localhost:3000/admin.html

---

## 🔑 Default Admin Credentials
| Field | Value |
|-------|-------|
| Email | admin@herbix.com |
| Password | admin123 |

> **Change the password immediately** after first login via the Admin panel → Add User (create a new admin and delete the default one).

---

## 📋 How Login Works

1. Users sign up → account is **pending approval** (cannot log in yet)
2. Admin approves them in **Admin Panel → Pending Approval**
3. User can now log in
4. Admin account is auto-created on first server start and is pre-approved

---

## 📄 Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | /index.html | Hero, features, testimonials |
| Product | /product.html | Product detail, add to cart |
| Cart | /cart.html | Cart management |
| Contact | /contact.html | Contact form |
| Checkout | /order.html | Delivery address + UPI/COD payment |
| Track | /track.html | Real-time order tracking |
| Admin | /admin.html | Full admin panel (admin only) |

---

## 💳 Razorpay UPI (Optional)
COD (Cash on Delivery) works without any Razorpay setup.

To enable UPI:
1. Go to https://dashboard.razorpay.com/app/keys
2. Create a free account
3. Get your test `key_id` and `key_secret`
4. Add them to `.env`
5. Restart the server

---

## 🔒 Security Notes for Production
- Set a strong `JWT_SECRET` in `.env` (random 32+ character string)
- Use MongoDB Atlas with a strong password
- Set `NODE_ENV=production`
- Use HTTPS (via nginx or a hosting provider)
- Never commit `.env` to git (add it to `.gitignore`)
