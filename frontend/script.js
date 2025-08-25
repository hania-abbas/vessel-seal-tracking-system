//for homepage

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('table-body');
  const pagination = document.getElementById('pagination');

  const pageSize = 10;
  let currentPage = 1;
  let vesselData = [];

  // Fetch vessel data
  fetch('http://localhost:3000/api/vessels')
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        vesselData = data;
        renderTable(currentPage);
      } else {
        console.error("Unexpected response:", data);
        alert("Failed to load vessel data");
      }
    })
    .catch(error => {
      console.error("Fetch error:", error);
      alert("Could not connect to backend");
    });

  // Render paginated table
  function renderTable(page) {
    currentPage = page;
    tableBody.innerHTML = '';
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = vesselData.slice(start, end);

    pageData.forEach(v => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${v.VesselRefNo}</td>
        <td>${v.Visit}</td>
        <td>${v.VesselName}</td>
        <td>${v.Status}</td> 
        <td>${formatDate(v.ATA)}</td>
        <td><a href="seal.html?visit=${v.Visit}" class="seal-btn">Seal</a></td>
      `;
      tableBody.appendChild(row);
    });

    renderPagination(page);
  }

  // Format datetime
  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  }

  // Render pagination
  function renderPagination(currentPage) {
    pagination.innerHTML = '';

    const totalPages = Math.ceil(vesselData.length / pageSize);
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
