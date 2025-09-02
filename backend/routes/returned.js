// backend/routes/returned.js
const express = require('express');
const router = express.Router();
const { database, sql } = require('../db/db');
const { logAudit, getRow } = require('../auditHelper');

/* ---------------- strict validators ---------------- */
const RE_SEAL = /^[0-9]{6,9}$/; // digits only, 6–9
const isSeal = (s) => RE_SEAL.test(String(s ?? '').trim());
const nonEmpty = (s) => String(s ?? '').trim().length > 0;

function normalizeReturnedPayload({
  seal_number, damaged_seal_number, lost_seal_number, damaged_count, lost_count
}) {
  const seals = String(seal_number ?? '').trim();
  const hasSeals = seals.length > 0;

  if (!hasSeals) return { ok: false };

  // Validate all individual seal numbers (comma-separated or range)
  const sealList = seals.split(',').map(s => s.trim());
  for (const seal of sealList) {
    if (seal.includes('-')) {
      const [from, to] = seal.split('-').map(Number);
      if (!isSeal(from) || !isSeal(to) || to < from) return { ok: false };
    } else {
      if (!isSeal(seal)) return { ok: false };
    }
  }

  if (damaged_seal_number && !isSeal(damaged_seal_number)) return { ok: false };
  if (lost_seal_number && !isSeal(lost_seal_number)) return { ok: false };

  return {
    ok: true,
    seal_number: seals,
    damaged_seal_number: damaged_seal_number ?? null,
    lost_seal_number: lost_seal_number ?? null,
    damaged_count: damaged_count ?? 0,
    lost_count: lost_count ?? 0,
  };
}

const expandRange = (a, b) => { const out=[]; for(let n=a;n<=b;n++) out.push(n); return out; };
function buildReturnedSet(seal_number) {
  const set = new Set();
  const seals = seal_number.split(',').map(s => s.trim());
  for (const seal of seals) {
    if (seal.includes('-')) {
      const [from, to] = seal.split('-').map(Number);
      expandRange(from, to).forEach(n => set.add(n));
    } else {
      set.add(Number(seal));
    }
  }
  return set;
}
function computeEffectiveReturnedCount({ baseSet, damaged_seal_number, lost_seal_number }) {
  const copy = new Set(baseSet);
  const excluded = [];
  if (damaged_seal_number && copy.delete(Number(damaged_seal_number))) excluded.push({ reason: 'damaged', seal: damaged_seal_number });
  if (lost_seal_number && copy.delete(Number(lost_seal_number))) excluded.push({ reason: 'lost', seal: lost_seal_number });
  return { effectiveReturnedCount: copy.size, excluded, effectiveReturnedList: [...copy] };
}

/* ---------------- helpers for Option C rules ---------------- */

// 1) Delivered set for THIS visit (what’s eligible to return)
async function loadDeliveredSetForVisit(pool, visit) {
  const eligible = new Set();
  const q = await pool
    .request()
    .input('visit', sql.NVarChar(50), visit)
    .query(`
      SELECT seal_number, total_count
      FROM dbo.delivered_seals
      WHERE visit=@visit
    `);
  for (const r of q.recordset) {
    if (r.seal_number) {
      if (r.seal_number.includes('-')) {
        const [from, to] = r.seal_number.split('-').map(Number);
        expandRange(from, to).forEach(n => eligible.add(n));
      } else if (r.seal_number.includes(',')) {
        r.seal_number.split(',').map(s => Number(s.trim())).forEach(n => eligible.add(n));
      } else {
        eligible.add(Number(r.seal_number));
      }
    }
  }
  return eligible;
}

