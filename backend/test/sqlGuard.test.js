const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSelect, referencedTables } = require('../lib/sqlGuard');

const OPTS = {
  allowedTables: ['Projects', 'Tasks', 'BoardColumns', 'TaskActivities', 'Users', 'Notes'],
  blockedColumns: ['passwordHash', 'email'],
  databaseName: 'admin-intelekia',
};
const ok = (sql) => validateSelect(sql, OPTS);
const bad = (sql, re) => assert.throws(() => validateSelect(sql, OPTS), re);

test('acepta SELECT reales del agente de seguimiento (joins, subconsultas, COUNT(*), CTE)', () => {
  ok(`SELECT p.name, t.title, bc.name AS estado, u.name AS responsable,
        COALESCE((SELECT MAX(a.createdAt) FROM TaskActivities a WHERE a.taskId = t.id), t.updatedAt) AS ultimo
      FROM Tasks t JOIN BoardColumns bc ON bc.id = t.columnId
      LEFT JOIN Projects p ON p.id = t.projectId LEFT JOIN Users u ON u.id = t.assigneeId
      WHERE bc.name <> 'Entregadas' ORDER BY t.dueDate LIMIT 200;`);
  ok('SELECT COUNT(*) AS n FROM Tasks');
  ok('SELECT p.name FROM Projects p, Tasks t WHERE t.projectId = p.id');
  ok('WITH abiertas AS (SELECT projectId FROM Tasks) SELECT COUNT(*) FROM abiertas');
  ok("SELECT title FROM Tasks WHERE title LIKE '%update%' OR title = 'drop; delete'");
  ok('SELECT name FROM `admin-intelekia`.Projects');
  ok('SELECT t.description FROM Tasks t');
});

test('rechaza cualquier escritura o comando que no sea SELECT', () => {
  bad('UPDATE Tasks SET title = 1', /Solo se permiten consultas SELECT/);
  bad('DELETE FROM Tasks', /SELECT/);
  bad('DROP TABLE Users', /SELECT/);
  bad('SHOW TABLES', /SELECT/);
  bad('SELECT 1; DROP TABLE Users', /una consulta a la vez/);
  bad('SELECT title FROM Tasks FOR UPDATE', /UPDATE/);
  bad("SELECT title INTO OUTFILE '/tmp/x' FROM Tasks", /INTO/);
  bad('SELECT SLEEP(10)', /SLEEP/);
  bad('WITH x AS (SELECT 1) DELETE FROM Tasks', /DELETE/);
});

test('rechaza comentarios que podrían esconder SQL ejecutable', () => {
  bad('SELECT /*! 1 */ name FROM Projects', /comentarios/);
  bad('SELECT name FROM Projects # nada', /comentarios/);
});

test('solo permite las tablas autorizadas y nunca esquemas del sistema', () => {
  bad('SELECT id FROM FinanceItems', /FinanceItems.*no está permitida/);
  bad('SELECT t.id FROM Tasks t JOIN Secrets s ON s.id = t.id', /Secrets/);
  bad('SELECT table_name FROM information_schema.tables', /sistema/);
  bad('SELECT user FROM mysql.user', /sistema/);
  bad('SELECT name FROM otra_base.Projects', /Solo puedes consultar/);
});

test('nunca deja leer columnas confidenciales ni usar SELECT *', () => {
  bad('SELECT passwordHash FROM Users', /confidencial/);
  bad('SELECT u.email FROM Users u', /confidencial/);
  bad('SELECT * FROM Users', /SELECT \*/);
  bad('SELECT u.* FROM Users u', /SELECT \*/);
  ok('SELECT id, name, role FROM Users');
});

test('referencedTables extrae tablas de FROM, listas con coma y JOIN', () => {
  assert.deepEqual(referencedTables('select a from Tasks t, Projects p join Users u on 1 where x'), ['Tasks', 'Projects', 'Users']);
});
