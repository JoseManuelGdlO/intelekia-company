const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createGetHandler, createSetRuleHandler, createSetDefaultHandler, createListConversacionesHandler } = require('../routes/comunicacion');
const { createComunicacionStore } = require('../lib/comunicacionStore');
const { createConversacionesStore } = require('../lib/conversacionesStore');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function store() {
  return createComunicacionStore({
    configPath: path.join(os.tmpdir(), `com-route-${Date.now()}-${Math.random()}.json`),
    departments: [
      { id: 'marketing', agents: [{ id: 'a', deps: { apiKey: 'sk-secret' } }, { id: 'b' }] },
      { id: 'comercial', agents: [{ id: 'c' }] },
    ],
  });
}

test('GET devuelve reglas y permitidos sin exponer deps', () => {
  const res = fakeRes();
  createGetHandler({ comunicacion: store() })({}, res);
  assert.equal(res.body.porDefecto, 'area');
  assert.deepEqual(res.body.permitidos.a, ['b']);
  assert.doesNotMatch(JSON.stringify(res.body), /sk-secret/);
});

test('PUT regla actualiza a quién puede consultar el agente', () => {
  const res = fakeRes();
  createSetRuleHandler({ comunicacion: store() })({ params: { agentId: 'a' }, body: { alcance: 'personalizado', permitidos: ['c'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.permitidos.a, ['c']);
});

test('PUT regla inválida responde 400', () => {
  const res = fakeRes();
  createSetRuleHandler({ comunicacion: store() })({ params: { agentId: 'a' }, body: { alcance: 'quien-sea' } }, res);
  assert.equal(res.statusCode, 400);
});

test('PUT por-defecto con aplicarATodos reinicia las reglas individuales', () => {
  const comunicacion = store();
  comunicacion.setRule('a', { alcance: 'nadie' });
  const res = fakeRes();
  createSetDefaultHandler({ comunicacion })({ body: { alcance: 'todos', aplicarATodos: true } }, res);
  assert.deepEqual(res.body.permitidos.a, ['b', 'c']);
});

test('GET conversaciones filtra por desde', () => {
  const conversaciones = createConversacionesStore({ filePath: path.join(os.tmpdir(), `conv-route-${Date.now()}.json`) });
  conversaciones.start({ de: 'a', para: 'b', pregunta: 'x' });
  const res = fakeRes();
  createListConversacionesHandler({ conversaciones })({ query: { desde: '2999-01-01T00:00:00.000Z' } }, res);
  assert.deepEqual(res.body, []);
});
