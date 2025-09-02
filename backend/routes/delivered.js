// backend/routes/delivered.js
const express = require('express');
const router = express.Router();
const { database, sql } = require('../db/db');
const { logAudit, getRow } = require('../auditHelper');

/* ---------------- strict validators ---------------- */
const RE_SEAL = /^[0-9]{6,9}$/; // digits only, 6–9
const isSeal = (s) => RE_SEAL.test(String(s ?? '').trim());
const nonEmpty = (s) => String(s ?? '').trim().length > 0;

function normalizeDeliveredPayload({ delivered_from, delivered_to, delivered_single }) {
  const hasRange = delivered_from != null || delivered_to != null;
  const hasSingle = delivered_single != null && String(delivered_single) !== '';

  if (hasRange) {
    if (!isSeal(delivered_from) || !isSeal(delivered_to)) return { ok: false };
    if (Number(delivered_to) < Number(delivered_from)) return { ok: false };
  }
  if (hasSingle) {
    if (!isSeal(delivered_single)) return { ok: false };
  }
  if (!hasRange && !hasSingle) return { ok: false };

  return {
    ok: true,
    f: hasRange ? Number(delivered_from) : null,
    t: hasRange ? Number(delivered_to) : null,
    s: hasSingle ? Number(delivered_single) : null,
  };
}

const expandRange = (a, b) => {
  const out = [];
  for (let n = a; n <= b; n++) out.push(n);
  return out;
};
function buildDeliveredSet({ f, t, s }) {
  const set = new Set();
  if (f !== null && t !== null) expandRange(f, t).forEach((n) => set.add(n));
  if (s !== null) set.add(s);
  return set;
}
function computeDeliveredCount(set) {
  return { deliveredCount: set.size, deliveredList: [...set] };
}

/* ---------- GLOBAL duplicates: Delivered must be unique system-wide ---------- */
async function loadUsedSealsFromDelivered(pool, { excludeId = null } = {}) {
  const used = new Set();
  const q = await pool.request().query(`
    SELECT id, seal_number, total_count
    FROM dbo.delivered_seals
  `);
  for (const r of q.recordset) {
    if (excludeId && r.id === excludeId) continue;
    if (r.seal_number) {
      if (r.seal_number.includes('-')) {
        const [from, to] = r.seal_number.split('-').map(Number);
        expandRange(from, to).forEach((n) => used.add(n));
      } else {
        used.add(Number(r.seal_number));
      }
    }
  }
  return used;
}
async function assertNoDeliveredDupes(pool, newSet, { excludeId = null } = {}) {
  const used = await loadUsedSealsFromDelivered(pool, { excludeId });
  const dups = [...newSet].filter((n) => used.has(n)).sort((a, b) => a - b);
  if (dups.length) {
    const err = new Error('duplicate_found');
    err.status = 409;
    err.payload = { error: 'duplicate_found', duplicates: dups };
    throw err;
  }
}
function respondDupOrThrow(res, err) {
  if (err && err.status === 409 && err.payload) return res.status(409).json(err.payload);
  throw err;
}

