// backend/db/db.js

const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'VesselSeal',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'h@n!a25',
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    connectTimeout: 30000,
    requestTimeout: 30000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  }
};

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.pool = await new sql.ConnectionPool(config).connect();
      this.connected = true;
      console.log('✅ Database connected successfully');
      
      // Test connection
      await this.pool.request().query('SELECT 1 as test');
      return this.pool;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      throw error;
    }
  }

  async getPool() {
    if (!this.connected) {
      await this.connect();
    }
    return this.pool;
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.connected = false;
      console.log('Database connection closed');
    }
  }

  // Health check
  async healthCheck() {
    try {
      const pool = await this.getPool();
      const result = await pool.request().query('SELECT 1 as health_check');
      return { healthy: true, message: 'Database connection is healthy' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }
}

// Create singleton instance
const database = new Database();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await database.close();
  process.exit(0);
});

module.exports = { database, sql };