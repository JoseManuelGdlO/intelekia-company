const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createConversacionesStore, MAX_CONVERSACIONES } = require('../lib/conversacionesStore');

function tempPath() {
  return path.join(os.tmpdir(), `conversaciones-${Date.now()}-${Math.random()}.json`);
}

test('registra una conversación en curso y luego su respuesta', () => {
  const filePath = tempPath();
  const store = createConversacionesStore({ filePath });
  const conv = store.start({ de: 'a', para: 'b', pregunta: '¿qué tal?' });
  assert.equal(conv.estado, 'en_curso');
  store.finish(conv.id, { respuesta: 'bien' });
  const reloaded = createConversacionesStore({ filePath });
  const [saved] = reloaded.list();
  assert.equal(saved.estado, 'completada');
  assert.equal(saved.respuesta, 'bien');
});

test('filtra por agente y por fecha de actualización', () => {
  let t = 0;
  const store = createConversacionesStore({ filePath: tempPath(), now: () => new Date(2026, 0, 1, 0, 0, t++) });
  store.start({ de: 'a', para: 'b', pregunta: '1' });
  const second = store.start({ de: 'c', para: 'd', pregunta: '2' });
  assert.equal(store.list({ agentId: 'b' }).length, 1);
  assert.deepEqual(store.list({ desde: new Date(2026, 0, 1, 0, 0, 0).toISOString() }).map((c) => c.id), [second.id]);
});

test('marca error y conserva como máximo las más recientes', () => {
  const store = createConversacionesStore({ filePath: tempPath() });
  const conv = store.start({ de: 'a', para: 'b', pregunta: 'x' });
  store.finish(conv.id, { error: 'falló' });
  assert.equal(store.list()[0].estado, 'error');
  for (let i = 0; i < MAX_CONVERSACIONES + 5; i += 1) store.start({ de: 'a', para: 'b', pregunta: String(i) });
  assert.equal(store.list({ limite: 1000 }).length, MAX_CONVERSACIONES);
});