/* ---------------- LIST ---------------- */
router.get('/', async (req, res) => {
  try {
    const { visit } = req.query;
    if (!visit) return res.status(400).json({ error: 'visit_required' });

    const pool = await poolPromise;
    const { recordset } = await pool
      .request()
      .input('visit', sql.NVarChar(50), visit)
      .query(`
        SELECT id, visit,
               seal_number, total_count,
               delivered_notes, vessel_supervisor, user_planner,
               CONVERT(varchar(19), created_at, 120) AS created_at
        FROM dbo.delivered_seals
        WHERE visit=@visit
        ORDER BY id DESC;
      `);

    res.json(recordset);
  } catch (err) {
    console.error('GET /delivered-seals', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- GET ONE ---------------- */
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });

    const pool = await poolPromise;
    const { recordset } = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT id, visit,
               delivered_from, delivered_to, delivered_single,
               delivered_notes, vessel_supervisor, delivered_user_planner,
               CONVERT(varchar(19), created_at, 120) AS created_at
        FROM dbo.delivered_seals
        WHERE id=@id;
      `);

    if (!recordset.length) return res.status(404).json({ error: 'not_found' });
    res.json(recordset[0]);
  } catch (err) {
    console.error('GET /delivered-seals/:id', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- CREATE ---------------- */
router.post('/', async (req, res) => {
  try {
    console.log('Received POST /delivered-seals payload:', JSON.stringify(req.body, null, 2));
    const { visit, delivered_notes = null, vessel_supervisor, delivered_user_planner = null } = req.body;
    
    // Validate required fields
    if (!visit) {
      console.log('Missing visit ID');
      return res.status(400).json({ error: 'visit_required' });
    }
    if (!nonEmpty(vessel_supervisor)) {
      console.log('Missing vessel supervisor');
      return res.status(400).json({ error: 'supervisor_required' });
    }

    const norm = normalizeDeliveredPayload(req.body);
    console.log('Normalized payload:', norm);
    if (!norm.ok) return res.status(400).json({ error: 'invalid_seal_format' });

    const newSet = buildDeliveredSet(norm);
    const pool = await poolPromise;

    // block if any already delivered anywhere (global uniqueness)
    try {
      await assertNoDeliveredDupes(pool, newSet);
    } catch (e) {
      return respondDupOrThrow(res, e);
    }

    const { deliveredCount } = computeDeliveredCount(newSet);

    // Generate array of individual seal numbers
    const sealNumbers = [];
    if (norm.f !== null && norm.t !== null) {
      for (let i = norm.f; i <= norm.t; i++) {
        sealNumbers.push(i.toString());
      }
    } else if (norm.s !== null) {
      sealNumbers.push(norm.s.toString());
    }

    // Insert each seal number as a separate record
    const insertPromises = sealNumbers.map(sealNum => 
      pool.request()
        .input('visit', sql.NVarChar(50), visit)
        .input('seal_number', sql.NVarChar(100), sealNum)
        .input('total_count', sql.Int, 1)
        .input('delivered_notes', sql.NVarChar(2000), delivered_notes)
        .input('vessel_supervisor', sql.NVarChar(100), vessel_supervisor.trim())
        .input('user_planner', sql.NVarChar(100), delivered_user_planner || 'planner_user')
        .query(`
          INSERT INTO dbo.delivered_seals(
            visit, seal_number, total_count,
            delivered_notes, vessel_supervisor, user_planner, created_at
          )
          OUTPUT INSERTED.*
          VALUES(
            @visit, @seal_number, @total_count,
            @delivered_notes, @vessel_supervisor, @user_planner, SYSUTCDATETIME()
          );
        `)
    );

    // Execute all inserts
    const results = await Promise.all(insertPromises);
    const insertedRows = results.map(r => r.recordset[0]);

    // Log audit for each inserted row
    for (const row of insertedRows) {
      await logAudit('delivered_seals', 'INSERT', row.id, null, row, delivered_user_planner || 'planner_user');
    }
    
    res.status(201).json({ 
      insertedRows,
      count: insertedRows.length,
      firstId: insertedRows[0]?.id,
      lastId: insertedRows[insertedRows.length - 1]?.id
    });
  } catch (err) {
    console.error('POST /delivered-seals error:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      name: err.name
    });
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/* ---------------- UPDATE ---------------- */
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const changedBy = req.body?.updatedBy || req.user?.username || 'planner_user';

  try {
    const pool = await poolPromise;
    const before = await getRow('delivered_seals', 'id', id);
    if (!before) return res.status(404).json({ error: 'Row not found' });

    const merged = {
      visit: req.body.visit ?? before.visit,
      delivered_from: req.body.delivered_from ?? before.delivered_from,
      delivered_to: req.body.delivered_to ?? before.delivered_to,
      delivered_single: req.body.delivered_single ?? before.delivered_single,
      vessel_supervisor: (req.body.vessel_supervisor ?? before.vessel_supervisor),
    };

    if (!nonEmpty(merged.vessel_supervisor)) return res.status(400).json({ error: 'supervisor_required' });

    const norm = normalizeDeliveredPayload(merged);
    if (!norm.ok) return res.status(400).json({ error: 'invalid_seal_format' });

    const newSet = buildDeliveredSet(norm);

    // block if would collide with another delivered row
    try {
      await assertNoDeliveredDupes(pool, newSet, { excludeId: id });
    } catch (e) {
      return respondDupOrThrow(res, e);
    }

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('delivered_from', sql.BigInt, req.body.delivered_from ?? null)
      .input('delivered_to', sql.BigInt, req.body.delivered_to ?? null)
      .input('delivered_single', sql.BigInt, req.body.delivered_single ?? null)
      .input('delivered_notes', sql.NVarChar(2000), req.body.delivered_notes ?? null)
      .input('vessel_supervisor', sql.NVarChar(100), merged.vessel_supervisor.trim())
      .input('visit', sql.NVarChar(50), merged.visit)
      .input('delivered_user_planner', sql.NVarChar(100), req.body.delivered_user_planner ?? changedBy)
      .query(`
        UPDATE dbo.delivered_seals
        SET delivered_from=@delivered_from, delivered_to=@delivered_to, delivered_single=@delivered_single,
            delivered_notes=@delivered_notes, vessel_supervisor=@vessel_supervisor,
            visit=@visit, delivered_user_planner=@delivered_user_planner
        WHERE id=@id;
      `);

    const after = await getRow('delivered_seals', 'id', id);
    const { deliveredCount } = computeDeliveredCount(newSet);
    await logAudit('delivered_seals', 'UPDATE', id, before, after, changedBy);
    res.json({ ...after, deliveredCount });
  } catch (err) {
    console.error('PUT /delivered-seals/:id', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

/* ---------------- DELETE ---------------- */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });

    const pool = await poolPromise;
    const before = await getRow('delivered_seals', 'id', id);
    if (!before) return res.status(404).json({ error: 'not_found' });

    const del = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.delivered_seals OUTPUT DELETED.* WHERE id=@id;
    `);

    await logAudit('delivered_seals', 'DELETE', id, before, null, req.headers['x-user'] || 'planner_user');
    res.json({ ok: true, deleted: del.recordset[0] });
  } catch (err) {
    console.error('DELETE /delivered-seals/:id', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
