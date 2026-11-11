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
  assert.equal(store.list({ limite: 100000 }).length, MAX_CONVERSACIONES);
});

test('MAX_CONVERSACIONES conserva hasta 2000', () => {
  assert.equal(MAX_CONVERSACIONES, 2000);
});

test('pagina devuelve las conversaciones del más reciente al más antiguo, filtradas por agente', () => {
  const store = createConversacionesStore({ filePath: tempPath() });
  for (let i = 0; i < 45; i += 1) store.start({ de: i % 2 ? 'a' : 'b', para: 'c', pregunta: String(i) });
  const p1 = store.pagina({ pagina: 1, porPagina: 20 });
  assert.equal(p1.total, 45);
  assert.equal(p1.paginas, 3);
  assert.equal(p1.pagina, 1);
  assert.equal(p1.items.length, 20);
  assert.equal(p1.items[0].pregunta, '44');
  assert.equal(p1.items[19].pregunta, '25');
  const p3 = store.pagina({ pagina: 3, porPagina: 20 });
  assert.deepEqual(p3.items.map((c) => c.pregunta), ['4', '3', '2', '1', '0']);
  const soloA = store.pagina({ agentId: 'a', pagina: 1, porPagina: 10 });
  assert.equal(soloA.total, 22);
  assert.equal(soloA.paginas, 3);
  assert.equal(soloA.items[0].pregunta, '43');
  assert.ok(soloA.items.every((c) => c.de === 'a' || c.para === 'a'));
  assert.equal(store.pagina({ agentId: 'c' }).total, 45);
});

test('pagina normaliza parámetros y devuelve vacío fuera de rango', () => {
  const store = createConversacionesStore({ filePath: tempPath() });
  assert.deepEqual(store.pagina(), { items: [], total: 0, pagina: 1, paginas: 1 });
  for (let i = 0; i < 5; i += 1) store.start({ de: 'a', para: 'b', pregunta: String(i) });
  assert.equal(store.pagina({ pagina: 0 }).pagina, 1);
  assert.equal(store.pagina({ pagina: 'x' }).pagina, 1);
  assert.equal(store.pagina({ pagina: '2.7', porPagina: 2 }).pagina, 2);
  const fuera = store.pagina({ pagina: 9, porPagina: 2 });
  assert.deepEqual(fuera.items, []);
  assert.equal(fuera.pagina, 9);
  assert.equal(fuera.paginas, 3);
  assert.equal(store.pagina({ porPagina: 500 }).items.length, 5);
  assert.equal(store.pagina({ porPagina: 0 }).items.length, 1);
});

test('persiste en JSON compacto', () => {
  const filePath = tempPath();
  const store = createConversacionesStore({ filePath });
  store.start({ de: 'a', para: 'b', pregunta: 'x' });
  assert.doesNotMatch(require('fs').readFileSync(filePath, 'utf-8'), /\n/);
});
