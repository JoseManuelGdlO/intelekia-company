const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

test('loadConfig applies defaults when env vars are missing', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.openaiModel, 'gpt-4o-mini');
  assert.equal(config.agentIntervalHours, 6);
  assert.equal(config.openaiApiKey, '');
});

test('loadConfig reads values from the given env object', () => {
  const config = loadConfig({
    PORT: '4000',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-4o',
    AGENT_INTERVAL_HOURS: '2',
  });
  assert.equal(config.port, 4000);
  assert.equal(config.openaiApiKey, 'sk-test');
  assert.equal(config.openaiModel, 'gpt-4o');
  assert.equal(config.agentIntervalHours, 2);
});

test('loadConfig lee la base de datos con tablas y columnas bloqueadas por defecto', () => {
  const config = loadConfig({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u' });
  assert.equal(config.db.port, 3306);
  assert.ok(config.db.allowedTables.includes('Tasks'));
  assert.deepEqual(config.db.blockedColumns, ['passwordHash', 'email']);
  assert.deepEqual(loadConfig({ DB_ALLOWED_TABLES: 'A, B' }).db.allowedTables, ['A', 'B']);
});

test('loadConfig lee el SMTP con valores por defecto para Hostinger (SSL 465) y firma', () => {
  const config = loadConfig({ SMTP_HOST: 'smtp.hostinger.com', SMTP_USER: 'pm@x.com', SMTP_PASSWORD: 'p' });
  assert.equal(config.smtp.port, 465);
  assert.equal(config.smtp.secure, true);
  assert.match(config.smtp.firma, /asistente de IA/);
  assert.equal(loadConfig({ SMTP_SECURE: 'false', SMTP_FIRMA: '' }).smtp.secure, false);
  assert.equal(loadConfig({ SMTP_FIRMA: '' }).smtp.firma, '');
});
