// backend/routes/sealLog.js
// only delivered is shown or also returned seals???? make sure the refresh button is functional
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');

// GET /api/seal-log?visit=...&limit=200
router.get('/', async (req, res) => {
  const { visit, limit = 200 } = req.query;

  try {
    const pool = await poolPromise;

    let query = `
      SELECT TOP (@lim)
        change_timestamp,
        table_name,
        action_type,
        changed_by,
        COALESCE(new_data, old_data) AS payload
      FROM dbo.audit_log
      WHERE table_name IN ('delivered_seals','returned_seals')
    `;
    if (visit) {
      query += ` AND JSON_VALUE(COALESCE(new_data, old_data), '$.visit') = @visit`;
    }
    query += ' ORDER BY change_timestamp DESC;';

    const request = pool.request();
    request.input('lim', sql.Int, Number(limit));
    if (visit) request.input('visit', sql.NVarChar(50), visit);

    const r = await request.query(query);

    // format each row to a readable line
    const lines = r.recordset.map(row => {
      let p = {};
      try { p = row.payload ? JSON.parse(row.payload) : {}; } catch {}

      const t = new Date(row.change_timestamp).toLocaleString();
      const who = row.changed_by || p.user_planner || p.return_user_planner || 'Planner';

      if (row.table_name === 'delivered_seals') {
        const seal =
          p.seal_number ? `Seal #${p.seal_number}` :
          (p.single_seal ? `Seal #${p.single_seal}` :
          (p.seal_from && p.seal_to) ? `Seals ${p.seal_from}–${p.seal_to}` : 'Seals');
        const extra = p.delivered_notes ? ` — ${p.delivered_notes}` : '';
        const sup = p.vessel_supervisor ? ` by ${p.vessel_supervisor}` : '';
        if (row.action_type === 'deleted') {
          return `[${t}] ${seal} delivery DELETED by ${who}${sup}${extra}`;
        } else if (row.action_type === 'updated') {
          return `[${t}] ${seal} delivery UPDATED by ${who}${sup}${extra}`;
        }
        return `[${t}] ${seal} delivered by ${who}${sup}${extra}`;
      } else {
        // returned_seals
        const sup = p.vessel_supervisor;
        const supTxt = sup ? ` by ${sup}` : '';
        const extra = p.return_notes ? ` — ${p.return_notes}` : '';

        if (row.action_type === 'deleted') {
          return `[${t}] Seal #${p.seal_number ?? ''} return DELETED by ${who}${supTxt}${extra}`;
        } else if (row.action_type === 'updated') {
          return `[${t}] Seal #${p.seal_number ?? ''} return UPDATED by ${who}${supTxt}${extra}`;
        }

        // If there are damaged/lost
        if (p.damaged_count > 0)
          return `[${t}] Damaged seals (${p.damaged_seal_number}) returned by ${who}${supTxt}${extra}`;
        if (p.lost_count > 0)
          return `[${t}] Lost seals (${p.lost_seal_number}) reported by ${who}${supTxt}${extra}`;

        const seal =
          p.seal_number ? `Seal #${p.seal_number}` :
          (p.return_single_seal ? `Seal #${p.return_single_seal}` :
          (p.return_seal_from && p.return_seal_to) ? `Seals ${p.return_seal_from}–${p.return_seal_to}` : 'Seals');
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