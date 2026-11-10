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

test('loadConfig lee GITHUB_OWNER para el revisor de PRs', () => {
  assert.equal(loadConfig({ GITHUB_OWNER: 'JoseManuelGdlO' }).githubOwner, 'JoseManuelGdlO');
  assert.equal(loadConfig({}).githubOwner, '');
});

test('loadConfig lee la configuración de Meta', () => {
  const c = loadConfig({ META_PAGE_TOKEN: 't', META_PAGE_ID: 'p', META_IG_USER_ID: 'i' });
  assert.deepEqual(c.meta, { pageToken: 't', pageId: 'p', igUserId: 'i', apiVersion: 'v21.0' });
  assert.equal(loadConfig({ META_API_VERSION: 'v22.0' }).meta.apiVersion, 'v22.0');
});

test('loadConfig lee la configuración de WhatsApp', () => {
  const c = loadConfig({
    WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's',
    WHATSAPP_PERMITIDOS: '+52 1 871 000 0000, 5218719999999', WHATSAPP_PLANTILLA_AVISO: 'aviso',
  });
  assert.deepEqual(c.whatsapp, {
    token: 't', phoneNumberId: 'p', verifyToken: 'v', appSecret: 's',
    permitidos: ['528710000000', '528719999999'], plantillaAviso: 'aviso', plantillaIdioma: 'es_MX', apiVersion: 'v21.0', voz: 'alloy',
    webhookPort: 3100,
  });
  assert.deepEqual(loadConfig({}).whatsapp.permitidos, []);
  assert.equal(loadConfig({ WHATSAPP_WEBHOOK_PORT: '3194' }).whatsapp.webhookPort, 3194);
});

test('loadConfig lee el usuario y contraseña de la oficina', () => {
  assert.deepEqual(loadConfig({ OFICINA_USUARIO: 'jose', OFICINA_PASSWORD: 'x' }).acceso, { usuario: 'jose', password: 'x' });
  assert.deepEqual(loadConfig({}).acceso, { usuario: '', password: '' });
});