// 2) Already returned/damaged/lost (to avoid double-return in this visit)
async function loadAlreadyReturnedForVisit(pool, visit, { excludeId = null } = {}) {
  const used = new Set();
  const q = await pool
    .request()
    .input('visit', sql.NVarChar(50), visit)
    .query(`
      SELECT id, seal_number, damaged_seal_number, lost_seal_number
      FROM dbo.returned_seals
      WHERE visit=@visit
    `);
  for (const r of q.recordset) {
    if (excludeId && r.id === excludeId) continue;
    if (r.seal_number) {
      const seals = r.seal_number.split(',').map(s => s.trim());
      for (const seal of seals) {
        if (seal.includes('-')) {
          const [from, to] = seal.split('-').map(Number);
          expandRange(from, to).forEach(n => used.add(n));
        } else {
          used.add(Number(seal));
        }
      }
    }
    if (r.damaged_seal_number) used.add(Number(r.damaged_seal_number));
    if (r.lost_seal_number) used.add(Number(r.lost_seal_number));
  }
  return used;
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
               seal_number,
               damaged_seal_number, damaged_count,
               lost_seal_number, lost_count,
               return_notes, vessel_supervisor, user_planner,
               CONVERT(varchar(19), created_at, 120) AS created_at
        FROM dbo.returned_seals
        WHERE visit=@visit
        ORDER BY id DESC;
      `);

    res.json(recordset);
  } catch (err) {
    console.error('GET /returned-seals', err);
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
               seal_number,
               damaged_seal_number, damaged_count,
               lost_seal_number, lost_count,
               return_notes, vessel_supervisor, user_planner,
               CONVERT(varchar(19), created_at, 120) AS created_at
        FROM dbo.returned_seals
        WHERE id=@id;
      `);

    if (!recordset.length) return res.status(404).json({ error: 'not_found' });
    res.json(recordset[0]);
  } catch (err) {
    console.error('GET /returned-seals/:id', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- CREATE ---------------- */
router.post('/', async (req, res) => {
  try {
    console.log('Received returned seals request:', {
      body: req.body,
      visitId: req.body.visit,
      supervisor: req.body.vessel_supervisor
    });

    const { visit, return_notes = null, vessel_supervisor, user_planner = null } = req.body;
    
    if (!visit) {
      console.warn('Missing required field: visit');
      return res.status(400).json({ error: 'visit_required', message: 'Visit ID is required' });
    }
    
    if (!nonEmpty(vessel_supervisor)) {
      console.warn('Missing required field: vessel_supervisor');
      return res.status(400).json({ error: 'supervisor_required', message: 'Vessel supervisor name is required' });
    }

    const norm = normalizeReturnedPayload(req.body);
    if (!norm.ok) {
      console.warn('Invalid seal format in payload:', req.body);
      return res.status(400).json({ 
        error: 'invalid_seal_format',
        message: 'Invalid seal number format. Please check the seal numbers provided.'
      });
    }

    const baseSet = buildReturnedSet(norm.seal_number);

    const pool = await poolPromise;

    try {
      // 1) Must have been delivered for THIS visit
      const eligible = await loadDeliveredSetForVisit(pool, visit);
      const needToCheck = new Set(baseSet);
      if (norm.damaged_seal_number) needToCheck.add(Number(norm.damaged_seal_number));
      if (norm.lost_seal_number) needToCheck.add(Number(norm.lost_seal_number));

      console.log('Validating seals:', {
        totalSeals: needToCheck.size,
        eligibleSeals: eligible.size,
        visit
      });

      const missing = [...needToCheck].filter((n) => !eligible.has(n)).sort((a, b) => a - b);
      if (missing.length) {
        console.warn('Seals not delivered in this visit:', {
          missing,
          visit
        });
        return res.status(409).json({ 
          error: 'not_delivered_for_visit', 
          seals: missing,
          message: 'Some seals were not delivered in this visit'
        });
      }

      // 2) Must not have been already returned/damaged/lost for THIS visit
      const already = await loadAlreadyReturnedForVisit(pool, visit);
      const clashes = [...needToCheck].filter((n) => already.has(n)).sort((a, b) => a - b);
      if (clashes.length) {
        console.warn('Duplicate seals detected:', {
          clashes,
          visit
        });
        return res.status(409).json({ 
          error: 'duplicate_found', 
          duplicates: clashes,
          message: 'Some seals have already been returned in this visit'
        });
      }
    } catch (err) {
      console.error('Error validating seals:', err);
      return res.status(500).json({ 
        error: 'validation_error',
        message: 'Error occurred while validating seal numbers'
      });
    }

    const eff = computeEffectiveReturnedCount({
      baseSet,
      damaged_seal_number: norm.damaged_seal_number,
      lost_seal_number: norm.lost_seal_number,
    });

    const insert = await pool
      .request()
      .input('visit', sql.NVarChar(50), visit)
      .input('seal_number', sql.NVarChar(1000), norm.seal_number)
      .input('damaged_seal_number', sql.NVarChar(20), norm.damaged_seal_number)
      .input('damaged_count', sql.Int, norm.damaged_count)
      .input('lost_seal_number', sql.NVarChar(20), norm.lost_seal_number)
      .input('lost_count', sql.Int, norm.lost_count)
      .input('return_notes', sql.NVarChar(2000), return_notes)
      .input('vessel_supervisor', sql.NVarChar(100), vessel_supervisor.trim())
      .input('user_planner', sql.NVarChar(100), user_planner || 'planner_user')
      .query(`
        INSERT INTO dbo.returned_seals(
          visit, seal_number,
          damaged_seal_number, damaged_count,
          lost_seal_number, lost_count,
          return_notes, vessel_supervisor, user_planner, created_at
        )
        OUTPUT INSERTED.*
        VALUES(
          @visit, @seal_number,
          @damaged_seal_number, @damaged_count,
          @lost_seal_number, @lost_count,
          @return_notes, @vessel_supervisor, @user_planner, SYSUTCDATETIME()
        );
      `);

    const row = insert.recordset[0];
    await logAudit('returned_seals', 'INSERT', row.id, null, row, user_planner || 'planner_user');
    res.status(201).json({ ...row, ...eff });
  } catch (err) {
    console.error('POST /returned-seals', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- UPDATE ---------------- */
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const changedBy = req.body?.updatedBy || req.user?.username || 'planner_user';

  try {
    const pool = await poolPromise;
    const before = await getRow('returned_seals', 'id', id);
    if (!before) return res.status(404).json({ error: 'Row not found' });

    const merged = {
      visit: req.body.visit ?? before.visit,
      seal_number: req.body.seal_number ?? before.seal_number,
      damaged_seal_number: req.body.damaged_seal_number ?? before.damaged_seal_number,
      damaged_count: req.body.damaged_count ?? before.damaged_count,
      lost_seal_number: req.body.lost_seal_number ?? before.lost_seal_number,
      lost_count: req.body.lost_count ?? before.lost_count,
      vessel_supervisor: (req.body.vessel_supervisor ?? before.vessel_supervisor),
    };

    if (!nonEmpty(merged.vessel_supervisor)) return res.status(400).json({ error: 'supervisor_required' });

    const norm = normalizeReturnedPayload(merged);
    if (!norm.ok) return res.status(400).json({ error: 'invalid_seal_format' });

    const baseSet = buildReturnedSet(norm.seal_number);

    // delivered prerequisite (same visit)
    const eligible = await loadDeliveredSetForVisit(pool, merged.visit);
    const needToCheck = new Set(baseSet);
    if (norm.damaged_seal_number) needToCheck.add(Number(norm.damaged_seal_number));
    if (norm.lost_seal_number) needToCheck.add(Number(norm.lost_seal_number));

    const missing = [...needToCheck].filter((n) => !eligible.has(n)).sort((a, b) => a - b);
    if (missing.length) {
      return res.status(409).json({ error: 'not_delivered_for_visit', seals: missing });
    }

    // not already returned in this visit (excluding this row)
    const already = await loadAlreadyReturnedForVisit(pool, merged.visit, { excludeId: id });
    const clashes = [...needToCheck].filter((n) => already.has(n)).sort((a, b) => a - b);
    if (clashes.length) {
      return res.status(409).json({ error: 'duplicate_found', duplicates: clashes });
    }

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('seal_number', sql.NVarChar(1000), merged.seal_number)
      .input('damaged_seal_number', sql.NVarChar(20), merged.damaged_seal_number)
      .input('damaged_count', sql.Int, merged.damaged_count)
      .input('lost_seal_number', sql.NVarChar(20), merged.lost_seal_number)
      .input('lost_count', sql.Int, merged.lost_count)
      .input('return_notes', sql.NVarChar(2000), req.body.return_notes ?? before.return_notes)
      .input('vessel_supervisor', sql.NVarChar(100), merged.vessel_supervisor.trim())
      .input('visit', sql.NVarChar(50), merged.visit)
      .input('user_planner', sql.NVarChar(100), req.body.user_planner ?? changedBy)
      .query(`
        UPDATE dbo.returned_seals
        SET seal_number=@seal_number,
            damaged_seal_number=@damaged_seal_number, damaged_count=@damaged_count,
            lost_seal_number=@lost_seal_number, lost_count=@lost_count,
            return_notes=@return_notes, vessel_supervisor=@vessel_supervisor,
            visit=@visit, user_planner=@user_planner
        WHERE id=@id;
      `);

    const after = await getRow('returned_seals', 'id', id);
    const eff = computeEffectiveReturnedCount({
      baseSet,
      damaged_seal_number: norm.damaged_seal_number,
      lost_seal_number: norm.lost_seal_number,
    });

    await logAudit('returned_seals', 'UPDATE', id, before, after, changedBy);
    res.json({ ...after, ...eff });
  } catch (err) {
    console.error('PUT /returned-seals/:id', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

/* ---------------- DELETE ---------------- */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });

    const pool = await poolPromise;
    const before = await getRow('returned_seals', 'id', id);
    if (!before) return res.status(404).json({ error: 'not_found' });

    const del = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.returned_seals OUTPUT DELETED.* WHERE id=@id;
    `);

    await logAudit('returned_seals', 'DELETE', id, before, null, req.headers['x-user'] || 'planner_user');
    res.json({ ok: true, deleted: del.recordset[0] });
  } catch (err) {
    console.error('DELETE /returned-seals/:id', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;