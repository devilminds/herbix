// ============================================================
//  HERBIX  –  server.js  (CORRECTED)
//  FIX LIST:
//  1. dotenv loaded first — all env vars work properly
//  2. MongoDB auto-retry with 5 attempts and backoff
//  3. JWT_SECRET from .env (not hardcoded)
//  4. Razorpay init is safe — won't crash if keys missing
//  5. /api/verify-admin endpoint for client-side token check
//  6. Clear error message when account awaiting approval
//  7. All error responses use consistent { error: "..." } shape
// ============================================================
require("dotenv").config();

const express   = require("express");
const mongoose  = require("mongoose");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const ExcelJS   = require("exceljs");
const crypto    = require("crypto");
const path      = require("path");
const fs        = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || "herbix_default_secret_CHANGE_ME";
if (JWT_SECRET === "herbix_default_secret_CHANGE_ME") {
  console.warn("⚠️  JWT_SECRET not set in .env — using insecure default!");
}

const MONGO_URI           = process.env.MONGO_URI   || "mongodb://localhost:27017/herbix";
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

let razorpay = null;
if (RAZORPAY_KEY_ID && !RAZORPAY_KEY_ID.includes("XXXXX")) {
  try {
    const Razorpay = require("razorpay");
    razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
    console.log("✅  Razorpay initialised.");
  } catch (e) { console.warn("⚠️  Razorpay init failed:", e.message); }
} else {
  console.warn("⚠️  Razorpay keys not configured — UPI payments disabled. COD still works.");
}

const EXCEL_F = path.join(__dirname, "HERBIX_Orders.xlsx");

// ============================================================
//  SCHEMAS
// ============================================================
const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ["user","admin"], default: "user" },
  approved: { type: Boolean, default: false },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderId:           { type: String, unique: true },
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userName:          String,
  userEmail:         String,
  cart:              [{ id: String, name: String, size: String, price: Number, qty: Number }],
  address: {
    fullName: String, phone: String, street: String,
    city: String, state: String, pincode: String, landmark: String,
  },
  total:             Number,
  paymentMethod:     { type: String, enum: ["cod","upi"], default: "cod" },
  paymentStatus:     { type: String, enum: ["Pending","Paid","Failed"], default: "Pending" },
  razorpayOrderId:   String,
  razorpayPaymentId: String,
  status: {
    type: String, default: "Confirmed",
    enum: ["Confirmed","Packed","Shipped","Out for Delivery","Delivered","Cancelled"],
  },
  timeline: [{ status: String, message: String, timestamp: { type: Date, default: Date.now } }],
}, { timestamps: true });

const contactSchema = new mongoose.Schema({
  name: String, email: String, message: String,
}, { timestamps: true });

const User    = mongoose.model("User",    userSchema);
const Order   = mongoose.model("Order",   orderSchema);
const Contact = mongoose.model("Contact", contactSchema);

// ============================================================
//  DB CONNECT + AUTO-RETRY (FIX #2)
// ============================================================
async function connectDB(retries = 5, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });
      const safeUri = MONGO_URI.replace(/:\/\/[^@]+@/, "://<credentials>@");
      console.log("✅  MongoDB connected →", safeUri);
      await seedAdmin();
      return;
    } catch (err) {
      console.error(`❌  MongoDB attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        console.error("💥  Could not connect to MongoDB. Exiting.");
        console.error("    Check your MONGO_URI in .env");
        process.exit(1);
      }
      console.log(`⏳  Retrying in ${delay/1000}s…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function seedAdmin() {
  const exists = await User.findOne({ role: "admin" });
  if (!exists) {
    await User.create({
      name: "Admin", email: "admin@herbix.com",
      password: await bcrypt.hash("admin123", 10),
      role: "admin", approved: true,
    });
    console.log("✅  Admin seeded  →  admin@herbix.com / admin123");
  } else {
    console.log("ℹ️   Admin exists:", exists.email);
  }
}

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer "))
    return res.status(401).json({ error: "Not authenticated. Please log in." });
  try {
    req.user = jwt.verify(h.split(" ")[1], JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === "TokenExpiredError"
      ? "Session expired. Please log in again."
      : "Invalid token. Please log in.";
    res.status(401).json({ error: msg });
  }
}

function adminOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role === "admin") return next();
    res.status(403).json({ error: "Admin access required." });
  });
}

