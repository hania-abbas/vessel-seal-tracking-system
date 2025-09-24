// backend/routes/delivered.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');
const auditHelper = require('../auditHelper');

// ---------- helpers ----------
const ONLY_6_9 = /^\d{6,9}$/;
const isSeal = s => ONLY_6_9.test((s || '').trim());
const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const safeStr = v => (v === undefined || v === null ? '' : String(v).trim());

function sanitizeText(text, max = 2000) {
  const s = safeStr(text).replace(/[<>]/g, '').substring(0, max);
  return s.length ? s : null;
}

function validateDeliveredSealInput({ visit, seal_number, vessel_supervisor }) {
  const errors = [];
  const vVisit = safeStr(visit);
  const vSeal  = safeStr(seal_number);
  const vSup   = safeStr(vessel_supervisor);
  if (vVisit.length < 3) errors.push('visit_required');
  if (vSeal.length  < 6) errors.push('seal_number_required');
  if (vSup.length   < 2) errors.push('supervisor_required');
  return errors;
}

// ---------- Parsing ----------
function parseMultipleRangesAndSingles(sealInput) {
  const ranges = [];
  const singles = [];
  const src = Array.isArray(sealInput)
    ? sealInput.join(',')
    : (sealInput == null ? '' : String(sealInput)).trim();
  if (!src) return { ranges, singles };

  const tokens = src.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  for (const t of tokens) {
    const m = t.match(/^(\d{6,9})-(\d{6,9})$/);
    if (m) {
      const a = m[1], b = m[2];
      const ai = toInt(a), bi = toInt(b);
      if (isSeal(a) && isSeal(b) && bi >= ai) {
        ranges.push({ from: a, to: b, count: bi - ai + 1 });
        continue;
      }
    }
    if (isSeal(t)) singles.push(t);
  }
  return { ranges, singles };
}

// ---------- Overlap helpers ----------
const overlaps = (a, b) => !(toInt(a.to) < toInt(b.from) || toInt(a.from) > toInt(b.to));
const inRange  = (num, r) => { const n = toInt(num); return n != null && n >= toInt(r.from) && n <= toInt(r.to); };

async function buildExistingIndex(pool, visit, excludeId = null) {
  const existingRanges = [];
  const existingSingles = new Set();

  let q = 'SELECT id, seal_number FROM delivered_seals WHERE visit=@visit';
  const req = pool.request().input('visit', sql.VarChar, visit);
  if (excludeId) { q += ' AND id<>@id'; req.input('id', sql.Int, excludeId); }

  const rs = await req.query(q);

  for (const row of rs.recordset) {
    const src = safeStr(row.seal_number);
    if (!src) continue;
    for (const token of src.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = token.match(/^(\d{6,9})-(\d{6,9})$/);
      if (m) {
        const from = m[1], to = m[2];
        if (isSeal(from) && isSeal(to) && toInt(to) >= toInt(from)) {
          existingRanges.push({ from, to });
        }
      } else if (isSeal(token)) {
        existingSingles.add(token);
      }
    }
  }
  return { existingRanges, existingSingles };
}

function findConflicts(existing, newRanges, newSingles) {
  const overlapRanges = new Set();
  const duplicateSingles = new Set();

  for (const nr of newRanges) {
    for (const er of existing.existingRanges) {
      if (overlaps(nr, er)) {
        const of = Math.max(toInt(nr.from), toInt(er.from));
        const ot = Math.min(toInt(nr.to),   toInt(er.to));
        overlapRanges.add(`${of}-${ot}`);
      }
    }
    for (const s of existing.existingSingles) if (inRange(s, nr)) duplicateSingles.add(s);
  }

  for (const s of newSingles) {
    if (existing.existingSingles.has(s)) duplicateSingles.add(s);
    else for (const er of existing.existingRanges) if (inRange(s, er)) { duplicateSingles.add(s); break; }
  }

  const num = t => toInt(t);
  const start = r => toInt(r.split('-')[0]);

  return {
    overlaps: [...overlapRanges].sort((a,b) => start(a) - start(b)),
    singles:  [...duplicateSingles].sort((a,b) => num(a) - num(b)),
  };
}

