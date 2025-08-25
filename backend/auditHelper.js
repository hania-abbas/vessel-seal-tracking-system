// backend/auditHelper.js
const { sql, poolPromise } = require('./db/db');  // adjust path if needed

async function logAudit(tableName, actionType, recordId, oldData, newData, changedBy) {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('tableName', sql.VarChar, tableName)
      .input('actionType', sql.VarChar, actionType)
      .input('recordId', sql.Int, recordId)
      .input('oldData', sql.NVarChar, JSON.stringify(oldData))
      .input('newData', sql.NVarChar, JSON.stringify(newData))
      .input('changedBy', sql.VarChar, changedBy)
      .query(`
        INSERT INTO audit_log (table_name, action_type, record_id, old_data, new_data, changed_by, change_timestamp)
        VALUES (@tableName, @actionType, @recordId, @oldData, @newData, @changedBy, GETDATE())
      `);
  } catch (err) {
    console.error("Error logging audit:", err.message);
  }
}

// add this under module.exports
async function getRow(table, pkName, id) {
  const { sql, poolPromise } = require('./db/db');
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT TOP(1) * FROM ${table} WHERE ${pkName} = @id;`);
  return r.recordset[0] || null;
}

module.exports = { logAudit, getRow };

