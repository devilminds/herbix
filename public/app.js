// ============================================================
//  HERBIX  –  app.js  |  REAL SERVER VERSION
//  Talks to Node.js backend — all data saves to MongoDB
//  Open via http://localhost:3000 (NOT Live Server port 5500)
// ============================================================

const CART_KEY = "herbix_cart";
const PRODUCT  = { id:"herbix-gel-100ml", name:"HERBIX Herbal Hair Gel", size:"100ml", price:200, origPrice:299 };

/* ── Auth helpers ─────────────────────────────────────────── */
const getToken   = ()  => localStorage.getItem("hx_token");
const getUser    = ()  => { try { return JSON.parse(localStorage.getItem("hx_user")); } catch { return null; } };
const isLoggedIn = ()  => !!getToken();

function logout() {
  localStorage.removeItem("hx_token");
  localStorage.removeItem("hx_user");
  updateAuthUI();
  updateCartBadge();
}

/* ── apiFetch — talks to real Node.js server ─────────────── */
async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...(opts.headers || {})
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res  = await fetch(url, { ...opts, headers, signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const msg = err.name === "AbortError"
      ? "Request timed out. Is the server running? Run: node server.js"
      : "Cannot connect to server. Make sure you opened http://localhost:3000 and ran: node server.js";
    return { ok: false, status: 0, data: { error: msg } };
  }
}

/* ── Cart ─────────────────────────────────────────────────── */
const getCart   = ()   => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
const saveCart  = (c)  => localStorage.setItem(CART_KEY, JSON.stringify(c));
const cartCount = ()   => getCart().reduce((s, i) => s + i.qty, 0);
const cartTotal = ()   => getCart().reduce((s, i) => s + i.price * i.qty, 0);
const clearCart = ()   => { localStorage.removeItem(CART_KEY); updateCartBadge(); };

function addToCart(product, qty = 1) {
  if (!isLoggedIn()) { openModal("login"); showToast("⚠️ Please login first."); return; }
  const cart = getCart();
  const ex   = cart.find(i => i.id === product.id);
  if (ex) ex.qty += qty; else cart.push({ ...product, qty });
  saveCart(cart);
  updateCartBadge();
  showToast("🌿 Added to cart!");
}

function updateCartQty(id, qty) {
  let cart = getCart();
  if (qty <= 0) cart = cart.filter(i => i.id !== id);
  else { const it = cart.find(i => i.id === id); if (it) it.qty = qty; }
  saveCart(cart);
  updateCartBadge();
  if (typeof renderCartPage === "function") renderCartPage();
}

/* ── Cart badge ───────────────────────────────────────────── */
function updateCartBadge() {
  const n = cartCount();
  document.querySelectorAll(".cart-badge").forEach(b => {
    b.textContent = n;
    b.classList.toggle("on", n > 0);
  });
}

/* ── Auth UI ──────────────────────────────────────────────── */
function updateAuthUI() {
  const user     = getUser();
  const loggedIn = !!user;
  document.querySelectorAll(".auth-login-btn").forEach(el  => el.style.display = loggedIn ? "none" : "");
  document.querySelectorAll(".auth-user-area").forEach(el  => el.style.display = loggedIn ? "flex" : "none");
  document.querySelectorAll(".auth-admin-link").forEach(el => el.style.display = (loggedIn && user?.role === "admin") ? "" : "none");
  document.querySelectorAll(".chip-name").forEach(el       => { if (loggedIn) el.textContent = user.name.split(" ")[0]; });
}

/* ── Modals ───────────────────────────────────────────────── */
function openModal(id)   { document.getElementById(id + "Modal")?.classList.add("open"); }
function closeModal(id)  { document.getElementById(id + "Modal")?.classList.remove("open"); }
function closeAllModals(){ document.querySelectorAll(".modal-bg").forEach(m => m.classList.remove("open")); }

/* ── Toast ────────────────────────────────────────────────── */
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.querySelector(".toast-msg").textContent = msg;
  t.classList.add("on");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

