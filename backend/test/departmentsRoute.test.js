const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDepartments, createDepartmentsHandler } = require('../routes/departments');

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
    body: null,
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
