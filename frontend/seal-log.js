// frontend/seal-log.js

async function getActiveVisit() {
  try {
    const r = await fetch('/api/visits/active');
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

function normalizeSeal(r) {
  const raw =
    r.seal_text ?? r.seal ?? r.seal_number ??
    (r.single_seal || r.return_single_seal) ??
    (r.seal_from && r.seal_to ? `#${r.seal_from}–${r.seal_to}` : '');

  if (!raw) return '';
  return raw.toString().startsWith('#') ? raw.toString() : `#${raw}`;
}

function normalizeAction(r) {
  return (r.action || '').toString().trim().toLowerCase();
}

function normalizePlanner(r) {
  return r.planner || r.user_planner || r.user || r.changed_by || 'Unknown';
}

function normalizeCondition(r) {
  if (r.condition) return r.condition;
  if (r.extra) return r.extra;

  const lost = (r.lost_seal === 1 || r.lost === 1 || r.is_lost === 1);
  const damaged = (r.damaged_seal === 1 || r.damaged === 1 || r.is_damaged === 1);

  if (lost && damaged) return 'damaged & lost';
  if (lost) return 'marked as lost';
  if (damaged) return 'partially damaged';

  return '';
}

function buildSentence(r) {
  const action = normalizeAction(r);
  const seal   = normalizeSeal(r);
  const planner = normalizePlanner(r);
  const cond   = normalizeCondition(r);
  const notes  = (r.notes || r.note || r.return_notes || '').toString().trim();

  let badgeClass = 'badge';
  let badgeLabel = action || 'Update';

  if (action === 'delivered') { badgeClass += ' badge-delivered'; badgeLabel = 'Delivered'; }
  else if (action === 'returned') { badgeClass += ' badge-returned'; badgeLabel = 'Returned'; }
  if (cond.includes('damaged')) { badgeClass += ' badge-damaged'; badgeLabel = 'Damaged'; }
  if (cond.includes('lost'))    { badgeClass += ' badge-lost'; badgeLabel = 'Lost'; }

  let verbPart = 'updated';
  if (action === 'delivered') verbPart = 'delivered and logged';
  else if (action === 'returned') verbPart = cond ? `returned ${cond}` : 'returned in good condition';
  else if (action) verbPart = action;

  return `
    <span class="${badgeClass}">${badgeLabel}</span>
    <span class="log-seal">Seal ${seal}</span>
    ${verbPart} by <span class="log-meta">${planner}</span>
    ${notes ? `<span class="log-note">— ${notes}</span>` : ''}
  `;
}

async function loadSealLog() {
  const visit = await getActiveVisit();
  const url = `/api/seal-log${visit ? `?visit=${encodeURIComponent(visit)}` : ''}`;

  const box = document.getElementById('sealLogBox');
  const meta = document.getElementById('sealLogMeta');
  if (!box) return;

  box.innerHTML = '<div class="log-line">Loading…</div>';
  if (meta) meta.textContent = visit ? `Visit: ${visit}` : '';

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();

    if (!rows || rows.length === 0) {
      box.innerHTML = '<div class="log-line">No entries yet.</div>';
      return;
    }

    box.innerHTML = rows.map(r => {
      const ts = formatTimestamp(r.timestamp || r.ts || Date.now());
      const msg = buildSentence(r);
      return `
        <div class="log-line">
          <span class="log-ts">[${ts}]</span> ${msg}
        </div>
      `;
    }).join('');

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
