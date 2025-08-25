// frontend/deliveredSeals.js
// Backend enforces duplicates & format. Frontend shows friendly UI and previews.

const D = (id) => document.getElementById(id);
const dGet = (id) => (D(id)?.value ?? '').trim();
const dSet = (id, v) => { const el = D(id); if (el) el.value = v; };
const dMark = (id, on) => { const el = D(id); if (el) el.classList.toggle('invalid', !!on); };

function dIsNum(s){ return typeof s==='string' && /^[0-9]{6,9}$/.test(s.trim()); }
function dNumOrNull(s){ return dIsNum(s) ? Number(s) : null; }

function dAutosize(el){ if(!el) return; el.style.height='auto'; el.style.height = el.scrollHeight + 'px'; }
function dAutosizeById(id){ dAutosize(D(id)); }

// --- VISIT: read ?visit= first, then fall back to /api/visits/active
function getVisitFromQuery() {
  const u = new URL(window.location.href);
  const v = (u.searchParams.get('visit') || '').trim();
  return v || null;
}
async function dGetActiveVisit(){
  const v = getVisitFromQuery();
  if (v) return v;
  try{
    const r = await fetch('/api/visits/active',{cache:'no-store'});
    const j = await r.json();
    return j.visit || null;
  }catch{ return null; }
}

/* preview / totals */
function dNormalizePreview(from, to, single){
  const out = [];
  if (dIsNum(single)) out.push(`Delivered ${Number(single)}`);
  if (dIsNum(from) && dIsNum(to) && Number(to)>=Number(from)) {
    out.push(`Delivered ${Number(from)}–${Number(to)}`);
  }
  return out.join('\n');
}
function dComputeTotal(from, to, single){
  let total = 0;
  if (dIsNum(single)) total += 1;
  if (dIsNum(from) && dIsNum(to) && Number(to)>=Number(from)) total += (Number(to)-Number(from)+1);
  return total;
}
function dRefreshPreview(){
  const from=dGet('seal_from'), to=dGet('seal_to'), single=dGet('single_seal');
  dSet('total_count', dComputeTotal(from,to,single) || '');
  dSet('entered_seals', dNormalizePreview(from,to,single));
  dAutosizeById('entered_seals');
}

/* friendly 409 handling */
function showDupAlert(dups){
  const list=(dups||[]).slice(0,30).join(', ');
  alert(`Duplicate seals detected:\n${list}${dups && dups.length>30 ? ' …' : ''}`);
}
function markDeliveredInputsInvalid(on){
  ['seal_from','seal_to','single_seal'].forEach(id => dMark(id, on));
}

/* submit */
async function dSubmit(e){
  if(e) e.preventDefault();

  const visit = await dGetActiveVisit();
  if(!visit){ alert('No active visit found. Add ?visit= in the URL or enable /api/visits/active.'); return; }

  const from=dGet('seal_from'), to=dGet('seal_to'), single=dGet('single_seal');

  const hasRange = dIsNum(from) && dIsNum(to) && Number(to)>=Number(from);
  const hasSingle = dIsNum(single);
  markDeliveredInputsInvalid(false);
  if(!hasRange && !hasSingle){
    markDeliveredInputsInvalid(true);
    alert('Enter a valid delivered range (6–9 digits) or a single seal (6–9 digits).');
    return;
  }

  const payload = {
    visit,
    delivered_from: dNumOrNull(from),
    delivered_to: dNumOrNull(to),
    delivered_single: dNumOrNull(single),
    delivered_notes: dGet('delivered_notes') || null,
    vessel_supervisor: dGet('vessel_supervisor') || null
  };

  try{
    const res = await fetch('/api/delivered-seals', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if(res.status === 409){
      const j = await res.json().catch(()=> ({}));
      markDeliveredInputsInvalid(true);
      showDupAlert(j.duplicates || []);
      return;
    }
    if(!res.ok){
      const msg = await res.text();
      alert(msg || 'Failed to submit delivered seals.');
      return;
    }

    // success -> clear + log
    dSet('seal_from',''); dSet('seal_to',''); dSet('single_seal','');
    dSet('delivered_notes',''); dSet('total_count',''); dSet('entered_seals','');
    dAutosizeById('delivered_notes'); dAutosizeById('entered_seals');

    const msg = D('clear-message'); if(msg){ msg.style.display='block'; setTimeout(()=> msg.style.display='none', 1200); }
    if (typeof window.loadSealLog === 'function') window.loadSealLog();
  }catch(err){
    console.error(err);
    alert('Failed to submit delivered seals.');
  }
}

/* wire up */
function dHook(){
  ['seal_from','seal_to','single_seal'].forEach(id => D(id)?.addEventListener('input', dRefreshPreview));
  D('delivered_notes')?.addEventListener('input', ()=> dAutosize(D('delivered_notes')));
  D('sealForm')?.addEventListener('submit', dSubmit);
  D('deliveredClear')?.addEventListener('click', ()=>{
    dSet('seal_from',''); dSet('seal_to',''); dSet('single_seal','');
    dSet('delivered_notes',''); dSet('total_count',''); dSet('entered_seals','');
    dAutosizeById('delivered_notes'); dAutosizeById('entered_seals');
  });
  dRefreshPreview(); dAutosizeById('delivered_notes'); dAutosizeById('entered_seals');
}
window.addEventListener('load', dHook);