/* ── Login handler ────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPass")?.value;
  const alertEl  = document.getElementById("loginAlert");
  const btn      = document.getElementById("loginBtn");
  const spin     = document.getElementById("loginSpin");
  alertEl.className = "alert";
  if (!email || !password) {
    alertEl.className = "alert alert-err on";
    alertEl.innerHTML = "❌ Email and password required.";
    return;
  }
  btn.disabled = true; spin?.classList.add("on");
  const { ok, data } = await apiFetch("/api/login", { method:"POST", body:JSON.stringify({ email, password }) });
  btn.disabled = false; spin?.classList.remove("on");
  if (ok) {
    localStorage.setItem("hx_token", data.token);
    localStorage.setItem("hx_user",  JSON.stringify(data.user));
    updateAuthUI();
    closeAllModals();
    showToast("🌿 Welcome, " + data.user.name + "!");
    if (data.user.role === "admin") window.location.href = "admin.html";
    else location.reload();
  } else {
    alertEl.className = "alert alert-err on";
    alertEl.innerHTML = "❌ " + (data.error || "Login failed.");
  }
}

/* ── Signup handler ───────────────────────────────────────── */
async function handleSignup(e) {
  e.preventDefault();
  const name     = document.getElementById("signupName")?.value.trim();
  const email    = document.getElementById("signupEmail")?.value.trim();
  const password = document.getElementById("signupPass")?.value;
  const confirm  = document.getElementById("signupConfirm")?.value;
  const alertEl  = document.getElementById("signupAlert");
  const btn      = document.getElementById("signupBtn");
  const spin     = document.getElementById("signupSpin");
  alertEl.className = "alert";
  if (!name||!email||!password) { alertEl.className="alert alert-err on"; alertEl.innerHTML="❌ All fields required."; return; }
  if (password !== confirm)     { alertEl.className="alert alert-err on"; alertEl.innerHTML="❌ Passwords do not match."; return; }
  if (password.length < 6)      { alertEl.className="alert alert-err on"; alertEl.innerHTML="❌ Password must be ≥ 6 characters."; return; }
  btn.disabled = true; spin?.classList.add("on");
  const { ok, data } = await apiFetch("/api/signup", { method:"POST", body:JSON.stringify({ name, email, password }) });
  btn.disabled = false; spin?.classList.remove("on");
  alertEl.className = ok ? "alert alert-ok on" : "alert alert-err on";
  alertEl.innerHTML = (ok ? "✅ " : "❌ ") + (ok ? data.message : (data.error || "Signup failed."));
  if (ok) document.getElementById("signupForm")?.reset();
}

/* ── Navbar ───────────────────────────────────────────────── */
function initNavbar() {
  const nav = document.querySelector(".navbar");
  window.addEventListener("scroll", () => nav?.classList.toggle("scrolled", scrollY > 30));
  document.querySelector(".hamburger")?.addEventListener("click", () => {
    document.querySelector(".nav-links")?.classList.toggle("open");
  });
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(a => {
    if ((a.getAttribute("href") || "") === page) a.classList.add("active");
  });
}

/* ── DOMContentLoaded ────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  updateAuthUI();
  updateCartBadge();

  document.querySelectorAll(".modal-bg").forEach(m =>
    m.addEventListener("click", e => { if (e.target === m) m.classList.remove("open"); })
  );
  document.querySelectorAll(".open-login").forEach(b  => b.addEventListener("click", () => openModal("login")));
  document.querySelectorAll(".open-signup").forEach(b => b.addEventListener("click", () => openModal("signup")));
  document.getElementById("goToSignup")?.addEventListener("click", () => { closeModal("login");  openModal("signup"); });
  document.getElementById("goToLogin")?.addEventListener("click",  () => { closeModal("signup"); openModal("login");  });
  document.getElementById("loginForm")?.addEventListener("submit",  handleLogin);
  document.getElementById("signupForm")?.addEventListener("submit", handleSignup);

  document.querySelectorAll(".logout-btn").forEach(b => b.addEventListener("click", () => {
    logout(); clearCart(); showToast("👋 Logged out.");
    setTimeout(() => window.location.replace("index.html"), 700);
  }));

  // Qty controls (product page)
  const qtyInput = document.getElementById("qtyInput");
  if (qtyInput) {
    document.getElementById("qtyMinus")?.addEventListener("click", () => {
      const v = parseInt(qtyInput.value)||1; if (v>1) qtyInput.value = v-1;
    });
    document.getElementById("qtyPlus")?.addEventListener("click", () => {
      const v = parseInt(qtyInput.value)||1; if (v<10) qtyInput.value = v+1;
    });
    document.getElementById("addCartBtn")?.addEventListener("click", () => {
      addToCart({ ...PRODUCT }, parseInt(qtyInput.value)||1);
    });
    document.getElementById("buyNowBtn")?.addEventListener("click", () => {
      addToCart({ ...PRODUCT }, parseInt(qtyInput.value)||1);
      if (isLoggedIn()) window.location.href = "order.html";
    });
  }

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".tabs-wrap");
      wrap?.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      wrap?.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      wrap?.querySelector("#tab-" + btn.dataset.tab)?.classList.add("active");
    });
  });

  document.getElementById("heroShopBtn")?.addEventListener("click", () =>
    document.getElementById("product")?.scrollIntoView({ behavior:"smooth" })
  );
});