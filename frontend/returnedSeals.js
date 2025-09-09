// frontend/returnedSeals.js


function rGet(id) { return (document.getElementById(id)?.value ?? '').trim(); }
function rSet(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function rAutosize(el){ if(!el) return; el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function rAutosizeById(id){ rAutosize(document.getElementById(id)); }

const RE_SEAL = /^[0-9]{6,9}$/;
const RE_SEAL_RANGE = /^[0-9]{6,9}-[0-9]{6,9}$/;

function countReturnedTotal(str) {
  let total = 0;
  if (!str) return total;
  for (const token of String(str).split(',').map(s => s.trim()).filter(Boolean)) {
    if (RE_SEAL_RANGE.test(token)) {
      const [a, b] = token.split('-').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b) && a <= b)
        total += (b - a + 1);
    } else if (RE_SEAL.test(token)) {
      total += 1;
    }
  }
  return total;
}

function countSingles(str) {
  if (!str) return 0;
  return str.split(',').map(s => s.trim()).filter(s => RE_SEAL.test(s)).length;
}

function rRefreshPreview() {
  // Get all relevant fields
  const from = rGet('return_seal_from');
  const to   = rGet('return_seal_to');
  const single = rGet('return_single_seal');
  const damagedInput = rGet('damaged_seal');
  const lostInput = rGet('lost_seal');

  // Build the returned seals string for backend and preview
  let returnedSealsArr = [];
  if (RE_SEAL.test(from) && RE_SEAL.test(to) && Number(to) >= Number(from)) {
    returnedSealsArr.push(`${from}-${to}`);
  }
  if (RE_SEAL.test(single)) {
    returnedSealsArr.push(single);
  }
  const returnedSealsStr = returnedSealsArr.join(',');

  // Damaged/Lost - comma separated singles only
  const damagedList = damagedInput.split(',').map(s => s.trim()).filter(s => RE_SEAL.test(s));
  const lostList    = lostInput.split(',').map(s => s.trim()).filter(s => RE_SEAL.test(s));
  const damagedDisplay = damagedList.join(', ');
  const lostDisplay    = lostList.join(', ');

  // Totals
  rSet('return_total_count', String(countReturnedTotal(returnedSealsStr)));
  rSet('damaged_count', String(damagedList.length));
  rSet('lost_count', String(lostList.length));

  // Preview block
  const lines = [];
  if (returnedSealsStr) lines.push('Returned: ' + returnedSealsStr);
  if (damagedDisplay)   lines.push('Damaged: ' + damagedDisplay);
  if (lostDisplay)      lines.push('Lost:    ' + lostDisplay);

  rSet('return_entered_seals', lines.join('\n') || 'No seals entered');
  rAutosizeById('return_entered_seals');
}

// Wire up on load
window.addEventListener('load', () => {
  ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', rRefreshPreview);
  });
  rRefreshPreview();
});