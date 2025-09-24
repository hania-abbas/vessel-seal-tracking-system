//visit-context.js
(function () {
  const H_VISIT = ['visit', 'return_visit'];

  function getVisitFromUrl() {
    const url = new URL(location.href);
    const v = (url.searchParams.get('visit') || '').trim();
    return v || null;
  }
  function getVisitFromLS() {
    return localStorage.getItem('currentVisit') || null;
  }
  function setVisit(v) {
    localStorage.setItem('currentVisit', v);
    H_VISIT.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    });
  }

  async function resolveVisit() {
    const u = getVisitFromUrl();
    if (u) { setVisit(u); return u; }

    const s = getVisitFromLS();
    if (s) { setVisit(s); return s; }

    try {
      const res = await App.apiFetch('/api/visits/active');
      const j = await res.json();
      if (j?.visit) { setVisit(j.visit); return j.visit; }
    } catch {}
    return null;
  }

  async function populateVisitPicker() {
    const sel = document.getElementById('visitSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading…</option>';

    let list = [];
    try {
      const r1 = await App.apiFetch('/api/visits?status=open');
      list = (await r1.json())?.visits || [];
    } catch {
      try {
        const r2 = await App.apiFetch('/api/visits');
        list = (await r2.json())?.visits || [];
      } catch {}
    }

    sel.innerHTML = (Array.isArray(list) ? list : [])
      .map(it => {
        const val = typeof it === 'string' ? it : (it.visit || it.id || it.code || '');
        const label = typeof it === 'string' ? it : (it.name || it.label || val);
        return val ? `<option value="${val}">${label}</option>` : '';
      })
      .join('') || '<option value="">No visits found</option>';
  }

  async function ensureVisitOrGate() {
    App.requireAuth();
    const v = await resolveVisit();
    const gate = document.getElementById('visitGate');
    const meta = document.getElementById('sealLogMeta');

    if (v) {
      if (gate) gate.style.display = 'none';
      if (meta) meta.textContent = `Visit: ${v}`;
      if (window.loadSealLog) window.loadSealLog();
      return;
    }

    if (gate) gate.style.display = '';
    await populateVisitPicker();

    const btn = document.getElementById('visitUseBtn');
    btn?.addEventListener('click', async () => {
      const chosen = document.getElementById('visitSelect')?.value || '';
      if (!chosen) return;

      setVisit(chosen);
      // optional: POST active visit (if your backend supports it)
      try {
        await App.apiFetch('/api/visits/active', {
          method: 'POST',
          body: JSON.stringify({ visit: chosen }),
        });
      } catch {}

      const url = new URL(location.href);
      url.searchParams.set('visit', chosen);
      location.href = url.toString();
    });
  }

  document.addEventListener('DOMContentLoaded', ensureVisitOrGate);
})();
