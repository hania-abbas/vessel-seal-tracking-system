// frontend/returnedSeals.js
// Range (From/To) + multiple single seals (comma-separated) with preview, totals, and submit (Option A stays backend-side).

(function () {
  // ---------- API helper (uses global if present) ----------
  const API_BASE  = window.API_BASE  || localStorage.getItem('API_BASE') || 'http://localhost:3000';
  const TOKEN_KEY = window.TOKEN_KEY || 'authToken';

  async function apiFetch(path, options = {}) {
    if (typeof window.apiFetch === 'function') {
      return window.apiFetch(path, options);
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      alert('Not authenticated. Please log in.');
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('no_token');
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`,
    };
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('unauthorized');
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ---------- tiny DOM helpers ----------
  const g = (id) => document.getElementById(id);
  const val = (id) => (g(id)?.value ?? '').trim();
  const set = (id, v) => { const el = g(id); if (el) el.value = v; };
  const autoSize = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  const autoSizeById = (id) => autoSize(g(id));

  // ---------- validation ----------
  const RE_SEAL = /^[0-9]{6,9}$/;

  function parseSinglesCSV(input) {
    if (!input) return [];
    return input
      .split(',')                     // commas only
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

  // ---------- visit resolver ----------
  async function getActiveVisit() {
    // URL
    const u = new URL(window.location.href);
    const inUrl = (u.searchParams.get('visit') || '').trim();
    if (inUrl) return inUrl;

    // localStorage
    const ls = localStorage.getItem('currentVisit');
    if (ls) return ls;

    // backend
    try {
      const j = await apiFetch('/api/visits/active');
      return j?.visit || null;
    } catch { return null; }
  }

  // ---------- preview + totals ----------
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

  // ---------- submit ----------
  async function onSubmit(e) {
    if (e) e.preventDefault();

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
      seal_number: buildSealNumber(range, singles),           // e.g. "800001-800003,800200,800201"
      damaged_seal_number: parseSinglesCSV(val('damaged_seal')).join(',') || null,
      lost_seal_number:    parseSinglesCSV(val('lost_seal')).join(',') || null,
      vessel_supervisor,
      return_notes: val('return_notes') || null,
      user_planner: (g('user_planner')?.value || '').trim() || null
    };

    try {
      await apiFetch('/api/returned-seals', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // clear
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
      alert('Failed to submit returned seals.');
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

  // ---------- wire up ----------
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
