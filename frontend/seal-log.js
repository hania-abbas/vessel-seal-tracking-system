//CHECK THISSSSS REVIEWWWW
// frontend/seal-log.js
// Seal log frontend display logic (with JWT + auto-redirect)

const API_BASE  = "http://localhost:3000"; // <-- change if your backend runs elsewhere
const TOKEN_KEY = "authToken";             // <-- matches what you saved at login
// is the key where JWT is stored in localStorage


//auth helpers
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function redirectToLogin() {
  // optional: preserve where we came from
  const here = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/frontend/login.html?next=${here}`;
}
//guarantees a token exists, otherwise redirects to login and stops execution
function requireAuth() {
  const t = getToken();
  if (!t) {
    redirectToLogin();
    throw new Error("no_token");
  }
  return t;
}

// Unified fetch helper that injects the token and handles 401
async function apiFetch(path, options = {}) {
  const token = requireAuth();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    "Authorization": `Bearer ${token}`,
  };

  const res = await fetch(
    path.startsWith("http") ? path : `${API_BASE}${path}`,
    { ...options, headers, cache: "no-store" }
  );

  // If token is bad/expired, clear it and redirect
  if (res.status === 401 || res.status === 403) {
    try { await res.json(); } catch {}
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error("unauthorized");
  }

  // Allow empty bodies
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- existing helpers ----
function pad2(n) { return n.toString().padStart(2, '0'); }
function formatTimestamp(ts) {
  const d = new Date(ts);
  const day = pad2(d.getDate());
  const mon = pad2(d.getMonth() + 1);
  const yr  = d.getFullYear();
  let hr = d.getHours();
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  const min = pad2(d.getMinutes());
  return `${day}/${mon}/${yr} ${hr}:${min} ${ampm}`;
}

// ---- API calls (now via apiFetch) ----
async function getActiveVisit() {
  try {
    const j = await apiFetch('/api/visits/active');
    return j?.visit || null;
  } catch {
    return null;
  }
}

async function loadSealLog() {
  const box  = document.getElementById('sealLogBox');
  const meta = document.getElementById('sealLogMeta');
  if (!box) return;

  // Ensure we have a token; will redirect if missing
  try { requireAuth(); } catch { return; }

  box.innerHTML = '<div class="log-line">Loading…</div>';

  try {
    const visit = await getActiveVisit();
    if (meta) meta.textContent = visit ? `Visit: ${visit}` : '';

    const path = visit ? `/api/seal-log?visit=${encodeURIComponent(visit)}` : '/api/seal-log';
    const rows = await apiFetch(path);

    if (!rows || !rows.lines || rows.lines.length === 0) {
      box.innerHTML = '<div class="log-line">No entries yet.</div>';
      return;
    }

    // lines are already formatted by backend
    box.innerHTML = rows.lines.map(line => `<div class="log-line">${line}</div>`).join('');

    // ✅ auto-scroll to bottom
    box.scrollTop = box.scrollHeight;

  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="log-line">Failed to load log.</div>';
  }
}

// Wire up refresh button + initial load
document.getElementById('refreshSealLogBtn')?.addEventListener('click', loadSealLog);
window.addEventListener('load', loadSealLog);

// Optional: expose to window for manual triggers
window.loadSealLog = loadSealLog;

window.apiFetch = apiFetch;
window.requireAuth = requireAuth;
window.getToken = getToken;
window.redirectToLogin = redirectToLogin;

