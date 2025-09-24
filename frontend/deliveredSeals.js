// frontend/deliveredSeals.js
console.log('deliveredSeals.js loaded');

(function () {
  const $   = (id) => document.getElementById(id);
  const get = (id) => ($(id)?.value ?? '').trim();
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  const mark = (id, on) => { const el = $(id); if (el) el.classList.toggle('invalid', !!on); };
  const autoSize = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  const autoSizeById = (id) => autoSize($(id));

  const RE_SEAL = /^[0-9]{6,9}$/;
  const isNum = (s) => typeof s === 'string' && RE_SEAL.test(s.trim());

  function parseSinglesCSV(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean).filter(isNum);
  }

  function parseRange(from, to) {
    const a = (from || '').trim();
    const b = (to   || '').trim();
    if (isNum(a) && isNum(b) && Number(b) >= Number(a)) {
      return { from: a, to: b, count: Number(b) - Number(a) + 1 };
    }
    return null;
  }

  const computeTotal = (rangeObj, singles) =>
    (rangeObj ? rangeObj.count : 0) + (singles?.length || 0);

  function buildSealNumber(rangeObj, singles) {
    const tokens = [];
    if (rangeObj) tokens.push(`${rangeObj.from}-${rangeObj.to}`);
    if (singles.length) tokens.push(...singles);
    return tokens.join(',');
  }

  async function getActiveVisit() {
    const u = new URL(window.location.href);
    const v = (u.searchParams.get('visit') || '').trim();
    if (v) return v;

    const ls = localStorage.getItem('currentVisit');
    if (ls) return ls;

    try {
      const res = await App.apiFetch('/api/visits/active');
      const j = await res.json();
      return j?.visit || null;
    } catch { return null; }
  }

  function refreshPreview() {
    const range   = parseRange(get('seal_from'), get('seal_to'));
    const singles = parseSinglesCSV(get('single_seal'));
    const total   = computeTotal(range, singles);

    const lines = [];
    if (range) lines.push(`Delivered ${range.from}–${range.to}`);
    if (singles.length) {
      lines.push(singles.length === 1
        ? `Delivered ${singles[0]}`
        : `Delivered singles: ${singles.join(', ')}`);
    }

    set('total_count', String(total || 0));
    set('entered_seals', lines.length ? lines.join('\n') : 'No seals entered');
    autoSizeById('entered_seals');
  }

  let editId = null;

  async function submitDelivered(e) {
    if (e) e.preventDefault();
    try { App.requireAuth(); } catch { return; }

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
      const res = await App.apiFetch('/api/delivered-seals', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const raw = await res.text();
      let data; try { data = JSON.parse(raw); } catch { data = { message: raw }; }

      if (!res.ok) {
        if (res.status === 409 && data?.error === 'duplicate') {
          const overlaps = Array.isArray(data.overlaps) ? data.overlaps.join(', ') : '';
          const singlesD = Array.isArray(data.singles)  ? data.singles.join(', ')  : '';
          const parts = [];
          if (overlaps) parts.push(`Overlapping range(s): ${overlaps}`);
          if (singlesD) parts.push(`Duplicate single(s): ${singlesD}`);
          alert(parts.length ? `Duplicate/overlap detected:\n${parts.join('\n')}` : 'Duplicate/overlap detected.');
          return;
        }
        if (res.status === 400 && Array.isArray(data?.details)) {
          alert(`Validation error:\n• ${data.details.join('\n• ')}`);
          return;
        }
        alert(`Failed to submit delivered seals.\n${res.status} ${res.statusText}\n${data?.message || ''}`);
        return;
      }

      // success: clear + reload
      ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals']
        .forEach(id => set(id,''));
      autoSizeById('delivered_notes');
      autoSizeById('entered_seals');

      await loadDeliveredSeals();
      window.loadSealLog?.();
      alert('Delivered seal(s) saved!');
    } catch (err) {
      console.error(err);
      alert('Failed to submit delivered seals. ' + (err?.message || ''));
    }
  }

  async function loadDeliveredSeals() {
    try {
      const visit = await getActiveVisit();
      const path = visit ? `/api/delivered-seals?visit=${encodeURIComponent(visit)}` : '/api/delivered-seals';
      const res = await App.apiFetch(path, { method: 'GET' });
      const seals = await res.json().catch(() => []);
      renderDeliveredSeals(seals || []);
    } catch (err) {
      console.error(err);
      const tbody = $('deliveredSealsTable');
      if (tbody) tbody.innerHTML = "<tr><td colspan='9'>Error loading delivered seals.</td></tr>";
    }
  }

  function renderDeliveredSeals(seals) {
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

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        if (btn.getAttribute('data-act') === 'edit') editDeliveredSeal(id);
        else if (btn.getAttribute('data-act') === 'del') deleteDeliveredSeal(id);
      });
    });
  }

  async function editDeliveredSeal(id) {
    try {
      const res = await App.apiFetch(`/api/delivered-seals/${id}`, { method: 'GET' });
      const s = await res.json();
      if (!s) throw new Error('not_found');

      set('seal_from',''); set('seal_to',''); set('single_seal','');
      set('delivered_notes', s.delivered_notes || '');
      set('total_count', s.total_count || '');
      set('vessel_supervisor', s.vessel_supervisor || '');
      set('user_planner', s.user_planner || '');
      editId = id;

      if (s.seal_number) {
        const m = s.seal_number.match(/^(\d{6,9})-(\d{6,9})/);
        if (m) { set('seal_from', m[1]); set('seal_to', m[2]); }
        const singles = s.seal_number.replace(/^(\d{6,9})-(\d{6,9})/, '').replace(/^,/, '');
        set('single_seal', singles);
      }
      $('updateBtn').textContent = 'Update';
      refreshPreview();
    } catch (err) {
      console.error(err);
      alert('Failed to load seal for edit.');
    }
  }

  async function updateDelivered(e) {
    if (e) e.preventDefault();
    if (!editId) { alert('No seal selected for update'); return; }
    try { App.requireAuth(); } catch { return; }

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

    try {
      const res  = await App.apiFetch(`/api/delivered-seals/${editId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { message: text }; }

      if (!res.ok) {
        if (res.status === 409 && data?.error === 'duplicate') {
          const overlaps = Array.isArray(data.overlaps) ? data.overlaps.join(', ') : '';
          const singlesD = Array.isArray(data.singles)  ? data.singles.join(', ')  : '';
          const lines = [];
          if (overlaps) lines.push(`Overlaps: ${overlaps}`);
          if (singlesD) lines.push(`Duplicates: ${singlesD}`);
          alert(`Duplicate/overlap in delivered seals:\n${lines.join('\n') || text}`);
          return;
        }
        if (res.status === 400 && Array.isArray(data?.details)) {
          alert(`Validation error:\n• ${data.details.join('\n• ')}`);
          return;
        }
        alert(`Failed to update delivered seals.\n${res.status} ${res.statusText}\n${data?.message || ''}`);
        return;
      }

      editId = null;
      $('updateBtn').textContent = 'Submit';
      ['seal_from','seal_to','single_seal','delivered_notes','total_count','entered_seals','user_planner']
        .forEach(id => set(id,''));
      autoSizeById('delivered_notes');
      autoSizeById('entered_seals');

      await loadDeliveredSeals();
      window.loadSealLog?.();
      alert('Delivered seal updated!');
    } catch (err) {
      console.error(err);
      alert('Network/server error while updating delivered seals.');
    }
  }

  async function deleteDeliveredSeal(id) {
    if (!confirm('Delete this delivered seal entry?')) return;
    try {
      const res = await App.apiFetch(`/api/delivered-seals/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed: ${res.status}`);
      }
      await loadDeliveredSeals();
      window.loadSealLog?.();
    } catch (err) {
      console.error(err);
      alert('Failed to delete delivered seal.');
    }
  }

  function wire() {
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

    const singleSealInput = $('single_seal');
    if (singleSealInput && !singleSealInput.nextElementSibling?.classList?.contains('help-text')) {
      const helpText = document.createElement('div');
      helpText.className = 'help-text';
      helpText.style.cssText = 'font-size: 12px; color: #666; margin-top: 4px;';
      helpText.textContent = 'Enter multiple seals separated by commas (e.g., 700100,700101)';
      singleSealInput.parentNode.appendChild(helpText);
    }

    refreshPreview();
    autoSizeById('delivered_notes');
    autoSizeById('entered_seals');
    loadDeliveredSeals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { try { wire(); } catch(e){ console.error(e);} });
  } else {
    try { wire(); } catch(e){ console.error(e); }
  }
})();
