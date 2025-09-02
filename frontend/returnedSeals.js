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
  try {
    const r = await fetch('http://localhost:3000/api/visits/active', {cache:'no-store'});
    const j = await r.json();
    return j.visit || null;
  } catch { return null; }
}

/* Preview / counts */
function rNormalizePreview(sealNumbers, dmgList, lostList) {
  const out = [];
  
  // Regular returns
  if (sealNumbers.length > 0) {
    out.push(`Returned ${sealNumbers.join(', ')}`);
  }
  
  // Damaged seals
  if (R$('damaged')?.checked && dmgList && dmgList.length > 0) {
    out.push(`Damaged ${dmgList.join(', ')}`);
  }

  // Lost seals
  if (R$('lost')?.checked && lostList && lostList.length > 0) {
    out.push(`Lost ${lostList.join(', ')}`);
  }
  
  return out.join('\n');
}

function rRangeCount(from, to) {
  if (!(rIsNum(from) && rIsNum(to))) return 0;
  const a = Number(from), b = Number(to);
  return b >= a ? (b - a + 1) : 0;
}

function rGetNumList(listStr) {
  return String(listStr || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(s => rIsNum(s))
    .map(Number);
}

function rRefreshPreview(){
  const from = rGet('return_seal_from');
  const to = rGet('return_seal_to');
  const single = rGet('return_single_seal');
  const damagedSeals = rGetNumList(rGet('damaged_seal'));
  const lostSeals = rGetNumList(rGet('lost_seal'));

  // Build array of seal numbers to return
  const sealNumbers = [];
  if (rIsNum(from) && rIsNum(to) && Number(to) >= Number(from)) {
    for (let i = Number(from); i <= Number(to); i++) {
      sealNumbers.push(i.toString());
    }
  }
  if (rIsNum(single)) {
    sealNumbers.push(single);
  }

  // Calculate total of regular returns
  const total = sealNumbers.length;
  rSet('return_total_count', total || '');

  // Update preview text
  const previewText = rNormalizePreview(sealNumbers, damagedSeals.map(String), lostSeals.map(String));
  rSet('return_entered_seals', previewText || 'No seals entered');
  
  // Update damaged count if checkbox is checked
  if (R$('damaged')?.checked) {
    rSet('damaged_count', damagedSeals.length || '');
  } else {
    rSet('damaged_count', '');
  }

  // Update lost count if checkbox is checked
  if (R$('lost')?.checked) {
    rSet('lost_count', lostSeals.length || '');
  } else {
    rSet('lost_count', '');
  }
  rAutosizeById('return_entered_seals');
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

  const hasRange = rIsNum(from) && rIsNum(to) && Number(to)>=Number(from);
  const hasSingle = rIsNum(single);
  markReturnedInputsInvalid(false);
  
  if(!hasRange && !hasSingle) {
    markReturnedInputsInvalid(true);
    alert('Enter either a valid range (6–9 digits) and/or a single seal (6–9 digits).');
    return;
  }

  // Build array of seal numbers to return
  const sealNumbers = [];
  if (hasRange) {
    for (let i = Number(from); i <= Number(to); i++) {
      sealNumbers.push(i.toString());
    }
  }
  if (hasSingle) {
    sealNumbers.push(single);
  }

  const damagedSeals = rGetNumList(rGet('damaged_seal'));
  const lostSeals = rGetNumList(rGet('lost_seal'));

  // Validate inputs before creating payload
  if (R$('damaged')?.checked && damagedSeals.length === 0) {
    alert('Please enter at least one valid damaged seal number');
    return;
  }
  if (R$('lost')?.checked && lostSeals.length === 0) {
    alert('Please enter at least one valid lost seal number');
    return;
  }
  
  // Get and validate supervisor
  const vessel_supervisor = rGet('return_vessel_supervisor');
  if (!vessel_supervisor) {
    alert('Please select a vessel supervisor');
    R$('return_vessel_supervisor')?.classList.add('invalid');
    return;
  }
  R$('return_vessel_supervisor')?.classList.remove('invalid');

  // Build payload for backend
  const payload = {
    visit,
    seal_number: sealNumbers.join(','), // e.g. "1001,1002,1003"
    damaged_seal_number: damagedSeals.map(String).join(','), // e.g. "2001,2002"
    damaged_count: damagedSeals.length,
    lost_seal_number: lostSeals.map(String).join(','), // e.g. "3001,3002"
    lost_count: lostSeals.length,
    return_notes: rGet('return_notes'),
    vessel_supervisor: vessel_supervisor
  };

  try{
  const res = await fetch('http://localhost:3000/api/returned-seals', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(e => ({ error: 'Failed to parse error response' }));
      console.error('Server error details:', {
        status: res.status,
        statusText: res.statusText,
        payload,
        errorData
      });
      
      if (res.status === 400) {
        if (errorData.error === 'supervisor_required') {
          alert('Please select a vessel supervisor');
        } else if (errorData.error === 'invalid_seal_format') {
          alert('Please check all seal numbers are valid (6-9 digits)');
        } else {
          alert(errorData.message || 'Please check the form for errors');
        }
      } else if (res.status === 409) {
        if (errorData.error === 'not_delivered_for_visit') {
          alert(`These seals were not delivered in this visit:\n${(errorData.seals||[]).join(', ')}`);
        } else {
          showReturnedDupAlert(errorData.duplicates || []);
        }
      } else {
        alert('Error: ' + (errorData.message || errorData.error || 'Failed to submit returned seals'));
      }
      markReturnedInputsInvalid(true);
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
  // Add event listeners for text inputs
  ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal']
    .forEach(id => R$(id)?.addEventListener('input', rRefreshPreview));

  // Add event listeners for checkboxes
  ['damaged', 'lost'].forEach(id => {
    const checkbox = R$(id);
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        // Clear the corresponding input if unchecked
        if (!checkbox.checked) {
          const inputId = id === 'damaged' ? 'damaged_seal' : 'lost_seal';
          rSet(inputId, '');
        }
        rRefreshPreview();
      });
    }
  });

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