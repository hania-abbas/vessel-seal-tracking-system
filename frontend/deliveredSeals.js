// frontend/deliveredSeals.js

// === Backend base URL (change here if your server port changes) ===
const API_BASE = localStorage.getItem('API_BASE') || 'http://localhost:3000';

// ------- small DOM helpers -------
const D     = (id) => document.getElementById(id);
const dGet  = (id) => (D(id)?.value ?? '').trim();
const dSet  = (id, v) => { const el = D(id); if (el) el.value = v; };
const dMark = (id, on) => { const el = D(id); if (el) el.classList.toggle('invalid', !!on); };

// ------- validation & utils -------
function dIsNum(s){ return typeof s==='string' && /^[0-9]{6,9}$/.test(s.trim()); }
function dAutosize(el){ if(!el) return; el.style.height='auto'; el.style.height = el.scrollHeight + 'px'; }
function dAutosizeById(id){ dAutosize(D(id)); }

function dParseMultipleSeals(sealString) {
  if (!sealString) return [];
  return sealString
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(dIsNum)
    .map(Number);
}

function getVisitFromQuery() {
  const u = new URL(window.location.href);
  const v = (u.searchParams.get('visit') || '').trim();
  return v || null;
}
async function dGetActiveVisit(){
  const v = getVisitFromQuery();
  if (v) return v;
  try{
    const r = await fetch(`${API_BASE}/api/visits/active`, { cache:'no-store' });
    const j = await r.json();
    return j.visit || null;
  }catch{ return null; }
}

function dNormalizePreview(from, to, singleSeals) {
  const out = [];
  if (dIsNum(from) && dIsNum(to) && Number(to) >= Number(from)) {
    out.push(`Delivered ${Number(from)}–${Number(to)}`);
  }
  if (singleSeals.length > 0) {
    out.push(singleSeals.length === 1
      ? `Delivered ${singleSeals[0]}`
      : `Delivered singles: ${singleSeals.join(', ')}`);
  }
  return out.join('\n');
}
function dComputeTotal(from, to, singleSeals) {
  let total = 0;
  if (dIsNum(from) && dIsNum(to) && Number(to) >= Number(from)) {
    total += (Number(to) - Number(from) + 1);
  }
  total += singleSeals.length;
  return total;
}
function dRefreshPreview(){
  const from        = dGet('seal_from');
  const to          = dGet('seal_to');
  const singleInput = dGet('single_seal');
  const singleSeals = dParseMultipleSeals(singleInput);

  const total   = dComputeTotal(from, to, singleSeals);
  const preview = dNormalizePreview(from, to, singleSeals);

  dSet('total_count', total || '');
  dSet('entered_seals', preview || 'No seals entered');

  dAutosizeById('entered_seals');
}

function showDupAlert(dups){
  const list = (dups || []).slice(0, 30).join(', ');
  alert(`Duplicate seals detected:\n${list}${dups && dups.length > 30 ? ' …' : ''}`);
}

/* -------- submit (CREATE delivered seals) -------- */
let deliveredEditId = null; // reserved for future PUT support via setDeliveredEdit()

async function dSubmit(e){
  if(e) e.preventDefault();

  const visit = await dGetActiveVisit();
  if(!visit){ 
    alert('No active visit found. Add ?visit= in the URL or enable /api/visits/active.'); 
    return; 
  }

  const from        = dGet('seal_from');
  const to          = dGet('seal_to');
  const singleSeals = dParseMultipleSeals(dGet('single_seal'));

  const hasRange   = dIsNum(from) && dIsNum(to) && Number(to) >= Number(from);
  const hasSingles = singleSeals.length > 0;

  ['seal_from','seal_to','single_seal'].forEach(id => dMark(id, false));
  if(!hasRange && !hasSingles){
    ['seal_from','seal_to','single_seal'].forEach(id => dMark(id, true));
    alert('Enter a valid delivered range and/or one or more single seals (6–9 digits).');
    return;
  }

  const vessel_supervisor = dGet('vessel_supervisor');
  if (!vessel_supervisor) { alert('Please select a vessel supervisor'); return; }

  const user_planner = dGet('user_planner') || null;

  let seal_number = "";
  if (hasRange) seal_number = `${from}-${to}`;
  if (hasSingles) seal_number += (seal_number ? "," : "") + singleSeals.join(",");
  const total_count = dComputeTotal(from, to, singleSeals);

  const payload = {
    visit,
    seal_number,
    total_count,
    vessel_supervisor,
    user_planner,
    created_at: new Date().toISOString(),
    delivered_notes: dGet('delivered_notes') || null
  };

  try{
    const res = await fetch(`${API_BASE}/api/delivered-seals`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await res.json().catch(()=> ({}));
      alert('Error: ' + (j.error || res.statusText || 'Unknown server error'));
      return;
    }

    ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals']
      .forEach(id => dSet(id,''));
    dAutosizeById('delivered_notes'); 
    dAutosizeById('entered_seals');
    loadDeliveredSeals();

  }catch(err){
    console.error(err);
    alert('Failed to submit delivered seals.');
  }
}

/* -------- READ: Load all delivered seals -------- */
async function loadDeliveredSeals(){
  try{
    const res = await fetch(`${API_BASE}/api/delivered-seals`, {method:'GET'});
    const seals = await res.json();
    renderDeliveredSeals(seals);
  }catch(err){
    console.error(err);
    D('deliveredSealsTable').innerHTML = "<tr><td colspan='9'>Error loading delivered seals.</td></tr>";
  }
}

