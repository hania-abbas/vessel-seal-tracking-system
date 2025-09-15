// backend/routes/returned.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');
const auditHelper = require('../auditHelper');

// Regex helpers
const RE_SEAL = /^[0-9]{6,9}$/;
const RE_SEAL_RANGE = /^[0-9]{6,9}-[0-9]{6,9}$/;

const ONLY_6_9 = /^\d{6,9}$/;
const isSeal = s => ONLY_6_9.test((s || '').trim());
const toInt = v => {const n = parseInt(v,10); return Number.isFinite(n) ? n : null;};

function parseMultipleRangesAndSingles(sealInput) {
  const ranges = [];
  const singles = [];
  if (!sealInput) return { ranges, singles };
  const tokens = sealInput.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  for (const t of tokens) {
    const m = t.match(/^(\d{6,9})-(\d{6,9})$/);
    if (m) {
      const a = m[1], b = m[2];
      if (isSeal(a) && isSeal(b) && toInt(b) >= toInt(a)) {
        ranges.push({ from: a, to: b, count: toInt(b) - toInt(a) + 1});
        continue;
      }
    }
    if (isSeal(t)) singles.push(t);
  }
  return { ranges, singles };
}
const parseSingleCSV = s => (s ? s.split(',').map(x => x.trim()).filter(isSeal) : []);

// Validation
function validateReturnedSealInput({ visit, seal_number, vessel_supervisor }) {
  const errors = [];
  if (!visit || typeof visit !== 'string' || visit.length < 3) errors.push('visit_required');
  if (!seal_number || typeof seal_number !== 'string' || seal_number.length < 6) errors.push('seal_number_required');
  if (!vessel_supervisor || typeof vessel_supervisor !== 'string' || vessel_supervisor.length < 2) errors.push('supervisor_required');
  return errors;
}
function sanitizeText(text, max = 2000) {
  if (!text) return null;
  return String(text).replace(/[<>]/g, '').substring(0, max);
}

// Batch parser
function parseReturnedEntries(str) {
  const entries = [];
  if (!str) return entries;
  for (const part of str.split(',').map(s => s.trim()).filter(Boolean)) {
    if (RE_SEAL_RANGE.test(part)) {
      const [start, end] = part.split('-').map(Number);
      if (end >= start) {
        entries.push({ seal_number: part, total_count: end - start + 1 });
      }
    } else if (RE_SEAL.test(part)) {
      entries.push({ seal_number: part, total_count: 1 });
    }
  }
  return entries;
}
function parseSingles(str) {
  return str
    ? str.split(',').map(s => s.trim()).filter(s => RE_SEAL.test(s))
    : [];
}

