// frontend/script.js
document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('table-body');
  const pagination = document.getElementById('pagination');

  const pageSize = 10;
  let currentPage = 1;
  let vesselData = [];

  // ---- auth helpers ----
  const TOKEN_KEY = 'authToken';
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function requireAuth() {
    const t = getToken();
    if (!t) {
      const next = encodeURIComponent('/index.html');
      location.href = `/login.html?next=${next}`;
      return false;
    }
    return true;
  }
  async function apiFetch(path, options = {}) {
    const token = getToken();
    return fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }

  // block page if no token
  if (!requireAuth()) return;

  // Fetch vessel data (same origin; no need to hardcode http://localhost:3000)
  apiFetch('/api/vessels')
    .then(async (res) => {
      if (!res.ok) {
        // If token expired or missing, backend will send 401 → go to login
        if (res.status === 401) {
          const next = encodeURIComponent('/index.html');
          location.href = `/login.html?next=${next}`;
          return Promise.reject(new Error('Unauthorized'));
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Request failed: ${res.status}`);
      }
      return res.json();
    })
    .then((data) => {
      // normalize shape (array or wrapped)
      vesselData = Array.isArray(data) ? data : (data?.items || data?.vessels || []);
      renderTable(currentPage);
    })
    .catch((error) => {
      console.error('Fetch error:', error);
      alert('Failed to load vessel data');
    });

  // Render paginated table
  function renderTable(page) {
    currentPage = page;
    tableBody.innerHTML = '';
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = vesselData.slice(start, end);

    pageData.forEach((v) => {
      // Be resilient to different field names/casing
      const ref    = v.VesselRefNo ?? v.vessel_ref_no ?? v.vesselRefNo ?? '';
      const visit  = v.Visit       ?? v.visit       ?? '';
      const name   = v.VesselName  ?? v.vessel_name ?? v.name ?? '';
      const status = v.Status      ?? v.status      ?? '';
      const etaVal = v.ETA ?? v.ETA_UTC ?? v.ATA ?? v.eta ?? v.ata;

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${ref}</td>
        <td>${visit}</td>
        <td>${name}</td>
        <td>${status}</td>
        <td>${formatDate(etaVal)}</td>
        <td><a href="seal.html?visit=${encodeURIComponent(visit)}" class="seal-btn">Seal</a></td>
      `;
      tableBody.appendChild(row);
    });

    renderPagination(page);
  }

  // Format datetime
  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleString();
  }

  // Render pagination
  function renderPagination(currentPage) {
    pagination.innerHTML = '';

    const totalPages = Math.ceil(vesselData.length / pageSize) || 1;
    const maxButtons = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    const endPage = Math.min(totalPages, startPage + maxButtons - 1);

    const first = document.createElement('button');
    first.textContent = '« First';
    first.disabled = currentPage === 1;
    first.onclick = () => renderTable(1);
    pagination.appendChild(first);

    const prev = document.createElement('button');
    prev.textContent = '‹ Prev';
    prev.disabled = currentPage === 1;
    prev.onclick = () => renderTable(currentPage - 1);
    pagination.appendChild(prev);

    for (let i = startPage; i <= endPage; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (i === currentPage) btn.classList.add('active');
      btn.onclick = () => renderTable(i);
      pagination.appendChild(btn);
    }

    const next = document.createElement('button');
    next.textContent = 'Next ›';
    next.disabled = currentPage === totalPages;
    next.onclick = () => renderTable(currentPage + 1);
    pagination.appendChild(next);

    const last = document.createElement('button');
    last.textContent = 'Last »';
    last.disabled = currentPage === totalPages;
    last.onclick = () => renderTable(totalPages);
    pagination.appendChild(last);
  }
});
