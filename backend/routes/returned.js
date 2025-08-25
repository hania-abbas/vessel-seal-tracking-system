// backend/routes/returned.js
const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../db/db');
const { logAudit, getRow } = require('../auditHelper');

/* ---------------- strict validators ---------------- */
const RE_SEAL = /^[0-9]{6,9}$/; // digits only, 6–9
const isSeal = (s) => RE_SEAL.test(String(s ?? '').trim());
const nonEmpty = (s) => String(s ?? '').trim().length > 0;

function normalizeReturnedPayload({
  return_seal_from, return_seal_to, return_single_seal,
  damaged, lost, damaged_seal, lost_seal
}) {
  const hasRange = return_seal_from != null || return_seal_to != null;
  const hasSingle = return_single_seal != null && String(return_single_seal) !== '';

  if (hasRange) {
    if (!isSeal(return_seal_from) || !isSeal(return_seal_to)) return { ok: false };
    if (Number(return_seal_to) < Number(return_seal_from)) return { ok: false };
  }
  if (hasSingle) {
    if (!isSeal(return_single_seal)) return { ok: false };
  }
  if (!hasRange && !hasSingle) return { ok: false };

  if (damaged && (damaged_seal != null && String(damaged_seal) !== '') && !isSeal(damaged_seal)) return { ok: false };
  if (lost && (lost_seal != null && String(lost_seal) !== '') && !isSeal(lost_seal)) return { ok: false };

  return {
    ok: true,
    f: hasRange ? Number(return_seal_from) : null,
    t: hasRange ? Number(return_seal_to) : null,
    s: hasSingle ? Number(return_single_seal) : null,
    damaged: !!damaged,
    lost: !!lost,
    d: damaged ? (damaged_seal != null && String(damaged_seal) !== '' ? Number(damaged_seal) : null) : null,
    l: lost ? (lost_seal != null && String(lost_seal) !== '' ? Number(lost_seal) : null) : null,
  };
}

