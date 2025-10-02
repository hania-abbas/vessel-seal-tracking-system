// frontend/script_updated.js
// Main Logic

const API = { token: null };
API.token = localStorage.getItem('authToken');

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API.token ? { Authorization: `Bearer ${API.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} - ${text}`);
  }
  // parse JSON safely
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function pad(n) { return String(n).padStart(2, "0"); }
function ts() {
  const d = new Date();
  return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("script_updated.js LOADED", new Date().toISOString());

  init();

  function init() {
    bindEvents();
    updateStatsDisplay();
  }

  function bindEvents() {
    // Back
    document.getElementById("btnBackToSchedule")
      ?.addEventListener("click", handleBackToSchedule);

    // Delivered
    document.getElementById("btnSaveDelivered")
      ?.addEventListener("click", handleSaveDelivered);
    document.getElementById("btnEditDelivered")
      ?.addEventListener("click", handleEditDelivered);
    document.getElementById("btnClearDelivered")
      ?.addEventListener("click", handleClearDelivered);

    // Returned
    document.getElementById("btnSaveReturned")
      ?.addEventListener("click", handleSaveReturned);
    document.getElementById("btnEditReturned")
      ?.addEventListener("click", handleEditReturned);
    document.getElementById("btnClearReturned")
      ?.addEventListener("click", handleClearReturned);

    // numeric filtering
    ["txtDeliveredRange","txtDeliveredSingle","txtReturnedRange","txtReturnedSingle","txtDamagedSeals","txtLostSeals"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", function () {
          this.value = this.value.replace(/[^\d,-]/g, "");
        });
      });
  }

  function handleBackToSchedule() {
    if (confirm("Go back to schedule? Unsaved changes will be lost.")) {
      alert("Navigating back to schedule...");
    }
  }

  // ===== Save Delivered
  async function handleSaveDelivered() {
  const range = val("txtDeliveredRange");     // e.g. "930001-930083,908478-908480"
  const single = val("txtDeliveredSingle");   // e.g. "950001"
  const supervisor = val("ddlDeliveredSupervisor");
  const remarks = val("txtDeliveredRemarks");

  if (!range && !single) return warn("Enter a range or a single seal.");
  if (!supervisor) return warn("Select a vessel supervisor.");

  // build the same compact string your backend expects, e.g. "A-B,C-D,700111,700112"
  const seal_number = [range, single].filter(Boolean).join(",").replace(/\s+/g, "");
  if (!seal_number) return warn("No valid seals.");

  // compute total like backend does (simple best-effort for UI)
  const total = seal_number.split(",").reduce((acc, token) => {
    const m = token.match(/^(\d{6,9})-(\d{6,9})$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      return acc + (b >= a ? (b - a + 1) : 0);
    }
    return acc + (/^\d{6,9}$/.test(token) ? 1 : 0);
  }, 0);

  const visit = new URLSearchParams(location.search).get("visit") || localStorage.getItem("currentVisit");
  if (!visit) return warn("No active visit. Open from the schedule (Seal button) or set ?visit=...");

  const payload = {
    visit,
    seal_number,
    total_count: total,
    vessel_supervisor: supervisor,
    user_planner: localStorage.getItem("plannerUser") || null,
    created_at: new Date().toISOString(),
    delivered_notes: remarks || null
  };

  try {
    const res = await fetch("/api/delivered-seals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        return err(`Duplicate/overlap detected:\n${parts.join('\n') || data.message || raw}`);
      }
      if (res.status === 400 && Array.isArray(data?.details)) {
        return err(`Validation error:\n• ${data.details.join('\n• ')}`);
      }
      return err(`Failed to submit delivered seals.\n${res.status} ${res.statusText}\n${data?.message || ''}`);
    }

    // success – reflect in UI like before
    updateDeliveredSealsList(seal_number.split(","));
    updateStatsDisplay();
    addToAuditLog(`Delivered seals: ${seal_number}`);
    ok("Delivered seal(s) saved.");

    // optionally clear fields
    set("txtDeliveredRange",""); set("txtDeliveredSingle",""); set("txtDeliveredRemarks","");
  } catch (e) {
    console.error(e);
    err(`Network/server error: ${e.message}`);
  }
}


  // ===== Save Returned
  function handleSaveReturned() {
    const range = val("txtReturnedRange");
    const single = val("txtReturnedSingle");
    const damaged = val("txtDamagedSeals");
    const lost = val("txtLostSeals");
    const supervisor = val("ddlReturnedSupervisor");
    const remarks = val("txtReturnedRemarks");

    if (!range && !single && !damaged && !lost)
      return warn("Enter a range/single/damaged/lost seals.");
    if (!supervisor) return warn("Select a vessel supervisor.");

    const processed = processSealInputs(range, single, damaged, lost);
    if (!processed.valid) return err(processed.message);

    updateReturnedSealsList(processed.seals);
    updateStatsDisplay();

    const parts = [];
    if (range) parts.push(range);
    if (single) parts.push(single);
    if (damaged) parts.push(`Damaged: ${damaged}`);
    if (lost) parts.push(`Lost: ${lost}`);
    addToAuditLog(`Returned seals: ${parts.join(" ")}`);
    ok("Returned seals saved.");
  }

  // ===== Edit/Cancel (Delivered)
  function handleEditDelivered() {
    const ta = byId("txtDeliveredList");
    ta.readOnly = false; ta.classList.add("editing");
    byId("btnSaveDelivered").textContent = "Update";
    const btn = byId("btnEditDelivered");
    btn.textContent = "Cancel Edit";
    btn.classList.replace("btn-warning", "btn-secondary");
    btn.onclick = cancelEditDelivered;
    info("Edit mode enabled for Delivered list.");
  }
  function cancelEditDelivered() {
    const ta = byId("txtDeliveredList");
    ta.readOnly = true; ta.classList.remove("editing");
    byId("btnSaveDelivered").textContent = "Save Delivered";
    const btn = byId("btnEditDelivered");
    btn.textContent = "Edit";
    btn.classList.replace("btn-secondary", "btn-warning");
    btn.onclick = handleEditDelivered;
    info("Edit cancelled.");
  }

  // ===== Edit/Cancel (Returned)
  function handleEditReturned() {
    const ta = byId("txtReturnedList");
    ta.readOnly = false; ta.classList.add("editing");
    byId("btnSaveReturned").textContent = "Update";
    const btn = byId("btnEditReturned");
    btn.textContent = "Cancel Edit";
    btn.classList.replace("btn-warning", "btn-secondary");
    btn.onclick = cancelEditReturned;
    info("Edit mode enabled for Returned list.");
  }
  function cancelEditReturned() {
    const ta = byId("txtReturnedList");
    ta.readOnly = true; ta.classList.remove("editing");
    byId("btnSaveReturned").textContent = "Save Returned";
    const btn = byId("btnEditReturned");
    btn.textContent = "Edit";
    btn.classList.replace("btn-secondary", "btn-warning");
    btn.onclick = handleEditReturned;
    info("Edit cancelled.");
  }

  // ===== Clear
  function handleClearDelivered() {
    if (!confirm("Clear all delivered seals?")) return;
    set("txtDeliveredRange",""); set("txtDeliveredSingle","");
    byId("ddlDeliveredSupervisor").selectedIndex = 0;
    set("txtDeliveredRemarks",""); set("txtDeliveredList","");
    updateStatsDisplay();
    addToAuditLog("Cleared all delivered seals"); ok("Delivered cleared.");
  }
  function handleClearReturned() {
    if (!confirm("Clear all returned seals?")) return;
    set("txtReturnedRange",""); set("txtReturnedSingle","");
    set("txtDamagedSeals",""); set("txtLostSeals","");
    byId("ddlReturnedSupervisor").selectedIndex = 0;
    set("txtReturnedRemarks",""); set("txtReturnedList","");
    updateStatsDisplay();
    addToAuditLog("Cleared all returned seals"); ok("Returned cleared.");
  }

  // ===== Helpers
  function processSealInputs(range, single, damaged, lost) {
    const seals = [];
    let valid = true, message = "";

    if (range) {
      for (const part of range.split(",")) {
        const m = part.match(/^(\d+)-(\d+)$/);
        if (!m) { valid = false; message = `Invalid range: ${part}`; break; }
        const a = Number(m[1]), b = Number(m[2]);
        if (a > b) { valid = false; message = `Invalid range order: ${part}`; break; }
        for (let i = a; i <= b; i++) seals.push(String(i));
      }
    }
    if (single && valid) {
      for (const s of single.split(",")) {
        if (/^\d+$/.test(s)) seals.push(s);
        else { valid = false; message = `Invalid seal: ${s}`; break; }
      }
    }
    if (damaged && valid) {
      for (const s of damaged.split(",")) {
        if (/^\d+$/.test(s)) seals.push(`${s} (Damaged)`);
        else { valid = false; message = `Invalid damaged seal: ${s}`; break; }
      }
    }
    if (lost && valid) {
      for (const s of lost.split(",")) {
        if (/^\d+$/.test(s)) seals.push(`${s} (Lost)`);
        else { valid = false; message = `Invalid lost seal: ${s}`; break; }
      }
    }
    return { valid, message, seals };
  }

  function updateDeliveredSealsList(newSeals) {
    const ta = byId("txtDeliveredList");
    const current = ta.value.trim();
    const combined = current ? `${current}\n${newSeals.join("\n")}` : newSeals.join("\n");
    ta.value = combined;
    byId("lblDeliveredCountBadge").textContent =
      combined.split("\n").filter(l => l.trim()).length;
  }

  function updateReturnedSealsList(newSeals) {
    const ta = byId("txtReturnedList");
    const current = ta.value.trim();
    const combined = current ? `${current}\n${newSeals.join("\n")}` : newSeals.join("\n");
    ta.value = combined;
    byId("lblReturnedCountBadge").textContent =
      combined.split("\n").filter(l => l.trim()).length;
  }

  function updateStatsDisplay() {
    const delivered = byId("txtDeliveredList").value;
    const returned  = byId("txtReturnedList").value;

    const deliveredCount = delivered.split("\n").filter(l => l.trim()).length;
    const returnedCount  = returned.split("\n").filter(l => l.trim()).length;
    const damagedCount   = returned.split("\n").filter(l => l.includes("(Damaged)")).length;
    const lostCount      = returned.split("\n").filter(l => l.includes("(Lost)")).length;
    const missingCount   = Math.max(0, deliveredCount - returnedCount - damagedCount - lostCount);

    byId("lblDeliveredCount").textContent = deliveredCount;
    byId("lblReturnedCount").textContent  = returnedCount;
    byId("lblDamagedCount").textContent   = damagedCount;
    byId("lblLostCount").textContent      = lostCount;
    byId("lblMissingCount").textContent   = missingCount;
    byId("lblTotalCount").textContent     = deliveredCount;
  }

  function addToAuditLog(message) {
    const line = `${ts()} User: admin - ${message}`;
    const pre = byId("auditLogText");          // <pre> variant
    if (pre) {
      pre.textContent = `${line}\n${pre.textContent || ""}`; // prepend
      pre.scrollTop = 0; // keep newest visible (top-prepend)
      // keep first 500 lines
      const lines = pre.textContent.split("\n");
      if (lines.length > 500) pre.textContent = lines.slice(0, 500).join("\n");
      return;
    }
    const div = byId("lblAuditLog");           // <div> fallback (old markup)
    if (div) {
      const el = document.createElement("div");
      el.textContent = line;
      el.classList.add("new-audit-entry");
      div.insertBefore(el, div.firstChild);
      if (div.children.length > 500) div.removeChild(div.lastChild);
    }
  }

  // DOM helpers / alerts
  function byId(id) { return document.getElementById(id); }
  function val(id) { return byId(id)?.value?.trim() || ""; }
  function set(id, v) { const el = byId(id); if (el) el.value = v; }

  function alertBox(message, type) {
    const existing = document.querySelector(".custom-alert"); if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = `alert alert-${type} custom-alert alert-dismissible fade show`;
    Object.assign(el.style, { position:"fixed", top:"20px", right:"20px", zIndex:"9999", minWidth:"300px" });
    el.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
  const ok  = m => alertBox(m, "success");
  const err = m => alertBox(m, "danger");
  const warn= m => alertBox(m, "warning");
  const info= m => alertBox(m, "info");
});
