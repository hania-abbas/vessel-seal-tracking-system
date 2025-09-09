//delivered.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');
const auditHelper = require('../auditHelper');

// Helper: Validate and sanitize delivered seal input
function validateDeliveredSealInput({ visit, seal_number, vessel_supervisor }) {
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

// Helper: parse seal input "1234516-1234518,8812340"
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

// --- CREATE ---
router.post('/', async (req, res) => {
  const {
    visit,
    seal_number, // e.g. "1234516-1234518,8812340"
    vessel_supervisor,
    user_planner,
    created_at,
    delivered_notes
  } = req.body;

  const errors = validateDeliveredSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;
    const sealEntries = parseSealEntries(seal_number);

    if (!sealEntries.length) return res.status(400).json({ error: 'no_valid_seal_entries' });

    const duplicates = [];
    for (const entry of sealEntries) {
      const dupCheck = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, entry.seal_number)
        .query('SELECT COUNT(*) AS cnt FROM delivered_seals WHERE visit=@visit AND seal_number=@seal_number');
      if (dupCheck.recordset[0].cnt > 0) duplicates.push(entry.seal_number);
    }
    if (duplicates.length) {
      return res.status(409).json({ error: 'duplicate', message: 'Duplicate seal(s)', duplicates });
    }

    for (const entry of sealEntries) {
      const result = await pool.request()
        .input('visit', sql.VarChar, visit)
        .input('seal_number', sql.VarChar, entry.seal_number)
        .input('total_count', sql.Int, entry.total_count)
        .input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100))
        .input('user_planner', sql.VarChar, sanitizeText(user_planner, 100))
        .input('created_at', sql.DateTime, created_at || new Date())
        .input('delivered_notes', sql.VarChar, sanitizeText(delivered_notes))
        .query(`
          INSERT INTO delivered_seals
            (visit, seal_number, total_count, vessel_supervisor, user_planner, created_at, delivered_notes)
          VALUES
            (@visit, @seal_number, @total_count, @vessel_supervisor, @user_planner, @created_at, @delivered_notes)
        `);

      await auditHelper.logAudit(
        'delivered_seals',
        'delivered',
        null,
        null,
        {
          visit,
          seal_number: entry.seal_number,
          total_count: entry.total_count,
          vessel_supervisor,
          user_planner,
          delivered_notes
        },
        user_planner
      );
    }

    res.status(201).json({ message: 'Seal(s) delivered and saved!', count: sealEntries.length });
  } catch (err) {
    console.error('Error delivering seal:', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// --- READ: Get all delivered seals ---
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query('SELECT * FROM delivered_seals ORDER BY created_at DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching delivered seals:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- READ: Get one delivered seal by ID ---
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

// --- UPDATE: Update delivered seal by ID ---
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    visit,
    seal_number,
    total_count,
    vessel_supervisor,
    user_planner,
    created_at,
    delivered_notes
  } = req.body;

  const errors = validateDeliveredSealInput({ visit, seal_number, vessel_supervisor });
  if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

  try {
    const pool = await poolPromise;

    // Check for duplicate seal_number except for this record
    const dupCheck = await pool.request()
      .input('visit', sql.VarChar, visit)
      .input('seal_number', sql.VarChar, seal_number)
      .input('id', sql.Int, id)
      .query('SELECT COUNT(*) AS cnt FROM delivered_seals WHERE visit=@visit AND seal_number=@seal_number AND id<>@id');
    if (dupCheck.recordset[0].cnt > 0) {
      return res.status(409).json({ error: 'duplicate', message: 'Seal number already exists for this visit.' });
    }

    // Get old data for audit
    const oldResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM delivered_seals WHERE id=@id');
    const oldData = oldResult.recordset[0] || null;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('visit', sql.VarChar, visit)
      .input('seal_number', sql.VarChar, seal_number)
      .input('total_count', sql.Int, total_count)
      .input('vessel_supervisor', sql.VarChar, sanitizeText(vessel_supervisor, 100))
      .input('user_planner', sql.VarChar, sanitizeText(user_planner, 100))
      .input('created_at', sql.DateTime, created_at || new Date())
      .input('delivered_notes', sql.VarChar, sanitizeText(delivered_notes))
      .query(`
        UPDATE delivered_seals
        SET
          visit = @visit,
          seal_number = @seal_number,
          total_count = @total_count,
          vessel_supervisor = @vessel_supervisor,
          user_planner = @user_planner,
          created_at = @created_at,
          delivered_notes = @delivered_notes
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Seal not found' });
    }

    await auditHelper.logAudit(
      'delivered_seals',
      'updated',
      id,
      oldData,
      {
        id,
        visit,
        seal_number,
        total_count,
        vessel_supervisor,
        user_planner,
        delivered_notes
      },
      user_planner
    );

    res.json({ message: 'Delivered seal updated!' });
  } catch (err) {
    console.error('Error updating delivered seal:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- DELETE: Delete delivered seal by ID ---
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
      'deleted',
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