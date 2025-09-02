// frontend/deliveredSeals.js
// frontend/deliveredSeals.js - Enhanced for multiple single seals

const D = (id) => document.getElementById(id);
const dGet = (id) => (D(id)?.value ?? '').trim();
const dSet = (id, v) => { const el = D(id); if (el) el.value = v; };
const dMark = (id, on) => { const el = D(id); if (el) el.classList.toggle('invalid', !!on); };

function dIsNum(s){ return typeof s==='string' && /^[0-9]{6,9}$/.test(s.trim()); }
function dNumOrNull(s){ return dIsNum(s) ? Number(s) : null; }

function dAutosize(el){ if(!el) return; el.style.height='auto'; el.style.height = el.scrollHeight + 'px'; }
function dAutosizeById(id){ dAutosize(D(id)); }

// Parse multiple single seals (comma or space separated)
function dParseMultipleSeals(sealString) {
  if (!sealString) return [];
  
  return sealString
    .split(/[,\s]+/) // Split by commas or spaces
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => dIsNum(s))
    .map(Number);
}

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
    const r = await fetch('http://localhost:3809/api/visits/active',{cache:'no-store'});
    const j = await r.json();
    return j.visit || null;
  }catch{ return null; }
}

/* preview / totals - ENHANCED FOR MULTIPLE SINGLE SEALS */
function dNormalizePreview(from, to, singleSeals) {
  const out = [];
  
  // Regular returns (range)
  if (dIsNum(from) && dIsNum(to) && Number(to) >= Number(from)) {
    out.push(`Delivered ${Number(from)}–${Number(to)}`);
  }
  
  // Multiple single seals
  if (singleSeals.length > 0) {
    if (singleSeals.length === 1) {
      out.push(`Delivered ${singleSeals[0]}`);
    } else {
      out.push(`Delivered singles: ${singleSeals.join(', ')}`);
    }
  }
  
  return out.join('\n');
}

function dComputeTotal(from, to, singleSeals) {
  let total = 0;
  
  // Range count
  if (dIsNum(from) && dIsNum(to) && Number(to) >= Number(from)) {
    total += (Number(to) - Number(from) + 1);
  }
  
  // Single seals count
  total += singleSeals.length;
  
  return total;
}

function dRefreshPreview(){
  const from = dGet('seal_from');
  const to = dGet('seal_to');
  const singleInput = dGet('single_seal');
  const singleSeals = dParseMultipleSeals(singleInput);
  
  const total = dComputeTotal(from, to, singleSeals);
  dSet('total_count', total || '');
  
  const preview = dNormalizePreview(from, to, singleSeals);
  dSet('entered_seals', preview || 'No seals entered');
  
  dAutosizeById('entered_seals');
}

/* friendly 409 handling */
function showDupAlert(dups){
  const list = (dups || []).slice(0, 30).join(', ');
  alert(`Duplicate seals detected:\n${list}${dups && dups.length > 30 ? ' …' : ''}`);
}

function markDeliveredInputsInvalid(on){
  ['seal_from','seal_to','single_seal'].forEach(id => dMark(id, on));
}

