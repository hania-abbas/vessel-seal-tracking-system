// frontend/seal-log.js
// Seal log frontend display logic

async function getActiveVisit() {
  try {
    const r = await fetch('http://localhost:3000/api/visits/active', {cache: 'no-store'});
    const j = await r.json();
    return j.visit || null;
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
  const visit = await getActiveVisit();
  const url = `http://localhost:3000/api/seal-log${visit ? `?visit=${encodeURIComponent(visit)}` : ''}`;

  const box = document.getElementById('sealLogBox');
  const meta = document.getElementById('sealLogMeta');
  if (!box) return;

  box.innerHTML = '<div class="log-line">Loading…</div>';
  if (meta) meta.textContent = visit ? `Visit: ${visit}` : '';

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();

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

document.getElementById('refreshSealLogBtn')?.addEventListener('click', loadSealLog);
window.addEventListener('load', loadSealLog);

window.loadSealLog = loadSealLog;