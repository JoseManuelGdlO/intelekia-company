const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeDepartments,
  createDepartmentsHandler,
  createCreateAgentHandler,
  createUpdateAgentHandler,
  createGetMemoryHandler,
  createSetMemoryHandler,
  createCompressMemoryHandler,
} = require('../routes/departments');

const FAKE_DEPARTMENTS = [
  {
    id: 'marketing',
    label: 'Marketing',
    agents: [
      { id: 'buscador-tendencias', label: 'Buscador de Tendencias', module: {}, deps: { apiKey: 'sk-secret', rolePath: '/secret/path.md' } },
      { id: 'publicador', label: 'Publicador', module: {}, deps: { apiKey: 'sk-secret' } },
    ],
  },
];

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

test('sanitizeDepartments strips module and deps, keeping only id/label', () => {
  const sanitized = sanitizeDepartments(FAKE_DEPARTMENTS);

  assert.deepEqual(sanitized, [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        { id: 'buscador-tendencias', label: 'Buscador de Tendencias' },
        { id: 'publicador', label: 'Publicador' },
      ],
    },
  ]);

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /sk-secret/);
  assert.doesNotMatch(serialized, /secret\/path/);
});

test('departments handler responds with the sanitized departments list', () => {
  const handler = createDepartmentsHandler({ departments: FAKE_DEPARTMENTS });
  const res = fakeRes();

  handler({}, res);

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'marketing');
  assert.equal(Object.keys(res.body[0].agents[0]).length, 2);
});

test('create-agent handler responds 201 with the new agent on success', () => {
  const handler = createCreateAgentHandler({
    createCustomAgent: ({ departmentId, label, context, autonomous }) => {
      assert.equal(departmentId, 'comercial');
      assert.equal(label, 'Closer');
      assert.equal(context, 'Eres un cerrador experto.');
      assert.equal(autonomous, true);
      return { id: 'custom-closer-123', label: 'Closer' };
    },
  });
  const req = { params: { departmentId: 'comercial' }, body: { label: 'Closer', context: 'Eres un cerrador experto.', autonomous: true } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: 'custom-closer-123', label: 'Closer' });
});

test('create-agent handler responds 400 when label is missing', () => {
  const handler = createCreateAgentHandler({ createCustomAgent: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { departmentId: 'comercial' }, body: { context: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /label/);
});

test('create-agent handler responds 400 when context is missing', () => {
  const handler = createCreateAgentHandler({ createCustomAgent: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { departmentId: 'comercial' }, body: { label: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /context/);
});

test('create-agent handler responds 400 when createCustomAgent throws', () => {
  const handler = createCreateAgentHandler({
    createCustomAgent: () => {
      throw new Error('Departamento desconocido: no-existe');
    },
  });
  const req = { params: { departmentId: 'no-existe' }, body: { label: 'x', context: 'y' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Departamento desconocido/);
});

test('update-agent handler responds with the updated agent on success', () => {
  const handler = createUpdateAgentHandler({
    updateCustomAgent: (id, patch) => {
      assert.equal(id, 'custom-closer-123');
      assert.deepEqual(patch, { label: 'Closer Pro', context: undefined, autonomous: undefined });
      return { id, label: 'Closer Pro' };
    },
  });
  const req = { params: { agentId: 'custom-closer-123' }, body: { label: 'Closer Pro' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { id: 'custom-closer-123', label: 'Closer Pro' });
});

test('update-agent handler responds 400 when updateCustomAgent throws', () => {
  const handler = createUpdateAgentHandler({
    updateCustomAgent: () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' }, body: {} };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Trabajador desconocido/);
});

test('get-memory handler responds with the current memory content', () => {
  const handler = createGetMemoryHandler({ getMemory: (id) => `memoria de ${id}` });
  const req = { params: { agentId: 'custom-closer-123' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { content: 'memoria de custom-closer-123' });
});

test('get-memory handler responds 400 when getMemory throws', () => {
  const handler = createGetMemoryHandler({
    getMemory: () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
});

test('set-memory handler responds with the new content on success', () => {
  const handler = createSetMemoryHandler({ setMemory: () => {} });
  const req = { params: { agentId: 'custom-closer-123' }, body: { content: 'nueva memoria' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { content: 'nueva memoria' });
});

test('set-memory handler responds 400 when content is missing', () => {
  const handler = createSetMemoryHandler({ setMemory: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { agentId: 'custom-closer-123' }, body: {} };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
});

test('compress-memory handler responds with the compressed content', async () => {
  const handler = createCompressMemoryHandler({ compressMemory: async () => 'resumen' });
  const req = { params: { agentId: 'custom-closer-123' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(res.body, { content: 'resumen' });
});

test('compress-memory handler responds 400 when compressMemory throws', async () => {
  const handler = createCompressMemoryHandler({
    compressMemory: async () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
});