/* -------- RENDER: Table -------- */
function renderDeliveredSeals(seals){
  const tbody = D('deliveredSealsTable');
  if (!tbody) return;
  if (!Array.isArray(seals) || seals.length === 0) {
    tbody.innerHTML = "<tr><td colspan='9'>No records found.</td></tr>";
    return;
  }
  tbody.innerHTML = seals.map(s => `
    <tr data-id="${s.id}">
      <td>${s.id}</td>
      <td>${s.visit}</td>
      <td>${s.seal_number}</td>
      <td>${s.total_count}</td>
      <td>${s.vessel_supervisor}</td>
      <td>${s.user_planner || ''}</td>
      <td>${s.created_at ? new Date(s.created_at).toLocaleString() : ''}</td>
      <td>${s.delivered_notes || ''}</td>
      <td>
        <button onclick="editDeliveredSeal(${s.id})">Edit</button>
        <button onclick="deleteDeliveredSeal(${s.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

/* -------- UPDATE: Edit delivered seal -------- */
async function editDeliveredSeal(id){
  try{
    const res = await fetch(`${API_BASE}/api/delivered-seals/${id}`);
    if(!res.ok) throw new Error('Seal not found');
    const s = await res.json();

    dSet('seal_from','');
    dSet('seal_to','');
    dSet('single_seal','');
    dSet('delivered_notes', s.delivered_notes || '');
    dSet('total_count', s.total_count || '');
    dSet('vessel_supervisor', s.vessel_supervisor || '');
    dSet('user_planner', s.user_planner || '');
    deliveredEditId = id;

    if (s.seal_number) {
      const rangeMatch = s.seal_number.match(/^(\d{6,9})-(\d{6,9})/);
      if (rangeMatch) {
        dSet('seal_from', rangeMatch[1]);
        dSet('seal_to', rangeMatch[2]);
      }
      const singles = s.seal_number.replace(/^(\d{6,9})-(\d{6,9})/, '').replace(/^,/, '');
      dSet('single_seal', singles);
    }
    D('updateBtn').textContent = 'Update';
  }catch(err){
    alert('Failed to load seal for edit.');
  }
}

async function dUpdateSeal(e){
  if(e) e.preventDefault();
  if (!deliveredEditId) { alert('No seal selected for update'); return; }

  const visit = await dGetActiveVisit();
  const from        = dGet('seal_from');
  const to          = dGet('seal_to');
  const singleSeals = dParseMultipleSeals(dGet('single_seal'));
  const vessel_supervisor = dGet('vessel_supervisor');
  const user_planner = dGet('user_planner') || null;
  const seal_number = (dIsNum(from) && dIsNum(to) && Number(to) >= Number(from)) ? `${from}-${to}` : '';
  const singles = singleSeals.length ? singleSeals.join(',') : '';
  const full_seal_number = seal_number + (seal_number && singles ? ',' : '') + singles;
  const total_count = dComputeTotal(from, to, singleSeals);

  const payload = {
    visit,
    seal_number: full_seal_number,
    total_count,
    vessel_supervisor,
    user_planner,
    created_at: new Date().toISOString(),
    delivered_notes: dGet('delivered_notes') || null
  };

  try{
    const res = await fetch(`${API_BASE}/api/delivered-seals/${deliveredEditId}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const j = await res.json().catch(()=> ({}));
      alert('Error updating: ' + (j.error || res.statusText || 'Unknown server error'));
      return;
    }

    deliveredEditId = null;
    D('updateBtn').textContent = 'Submit';
    ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals','user_planner']
      .forEach(id => dSet(id,''));
    dAutosizeById('delivered_notes'); 
    dAutosizeById('entered_seals');
    loadDeliveredSeals();

  }catch(err){
    console.error(err);
    alert('Failed to update delivered seal.');
  }
}

/* -------- DELETE: Remove delivered seal -------- */
async function deleteDeliveredSeal(id){
  if (!confirm('Delete this delivered seal entry?')) return;
  try{
    const res = await fetch(`${API_BASE}/api/delivered-seals/${id}`, {method:'DELETE'});
    if (!res.ok) {
      const j = await res.json().catch(()=> ({}));
      alert('Error deleting: ' + (j.error || res.statusText || 'Unknown server error'));
      return;
    }
    loadDeliveredSeals();
  }catch(err){
    console.error(err);
    alert('Failed to delete delivered seal.');
  }
}

/* -------- wire up -------- */
function dHook(){
  ['seal_from','seal_to','single_seal'].forEach(id => {
    D(id)?.addEventListener('input', dRefreshPreview);
  });

  D('delivered_notes')?.addEventListener('input', () => dAutosize(D('delivered_notes')));
  D('sealForm')?.addEventListener('submit', function(e){
    if(deliveredEditId){ dUpdateSeal(e); }
    else{ dSubmit(e); }
  });

  D('deliveredClear')?.addEventListener('click', () => {
    deliveredEditId = null;
    D('updateBtn').textContent = 'Submit';
    ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals','user_planner']
      .forEach(id => dSet(id,''));
    dAutosizeById('delivered_notes'); 
    dAutosizeById('entered_seals');
  });

  dRefreshPreview(); 
  dAutosizeById('delivered_notes'); 
  dAutosizeById('entered_seals');
  loadDeliveredSeals();

  const singleSealInput = D('single_seal');
  if (singleSealInput && !singleSealInput.nextElementSibling?.classList?.contains('help-text')) {
    const helpText = document.createElement('div');
    helpText.className = 'help-text';
    helpText.style.cssText = 'font-size: 12px; color: #666; margin-top: 4px;';
    helpText.textContent = 'Enter multiple seals separated by commas or spaces';
    singleSealInput.parentNode.appendChild(helpText);
  }
}
window.addEventListener('load', dHook);

// ---- END ----