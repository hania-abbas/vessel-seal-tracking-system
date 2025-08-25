// frontend/submitAll.js

async function getActiveVisitForSubmit() {
  try {
    const r = await fetch('/api/visits/active');
    const j = await r.json();
    return j.visit || null;
  } catch {
    return null;
  }
}

document.getElementById('submitAllBtn')?.addEventListener('click', async () => {
  const visit = await getActiveVisitForSubmit();
  if (!visit) {
    alert('No active visit found.');
    return;
  }

  try {
    const res = await fetch('/api/submit-all', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ visit })
    });
    if (!res.ok) throw new Error(await res.text());

    // Optionally toast/alert:
    alert('Submitted.');

    // Refresh the log if available
    if (typeof window.loadSealLog === 'function') {
      await window.loadSealLog();
    }
  } catch (e) {
    console.error(e);
    alert('Submit failed.');
  }
});

