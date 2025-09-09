// backend/routes/returned.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');
const auditHelper = require('../auditHelper');

// Regex helpers
const RE_SEAL = /^[0-9]{6,9}$/;
const RE_SEAL_RANGE = /^[0-9]{6,9}-[0-9]{6,9}$/;

// --- Validation & Sanitization ---
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

// --- Helpers ---
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
    // ignore invalid
  }
  return entries;
}
function parseSingles(str) {
  return str
    ? str.split(',').map(s => s.trim()).filter(s => RE_SEAL.test(s))
    : [];
}

// --- CREATE: Save returned seals (can save multiple entries for one request) ---
router.post('/', async (req, res) => {
  const {
    visit,
    seal_number,
    damaged_seal_number,
    lost_seal_number,
    vessel_supervisor,
    return_notes,
    user_planner
  } = req.body;

  const errors = validateReturnedSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;
    const returnedEntries = parseReturnedEntries(seal_number);
    if (!returnedEntries.length) return res.status(400).json({ error: 'no_valid_seal_entries' });

    const damagedList = parseSingles(damaged_seal_number);
    const lostList = parseSingles(lost_seal_number);

    // Duplicate detection for returned seals
    const duplicates = [];
    for (const entry of returnedEntries) {
      const dupCheck = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, entry.seal_number)
        .query('SELECT COUNT(*) AS cnt FROM returned_seals WHERE visit=@visit AND seal_number=@seal_number');
      if (dupCheck.recordset[0].cnt > 0) duplicates.push(entry.seal_number);
    }
    if (duplicates.length) {
      return res.status(409).json({ error: 'duplicate', message: 'Duplicate returned seal(s)', duplicates });
    }

    const results = [];
    for (const entry of returnedEntries) {
      await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, entry.seal_number)
        .input('total_count', sql.Int, entry.total_count)
        .input('damaged_seal_number', sql.VarChar, damagedList.join(',') || null)
        .input('damaged_count', sql.Int, damagedList.length)
        .input('lost_seal_number', sql.VarChar, lostList.join(',') || null)
        .input('lost_count', sql.Int, lostList.length)
        .input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100))
        .input('created_at', sql.DateTime, new Date())
        .input('return_notes', sql.VarChar, sanitizeText(return_notes))
        .input('user_planner', sql.VarChar, sanitizeText(user_planner, 100))
        .query(`
          INSERT INTO returned_seals
            (visit, seal_number, total_count, damaged_seal_number, damaged_count, lost_seal_number, lost_count, vessel_supervisor, created_at, return_notes, user_planner)
          VALUES
            (@visit, @seal_number, @total_count, @damaged_seal_number, @damaged_count, @lost_seal_number, @lost_count, @vessel_supervisor, @created_at, @return_notes, @user_planner)
        `);

      await auditHelper.logAudit(
        'returned_seals',
        'returned',
        null,
        null,
        {
          visit,
          seal_number: entry.seal_number,
          total_count: entry.total_count,
          damaged_seal_number: damagedList.join(',') || null,
          damaged_count: damagedList.length,
          lost_seal_number: lostList.join(',') || null,
          lost_count: lostList.length,
          vessel_supervisor,
          return_notes,
          user_planner
        },
        user_planner
      );
      results.push(entry);
    }

    res.status(201).json({ inserted: results, count: results.length });
  } catch (err) {
    console.error('POST /returned-seals error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// --- READ: Get all returned seals (optionally filter by visit) ---
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

// --- READ: Get one returned seal by ID ---
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

// --- UPDATE: Update a returned seal by ID ---
router.put('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const { id } = req.params;
    const {
      visit,
      seal_number,
      total_count,
      damaged_seal_number,
      damaged_count,
      lost_seal_number,
      lost_count,
      vessel_supervisor,
      created_at,
      return_notes,
      user_planner
    } = req.body;

    const errors = validateReturnedSealInput({ visit, seal_number, vessel_supervisor });
    if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

    // Duplicate detection (exclude this record)
    const dupCheck = await pool.request()
      .input('visit', sql.VarChar, visit)
      .input('seal_number', sql.VarChar, seal_number)
      .input('id', sql.Int, id)
      .query('SELECT COUNT(*) AS cnt FROM returned_seals WHERE visit=@visit AND seal_number=@seal_number AND id<>@id');
    if (dupCheck.recordset[0].cnt > 0) {
      return res.status(409).json({ error: 'duplicate', message: 'Seal number already exists for this visit.' });
    }

    // Get old data for audit
    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM returned_seals WHERE id=@id');
    const oldData = oldResult.recordset[0] || null;

    // Optionally recalc total_count if not given
    let calc_total = total_count;
    if (!calc_total && seal_number) {
      if (RE_SEAL_RANGE.test(seal_number)) {
        const [start, end] = seal_number.split('-').map(Number);
        calc_total = (end >= start) ? (end - start + 1) : 1;
      } else if (RE_SEAL.test(seal_number)) {
        calc_total = 1;
      }
    }

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('visit', sql.VarChar, visit)
      .input('seal_number', sql.VarChar, seal_number)
      .input('total_count', sql.Int, calc_total)
      .input('damaged_seal_number', sql.VarChar, sanitizeText(damaged_seal_number))
      .input('damaged_count', sql.Int, damaged_count || 0)
      .input('lost_seal_number', sql.VarChar, sanitizeText(lost_seal_number))
      .input('lost_count', sql.Int, lost_count || 0)
      .input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100))
      .input('created_at', sql.DateTime, created_at || new Date())
      .input('return_notes', sql.VarChar, sanitizeText(return_notes))
      .input('user_planner', sql.VarChar, sanitizeText(user_planner, 100))
      .query(`
        UPDATE returned_seals SET
          visit=@visit,
          seal_number=@seal_number,
          total_count=@total_count,
          damaged_seal_number=@damaged_seal_number,
          damaged_count=@damaged_count,
          lost_seal_number=@lost_seal_number,
          lost_count=@lost_count,
          vessel_supervisor=@vessel_supervisor,
          created_at=@created_at,
          return_notes=@return_notes,
          user_planner=@user_planner
        WHERE id=@id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    await auditHelper.logAudit(
      'returned_seals',
      'updated',
      id,
      oldData,
      {
        id,
        visit,
        seal_number,
        total_count: calc_total,
        damaged_seal_number,
        damaged_count,
        lost_seal_number,
        lost_count,
        vessel_supervisor,
        return_notes,
        user_planner
      },
      user_planner
    );

    res.json({ message: 'Returned seal updated!' });
  } catch (err) {
    console.error('PUT /returned-seals/:id error:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// --- DELETE: Delete a returned seal by ID ---
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
      'deleted',
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