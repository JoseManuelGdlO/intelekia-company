/**
 * Valida que una consulta escrita por un agente sea un único SELECT de solo lectura sobre
 * tablas permitidas y sin columnas sensibles. Es la PRIMERA barrera; las otras dos son la
 * transacción READ ONLY (database.js) y un usuario MySQL con permisos SELECT únicamente.
 */
const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'replace', 'drop', 'alter', 'create', 'truncate', 'rename',
  'grant', 'revoke', 'set', 'call', 'load', 'handler', 'lock', 'unlock', 'do', 'prepare',
  'execute', 'deallocate', 'flush', 'kill', 'shutdown', 'into', 'outfile', 'dumpfile',
  'sleep', 'benchmark', 'get_lock', 'release_lock', 'load_file', 'show', 'describe', 'explain',
];
const SYSTEM_SCHEMAS = /(^|[^\w$])`?(information_schema|performance_schema|mysql|sys)`?\s*\./i;
const CLAUSE_END = /\b(where|join|inner|left|right|cross|natural|straight_join|group|order|limit|having|union|window|on|using)\b|\)/i;

class SqlGuardError extends Error {}

function fail(message) {
  throw new SqlGuardError(message);
}

/** Reemplaza el contenido de los textos entre comillas para no confundirlos con SQL. */
function stripStrings(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

function cleanIdentifier(raw) {
  return raw.replace(/`/g, '').trim();
}

function referencedTables(sql) {
  const tables = [];
  const fromRe = /\bfrom\s+/gi;
  let match;
  while ((match = fromRe.exec(sql))) {
    const rest = sql.slice(match.index + match[0].length);
    if (rest.startsWith('(')) continue; // subconsulta: se revisa por su propio FROM
    const end = rest.search(CLAUSE_END);
    const clause = end === -1 ? rest : rest.slice(0, end);
    clause.split(',').forEach((part) => {
      const name = part.trim().split(/\s+/)[0];
      if (name && !name.startsWith('(')) tables.push(cleanIdentifier(name));
    });
  }
  const joinRe = /\bjoin\s+([^\s,()]+)/gi;
  while ((match = joinRe.exec(sql))) tables.push(cleanIdentifier(match[1]));
  return tables;
}

function cteNames(sql) {
  if (!/^\s*with\b/i.test(sql)) return [];
  const names = [];
  const re = /(?:^\s*with\s+(?:recursive\s+)?|,\s*)`?(\w+)`?\s*(?:\([^)]*\)\s*)?as\s*\(/gi;
  let match;
  while ((match = re.exec(sql))) names.push(match[1].toLowerCase());
  return names;
}

function validateSelect(sql, { allowedTables = [], blockedColumns = [], databaseName = '' } = {}) {
  if (typeof sql !== 'string' || !sql.trim()) fail('La consulta está vacía');
  const statement = sql.trim().replace(/;\s*$/, '');
  if (statement.length > 5000) fail('La consulta es demasiado larga (máximo 5000 caracteres)');

  const noStrings = stripStrings(statement);
  if (/\/\*|#/.test(noStrings)) fail('No se permiten comentarios /* */ ni #');
  const clean = noStrings.replace(/--[^\n]*/g, ' ');
  if (clean.includes(';')) fail('Solo se permite una consulta a la vez');
  if (!/^\s*(select|with)\b/i.test(clean)) fail('Solo se permiten consultas SELECT');

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(clean)) fail(`No se permite usar ${keyword.toUpperCase()}: solo lectura con SELECT`);
  }
  if (SYSTEM_SCHEMAS.test(clean)) fail('No se permite consultar esquemas del sistema');

  const allowed = new Set(allowedTables.map((t) => t.toLowerCase()));
  const ctes = new Set(cteNames(clean));
  for (const ref of referencedTables(clean)) {
    const parts = ref.split('.');
    if (parts.length > 2) fail(`Referencia de tabla inválida: ${ref}`);
    if (parts.length === 2 && parts[0].toLowerCase() !== databaseName.toLowerCase()) {
      fail(`Solo puedes consultar la base "${databaseName}"`);
    }
    const table = parts[parts.length - 1].toLowerCase();
    if (!allowed.has(table) && !ctes.has(table)) {
      fail(`La tabla "${parts[parts.length - 1]}" no está permitida. Permitidas: ${allowedTables.join(', ')}`);
    }
  }

  for (const column of blockedColumns) {
    if (new RegExp(`\\b${column}\\b`, 'i').test(clean)) fail(`La columna "${column}" es confidencial y no se puede consultar`);
  }
  if (/(^|[\s,])(`?\w+`?\.)?\*(?=\s|,|$)/.test(clean)) {
    fail('No uses SELECT *: escribe las columnas que necesitas');
  }
  return statement;
}

module.exports = { validateSelect, referencedTables, SqlGuardError };
