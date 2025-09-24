// backend/routes/returned.js

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

// Expand a range into singles while preserving width (zero padding)
function* expandRangeToSingles(fromStr, toStr) {
  const a = toInt(fromStr), b = toInt(toStr);
  const width = Math.max(fromStr.length, toStr.length);
  for (let n = a; n <= b; n++) yield String(n).padStart(width, '0');
}

function expandAllSingles(ranges, singles) {
  const out = new Set(singles);
  for (const r of ranges) for (const s of expandRangeToSingles(r.from, r.to)) out.add(s);
  return out;
}

// ---------- overlap helpers ----------
const overlaps = (a, b) => !(toInt(a.to) < toInt(b.from) || toInt(a.from) > toInt(b.to));
const inRange  = (num, r) => { const n = toInt(num); return n != null && n >= toInt(r.from) && n <= toInt(r.to); };

async function buildExistingIndex(pool, visit, excludeId = null) {
  const existingRanges = [];
  const existingSingles = new Set();

  let q = 'SELECT id, seal_number FROM returned_seals WHERE visit=@visit';
  if (excludeId) q += ' AND id<>@id';

  const req = pool.request().input('visit', sql.VarChar, visit);
  if (excludeId) req.input('id', sql.Int, excludeId);

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
        // pretty formatting with zero padding based on bounds
        overlapRanges.add(
          `${String(of).padStart(Math.max(nr.from.length, er.from.length), '0')}-${String(ot).padStart(Math.max(nr.to.length, er.to.length), '0')}`
        );
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
    overlapRanges: [...overlapRanges].sort((a,b) => start(a) - start(b)),
    duplicateSingles: [...duplicateSingles].sort((a,b) => num(a) - num(b)),
  };
}

// ---------- delivered/returned singles for content-level validation ----------
async function buildDeliveredSinglesSet(pool, visit) {
  const singles = new Set();
  const rs = await pool.request()
    .input('visit', sql.VarChar, visit)
    .query('SELECT seal_number FROM delivered_seals WHERE visit=@visit');

  for (const row of rs.recordset) {
    const src = safeStr(row.seal_number);
    if (!src) continue;
    for (const token of src.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = token.match(/^(\d{6,9})-(\d{6,9})$/);
      if (m) for (const s of expandRangeToSingles(m[1], m[2])) singles.add(s);
      else if (isSeal(token)) singles.add(token);
    }
  }
  return singles;
}

async function buildReturnedSinglesSet(pool, visit, excludeId = null) {
  const singles = new Set();
  let q = 'SELECT id, seal_number FROM returned_seals WHERE visit=@visit';
  if (excludeId) q += ' AND id<>@id';

  const req = pool.request().input('visit', sql.VarChar, visit);
  if (excludeId) req.input('id', sql.Int, excludeId);

  const rs = await req.query(q);

  for (const row of rs.recordset) {
    const src = safeStr(row.seal_number);
    if (!src) continue;
    for (const token of src.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = token.match(/^(\d{6,9})-(\d{6,9})$/);
      if (m) for (const s of expandRangeToSingles(m[1], m[2])) singles.add(s);
      else if (isSeal(token)) singles.add(token);
    }
  }
  return singles;
}

async function validateReturnAgainstDeliveredAndReturned(pool, visit, ranges, singles, excludeId = null) {
  const requestedSingles = [...expandAllSingles(ranges, singles)];
  const deliveredSingles = await buildDeliveredSinglesSet(pool, visit);
  const alreadyReturned  = await buildReturnedSinglesSet(pool, visit, excludeId);

  const notDelivered = [];
  const alreadyRet   = [];

  for (const s of requestedSingles) {
    if (!deliveredSingles.has(s)) notDelivered.push(s);
    else if (alreadyReturned.has(s)) alreadyRet.push(s);
  }

  return { notDelivered, alreadyReturned: alreadyRet };
}

