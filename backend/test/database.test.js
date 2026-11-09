const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createDatabase, MAX_ROWS } = require('../lib/database');

const DB = {
  host: 'h', port: 3306, name: 'admin-intelekia', user: 'lector', password: 'x',
  allowedTables: ['Tasks', 'Users'], blockedColumns: ['passwordHash', 'email'],
};

function fakePool(rowsFor) {
  const executed = [];
  let released = 0;
  const conn = {
    query: async (sql, params) => {
      executed.push(sql);
      return [rowsFor(sql, params)];
    },
    release: () => {
      released += 1;
    },
  };
  return { pool: { getConnection: async () => conn }, executed, released: () => released };
}

function make(rowsFor = () => []) {
  const fake = fakePool(rowsFor);
  const db = createDatabase({
    dbConfig: DB,
    logPath: path.join(os.tmpdir(), `consultas-${Date.now()}-${Math.random()}.json`),
    createPool: () => fake.pool,
  });
  return { db, ...fake };
}

test('cada consulta corre en una transacción READ ONLY con límite de tiempo y se revierte', async () => {
  const { db, executed, released } = make((sql) => (sql.startsWith('SELECT') ? [{ id: 1, title: 'x' }] : []));
  const result = await db.query('SELECT id, title FROM Tasks', { agentId: 'seg' });
  assert.deepEqual(result.rows, [{ id: 1, title: 'x' }]);
  assert.match(executed[0], /MAX_EXECUTION_TIME/);
  assert.equal(executed[1], 'START TRANSACTION READ ONLY');
  assert.equal(executed[2], 'SELECT id, title FROM Tasks');
  assert.equal(executed.at(-1), 'ROLLBACK');
  assert.equal(released(), 1);
  assert.equal(db.consultas({ agentId: 'seg' })[0].filas, 1);
});

test('una consulta bloqueada nunca llega a la base y queda en la bitácora', async () => {
  const { db, executed } = make();
  await assert.rejects(db.query('SELECT passwordHash FROM Users', { agentId: 'seg' }), /confidencial/);
  assert.equal(executed.length, 0);
  const [entry] = db.consultas();
  assert.equal(entry.bloqueada, true);
});

test('recorta filas y celdas largas', async () => {
  const many = Array.from({ length: MAX_ROWS + 50 }, (_, i) => ({ id: i, description: 'a'.repeat(900) }));
  const { db } = make((sql) => (sql.startsWith('SELECT') ? many : []));
  const result = await db.query('SELECT id, description FROM Tasks');
  assert.equal(result.rows.length, MAX_ROWS);
  assert.equal(result.total, MAX_ROWS + 50);
  assert.equal(result.truncado, true);
  assert.ok(result.rows[0].description.length < 510);
  assert.ok(db.formatForModel(result).length <= 15100);
});

test('el esquema oculta columnas bloqueadas y muestra enums', async () => {
  const { db } = make((sql) =>
    sql.includes('information_schema')
      ? [
          { t: 'Users', c: 'id', tipo: 'int' },
          { t: 'Users', c: 'email', tipo: 'varchar(255)' },
          { t: 'Users', c: 'passwordHash', tipo: 'varchar(255)' },
          { t: 'Users', c: 'role', tipo: "enum('admin','developer')" },
        ]
      : []
  );
  assert.equal(await db.schema(), "Users(id, role enum('admin','developer'))");
});

test('sin configuración da un error claro y lo reporta en el estado', async () => {
  const db = createDatabase({ dbConfig: { ...DB, host: '' }, createPool: () => assert.fail('no debe conectar') });
  assert.equal(db.status().configurada, false);
  await assert.rejects(db.query('SELECT id FROM Tasks'), /no está configurada/);
});
