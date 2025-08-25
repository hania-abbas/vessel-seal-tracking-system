// backend/db/db.js
// creates a single mssql connection pool and exports
const sql = require('mssql');

const config = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || "h@n!a25",
  server: process.env.DB_SERVER || "localhost",
  database:process.env.DB_NAME || "VesselSeal",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const pool = new sql.ConnectionPool(config);

const poolPromise = pool.connect().then(p => 
{
  console.log('MSSQL connected');
  return p;

})
.catch(err => {
  console.error('MSSQL connection failed:', err);
  throw err;
})

module.exports = {sql, poolPromise}