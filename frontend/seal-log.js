
// frontend/seal-log.js
// Seal log frontend display logic (with JWT + auto-redirect)

const TOKEN_KEY = "authToken";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function redirectToLogin() {
  const here = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login.html?next=${here}`; // fixed
}

function requireAuth() {
  const t = getToken();
  if (!t) {
    redirectToLogin();
    throw new Error("no_token");
  }
  return t;
}

async function getActiveVisit() {
  try {
    const res = await App.apiFetch('/api/visits/active');
    const j = await res.json();
    return j?.visit || null;
  } catch {
    return null;
  }
}

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

async function loadSealLog() {
  const box  = document.getElementById('sealLogBox');
  const meta = document.getElementById('sealLogMeta');
  if (!box) return;

  try { requireAuth(); } catch { return; }

  box.innerHTML = '<div class="log-line">Loading…</div>';

  try {
    const visit = await getActiveVisit();
    if (meta) meta.textContent = visit ? `Visit: ${visit}` : '';

    const path = visit ? `/api/seal-log?visit=${encodeURIComponent(visit)}` : '/api/seal-log';
    const res = await App.apiFetch(path);
    const rows = await res.json();

    const lines = rows?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      box.innerHTML = '<div class="log-line">No entries yet.</div>';
      return;
    }

    box.innerHTML = lines.map(line => `<div class="log-line">${line}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="log-line">Failed to load log.</div>';
  }
}

document.getElementById('refreshSealLogBtn')?.addEventListener('click', loadSealLog);
window.addEventListener('load', loadSealLog);
window.loadSealLog = loadSealLog;

