// backend/index.js

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');              
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { database } = require('./db/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // IMPORTANT: allow XHR/fetch to your API
        connectSrc: ["'self'"],
        // You already serve CSS/JS/fonts locally
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        // If you see websocket errors during local dev, uncomment:
        // connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false, // keeps devtools happy in local dev
  })
);


// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Middleware
app.use(compression());
app.use(morgan('combined'));
app.use(cors({
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://localhost:3809',
    'http://127.0.0.1:3809'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/api/health', async (req, res) => {
  try {
    let dbHealth = { status: 'unknown'};
    if (database && typeof database.healthCheck =='function') {
      dbHealth = await database.healthCheck();
    } else if (database && typeof database.connect === 'function') {
      dbHealth = {status: 'assumed-up'}
    } else{
      dbHealth = {status: 'skipped', reason: 'no heathCheck() in db module'};
    }

    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(200).json({ status: 'DEGRADED', error: error.message });
  }
});

// Serve static files from frontend
const frontDir = path.join(__dirname, '../frontend');
console.log('Serving static from:', frontDir);
app.use(express.static(frontDir));             //  keep just one

// explicit root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});



// Auth & routes
app.use('/api/login', require('./routes/login'));

//const authenticateJWT = require('./middleware/auth');
//app.use('/api', authenticateJWT); // before API routes

// API Routes
app.use('/api/delivered-seals', require('./routes/delivered'));
app.use('/api/returned-seals', require('./routes/returned'));
app.use('/api/visits', require('./routes/visit'));
app.use('/api/vessels', require('./routes/vessels'));
app.use('/api/seal-log', require('./routes/sealLog'));

//debug 
app.post('/api/debug-echo', (req, res) => {
  console.log('DEBUG ECHO BODY:' , req.body);
  res.json({ ok: true, echo: req.body, time: new Date().toISOString() });
});

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /api/health',
      'GET /api/vessels',
      'POST /api/delivered-seals',
      'POST /api/returned-seals',
      'GET /api/seal-log',
      'GET /api/visits/active'
    ]
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('🚨 Error:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'invalid_json',
      message: 'Invalid JSON payload'
    });
  }

  res.status(error.status || 500).json({
    error: 'server_error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Start server with database connection
async function startServer() {
  try {
    await database.connect();
    if (database && typeof database.connect === 'function') {
      await database.connect();
    }
    app.listen(PORT, () => {
      console.log(`
🚀 Vessel Seal Tracking Server Started!
📍 Port: ${PORT}
📊 API Health: http://localhost:${PORT}/api/health
📁 Frontend: http://localhost:${PORT}
⏰ Started: ${new Date().toISOString()}
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Uncaught/unhandled
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
