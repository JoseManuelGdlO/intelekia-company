const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusHandler, createChatHandler, createForzarHandler } = require('../routes/agents');

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

test('status handler responds with the result of readStatus', () => {
  const handler = createStatusHandler({
    statusPath: '/fake/path.json',
    readStatus: (p) => ({ fake: p }),
  });
  const res = fakeRes();

  handler({}, res);

  assert.deepEqual(res.body, { fake: '/fake/path.json' });
});

test('chat handler calls the matching chatHandler with the request body', async () => {
  const handler = createChatHandler({
    chatHandlers: {
      publicador: async (body) => ({ reply: `recibido: ${body.message}` }),
    },
  });
  const req = { params: { id: 'publicador' }, body: { message: 'hola' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(res.body, { reply: 'recibido: hola' });
});

test('chat handler responds 404 for an unknown agent id', async () => {
  const handler = createChatHandler({ chatHandlers: {} });
  const req = { params: { id: 'no-existe' }, body: {} };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
});

test('chat handler responds 500 when the handler throws', async () => {
  const handler = createChatHandler({
    chatHandlers: {
      publicador: async () => {
        throw new Error('fallo openai');
      },
    },
  });
  const req = { params: { id: 'publicador' }, body: {} };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'fallo openai');
});

test('forzar handler calls scheduler.runOne with the agent id', async () => {
  const calledWith = [];
  const handler = createForzarHandler({
    scheduler: {
      runOne: async (id) => {
        calledWith.push(id);
        return { addedIdeas: [] };
      },
    },
  });
  const req = { params: { id: 'buscador-tendencias' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(calledWith, ['buscador-tendencias']);
  assert.equal(res.body.ok, true);
});

test('forzar handler responds 400 when scheduler.runOne rejects', async () => {
  const handler = createForzarHandler({
    scheduler: {
      runOne: async () => {
        throw new Error('Agente desconocido: x');
      },
    },
  });
  const req = { params: { id: 'x' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
});

test('actividad handler con pagina devuelve la forma paginada', () => {
  const { createActividadHandler } = require('../routes/agents');
  const { createActividadStore } = require('../lib/actividad');
  const actividad = createActividadStore();
  for (let i = 0; i < 30; i += 1) actividad.log('pm', 'nota', `paso ${i}`);
  const res = fakeRes();
  createActividadHandler({ actividad })({ params: { id: 'pm' }, query: { pagina: '2', porPagina: '20' } }, res);
  assert.equal(res.body.total, 30);
  assert.equal(res.body.paginas, 2);
  assert.equal(res.body.pagina, 2);
  assert.equal(res.body.eventos.length, 10);
  assert.equal(res.body.eventos[0].texto, 'paso 9');
});

test('actividad handler sin pagina responde un arreglo como antes', () => {
  const { createActividadHandler } = require('../routes/agents');
  const { createActividadStore } = require('../lib/actividad');
  const actividad = createActividadStore();
  actividad.log('pm', 'nota', 'uno');
  actividad.log('pm', 'nota', 'dos');
  const res = fakeRes();
  createActividadHandler({ actividad })({ params: { id: 'pm' }, query: { limite: '1' } }, res);
  assert.deepEqual(res.body.map((e) => e.texto), ['dos']);
});

test('actividad handler con pagina y sin bitácora responde la forma paginada vacía', () => {
  const { createActividadHandler } = require('../routes/agents');
  const res = fakeRes();
  createActividadHandler({ actividad: null })({ params: { id: 'pm' }, query: { pagina: '1' } }, res);
  assert.deepEqual(res.body, { eventos: [], total: 0, pagina: 1, paginas: 1 });
});
