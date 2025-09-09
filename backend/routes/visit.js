//visit.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/db');

// GET /api/visits/active
router.get('/active', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 1 Visit
      FROM dbo.VesselVisitSeal
      WHERE Visit IS NOT NULL
      ORDER BY LastUpdate DESC;
    `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: 'no_active_visit' });
    }

    res.json({ visit: result.recordset[0].Visit });
  } catch (err) {
    console.error('Error fetching visit:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
