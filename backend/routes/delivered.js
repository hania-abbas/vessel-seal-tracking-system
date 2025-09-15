//delivered.js

const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');
const auditHelper = require('../auditHelper');

const ONLY_6_9 = /^\d{6,9}$/;
const isSeal = s => ONLY_6_9.test((s || '').trim());
const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

// Validation helper
function validateDeliveredSealInput({ visit, seal_number, vessel_supervisor }) {
  const errors = [];
  if (!visit || typeof visit !== 'string' || visit.length < 3) errors.push('visit_required');
  if (!seal_number || typeof seal_number !== 'string' || seal_number.length < 6) errors.push('seal_number_required');
  if (!vessel_supervisor || typeof vessel_supervisor !== 'string' || vessel_supervisor.length < 2) errors.push('supervisor_required');
  return errors;
}

// Sanitizer
function sanitizeText(text, max = 2000) {
  if (!text) return null;
  return String(text).replace(/[<>]/g, '').substring(0, max);
}

function parseMultipleRangesAndSingles(sealInput) {
  const ranges = [];
  const singles = [];
  if(!sealInput) return {ranges, singles};

  const tokens = sealInput.split(/[,\s]+/).map(t => t.trim().filter(Boolean));
  for (const t of tokens) {
    const m = t.match(/^(\d{6,9})-(\d{6,9})$/);
    if(m) {
      const a = m[1], b = m[2];
      if(isSeal(a) && isSeal(b) && toInt(b) >= toInt(a)) {
        ranges.push({from: a, to: b, count: toInt(b) - toInt(a) + 1});
        continue;
      }
    }
    if (isSeal(t)) singles.push(t);
  }
  return { ranges, singles };
}


// Batch parser
function parseSealEntries(sealInput) {
  const entries = [];
  if (!sealInput) return entries;
  for (const part of sealInput.split(',').map(s => s.trim()).filter(Boolean)) {
    if (/^\d{6,9}-\d{6,9}$/.test(part)) {
      const [start, end] = part.split('-').map(Number);
      if (start > 0 && end >= start) entries.push({ seal_number: part, total_count: end - start + 1 });
    } else if (/^\d{6,9}$/.test(part)) {
      entries.push({ seal_number: part, total_count: 1 });
    }
  }
  return entries;
}

// CREATE
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

    const rangesTotal = ranges.reduce((s, r) => s + r.count, 0);
    const singlesTotal = singles.length;
    const overallTotal = rangesTotal + singlesTotal;

    // Build rows: one per range + one row for all singles (if any)
    const rows = [
      ...ranges.map(r => ({ seal_number: `${r.from}-${r.to}`, total_count: overallTotal })),
      ...(singles.length ? [{ seal_number: singles.join(','), total_count: overallTotal }] : [])
    ];

    // duplicate check within visit
    const duplicates = [];
    for (const row of rows) {
      const dupCheck = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, row.seal_number)
        .query('SELECT COUNT(*) AS cnt FROM delivered_seals WHERE visit=@visit AND seal_number=@seal_number');
      if (dupCheck.recordset[0].cnt > 0) duplicates.push(row.seal_number);
    }
    if (duplicates.length) {
      return res.status(409).json({ error: 'duplicate', message: 'Duplicate seal(s)', duplicates });
    }

    // insert transactionally
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, visit);
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

        await auditHelper.logAudit('delivered_seals', 'INSERT', id, null, {
          visit, seal_number: row.seal_number, total_count: row.total_count,
          vessel_supervisor, user_planner, delivered_notes
        }, user_planner);

        inserted.push({ id, seal_number: row.seal_number, total_count: row.total_count });
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    res.status(201).json({ message: 'Seal(s) delivered and saved!', inserted, overall_total: overallTotal });
  } catch (err) {
    console.error('Error delivering seal:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});


// READ all
// READ all (optionally filter by visit)
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { visit } = req.query;

    let sqlText = 'SELECT * FROM delivered_seals';
    const request = pool.request();

    if (visit) {
      sqlText += ' WHERE visit=@visit';
      request.input('visit', sql.VarChar, visit);
    }

    sqlText += ' ORDER BY created_at DESC';

    const result = await request.query(sqlText);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching delivered seals:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});


// READ one
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM delivered_seals WHERE id = @id');
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Seal not found' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error fetching delivered seal:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ************
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

    const overallTotal = ranges.reduce((s, r) => s + r.count, 0) + singles.length;

    const rows = [
      ...ranges.map(r => ({ seal_number: `${r.from}-${r.to}`, total_count: overallTotal })),
      ...(singles.length ? [{ seal_number: singles.join(','), total_count: overallTotal }] : [])
    ];

    // dup check excluding the row being replaced
    for (const row of rows) {
      const dup = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, row.seal_number)
        .input('id', sql.Int, id)
        .query('SELECT COUNT(*) AS cnt FROM delivered_seals WHERE visit=@visit AND seal_number=@seal_number AND id<>@id');
      if (dup.recordset[0].cnt > 0) {
        return res.status(409).json({ error: 'duplicate', message: `Seal number already exists: ${row.seal_number}` });
      }
    }//maybe stored procedure
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const inserted = [];
    try {
      await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM delivered_seals WHERE id=@id');

      for (const row of rows) {
        const req1 = new sql.Request(tx);
        req1.input('visit', sql.VarChar, visit);
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

    res.json({ message: 'Delivered seal updated!', replaced: inserted, overall_total: overallTotal });
  } catch (err) {
    console.error('Error updating delivered seal:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});


// DELETE
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    // Get the old data for logging
    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM delivered_seals WHERE id = @id');
    const oldData = oldResult.recordset[0] ? oldResult.recordset[0] : null;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM delivered_seals WHERE id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Seal not found' });
    }

    await auditHelper.logAudit(
      'delivered_seals',
      'DELETE',
      id,
      oldData,
      null,
      oldData?.user_planner || 'unknown'
    );

    res.json({ message: 'Delivered seal deleted!' });
  } catch (err) {
    console.error('Error deleting delivered seal:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;