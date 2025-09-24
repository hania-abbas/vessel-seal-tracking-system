// frontend/returnedSeals.js
(function () {
  const g = (id) => document.getElementById(id);
  const val = (id) => (g(id)?.value ?? '').trim();
  const set = (id, v) => { const el = g(id); if (el) el.value = v; };
  const autoSize = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  const autoSizeById = (id) => autoSize(g(id));
  const RE_SEAL = /^[0-9]{6,9}$/;

  function parseSinglesCSV(input) {
    if (!input) return [];
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => RE_SEAL.test(s));
  }

  function parseRange(from, to) {
    const a = (from || '').trim();
    const b = (to   || '').trim();
    if (RE_SEAL.test(a) && RE_SEAL.test(b) && Number(b) >= Number(a)) {
      return { from: a, to: b, count: Number(b) - Number(a) + 1 };
    }
    return null;
  }

  function buildSealNumber(rangeObj, singlesArr) {
    const tokens = [];
    if (rangeObj) tokens.push(`${rangeObj.from}-${rangeObj.to}`);
    if (singlesArr.length) tokens.push(...singlesArr);
    return tokens.join(',');
  }

  function calcTotal(rangeObj, singlesArr) {
    return (rangeObj ? rangeObj.count : 0) + (singlesArr?.length || 0);
  }

  async function getActiveVisit() {
    const u = new URL(window.location.href);
    const inUrl = (u.searchParams.get('visit') || '').trim();
    if (inUrl) return inUrl;

    const ls = localStorage.getItem('currentVisit');
    if (ls) return ls;

    try {
      const res = await App.apiFetch('/api/visits/active');
      const j = await res.json();
      return j?.visit || null;
    } catch { return null; }
  }

  function refreshPreview() {
    const range   = parseRange(val('return_seal_from'), val('return_seal_to'));
    const singles = parseSinglesCSV(val('return_single_seal'));
    const damaged = parseSinglesCSV(val('damaged_seal'));
    const lost    = parseSinglesCSV(val('lost_seal'));

    const total = calcTotal(range, singles);

    const lines = [];
    if (range)              lines.push(`Returned: ${range.from}-${range.to}`);
    if (singles.length)     lines.push(`Returned: ${singles.join(', ')}`);
    if (damaged.length)     lines.push(`Damaged: ${damaged.join(', ')}`);
    if (lost.length)        lines.push(`Lost:    ${lost.join(', ')}`);

    set('return_total_count', total ? String(total) : '');
    set('damaged_count', String(damaged.length));
    set('lost_count', String(lost.length));
    set('return_entered_seals', lines.length ? lines.join('\n') : 'No seals entered');
    autoSizeById('return_entered_seals');
  }

  async function onSubmit(e) {
    if (e) e.preventDefault();

    try { App.requireAuth(); } catch { return; }

    const visit = await getActiveVisit();
    if (!visit) {
      alert('No active visit found. Pick one (or add ?visit= in the URL).');
      return;
    }

    const range   = parseRange(val('return_seal_from'), val('return_seal_to'));
    const singles = parseSinglesCSV(val('return_single_seal'));
    if (!range && singles.length === 0) {
      alert('Enter a valid returned range and/or one or more single seals (6–9 digits, commas only).');
      return;
    }

    const vessel_supervisor = val('return_vessel_supervisor');
    if (!vessel_supervisor) {
      alert('Please select a vessel supervisor');
      return;
    }

    const payload = {
      visit,
      seal_number: buildSealNumber(range, singles),
      damaged_seal_number: parseSinglesCSV(val('damaged_seal')).join(',') || null,
      lost_seal_number:    parseSinglesCSV(val('lost_seal')).join(',') || null,
      vessel_supervisor,
      return_notes: val('return_notes') || null,
      user_planner: (g('user_planner')?.value || '').trim() || null
    };

    try {
      const res = await App.apiFetch('/api/returned-seals', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const raw = await res.text();
      let data; try { data = JSON.parse(raw); } catch { data = { message: raw }; }

      if (!res.ok) {
        // 409: our backend returns either {error:'invalid_return', not_delivered, already_returned}
        // or {error:'duplicate', overlaps, singles}
        if (res.status === 409) {
          if (data?.error === 'invalid_return') {
            const notDel   = (data.not_delivered || []).join(', ');
            const already  = (data.already_returned || []).join(', ');
            const lines = [];
            if (notDel)  lines.push(`Not delivered: ${notDel}`);
            if (already) lines.push(`Already returned: ${already}`);
            alert(`Cannot return those seals:\n${lines.join('\n') || raw}`);
            return; // IMPORTANT: stop here
          }
          if (data?.error === 'duplicate') {
            const overlaps = Array.isArray(data.overlaps) ? data.overlaps.join(', ') : '';
            const singlesD = Array.isArray(data.singles)  ? data.singles.join(', ')  : '';
            const lines = [];
            if (overlaps) lines.push(`Overlaps: ${overlaps}`);
            if (singlesD) lines.push(`Duplicates: ${singlesD}`);
            alert(`Duplicate returned seal(s):\n${lines.join('\n') || raw}`);
            return; // IMPORTANT: stop here
          }
        }

        if (res.status === 400 && Array.isArray(data?.details)) {
          alert(`Validation error:\n• ${data.details.join('\n• ')}`);
          return; // IMPORTANT: stop here
        }

        alert(`Failed to submit returned seals.\n${res.status} ${res.statusText}\n${data?.message || ''}`);
        return; // IMPORTANT: stop here
      }

      // ---- success only below ----
      [
        'return_seal_from','return_seal_to','return_single_seal',
        'damaged_seal','lost_seal','return_total_count',
        'damaged_count','lost_count','return_entered_seals','return_notes'
      ].forEach(id => set(id, ''));

      refreshPreview();
      window.loadSealLog?.();
      alert('Returned seal(s) saved!');
    } catch (err) {
      console.error(err);
      alert('Network / server error while submitting returned seals.');
    }
  }

  function onClear() {
    [
      'return_seal_from','return_seal_to','return_single_seal',
      'damaged_seal','lost_seal','return_total_count',
      'damaged_count','lost_count','return_entered_seals','return_notes'
    ].forEach(id => set(id, ''));
    refreshPreview();
  }

  function wire() {
    ['return_seal_from','return_seal_to','return_single_seal','damaged_seal','lost_seal','return_notes']
      .forEach(id => {
        const el = g(id);
        if (el) {
          el.addEventListener('input', refreshPreview);
          el.addEventListener('change', refreshPreview);
        }
      });

    g('returnedSealForm')?.addEventListener('submit', onSubmit);
    g('returnedClear')?.addEventListener('click', onClear);

    refreshPreview();
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