// FIX #5: API endpoint so admin.html can verify token server-side on load
app.get("/api/verify-admin", adminOnly, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ============================================================
//  AUTH
// ============================================================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required." });
    const u = await User.findOne({ email: email.toLowerCase().trim() });
    if (!u)
      return res.status(401).json({ error: "Invalid email or password." });
    // FIX #6: clear approval message
    if (!u.approved)
      return res.status(403).json({
        error: "Your account is pending admin approval. An admin must approve your account before you can log in.",
      });
    if (!await bcrypt.compare(password, u.password))
      return res.status(401).json({ error: "Invalid email or password." });
    const token = jwt.sign(
      { id: u._id, name: u.name, email: u.email, role: u.role },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ success: true, token, user: { id: u._id, name: u.name, email: u.email, role: u.role } });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email address." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    if (await User.findOne({ email: email.toLowerCase().trim() }))
      return res.status(409).json({ error: "An account with this email already exists." });
    await User.create({
      name: name.trim(), email: email.toLowerCase().trim(),
      password: await bcrypt.hash(password, 10),
      role: "user", approved: false,
    });
    res.status(201).json({
      success: true,
      message: "Account created! Awaiting admin approval before you can log in.",
    });
  } catch (e) {
    console.error("Signup error:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select("-password");
    if (!u) return res.status(404).json({ error: "User not found." });
    res.json({ id: u._id, name: u.name, email: u.email, role: u.role });
  } catch { res.status(500).json({ error: "Server error." }); }
});

// ============================================================
//  PAYMENT — RAZORPAY UPI
// ============================================================
app.post("/api/payment/create-order", auth, async (req, res) => {
  if (!razorpay)
    return res.status(503).json({ error: "UPI payments are not configured. Please use Cash on Delivery." });
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount." });
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100), currency: "INR",
      receipt: "herbix_" + Date.now(), payment_capture: 1,
    });
    res.json({ success: true, orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, keyId: RAZORPAY_KEY_ID });
  } catch (e) {
    console.error("Razorpay error:", e);
    res.status(500).json({ error: "Payment initiation failed. Check Razorpay keys in .env." });
  }
});

app.post("/api/payment/verify", auth, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: "UPI payments not configured." });
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, cart, address, total } = req.body;
    const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(razorpayOrderId + "|" + razorpayPaymentId).digest("hex");
    if (expected !== razorpaySignature)
      return res.status(400).json({ success: false, error: "Payment verification failed." });
    const orderId = "ORD" + Date.now();
    const order = await Order.create({
      orderId, userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
      cart, address, total, paymentMethod: "upi", paymentStatus: "Paid",
      razorpayOrderId, razorpayPaymentId, status: "Confirmed",
      timeline: [{ status: "Confirmed", message: "Order confirmed. Payment received via UPI." }],
    });
    appendToExcel(order).catch(console.error);
    res.json({ success: true, orderId, message: "Payment successful! Order placed." });
  } catch (e) {
    console.error("Verify error:", e);
    res.status(500).json({ success: false, error: "Server error during payment verification." });
  }
});

// ============================================================
//  ORDERS (COD)
// ============================================================
app.post("/api/orders", auth, async (req, res) => {
  try {
    const { cart, address, total } = req.body;
    if (!cart?.length) return res.status(400).json({ error: "Cart is empty." });
    const required = ["fullName","phone","street","city","state","pincode"];
    if (!address || required.some(k => !address[k]))
      return res.status(400).json({ error: "Complete delivery address is required." });
    const orderId = "ORD" + Date.now();
    const order = await Order.create({
      orderId, userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
      cart, address, total, paymentMethod: "cod", paymentStatus: "Pending",
      status: "Confirmed",
      timeline: [{ status: "Confirmed", message: "Order confirmed. Cash on Delivery." }],
    });
    appendToExcel(order).catch(console.error);
    res.status(201).json({ success: true, orderId, message: "Order placed successfully!" });
  } catch (e) {
    console.error("Order error:", e);
    res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/orders", auth, async (req, res) => {
  try { res.json(await Order.find({ userId: req.user.id }).sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Server error." }); }
});

app.get("/api/orders/:orderId", auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.userId.toString() !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "Access denied." });
    res.json(order);
  } catch { res.status(500).json({ error: "Server error." }); }
});

// ============================================================
//  CONTACT
// ============================================================
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message)
      return res.status(400).json({ success: false, error: "All fields are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, error: "Invalid email address." });
    await Contact.create({ name: name.trim(), email: email.toLowerCase().trim(), message: message.trim() });
    res.status(201).json({ success: true, message: "Thank you! We'll get back to you soon. 🌿" });
  } catch { res.status(500).json({ success: false, error: "Server error." }); }
});

