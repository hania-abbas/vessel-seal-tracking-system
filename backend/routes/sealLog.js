// backend/routes/sealLog.js
const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../db/db');

// GET /api/seal-log?visit=...&limit=200
router.get('/', async (req, res) => {
  const { visit, limit = 200 } = req.query;

  try {
    const pool = await poolPromise;

    const query = `
      SELECT TOP (@lim)
        change_timestamp,
        table_name,
        action_type,
        changed_by,
        COALESCE(new_data, old_data) AS payload
      FROM dbo.audit_log
      WHERE table_name IN ('delivered_seals','returned_seals')
        ${visit ? `AND JSON_VALUE(COALESCE(new_data, old_data), '$.visit') = @visit` : ''}
      ORDER BY change_timestamp DESC;
    `;

    const r = await pool.request()
      .input('lim', sql.Int, Number(limit))
      .input('visit', sql.NVarChar(50), visit || null)
      .query(query);

    // format each row to a readable line
    const lines = r.recordset.map(row => {
      let p = {};
      try { p = row.payload ? JSON.parse(row.payload) : {}; } catch {}

      const t = new Date(row.change_timestamp).toLocaleString();
      const who = row.changed_by || p.user_planner || p.return_user_planner || 'Planner';

      if (row.table_name === 'delivered_seals') {
        const seal =
          p.single_seal ? `Seal #${p.single_seal}` :
          (p.seal_from && p.seal_to) ? `Seals ${p.seal_from}–${p.seal_to}` :
          (p.seal_number ? `Seal #${p.seal_number}` : 'Seals');
        const extra = p.delivered_notes ? ` — ${p.delivered_notes}` : '';
        const sup = p.vessel_supervisor ? ` by ${p.vessel_supervisor}` : '';
        return `[${t}] ${seal} delivered by ${who}${sup}${extra}`;
      } else {
        // returned_seals
        const sup = p.return_vessel_superior || p.vessel_supervisor;
        const supTxt = sup ? ` by ${sup}` : '';
        const extra = p.return_notes ? ` — ${p.return_notes}` : '';

        if (p.damaged) return `[${t}] Seal #${p.damaged_seal ?? ''} returned DAMAGED by ${who}${supTxt}${extra}`;
        if (p.lost)    return `[${t}] Seal #${p.lost_seal ?? ''} reported LOST by ${who}${supTxt}${extra}`;

        const seal =
          p.return_single_seal ? `Seal #${p.return_single_seal}` :
          (p.return_seal_from && p.return_seal_to) ? `Seals ${p.return_seal_from}–${p.return_seal_to}` :
          (p.seal_number ? `Seal #${p.seal_number}` : 'Seals');
        return `[${t}] ${seal} returned by ${who}${supTxt}${extra}`;
      }
    });

    res.json({ visit: visit || null, lines });
  } catch (e) {
    console.error('GET /api/seal-log error:', e);
    res.status(500).json({ error: 'Failed to read seal log' });
  }
});

module.exports = router;