/* submit - ENHANCED FOR MULTIPLE SINGLE SEALS */
async function dSubmit(e){
  if(e) e.preventDefault();

  const visit = await dGetActiveVisit();
  if(!visit){ 
    alert('No active visit found. Add ?visit= in the URL or enable /api/visits/active.'); 
    return; 
  }

  const from = dGet('seal_from');
  const to = dGet('seal_to');
  const singleInput = dGet('single_seal');
  const singleSeals = dParseMultipleSeals(singleInput);

  const hasRange = dIsNum(from) && dIsNum(to) && Number(to) >= Number(from);
  const hasSingle = singleSeals.length > 0;
  
  markDeliveredInputsInvalid(false);
  
  if(!hasRange && !hasSingle){
    markDeliveredInputsInvalid(true);
    alert('Enter a valid delivered range (6–9 digits) or one/more single seals (6–9 digits) separated by commas or spaces.');
    return;
  }

  const vessel_supervisor = dGet('vessel_supervisor');
  if (!vessel_supervisor) {
    alert('Please select a vessel supervisor');
    return;
  }

  const total_count = dComputeTotal(from, to, singleSeals);
  if (total_count <= 0) {
    alert('Invalid seal count');
    return;
  }

  // Build payload with multiple single seals
  const payload = {
    visit,
    delivered_from: dNumOrNull(from),
    delivered_to: dNumOrNull(to),
    delivered_singles: hasSingle ? singleSeals : [], // Array of single seals
    delivered_notes: dGet('delivered_notes') || null,
    vessel_supervisor
  };

  // Add to submission history
  const submission = window.submissionHistory?.addSubmission(payload);

  try{
    const res = await fetch('http://localhost:3809/api/delivered-seals', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(e => ({ error: 'Failed to parse error response' }));
      console.error('Server error details:', {
        status: res.status,
        statusText: res.statusText,
        errorData
      });
      
      // Update submission history
      if (submission) {
        window.submissionHistory?.updateSubmissionStatus(submission, 'error', errorData);
      }
      
      alert('Error: ' + (errorData.error || 'Unknown server error'));
      return;
    }

    if(res.status === 409){
      const j = await res.json().catch(()=> ({}));
      markDeliveredInputsInvalid(true);
      
      // Update submission history
      if (submission) {
        window.submissionHistory?.updateSubmissionStatus(submission, 'error', j);
      }
      
      showDupAlert(j.duplicates || []);
      return;
    }
    
    if(!res.ok){
      const msg = await res.text();
      
      // Update submission history
      if (submission) {
        window.submissionHistory?.updateSubmissionStatus(submission, 'error', msg);
      }
      
      alert(msg || 'Failed to submit delivered seals.');
      return;
    }

    // success -> clear + log
    dSet('seal_from',''); 
    dSet('seal_to',''); 
    dSet('single_seal','');
    dSet('delivered_notes',''); 
    dSet('total_count',''); 
    dSet('entered_seals','');
    dAutosizeById('delivered_notes'); 
    dAutosizeById('entered_seals');

    // Update submission history
    if (submission) {
      window.submissionHistory?.updateSubmissionStatus(submission, 'success', 'Seals delivered successfully');
    }

    const msg = D('clear-message'); 
    if(msg){ 
      msg.style.display='block'; 
      setTimeout(()=> msg.style.display='none', 1200); 
    }
    
    if (typeof window.loadSealLog === 'function') window.loadSealLog();
    
  }catch(err){
    console.error(err);
    
    // Update submission history
    if (submission) {
      window.submissionHistory?.updateSubmissionStatus(submission, 'error', err.message);
    }
    
    alert('Failed to submit delivered seals.');
  }
}

/* wire up */
function dHook(){
  ['seal_from','seal_to','single_seal'].forEach(id => {
    D(id)?.addEventListener('input', dRefreshPreview);
  });
  
  D('delivered_notes')?.addEventListener('input', ()=> dAutosize(D('delivered_notes')));
  D('sealForm')?.addEventListener('submit', dSubmit);
  
  D('deliveredClear')?.addEventListener('click', ()=>{
    dSet('seal_from',''); 
    dSet('seal_to',''); 
    dSet('single_seal','');
    dSet('delivered_notes',''); 
    dSet('total_count',''); 
    dSet('entered_seals','');
    dAutosizeById('delivered_notes'); 
    dAutosizeById('entered_seals');
  });
  
  dRefreshPreview(); 
  dAutosizeById('delivered_notes'); 
  dAutosizeById('entered_seals');
  
  // Add help text for multiple seals
  const singleSealInput = D('single_seal');
  if (singleSealInput && !singleSealInput.nextElementSibling?.classList.contains('help-text')) {
    const helpText = document.createElement('div');
    helpText.className = 'help-text';
    helpText.style.cssText = 'font-size: 12px; color: #666; margin-top: 4px;';
    helpText.textContent = 'Enter multiple seals separated by commas or spaces';
    singleSealInput.parentNode.appendChild(helpText);
  }
}

window.addEventListener('load', dHook);