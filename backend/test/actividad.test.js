const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createActividadStore, MAX_POR_AGENTE } = require('../lib/actividad');

test('registra pasos con fecha y los filtra por agente y por "desde"', () => {
  let t = 0;
  const store = createActividadStore({ now: () => new Date(Date.UTC(2026, 10, 7, 10, 0, t++)) });
  store.log('pm', 'inicio', 'Inicia ciclo');
  const segundo = store.log('pm', 'herramienta', 'Consulta la base', 'SELECT 1');
  store.log('cotizador', 'chat', 'Hola');
  assert.equal(store.list('pm').length, 2);
  assert.equal(segundo.fecha, '2026-11-07T10:00:01.000Z');
  assert.equal(segundo.detalle, 'SELECT 1');
  assert.deepEqual(store.list('pm', { desde: '2026-11-07T10:00:00.000Z' }).map((e) => e.texto), ['Consulta la base']);
  assert.equal(store.log('x', 'inventado', 'y').tipo, 'nota');
});

test('conserva solo los últimos pasos por agente y persiste en disco', async () => {
  const filePath = path.join(os.tmpdir(), `actividad-${Date.now()}.json`);
  const store = createActividadStore({ filePath });
  for (let i = 0; i < MAX_POR_AGENTE + 10; i += 1) store.log('pm', 'nota', `paso ${i}`);
  assert.equal(store.list('pm').length, MAX_POR_AGENTE);
  assert.equal(store.list('pm')[0].texto, 'paso 10');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(createActividadStore({ filePath }).list('pm').length, MAX_POR_AGENTE);
});
