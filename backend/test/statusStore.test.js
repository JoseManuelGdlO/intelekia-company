const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStatus, writeStatus, updateAgentStatus } = require('../lib/statusStore');

function tempStatusPath() {
  return path.join(os.tmpdir(), `agents-status-${Date.now()}-${Math.random()}.json`);
}

test('readStatus returns empty object when file does not exist', () => {
  const filePath = tempStatusPath();
  assert.deepEqual(readStatus(filePath), {});
});

test('writeStatus then readStatus returns the same data', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, { foo: { estatus: 'idle' } });
  assert.deepEqual(readStatus(filePath), { foo: { estatus: 'idle' } });
  fs.unlinkSync(filePath);
});

test('updateAgentStatus merges patch into existing agent status and sets updatedAt', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, { buscador: { estatus: 'idle', ultimaAccion: 'nada' } });

  const result = updateAgentStatus(filePath, 'buscador', { estatus: 'trabajando' });

  assert.equal(result.estatus, 'trabajando');
  assert.equal(result.ultimaAccion, 'nada');
  assert.ok(result.updatedAt);

  const onDisk = readStatus(filePath);
  assert.equal(onDisk.buscador.estatus, 'trabajando');
  fs.unlinkSync(filePath);
});

test('updateAgentStatus creates a new agent entry if it does not exist yet', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, {});

  const result = updateAgentStatus(filePath, 'publicador', { estatus: 'idle' });

  assert.equal(result.estatus, 'idle');
  fs.unlinkSync(filePath);
});
