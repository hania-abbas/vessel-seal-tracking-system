// backend/auditHelper.js

const { database, sql } = require('./db/db');

class AuditHelper {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    try {
      await database.getPool();
      this.initialized = true;
      console.log('✅ Audit helper initialized');
    } catch (error) {
      console.error('❌ Audit helper initialization failed:', error);
    }
  }

  /**
   * Logs an audit event using the stored procedure sp_insert_audit_log.
   * @param {string} tableName 
   * @param {string} actionType 
   * @param {number|null} recordId 
   * @param {object|null} oldData 
   * @param {object|null} newData 
   * @param {string} changedBy 
   */
  async logAudit(tableName, actionType, recordId, oldData, newData, changedBy) {
    if (!this.initialized) {
      console.warn('Audit helper not initialized, skipping audit log');
      return;
    }

    try {
      const pool = await database.getPool();

      await pool.request()
        .input('table_name', sql.VarChar(100), tableName)
        .input('action_type', sql.VarChar(10), actionType)
        .input('record_id', sql.Int, recordId)
        .input('changed_by', sql.VarChar(100), changedBy || 'unknown')
        .input('old_data', sql.NVarChar(sql.MAX), oldData ? JSON.stringify(oldData) : null)
        .input('new_data', sql.NVarChar(sql.MAX), newData ? JSON.stringify(newData) : null)
        .execute('sp_insert_audit_log');

    } catch (error) {
      console.error('📝 Audit log failed:', error.message);
      // Don't throw - audit failures shouldn't break main operations
    }
  }

  /**
   * Gets a row from any table by primary key.
   */
  async getRow(table, pkName, id) {
    try {
      const pool = await database.getPool();
      const result = await pool.request()
        .input('id', sql.Int, id)
        .query(`
          SELECT * FROM ${table} 
          WHERE ${pkName} = @id
        `);
      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error getting row:', error);
      return null;
    }
  }

  /**
   * Gets audit logs for a specific table and record.
   */
  async getAuditLogs(tableName, recordId, limit = 100) {
    try {
      const pool = await database.getPool();
      const result = await pool.request()
        .input('tableName', sql.VarChar(100), tableName)
        .input('recordId', sql.Int, recordId)
        .input('limit', sql.Int, limit)
        .query(`
          SELECT TOP (@limit) 
            change_timestamp, action_type, changed_by, 
            old_data, new_data
          FROM audit_log 
          WHERE table_name = @tableName AND record_id = @recordId
          ORDER BY change_timestamp DESC
        `);
      return result.recordset;
    } catch (error) {
      console.error('Error getting audit logs:', error);
      return [];
    }
  }
}

// Create singleton instance
const auditHelper = new AuditHelper();

// Initialize when database is ready
database.getPool().then(() => auditHelper.initialize());

module.exports = auditHelper;