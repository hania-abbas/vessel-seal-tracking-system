// backend/auditHelper.js
// inserting audit logs 
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

  async logAudit(tableName, actionType, recordId, oldData, newData, changedBy, additionalInfo = {}) {
    if (!this.initialized) {
      console.warn('Audit helper not initialized, skipping audit log');
      return;
    }

    try {
      const pool = await database.getPool();
      
      await pool.request()
        .input('tableName', sql.VarChar(100), tableName)
        .input('actionType', sql.VarChar(20), actionType)
        .input('recordId', sql.Int, recordId)
        .input('oldData', sql.NVarChar(sql.MAX), oldData ? JSON.stringify(oldData) : null)
        .input('newData', sql.NVarChar(sql.MAX), newData ? JSON.stringify(newData) : null)
        .input('changedBy', sql.VarChar(255), changedBy || 'system')
        .input('userIp', sql.VarChar(45), additionalInfo.ip || null)
        .input('userAgent', sql.VarChar(500), additionalInfo.userAgent || null)
        .input('correlationId', sql.VarChar(100), additionalInfo.correlationId || null)
        .query(`
          INSERT INTO audit_log (
            table_name, action_type, record_id, old_data, new_data, 
            changed_by, user_ip, user_agent, correlation_id, change_timestamp
          ) 
          VALUES (
            @tableName, @actionType, @recordId, @oldData, @newData,
            @changedBy, @userIp, @userAgent, @correlationId, SYSUTCDATETIME()
          )
        `);

    } catch (error) {
      console.error('📝 Audit log failed:', error.message);
      // Don't throw - audit failures shouldn't break main operations
    }
  }

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
            old_data, new_data, user_ip, user_agent
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