// CREATE
router.post('/', async (req, res) => {
  const {
    visit,
    seal_number,             // mixed tokens: ranges + singles
    damaged_seal_number,     // comma singles only
    lost_seal_number,        // comma singles only
    vessel_supervisor,
    return_notes,
    user_planner
  } = req.body;

  const errors = validateReturnedSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;

    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    const damagedList = parseSinglesCSV(damaged_seal_number);
    const lostList    = parseSinglesCSV(lost_seal_number);

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    // Build rows: one per range + (optional) singles row
    // Option A: attach damaged/lost to singles row if exists, else to the FIRST range row only
    const rows = ranges.map((r, idx) => ({
      seal_number: `${r.from}-${r.to}`,
      total_count: overallTotal,
      damaged_seal_number: singles.length ? null : (idx === 0 ? (damagedList.join(',') || null) : null),
      damaged_count:        singles.length ? 0    : (idx === 0 ? damagedList.length : 0),
      lost_seal_number:     singles.length ? null : (idx === 0 ? (lostList.join(',') || null) : null),
      lost_count:           singles.length ? 0    : (idx === 0 ? lostList.length : 0),
    }));
    if (singles.length) {
      rows.push({
        seal_number: singles.join(','),
        total_count: overallTotal,
        damaged_seal_number: damagedList.join(',') || null,
        damaged_count: damagedList.length,
        lost_seal_number:  lostList.join(',') || null,
        lost_count:        lostList.length,
      });
    }

    // duplicates
    const duplicates = [];
    for (const row of rows) {
      const dupCheck = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, row.seal_number)
        .query('SELECT COUNT(*) AS cnt FROM returned_seals WHERE visit=@visit AND seal_number=@seal_number');
      if (dupCheck.recordset[0].cnt > 0) duplicates.push(row.seal_number);
    }
    if (duplicates.length) {
      return res.status(409).json({ error: 'duplicate', message: 'Duplicate returned seal(s)', duplicates });
    }

    // insert
    // maybe stored procedure
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, visit);
        req1.input('seal_number', sql.VarChar, row.seal_number);
        req1.input('total_count', sql.Int, row.total_count);
        req1.input('damaged_seal_number', sql.VarChar, sanitizeText(row.damaged_seal_number));
        req1.input('damaged_count', sql.Int, row.damaged_count || 0);
        req1.input('lost_seal_number', sql.VarChar, sanitizeText(row.lost_seal_number));
        req1.input('lost_count', sql.Int, row.lost_count || 0);
        req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
        req1.input('created_at', sql.DateTime, new Date());
        req1.input('return_notes', sql.VarChar, sanitizeText(return_notes));
        req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
        const result = await req1.query(`
          INSERT INTO returned_seals
            (visit, seal_number, total_count, damaged_seal_number, damaged_count, lost_seal_number, lost_count, vessel_supervisor, created_at, return_notes, user_planner)
          OUTPUT INSERTED.id
          VALUES
            (@visit, @seal_number, @total_count, @damaged_seal_number, @damaged_count, @lost_seal_number, @lost_count, @vessel_supervisor, @created_at, @return_notes, @user_planner)
        `);
        inserted.push({ id: result.recordset[0].id, visit, ...row });
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    res.status(201).json({ inserted, count: inserted.length, overall_total: overallTotal });
  } catch (err) {
    console.error('POST /returned-seals error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});


// READ all
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { visit } = req.query;
    let query = 'SELECT * FROM returned_seals';
    if (visit) {
      query += ' WHERE visit=@visit ORDER BY created_at DESC';
    } else {
      query += ' ORDER BY created_at DESC';
    }
    const request = pool.request();
    if (visit) request.input('visit', sql.VarChar, visit);
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /returned-seals error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// READ one
router.get('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { id } = req.params;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM returned_seals WHERE id=@id');
    if (!result.recordset.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('GET /returned-seals/:id error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// UPDATE
router.put('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { id } = req.params;

    const {
      visit, seal_number, vessel_supervisor, created_at,
      return_notes, user_planner, damaged_seal_number, lost_seal_number
    } = req.body;

    const errors = validateReturnedSealInput({ visit, seal_number, vessel_supervisor });
    if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

    const oldResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM returned_seals WHERE id=@id');
    if (!oldResult.recordset.length) return res.status(404).json({ error: 'not_found' });
    const oldData = oldResult.recordset[0];

    const { ranges, singles } = parseMultipleRangesAndSingles(seal_number);
    if (ranges.length === 0 && singles.length === 0) {
      return res.status(400).json({ error: 'no_valid_seal_entries' });
    }

    const damagedList = parseSinglesCSV(damaged_seal_number);
    const lostList    = parseSinglesCSV(lost_seal_number);
    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    const rows = ranges.map((r, idx) => ({
      seal_number: `${r.from}-${r.to}`,
      total_count: overallTotal,
      damaged_seal_number: singles.length ? null : (idx === 0 ? (damagedList.join(',') || null) : null),
      damaged_count:        singles.length ? 0    : (idx === 0 ? damagedList.length : 0),
      lost_seal_number:     singles.length ? null : (idx === 0 ? (lostList.join(',') || null) : null),
      lost_count:           singles.length ? 0    : (idx === 0 ? lostList.length : 0),
    }));
    if (singles.length) {
      rows.push({
        seal_number: singles.join(','),
        total_count: overallTotal,
        damaged_seal_number: damagedList.join(',') || null,
        damaged_count: damagedList.length,
        lost_seal_number:  lostList.join(',') || null,
        lost_count:        lostList.length,
      });
    }

    // dup check excluding the row being replaced
    for (const row of rows) {
      const dup = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, row.seal_number)
        .input('id', sql.Int, id)
        .query('SELECT COUNT(*) AS cnt FROM returned_seals WHERE visit=@visit AND seal_number=@seal_number AND id<>@id');
      if (dup.recordset[0].cnt > 0) {
        return res.status(409).json({ error: 'duplicate', message: `Seal number already exists for this visit: ${row.seal_number}` });
      }
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM returned_seals WHERE id=@id');

      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, visit);
        req1.input('seal_number', sql.VarChar, row.seal_number);
        req1.input('total_count', sql.Int, row.total_count);
        req1.input('damaged_seal_number', sql.VarChar, sanitizeText(row.damaged_seal_number));
        req1.input('damaged_count', sql.Int, row.damaged_count || 0);
        req1.input('lost_seal_number', sql.VarChar, sanitizeText(row.lost_seal_number));
        req1.input('lost_count', sql.Int, row.lost_count || 0);
        req1.input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100));
        req1.input('created_at', sql.DateTime, created_at || new Date());
        req1.input('return_notes', sql.VarChar, sanitizeText(return_notes));
        req1.input('user_planner', sql.VarChar, sanitizeText(user_planner, 100));
        const result = await req1.query(`
          INSERT INTO returned_seals
            (visit, seal_number, total_count, damaged_seal_number, damaged_count, lost_seal_number, lost_count, vessel_supervisor, created_at, return_notes, user_planner)
          OUTPUT INSERTED.id
          VALUES
            (@visit, @seal_number, @total_count, @damaged_seal_number, @damaged_count, @lost_seal_number, @lost_count, @vessel_supervisor, @created_at, @return_notes, @user_planner)
        `);
        inserted.push({ id: result.recordset[0].id, visit, ...row });
      }

      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    await auditHelper.logAudit('returned_seals', 'UPDATE', id, oldData, { new_rows: inserted }, user_planner);

    res.json({ message: 'Returned seal updated!', replaced: inserted, overall_total: overallTotal });
  } catch (err) {
    console.error('PUT /returned-seals/:id error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});


// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { id } = req.params;
    // Get the old data for logging
    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM returned_seals WHERE id=@id');
    const oldData = oldResult.recordset[0] ? oldResult.recordset[0] : null;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM returned_seals WHERE id=@id');
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    await auditHelper.logAudit(
      'returned_seals',
      'DELETE',
      id,
      oldData,
      null,
      oldData?.user_planner || 'unknown'
    );

    res.json({ message: 'Returned seal deleted!' });
  } catch (err) {
    console.error('DELETE /returned-seals/:id error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

module.exports = router;