// ---------- CREATE ----------
router.post('/', async (req, res) => {
  const { visit, seal_number, vessel_supervisor, user_planner, created_at, delivered_notes } = req.body;

  const errors = validateDeliveredSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;

    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    console.log('*** delivered.js overlap-debug (POST) ***');
    console.log('[DELIVERED.POST] visit=%s new ranges=%j singles=%j', visit, ranges, singles);

    const existing = await buildExistingIndex(pool, visit);
    console.log('[DELIVERED.POST] existing ranges=%j singles=%j',
      existing.existingRanges, Array.from(existing.existingSingles));

    const conflicts = findConflicts(existing, ranges, singles);
    console.log('[DELIVERED.POST] conflicts overlaps=%j singles=%j',
      conflicts.overlaps, conflicts.singles);

    if (conflicts.overlaps.length || conflicts.singles.length) {
      return res.status(409).json({
        error: 'duplicate',
        message: 'Overlapping or duplicate seals exist in this visit.',
        overlaps: conflicts.overlaps,
        singles:  conflicts.singles
      });
    }

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    const rows = [
      ...ranges.map(r => ({ seal_number: `${r.from}-${r.to}`, total_count: overallTotal })),
      ...(singles.length ? [{ seal_number: singles.join(','), total_count: overallTotal }] : [])
    ];

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, safeStr(visit));
        req1.input('seal_number', sql.VarChar, row.seal_number);
        req1.input('total_count', sql.Int, row.total_count);
        req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
        req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
        req1.input('created_at', sql.DateTime, created_at || new Date());
        req1.input('delivered_notes', sql.VarChar, sanitizeText(delivered_notes));
        const result = await req1.query(`
          INSERT INTO delivered_seals
            (visit, seal_number, total_count, vessel_supervisor, user_planner, created_at, delivered_notes)
          OUTPUT INSERTED.id
          VALUES
            (@visit, @seal_number, @total_count, @vessel_supervisor, @user_planner, @created_at, @delivered_notes)
        `);
        const id = result.recordset[0].id;

        await auditHelper.logAudit(
          'delivered_seals', 'INSERT', id, null,
          { visit, seal_number: row.seal_number, total_count: row.total_count, vessel_supervisor, user_planner, delivered_notes },
          user_planner
        );

        inserted.push({ id, seal_number: row.seal_number, total_count: row.total_count });
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    return res.status(201).json({ message: 'Seal(s) delivered and saved!', inserted, overall_total: overallTotal });
  } catch (err) {
    console.error('Error delivering seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- READ all ----------
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { visit } = req.query;
    let sqlText = 'SELECT * FROM delivered_seals';
    const request = pool.request();
    if (visit) { sqlText += ' WHERE visit=@visit'; request.input('visit', sql.VarChar, visit); }
    sqlText += ' ORDER BY created_at DESC';
    const result = await request.query(sqlText);
    return res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching delivered seals:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- READ one ----------
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('id', sql.Int, id).query('SELECT * FROM delivered_seals WHERE id=@id');
    if (!result.recordset.length) return res.status(404).json({ error: 'Seal not found' });
    return res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error fetching delivered seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- UPDATE ----------
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { visit, seal_number, vessel_supervisor, user_planner, created_at, delivered_notes } = req.body;

  const errors = validateDeliveredSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;

    const oldResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM delivered_seals WHERE id=@id');
    if (!oldResult.recordset.length) return res.status(404).json({ error: 'not_found' });
    const oldData = oldResult.recordset[0];

    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    console.log('*** delivered.js overlap-debug (PUT) ***');
    console.log('[DELIVERED.PUT] visit=%s id=%s new ranges=%j singles=%j', visit, id, ranges, singles);

    // exclude the row being replaced
    const existing = await buildExistingIndex(pool, visit, Number(id));
    console.log('[DELIVERED.PUT] existing ranges=%j singles=%j',
      existing.existingRanges, Array.from(existing.existingSingles));

    const conflicts = findConflicts(existing, ranges, singles);
    console.log('[DELIVERED.PUT] conflicts overlaps=%j singles=%j',
      conflicts.overlaps, conflicts.singles);

    if (conflicts.overlaps.length || conflicts.singles.length) {
      return res.status(409).json({
        error: 'duplicate',
        message: 'Overlapping or duplicate seals exist in this visit.',
        overlaps: conflicts.overlaps,
        singles:  conflicts.singles
      });
    }

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;
    const rows = [
      ...ranges.map(r => ({ seal_number: `${r.from}-${r.to}`, total_count: overallTotal })),
      ...(singles.length ? [{ seal_number: singles.join(','), total_count: overallTotal }] : [])
    ];

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM delivered_seals WHERE id=@id');
      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, safeStr(visit));
        req1.input('seal_number', sql.VarChar, row.seal_number);
        req1.input('total_count', sql.Int, row.total_count);
        req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
        req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
        req1.input('created_at', sql.DateTime, created_at || new Date());
        req1.input('delivered_notes', sql.VarChar, sanitizeText(delivered_notes));
        const result = await req1.query(`
          INSERT INTO delivered_seals
            (visit, seal_number, total_count, vessel_supervisor, user_planner, created_at, delivered_notes)
          OUTPUT INSERTED.id
          VALUES
            (@visit, @seal_number, @total_count, @vessel_supervisor, @user_planner, @created_at, @delivered_notes)
        `);
        inserted.push({ id: result.recordset[0].id, visit, ...row });
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    await auditHelper.logAudit('delivered_seals', 'UPDATE', id, oldData, { new_rows: inserted }, user_planner);

    return res.json({ message: 'Delivered seal updated!', replaced: inserted, overall_total: overallTotal });
  } catch (err) {
    console.error('Error updating delivered seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const oldResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM delivered_seals WHERE id=@id');
    const oldData = oldResult.recordset[0] || null;
    const result = await pool.request().input('id', sql.Int, id).query('DELETE FROM delivered_seals WHERE id=@id');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Seal not found' });
    await auditHelper.logAudit('delivered_seals', 'DELETE', id, oldData, null, oldData?.user_planner || 'unknown');
    return res.json({ message: 'Delivered seal deleted!' });
  } catch (err) {
    console.error('Error deleting delivered seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

module.exports = router;
