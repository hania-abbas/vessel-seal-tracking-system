// backend/routes/vessels.js
//file that has the api to get VesselVisitSeal data
// backend/routes/vessels.js
const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../db/db');

// GET /api/vessels - Fetch all vessel visits
router.get('/', async (req, res) => {
  try {
    const pool= await poolPromise;
    const result = await pool.query(`
      SELECT 
        VesselRefNo,
        Visit,
        VesselName,
        Status,
        ATA
      FROM VesselVisitSeal
      ORDER BY VesselRefNo DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching vessel data:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