const expandRange = (a, b) => { const out=[]; for(let n=a;n<=b;n++) out.push(n); return out; };
function buildReturnedSet({ f, t, s }) {
  const set = new Set();
  if (f !== null && t !== null) expandRange(f, t).forEach((n) => set.add(n));
  if (s !== null) set.add(s);
  return set;
}
function computeEffectiveReturnedCount({ baseSet, damaged, lost, d, l }) {
  const copy = new Set(baseSet);
  const excluded = [];
  if (damaged && d !== null && copy.delete(d)) excluded.push({ reason: 'damaged', seal: d });
  if (lost && l !== null && copy.delete(l)) excluded.push({ reason: 'lost', seal: l });
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
      SELECT delivered_from, delivered_to, delivered_single
      FROM dbo.delivered_seals
      WHERE visit=@visit
    `);
  for (const r of q.recordset) {
    if (r.delivered_from != null && r.delivered_to != null) {
      expandRange(Number(r.delivered_from), Number(r.delivered_to)).forEach((n) => eligible.add(n));
    }
    if (r.delivered_single != null) eligible.add(Number(r.delivered_single));
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
      SELECT id, return_seal_from, return_seal_to, return_single_seal, damaged_seal, lost_seal
      FROM dbo.returned_seals
      WHERE visit=@visit
    `);
  for (const r of q.recordset) {
    if (excludeId && r.id === excludeId) continue;
    if (r.return_seal_from != null && r.return_seal_to != null) {
      expandRange(Number(r.return_seal_from), Number(r.return_seal_to)).forEach((n) => used.add(n));
    }
    if (r.return_single_seal != null) used.add(Number(r.return_single_seal));
    if (r.damaged_seal != null) used.add(Number(r.damaged_seal));
    if (r.lost_seal != null) used.add(Number(r.lost_seal));
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
               return_seal_from, return_seal_to, return_single_seal,
               damaged, lost, damaged_seal, lost_seal,
               return_notes, vessel_supervisor, return_user_planner,
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
               return_seal_from, return_seal_to, return_single_seal,
               damaged, lost, damaged_seal, lost_seal,
               return_notes, vessel_supervisor, return_user_planner,
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
    const { visit, return_notes = null, vessel_supervisor, return_user_planner = null } = req.body;
    if (!visit) return res.status(400).json({ error: 'visit_required' });
    if (!nonEmpty(vessel_supervisor)) return res.status(400).json({ error: 'supervisor_required' });

    const norm = normalizeReturnedPayload(req.body);
    if (!norm.ok) return res.status(400).json({ error: 'invalid_seal_format' });

    const baseSet = buildReturnedSet(norm);
    // reject if single is inside the same range provided
    if (norm.s !== null && baseSet.has(norm.s) && norm.f !== null && norm.t !== null) {
      return res.status(400).json({ error: 'payload_overlap' });
    }

    const pool = await poolPromise;

    // 1) Must have been delivered for THIS visit
    const eligible = await loadDeliveredSetForVisit(pool, visit);
    const needToCheck = new Set(baseSet);
    if (norm.damaged && norm.d !== null) needToCheck.add(norm.d);
    if (norm.lost && norm.l !== null) needToCheck.add(norm.l);

    const missing = [...needToCheck].filter((n) => !eligible.has(n)).sort((a, b) => a - b);
    if (missing.length) {
      return res.status(409).json({ error: 'not_delivered_for_visit', seals: missing });
    }

    // 2) Must not have been already returned/damaged/lost for THIS visit
    const already = await loadAlreadyReturnedForVisit(pool, visit);
    const clashes = [...needToCheck].filter((n) => already.has(n)).sort((a, b) => a - b);
    if (clashes.length) {
      return res.status(409).json({ error: 'duplicate_found', duplicates: clashes });
    }

    const eff = computeEffectiveReturnedCount({
      baseSet,
      damaged: norm.damaged,
      lost: norm.lost,
      d: norm.d,
      l: norm.l,
    });

    const insert = await pool
      .request()
      .input('visit', sql.NVarChar(50), visit)
      .input('return_seal_from', sql.BigInt, norm.f)
      .input('return_seal_to', sql.BigInt, norm.t)
      .input('return_single_seal', sql.BigInt, norm.s)
      .input('damaged', sql.Bit, norm.damaged ? 1 : 0)
      .input('lost', sql.Bit, norm.lost ? 1 : 0)
      .input('damaged_seal', sql.BigInt, norm.d)
      .input('lost_seal', sql.BigInt, norm.l)
      .input('return_notes', sql.NVarChar(2000), return_notes)
      .input('vessel_supervisor', sql.NVarChar(100), vessel_supervisor.trim())
      .input('return_user_planner', sql.NVarChar(100), return_user_planner || 'planner_user')
      .query(`
        INSERT INTO dbo.returned_seals(
          visit, return_seal_from, return_seal_to, return_single_seal,
          damaged, lost, damaged_seal, lost_seal,
          return_notes, vessel_supervisor, return_user_planner, created_at
        )
        OUTPUT INSERTED.*
        VALUES(
          @visit, @return_seal_from, @return_seal_to, @return_single_seal,
          @damaged, @lost, @damaged_seal, @lost_seal,
          @return_notes, @vessel_supervisor, @return_user_planner, SYSUTCDATETIME()
        );
      `);

    const row = insert.recordset[0];
    await logAudit('returned_seals', 'INSERT', row.id, null, row, return_user_planner || 'planner_user');
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
      return_seal_from: req.body.return_seal_from ?? before.return_seal_from,
      return_seal_to: req.body.return_seal_to ?? before.return_seal_to,
      return_single_seal: req.body.return_single_seal ?? before.return_single_seal,
      damaged: req.body.damaged ?? before.damaged,
      lost: req.body.lost ?? before.lost,
      damaged_seal: req.body.damaged_seal ?? before.damaged_seal,
      lost_seal: req.body.lost_seal ?? before.lost_seal,
      vessel_supervisor: (req.body.vessel_supervisor ?? before.vessel_supervisor),
    };

    if (!nonEmpty(merged.vessel_supervisor)) return res.status(400).json({ error: 'supervisor_required' });

    const norm = normalizeReturnedPayload(merged);
    if (!norm.ok) return res.status(400).json({ error: 'invalid_seal_format' });

    const baseSet = buildReturnedSet(norm);
    if (norm.s !== null && baseSet.has(norm.s) && norm.f !== null && norm.t !== null) {
      return res.status(400).json({ error: 'payload_overlap' });
    }

    // delivered prerequisite (same visit)
    const eligible = await loadDeliveredSetForVisit(pool, merged.visit);
    const needToCheck = new Set(baseSet);
    if (norm.damaged && norm.d !== null) needToCheck.add(norm.d);
    if (norm.lost && norm.l !== null) needToCheck.add(norm.l);

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
      .input('return_seal_from', sql.BigInt, req.body.return_seal_from ?? null)
      .input('return_seal_to', sql.BigInt, req.body.return_seal_to ?? null)
      .input('return_single_seal', sql.BigInt, req.body.return_single_seal ?? null)
      .input('damaged', sql.Bit, req.body.damaged ? 1 : 0)
      .input('lost', sql.Bit, req.body.lost ? 1 : 0)
      .input('damaged_seal', sql.BigInt, req.body.damaged_seal ?? null)
      .input('lost_seal', sql.BigInt, req.body.lost_seal ?? null)
      .input('return_notes', sql.NVarChar(2000), req.body.return_notes ?? null)
      .input('vessel_supervisor', sql.NVarChar(100), merged.vessel_supervisor.trim())
      .input('visit', sql.NVarChar(50), merged.visit)
      .input('return_user_planner', sql.NVarChar(100), req.body.return_user_planner ?? changedBy)
      .query(`
        UPDATE dbo.returned_seals
        SET return_seal_from=@return_seal_from, return_seal_to=@return_seal_to, return_single_seal=@return_single_seal,
            damaged=@damaged, lost=@lost, damaged_seal=@damaged_seal, lost_seal=@lost_seal,
            return_notes=@return_notes, vessel_supervisor=@vessel_supervisor,
            visit=@visit, return_user_planner=@return_user_planner
        WHERE id=@id;
      `);

    const after = await getRow('returned_seals', 'id', id);
    const eff = computeEffectiveReturnedCount({
      baseSet,
      damaged: norm.damaged,
      lost: norm.lost,
      d: norm.d,
      l: norm.l,
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
