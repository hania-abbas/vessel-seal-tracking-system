// backend/db/db.js

const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'VesselSeal',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'h@n!a25',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  connectionTimeout: 30000,
  requestTimeout: 30000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
  },
};

class Database {
  constructor(){ this.pool = null; this.connected = false; }
  async connect() {
    if (this.connected && this.pool) return this.pool;
    this.pool = await new sql.ConnectionPool(config).connect();
    this.connected = true;
    await this.pool.request().query('SELECT 1'); // sanity probe
    return this.pool;
  }
  async getPool(){ return this.connected && this.pool ? this.pool : this.connect(); }
  async close(){ if (this.pool) { await this.pool.close(); this.connected = false; } }
}

const database = new Database();

// Export a real Promise (best for your case)
const poolPromise = database.getPool();

process.on('SIGINT', async () => { await database.close(); process.exit(0); });

module.exports = { sql, poolPromise, database };
