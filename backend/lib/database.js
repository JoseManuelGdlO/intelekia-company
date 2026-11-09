const fs = require('fs');
const path = require('path');
const { validateSelect } = require('./sqlGuard');

const MAX_ROWS = 200;
const MAX_CELL_CHARS = 500;
const MAX_RESULT_CHARS = 15000;
const QUERY_TIMEOUT_MS = 8000;
const MAX_LOG = 100;

function truncateCell(value) {
  if (typeof value === 'string' && value.length > MAX_CELL_CHARS) return `${value.slice(0, MAX_CELL_CHARS)}…`;
  if (Buffer.isBuffer(value)) return '[binario]';
  return value;
}

/**
 * Conexión de SOLO LECTURA a la base de datos externa para los agentes.
 * Cada consulta: pasa por sqlGuard, corre dentro de START TRANSACTION READ ONLY con
 * límite de tiempo, se recorta a MAX_ROWS filas y queda registrada en la bitácora.
 */
function createDatabase({ dbConfig, logPath, createPool = (opts) => require('mysql2/promise').createPool(opts), now = () => new Date() }) {
  const configured = Boolean(dbConfig.host && dbConfig.user && dbConfig.name);
  let pool = null;
  let schemaCache = null;
  let log = [];
  if (logPath && fs.existsSync(logPath)) {
    try {
      log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch {
      log = [];
    }
  }

  function getPool() {
    if (!pool) {
      pool = createPool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.name,
        connectionLimit: 2,
        multipleStatements: false,
        dateStrings: true,
        connectTimeout: 10000,
      });
    }
    return pool;
  }

  function record(entry) {
    log.push({ fecha: now().toISOString(), ...entry });
    log = log.slice(-MAX_LOG);
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    }
  }

  function requireConfigured() {
    if (!configured) {
      throw new Error('La base de datos no está configurada: faltan DB_HOST, DB_USER o DB_NAME en backend/.env');
    }
  }

  async function readOnly(fn) {
    const conn = await getPool().getConnection();
    try {
      await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${QUERY_TIMEOUT_MS}`);
      await conn.query('START TRANSACTION READ ONLY');
      return await fn(conn);
    } finally {
      await conn.query('ROLLBACK').catch(() => {});
      conn.release();
    }
  }

  /** Ejecuta un SELECT escrito por un agente. Lanza error con mensaje claro si no es válido. */
  async function query(sql, { agentId = null, motivo = '' } = {}) {
    requireConfigured();
    let statement;
    try {
      statement = validateSelect(sql, {
        allowedTables: dbConfig.allowedTables,
        blockedColumns: dbConfig.blockedColumns,
        databaseName: dbConfig.name,
      });
    } catch (err) {
      record({ agentId, sql, motivo, filas: 0, error: err.message, bloqueada: true });
      throw err;
    }
    try {
      const rows = await readOnly(async (conn) => (await conn.query(statement))[0]);
      const list = Array.isArray(rows) ? rows : [];
      const limited = list.slice(0, MAX_ROWS).map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, truncateCell(v)]))
      );
      record({ agentId, sql: statement, motivo, filas: list.length, error: null });
      return { rows: limited, total: list.length, truncado: list.length > MAX_ROWS };
    } catch (err) {
      record({ agentId, sql: statement, motivo, filas: 0, error: err.message });
      throw err;
    }
  }

  /**
   * Consulta fija definida en el CÓDIGO del backend (nunca escrita por un agente), por eso no
   * pasa por sqlGuard y puede leer columnas bloqueadas para la IA (p. ej. el email de un
   * usuario para notificarle). Igual corre en transacción READ ONLY y queda en la bitácora.
   */
  async function queryInterna(sql, params = [], { etiqueta = 'consulta interna', agentId = null } = {}) {
    requireConfigured();
    try {
      const rows = await readOnly(async (conn) => (await conn.query(sql, params))[0]);
      record({ agentId, sql: `[interna] ${etiqueta}`, motivo: etiqueta, filas: rows.length, error: null });
      return rows;
    } catch (err) {
      record({ agentId, sql: `[interna] ${etiqueta}`, motivo: etiqueta, filas: 0, error: err.message });
      throw err;
    }
  }

  /** Resultado compacto para el modelo (JSON recortado). */
  function formatForModel({ rows, total, truncado }) {
    let text = JSON.stringify({ filas: total, mostradas: rows.length, truncado, datos: rows });
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}… (resultado recortado: pide menos filas o columnas)`;
    }
    return text;
  }

  /** Tablas y columnas visibles para los agentes (sin columnas bloqueadas). Se cachea. */
  async function schema() {
    requireConfigured();
    if (schemaCache) return schemaCache;
    const blocked = new Set(dbConfig.blockedColumns.map((c) => c.toLowerCase()));
    const rows = await readOnly(async (conn) =>
      (
        await conn.query(
          'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION',
          [dbConfig.name, dbConfig.allowedTables]
        )
      )[0]
    );
    const byTable = new Map();
    rows.forEach(({ t, c, tipo }) => {
      if (blocked.has(String(c).toLowerCase())) return;
      if (!byTable.has(t)) byTable.set(t, []);
      byTable.get(t).push(/^enum/.test(tipo) ? `${c} ${tipo}` : c);
    });
    schemaCache = [...byTable.entries()].map(([t, cols]) => `${t}(${cols.join(', ')})`).join('\n');
    return schemaCache;
  }

  async function test() {
    requireConfigured();
    schemaCache = null;
    const tablas = (await schema()).split('\n').filter(Boolean).length;
    return { ok: true, tablas };
  }

  function status() {
    return {
      configurada: configured,
      baseDatos: dbConfig.name || null,
      tablas: dbConfig.allowedTables,
      columnasBloqueadas: dbConfig.blockedColumns,
      usuarioEsRoot: dbConfig.user === 'root',
    };
  }

  function consultas({ agentId, limite = 30 } = {}) {
    const items = agentId ? log.filter((l) => l.agentId === agentId) : log;
    return items.slice(-limite);
  }

  return { isConfigured: () => configured, query, queryInterna, formatForModel, schema, test, status, consultas, MAX_ROWS };
}

module.exports = { createDatabase, MAX_ROWS };
