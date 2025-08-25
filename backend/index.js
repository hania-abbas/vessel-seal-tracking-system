// backend/index.js
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// --- CORS (fix 126.0.0.1 -> 127.0.0.1 and allow x-user) ---
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user'],
}));

// Health + body parsing
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.json());

// --- API routes ---
// NOTE: make sure these files exist and export an Express.Router()
app.use('/api/vessels',         require('./routes/vessels'));      // vessel schedule endpoints
app.use('/api/delivered-seals', require('./routes/delivered'));
app.use('/api/returned-seals',  require('./routes/returned'));
app.use('/api/visits', require('./routes/visit')); // your visit.js file


// You referenced sealLogRoutes; require it explicitly:
const sealLogRoutes = require('./routes/sealLog');
app.use('/api/seal-log', sealLogRoutes);

// 404 for unknown /api paths (return JSON, not HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// --- Static frontend (served from /frontend) ---
app.use(express.static(path.join(__dirname, '../frontend')));

// JSON error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error', message: err.message });
});

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
