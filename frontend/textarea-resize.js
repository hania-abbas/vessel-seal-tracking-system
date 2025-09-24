//textarea-resize.js
(function () {
  function autosizeTextarea(el) {
    if (!el) return;
    const max = parseInt(getComputedStyle(el).maxHeight || '0', 10) || Infinity;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }
  function refreshPreviewsAutosize() {
    autosizeTextarea(document.getElementById('entered_seals'));
    autosizeTextarea(document.getElementById('return_entered_seals'));
  }
  function autoExpand(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  function attachAutoExpand(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => autoExpand(el));
    autoExpand(el);
  }

  window.addEventListener('load', () => {
    refreshPreviewsAutosize();
    attachAutoExpand('delivered_notes');
    attachAutoExpand('return_notes');
  });
  window.addEventListener('resize', refreshPreviewsAutosize);
})();













