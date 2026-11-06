const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wrapRunCycle } = require('../lib/runWithStatus');
const { readStatus, writeStatus } = require('../lib/statusStore');

function tempStatusPath() {
  const filePath = path.join(os.tmpdir(), `status-${Date.now()}-${Math.random()}.json`);
  writeStatus(filePath, {});
  return filePath;
}

test('wrapRunCycle sets estatus trabajando then the success estatus on success', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'buscador-tendencias',
    statusPath,
    runCycle: async () => ({ addedIdeas: [1, 2] }),
    deps: {},
    describeSuccess: (result) => ({
      estatus: 'idle',
      ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s)`,
    }),
  });

  const result = await runWrapped();

  assert.deepEqual(result, { addedIdeas: [1, 2] });
  const status = readStatus(statusPath)['buscador-tendencias'];
  assert.equal(status.estatus, 'idle');
  assert.equal(status.ultimaAccion, 'Encontró 2 idea(s)');
  assert.equal(status.error, null);

  fs.unlinkSync(statusPath);
});

test('wrapRunCycle sets estatus error and records the error message on failure', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'publicador',
    statusPath,
    runCycle: async () => {
      throw new Error('fallo de prueba');
    },
    deps: {},
    describeSuccess: () => ({ estatus: 'idle', ultimaAccion: '' }),
  });

  await assert.rejects(runWrapped(), /fallo de prueba/);

  const status = readStatus(statusPath).publicador;
  assert.equal(status.estatus, 'error');
  assert.equal(status.error, 'fallo de prueba');

  fs.unlinkSync(statusPath);
});

test('wrapRunCycle passes extra fields from describeSuccess into the status patch', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'publicador',
    statusPath,
    runCycle: async () => ({ draftCreated: { ideaId: 'idea-9' } }),
    deps: {},
    describeSuccess: (result) => ({
      estatus: 'listo_para_revision',
      ultimaAccion: 'Redactó un draft',
      ultimoIdeaId: result.draftCreated.ideaId,
    }),
  });

  await runWrapped();

  const status = readStatus(statusPath).publicador;
  assert.equal(status.ultimoIdeaId, 'idea-9');

  fs.unlinkSync(statusPath);
});
