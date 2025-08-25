// frontend/returnedSeals.js
// Backend enforces format & lifecycle. Frontend shows friendly UI and previews.

const R$ = (id) => document.getElementById(id);
const rGet = (id) => (R$(id)?.value ?? '').trim();
const rSet = (id, v) => { const el = R$(id); if (el) el.value = v; };
const rMark = (id, on) => { const el = R$(id); if (el) el.classList.toggle('invalid', !!on); };

function rIsNum(s){ return typeof s==='string' && /^[0-9]{6,9}$/.test(s.trim()); }
function rNumOrNull(s){ return rIsNum(s) ? Number(s) : null; }

function rAutosize(el){ if(!el) return; el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function rAutosizeById(id){ rAutosize(R$(id)); }

// --- VISIT: read ?visit= first, then fall back to /api/visits/active
function getVisitFromQuery() {
  const u = new URL(window.location.href);
  const v = (u.searchParams.get('visit') || '').trim();
  return v || null;
}
async function rGetActiveVisit(){
  const v = getVisitFromQuery();
  if (v) return v;
  try{
    const r=await fetch('/api/visits/active',{cache:'no-store'});
    const j=await r.json();
    return j.visit || null;
  }catch{ return null; }
}

/* Preview / counts */
function rNormalizePreview(from,to,single, dmg, lost){
  const out=[];
  if(rIsNum(single)) out.push(`Returned ${Number(single)}`);
  if(rIsNum(from)&&rIsNum(to)&&Number(to)>=Number(from)) out.push(`Returned ${Number(from)}–${Number(to)}`);
  if (rIsNum(dmg))  out.push(`Damaged ${Number(dmg)}`);
  if (rIsNum(lost)) out.push(`Lost ${Number(lost)}`);
  return out.join('\n');
}
function rRangeCount(from,to){ if(!(rIsNum(from)&&rIsNum(to))) return 0; const a=Number(from), b=Number(to); return b>=a ? (b-a+1):0; }
function rFirstNumFromList(listStr){ const tok=String(listStr||'').split(/[\s,]+/).find(x=>x && rIsNum(x)); return tok?Number(tok):null; }

function rRefreshPreview(){
  const from=rGet('return_seal_from'), to=rGet('return_seal_to'), single=rGet('return_single_seal');
  const dmgFirst  = rFirstNumFromList(rGet('damaged_seal'));
  const lostFirst = rFirstNumFromList(rGet('lost_seal'));

  const total=(rIsNum(single)?1:0)+rRangeCount(from,to);
  rSet('return_total_count', total || '');
  rSet('return_entered_seals', rNormalizePreview(from,to,single, dmgFirst, lostFirst));
  rAutosizeById('return_entered_seals');

  // UI-only mini counts for damaged/lost (if multiple typed)
  const dmgList=rGet('damaged_seal'), lostList=rGet('lost_seal');
  const dmgCount=(dmgList?dmgList.split(/[\s,]+/).filter(x=>x && rIsNum(x)).length:0);
  const lostCount=(lostList?lostList.split(/[\s,]+/).filter(x=>x && rIsNum(x)).length:0);
  rSet('damaged_count', dmgCount || '');
  rSet('lost_count',    lostCount || '');
}

/* friendly 409 handling */
function showReturnedDupAlert(dups){
  const list=(dups||[]).slice(0,30).join(', ');
  alert(`Returned/Damaged/Lost duplicates in this visit:\n${list}${dups && dups.length>30 ? ' …' : ''}`);
}
function markReturnedInputsInvalid(on){
  ['return_seal_from','return_seal_to','return_single_seal'].forEach(id => rMark(id, on));
}

/* submit */
async function rSubmit(e){
  if(e) e.preventDefault();

  const visit = await rGetActiveVisit();
  if(!visit){ alert('No active visit found. Add ?visit= in the URL or enable /api/visits/active.'); return; }

  const from=rGet('return_seal_from'), to=rGet('return_seal_to'), single=rGet('return_single_seal');

  const hasRange=rIsNum(from) && rIsNum(to) && Number(to)>=Number(from);
  const hasSingle=rIsNum(single);
  markReturnedInputsInvalid(false);
  if(!hasRange && !hasSingle){
    markReturnedInputsInvalid(true);
    alert('Enter a valid returned range (6–9 digits) or a single seal (6–9 digits).');
    return;
  }

  const dmgFirst  = rFirstNumFromList(rGet('damaged_seal'));
  const lostFirst = rFirstNumFromList(rGet('lost_seal'));

  const payload = {
    visit,
    return_seal_from: rNumOrNull(from),
    return_seal_to: rNumOrNull(to),
    return_single_seal: rNumOrNull(single),
    damaged: dmgFirst !== null ? 1 : 0,
    lost:    lostFirst !== null ? 1 : 0,
    damaged_seal: dmgFirst,
    lost_seal:    lostFirst,
    return_notes: rGet('return_notes') || null,
    vessel_supervisor: rGet('return_vessel_supervisor') || null
  };

  try{
    const res = await fetch('/api/returned-seals', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if(res.status === 409){
      const j = await res.json().catch(()=> ({}));
      markReturnedInputsInvalid(true);
      if (j.error === 'not_delivered_for_visit') {
        alert(`These seals were not delivered in this visit:\n${(j.seals||[]).join(', ')}`);
      } else {
        showReturnedDupAlert(j.duplicates || []);
      }
      return;
    }
    if(!res.ok){
      const msg = await res.text();
      alert(msg || 'Failed to submit returned seals.');
      return;
    }

    ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal',
     'return_notes','return_total_count','damaged_count','lost_count','return_entered_seals']
     .forEach(id => rSet(id,''));
    rAutosizeById('return_notes'); rAutosizeById('return_entered_seals');

    if (typeof window.loadSealLog === 'function') window.loadSealLog();
  }catch(err){
    console.error(err);
    alert('Failed to submit returned seals.');
  }
}

/* wire up */
function rHook(){
  ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal']
    .forEach(id => R$(id)?.addEventListener('input', rRefreshPreview));
  R$('return_notes')?.addEventListener('input', ()=> rAutosize(R$('return_notes')));
  R$('returnedSealForm')?.addEventListener('submit', rSubmit);
  R$('returnedClear')?.addEventListener('click', ()=>{
    ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal',
     'return_notes','return_total_count','damaged_count','lost_count','return_entered_seals']
     .forEach(id => rSet(id,''));
    rAutosizeById('return_notes'); rAutosizeById('return_entered_seals');
  });

  rRefreshPreview(); rAutosizeById('return_notes'); rAutosizeById('return_entered_seals');
}
window.addEventListener('load', rHook);