// ============================================================
//  ADMIN ROUTES
// ============================================================
app.get("/api/admin/orders", adminOnly, async (req, res) => {
  try { res.json(await Order.find().sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Server error." }); }
});

app.patch("/api/admin/orders/:id/status", adminOnly, async (req, res) => {
  try {
    const { status, message } = req.body;
    const msgs = {
      "Confirmed":"Order confirmed and being processed.",
      "Packed":"Your order has been packed.",
      "Shipped":"Your order has been shipped!",
      "Out for Delivery":"Out for delivery. Expect it today!",
      "Delivered":"Delivered. Enjoy! 🌿",
      "Cancelled":"Order cancelled.",
    };
    const o = await Order.findByIdAndUpdate(
      req.params.id,
      { status, $push: { timeline: { status, message: message || msgs[status] || status } } },
      { new: true }
    );
    if (!o) return res.status(404).json({ error: "Order not found." });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error." }); }
});

app.get("/api/admin/users", adminOnly, async (req, res) => {
  try { res.json(await User.find().select("-password").sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Server error." }); }
});

app.post("/api/admin/users", adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "Name, email and password are required." });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: "A user with this email already exists." });
    await User.create({
      name: name.trim(), email: email.toLowerCase().trim(),
      password: await bcrypt.hash(password, 10), role: role || "user", approved: true,
    });
    res.status(201).json({ success: true, message: `User ${name} created.` });
  } catch { res.status(500).json({ error: "Server error." }); }
});

app.patch("/api/admin/users/:id/approve", adminOnly, async (req, res) => {
  try {
    const u = await User.findByIdAndUpdate(req.params.id, { approved: true }, { new: true });
    if (!u) return res.status(404).json({ error: "User not found." });
    res.json({ success: true, message: `${u.name} approved.` });
  } catch { res.status(500).json({ error: "Server error." }); }
});

app.delete("/api/admin/users/:id", adminOnly, async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: "User not found." });
    if (u.role === "admin") return res.status(400).json({ error: "Cannot delete admin account." });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error." }); }
});

app.get("/api/admin/contacts", adminOnly, async (req, res) => {
  try { res.json(await Contact.find().sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Server error." }); }
});

app.get("/api/admin/export", adminOnly, async (req, res) => {
  try { await rebuildExcel(); res.download(EXCEL_F, "HERBIX_Orders.xlsx"); }
  catch { res.status(500).json({ error: "Export failed." }); }
});

// ============================================================
//  EXCEL
// ============================================================
async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HERBIX Admin";
  const ws = wb.addWorksheet("Orders");
  const headers = ["Order ID","Date","Customer","Email","Items","Total (₹)","Payment","Delivery Address","Status"];
  const widths  = [16,20,20,28,36,10,10,55,14];
  ws.addRow(headers);
  const hr = ws.getRow(1); hr.height = 28;
  headers.forEach((_,i) => {
    const c = hr.getCell(i+1);
    c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF1a3a2a"} };
    c.font = { bold:true, color:{argb:"FFFFFFFF"}, name:"Arial", size:11 };
    c.alignment = { horizontal:"center", vertical:"middle" };
    ws.getColumn(i+1).width = widths[i];
  });
  ws.autoFilter = "A1:I1";
  return wb;
}

function orderToRow(o) {
  const items = o.cart.map(i=>`${i.name} ×${i.qty}`).join(", ");
  const addr  = `${o.address.fullName}, ${o.address.phone}, ${o.address.street}, ${o.address.city}, ${o.address.state} - ${o.address.pincode}`;
  const date  = new Date(o.createdAt).toISOString().replace("T"," ").slice(0,19);
  return [o.orderId, date, o.userName, o.userEmail, items, o.total, (o.paymentMethod||"cod").toUpperCase(), addr, o.status];
}

async function appendToExcel(order) {
  let wb;
  if (fs.existsSync(EXCEL_F)) { wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(EXCEL_F); }
  else wb = await buildWorkbook();
  const ws = wb.getWorksheet("Orders");
  const row = ws.addRow(orderToRow(order));
  row.height = 36;
  if (row.number%2===0) row.eachCell(c=>{ c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F8F4"}}; });
  row.eachCell(c=>{ c.alignment={vertical:"middle",wrapText:true}; c.font={name:"Arial",size:10}; });
  await wb.xlsx.writeFile(EXCEL_F);
}

async function rebuildExcel() {
  const wb = await buildWorkbook();
  const ws = wb.getWorksheet("Orders");
  const orders = await Order.find().sort({ createdAt: 1 });
  orders.forEach((o,idx) => {
    const row = ws.addRow(orderToRow(o));
    row.height = 36;
    if ((idx+2)%2===0) row.eachCell(c=>{ c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F8F4"}}; });
    row.eachCell(c=>{ c.alignment={vertical:"middle",wrapText:true}; c.font={name:"Arial",size:10}; });
  });
  await wb.xlsx.writeFile(EXCEL_F);
}

// ============================================================
//  START
// ============================================================
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌿  HERBIX  →  http://localhost:${PORT}`);
    console.log(`🔑  Admin   →  admin@herbix.com  /  admin123`);
    if (razorpay) console.log(`💳  Razorpay: ${RAZORPAY_KEY_ID}`);
    else          console.log(`💳  Razorpay: NOT configured (COD works fine)`);
    console.log();
  });
});