// ---------- CREATE ----------
router.post('/', async (req, res) => {
  const { visit, seal_number, damaged_seal_number, lost_seal_number, vessel_supervisor, user_planner, return_notes } = req.body;

  if (!visit || !seal_number || !vessel_supervisor) {
    return res.status(400).json({ error: 'validation', message: 'Missing required fields' });
  }

  try {
    const pool = await poolPromise;
    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    // 1) structural: overlaps/duplicates within returned_seals
    const existing = await buildExistingIndex(pool, visit);
    const conflicts = findConflicts(existing, ranges, singles);
    if (conflicts.overlapRanges.length || conflicts.duplicateSingles.length) {
      return res.status(409).json({
        error: 'duplicate',
        message: 'Overlapping or duplicate returned seals exist in this visit.',
        overlaps: conflicts.overlapRanges,
        singles:  conflicts.duplicateSingles
      });
    }

    // 2) content: must be delivered and not already returned
    const contentCheck = await validateReturnAgainstDeliveredAndReturned(pool, visit, ranges, singles);
    if (contentCheck.notDelivered.length || contentCheck.alreadyReturned.length) {
      return res.status(409).json({
        error: 'invalid_return',
        message: 'Return contains seals that were not delivered or already returned.',
        not_delivered: contentCheck.notDelivered,
        already_returned: contentCheck.alreadyReturned
      });
    }

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    const tx = new sql.Transaction(pool);
    await tx.begin();
    let id;
    try {
      const req1 = new sql.Request(tx);
      req1.input('visit', sql.VarChar, safeStr(visit));
      req1.input('seal_number', sql.VarChar, safeStr(seal_number));
      req1.input('total_count', sql.Int, overallTotal);
      req1.input('damaged_seal_number', sql.VarChar, sanitizeText(damaged_seal_number));
      req1.input('lost_seal_number', sql.VarChar, sanitizeText(lost_seal_number));
      req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
      req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
      req1.input('return_notes', sql.VarChar, sanitizeText(return_notes));
      const result = await req1.query(`
        INSERT INTO returned_seals
          (visit, seal_number, total_count, damaged_seal_number, lost_seal_number,
           vessel_supervisor, user_planner, return_notes)
        OUTPUT INSERTED.id
        VALUES
          (@visit, @seal_number, @total_count, @damaged_seal_number, @lost_seal_number,
           @vessel_supervisor, @user_planner, @return_notes)
      `);
      id = result.recordset[0].id;
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    await auditHelper.logAudit(
      'returned_seals', 'INSERT', id,
      null,
      { visit, seal_number, damaged_seal_number, lost_seal_number, vessel_supervisor, user_planner, return_notes },
      user_planner
    );

    return res.status(201).json({ message: 'Seal(s) returned and saved!', id, overall_total: overallTotal });
  } catch (err) {
    console.error('Error returning seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- UPDATE ----------
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { visit, seal_number, damaged_seal_number, lost_seal_number, vessel_supervisor, user_planner, return_notes } = req.body;

  if (!visit || !seal_number || !vessel_supervisor) {
    return res.status(400).json({ error: 'validation', message: 'Missing required fields' });
  }

  try {
    const pool = await poolPromise;

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM returned_seals WHERE id=@id');
    if (!oldResult.recordset.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const oldData = oldResult.recordset[0];

    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    // 1) structural (excluding this id)
    const existing = await buildExistingIndex(pool, visit, id);
    const conflicts = findConflicts(existing, ranges, singles);
    if (conflicts.overlapRanges.length || conflicts.duplicateSingles.length) {
      return res.status(409).json({
        error: 'duplicate',
        message: 'Overlapping or duplicate returned seals exist in this visit.',
        overlaps: conflicts.overlapRanges,
        singles:  conflicts.duplicateSingles
      });
    }

    // 2) content (excluding this id)
    const contentCheck = await validateReturnAgainstDeliveredAndReturned(pool, visit, ranges, singles, id);
    if (contentCheck.notDelivered.length || contentCheck.alreadyReturned.length) {
      return res.status(409).json({
        error: 'invalid_return',
        message: 'Return contains seals that were not delivered or already returned.',
        not_delivered: contentCheck.notDelivered,
        already_returned: contentCheck.alreadyReturned
      });
    }

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM returned_seals WHERE id=@id');

      const req1 = new sql.Request(tx);
      req1.input('visit', sql.VarChar, safeStr(visit));
      req1.input('seal_number', sql.VarChar, safeStr(seal_number));
      req1.input('total_count', sql.Int, overallTotal);
      req1.input('damaged_seal_number', sql.VarChar, sanitizeText(damaged_seal_number));
      req1.input('lost_seal_number', sql.VarChar, sanitizeText(lost_seal_number));
      req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
      req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
      req1.input('return_notes', sql.VarChar, sanitizeText(return_notes));
      const result = await req1.query(`
        INSERT INTO returned_seals
          (visit, seal_number, total_count, damaged_seal_number, lost_seal_number,
           vessel_supervisor, user_planner, return_notes)
        OUTPUT INSERTED.id
        VALUES
          (@visit, @seal_number, @total_count, @damaged_seal_number, @lost_seal_number,
           @vessel_supervisor, @user_planner, @return_notes)
      `);

      await tx.commit();

      await auditHelper.logAudit('returned_seals', 'UPDATE', id, oldData, result.recordset[0], user_planner);

      return res.json({ message: 'Returned seal updated!', replaced: result.recordset[0], overall_total: overallTotal });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error('Error updating returned seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;

    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM returned_seals WHERE id=@id');
    const oldData = oldResult.recordset[0] || null;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM returned_seals WHERE id=@id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    await auditHelper.logAudit('returned_seals', 'DELETE', id, oldData, null, oldData?.user_planner || 'unknown');

    return res.json({ message: 'Returned seal deleted!' });
  } catch (err) {
    console.error('Error deleting returned seal:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// ---------- READ all ----------
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { visit } = req.query;
    let sqlText = 'SELECT * FROM returned_seals';
    const request = pool.request();
    if (visit) { sqlText += ' WHERE visit=@visit'; request.input('visit', sql.VarChar, visit); }
    sqlText += ' ORDER BY id DESC';
    const result = await request.query(sqlText);
    return res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching returned seals:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
});

module.exports = router;
