

// frontend/deliveredSeals.js
// Range (From/To) + multiple single seals (comma-separated) with preview, totals, submit, edit, delete.

(function () {
  // ---------- API helper (uses global if present) ----------
  const API_BASE  = window.API_BASE  || localStorage.getItem('API_BASE') || 'http://localhost:3000';
  const TOKEN_KEY = window.TOKEN_KEY || 'authToken';

  async function apiFetch(path, options = {}) {
    if (typeof window.apiFetch === 'function') {
      // use page-provided helper (handles 401 redirect)
      return window.apiFetch(path, options);
    }
    // minimal fallback
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

  // ---------- small DOM helpers ----------
  const $   = (id) => document.getElementById(id);
  const get = (id) => ($(id)?.value ?? '').trim();
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  const mark = (id, on) => { const el = $(id); if (el) el.classList.toggle('invalid', !!on); };
  const autoSize = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  const autoSizeById = (id) => autoSize($(id));

  // ---------- validation & parsing ----------
  const RE_SEAL = /^[0-9]{6,9}$/;

  function isNum(s){ return typeof s === 'string' && RE_SEAL.test(s.trim()); }

  // COMMA-ONLY singles
  function parseSinglesCSV(str) {
    if (!str) return [];
    return str
      .split(',')                 // commas only
      .map(s => s.trim())
      .filter(Boolean)
      .filter(isNum);             // keep strings
  }

  function parseRange(from, to) {
    const a = (from || '').trim();
    const b = (to   || '').trim();
    if (isNum(a) && isNum(b) && Number(b) >= Number(a)) {
      return { from: a, to: b, count: Number(b) - Number(a) + 1 };
    }
    return null;
  }

  function computeTotal(rangeObj, singles) {
    return (rangeObj ? rangeObj.count : 0) + (singles?.length || 0);
  }

  function buildSealNumber(rangeObj, singles) {
    const tokens = [];
    if (rangeObj) tokens.push(`${rangeObj.from}-${rangeObj.to}`);
    if (singles.length) tokens.push(...singles);
    return tokens.join(',');
  }

  // ---------- visit resolver ----------
  async function getActiveVisit(){
    // 1) URL
    const u = new URL(window.location.href);
    const v = (u.searchParams.get('visit') || '').trim();
    if (v) return v;

    // 2) localStorage
    const ls = localStorage.getItem('currentVisit');
    if (ls) return ls;

    // 3) backend
    try {
      const j = await apiFetch('/api/visits/active');
      return j?.visit || null;
    } catch { return null; }
  }

  // ---------- preview ----------
  function refreshPreview(){
    const range   = parseRange(get('seal_from'), get('seal_to'));
    const singles = parseSinglesCSV(get('single_seal'));

    const total = computeTotal(range, singles);

    const lines = [];
    if (range)            lines.push(`Delivered ${range.from}–${range.to}`);  // en-dash for display
    if (singles.length)   lines.push(singles.length === 1
                                ? `Delivered ${singles[0]}`
                                : `Delivered singles: ${singles.join(', ')}`);

    set('total_count', total ? String(total) : '');
    set('entered_seals', lines.length ? lines.join('\n') : 'No seals entered');
    autoSizeById('entered_seals');
  }

  // ---------- CRUD ----------
  let editId = null;

  async function submitDelivered(e){
    if (e) e.preventDefault();

    const visit = await getActiveVisit();
    if (!visit) { alert('No active visit found. Pick a visit first.'); return; }

    const range   = parseRange(get('seal_from'), get('seal_to'));
    const singles = parseSinglesCSV(get('single_seal'));
    const hasRange   = !!range;
    const hasSingles = singles.length > 0;

    ['seal_from','seal_to','single_seal'].forEach(id => mark(id, false));
    if (!hasRange && !hasSingles) {
      ['seal_from','seal_to','single_seal'].forEach(id => mark(id, true));
      alert('Enter a valid delivered range and/or one or more single seals (6–9 digits, commas only).');
      return;
    }

    const vessel_supervisor = get('vessel_supervisor');
    if (!vessel_supervisor) { alert('Please select a vessel supervisor'); return; }

    const user_planner = get('user_planner') || null;

    const payload = {
      visit,
      seal_number: buildSealNumber(range, singles),
      total_count: computeTotal(range, singles),
      vessel_supervisor,
      user_planner,
      created_at: new Date().toISOString(),
      delivered_notes: get('delivered_notes') || null
    };

    try {
      await apiFetch('/api/delivered-seals', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // clear
      ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals']
        .forEach(id => set(id,''));
      autoSizeById('delivered_notes');
      autoSizeById('entered_seals');
      await loadDeliveredSeals();
      window.loadSealLog?.();
      alert('Delivered seal(s) saved!');
    } catch (err) {
      console.error(err);
      alert('Failed to submit delivered seals.');
    }
  }

  async function loadDeliveredSeals(){
    try{
      const visit = await dGetActiveVisit();
      const path = visit
      ? `/api/delivered-seals?visit${encodeURIComponent(visit)}`
      : '/api/delivered-seals';

      let seals;
      if (typeof window.apiFetch === 'function') {
        seals = await apiFetch(path, {method: 'GET' });
      } else {
        const res = await fetch(`${API_BASE}${path}`, { headers: {'Content-Type' : 'application/json'}, cache: 'no-store'});
        seals = await res.json();
      }
      renderDeliveredSeals(seals || []);
    }catch(err){
      console.error(err);
      D('deliveredSealsTable').innerHTML = "<tr><td colspan='9' > Error loading delivered seals.</td></tr>";
    }
  }

  function renderDeliveredSeals(seals){
    const tbody = $('deliveredSealsTable');
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
          <button type="button" data-act="edit" data-id="${s.id}">Edit</button>
          <button type="button" data-act="del"  data-id="${s.id}">Delete</button>
        </td>
      </tr>
    `).join('');
    // delegate click handlers
    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        if (btn.getAttribute('data-act') === 'edit') editDeliveredSeal(id);
        else if (btn.getAttribute('data-act') === 'del') deleteDeliveredSeal(id);
      });
    });
  }

  async function editDeliveredSeal(id){
    try{
      const s = await apiFetch(`/api/delivered-seals/${id}`, { method: 'GET' });
      if (!s) throw new Error('not_found');

      set('seal_from','');
      set('seal_to','');
      set('single_seal','');
      set('delivered_notes', s.delivered_notes || '');
      set('total_count', s.total_count || '');
      set('vessel_supervisor', s.vessel_supervisor || '');
      set('user_planner', s.user_planner || '');
      editId = id;

      if (s.seal_number) {
        const m = s.seal_number.match(/^(\d{6,9})-(\d{6,9})/);
        if (m) {
          set('seal_from', m[1]);
          set('seal_to', m[2]);
        }
        const singles = s.seal_number.replace(/^(\d{6,9})-(\d{6,9})/, '').replace(/^,/, '');
        set('single_seal', singles);
      }
      $('updateBtn').textContent = 'Update';
      refreshPreview();
    }catch(err){
      console.error(err);
      alert('Failed to load seal for edit.');
    }
  }

  async function updateDelivered(e){
    if (e) e.preventDefault();
    if (!editId) { alert('No seal selected for update'); return; }

    const visit = await getActiveVisit();
    if (!visit) { alert('No active visit found.'); return; }

    const range   = parseRange(get('seal_from'), get('seal_to'));
    const singles = parseSinglesCSV(get('single_seal'));
    const vessel_supervisor = get('vessel_supervisor');
    const user_planner      = get('user_planner') || null;

    if (!vessel_supervisor) { alert('Please select a vessel supervisor'); return; }

    const payload = {
      visit,
      seal_number: buildSealNumber(range, singles),
      total_count: computeTotal(range, singles),
      vessel_supervisor,
      user_planner,
      created_at: new Date().toISOString(),
      delivered_notes: get('delivered_notes') || null
    };

    try{
      await apiFetch(`/api/delivered-seals/${editId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      editId = null;
      $('updateBtn').textContent = 'Submit';
      ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals','user_planner']
        .forEach(id => set(id,''));
      autoSizeById('delivered_notes');
      autoSizeById('entered_seals');
      await loadDeliveredSeals();
      window.loadSealLog?.();
      alert('Delivered seal updated!');
    }catch(err){
      console.error(err);
      alert('Failed to update delivered seal.');
    }
  }

  async function deleteDeliveredSeal(id){
    if (!confirm('Delete this delivered seal entry?')) return;
    try{
      await apiFetch(`/api/delivered-seals/${id}`, { method: 'DELETE' });
      await loadDeliveredSeals();
      window.loadSealLog?.();
    }catch(err){
      console.error(err);
      alert('Failed to delete delivered seal.');
    }
  }

  // ---------- wire up ----------
  function wire(){
    ['seal_from','seal_to','single_seal'].forEach(id => {
      $(id)?.addEventListener('input', refreshPreview);
      $(id)?.addEventListener('change', refreshPreview);
    });

    $('delivered_notes')?.addEventListener('input', () => autoSize($('delivered_notes')));

    $('sealForm')?.addEventListener('submit', (e) => {
      if (editId) updateDelivered(e);
      else        submitDelivered(e);
    });

    $('deliveredClear')?.addEventListener('click', () => {
      editId = null;
      $('updateBtn').textContent = 'Submit';
      ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals','user_planner']
        .forEach(id => set(id,''));
      refreshPreview();
    });

    // helper note (commas only)
    const singleSealInput = $('single_seal');
    if (singleSealInput && !singleSealInput.nextElementSibling?.classList?.contains('help-text')) {
      const helpText = document.createElement('div');
      helpText.className = 'help-text';
      helpText.style.cssText = 'font-size: 12px; color: #666; margin-top: 4px;';
      helpText.textContent = 'Enter multiple seals separated by commas (e.g., 700100,700101)';
      singleSealInput.parentNode.appendChild(helpText);
    }

    // first paint
    refreshPreview();
    autoSizeById('delivered_notes');
    autoSizeById('entered_seals');
    loadDeliveredSeals();
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
