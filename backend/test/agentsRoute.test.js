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
