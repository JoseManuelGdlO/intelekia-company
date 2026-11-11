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
  assert.equal(store.list('pm', { limite: MAX_POR_AGENTE * 2 }).length, MAX_POR_AGENTE);
  assert.equal(store.list('pm', { limite: MAX_POR_AGENTE * 2 })[0].texto, 'paso 10');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(createActividadStore({ filePath }).pagina('pm').total, MAX_POR_AGENTE);
});

test('MAX_POR_AGENTE conserva hasta 1000 pasos', () => {
  assert.equal(MAX_POR_AGENTE, 1000);
});

test('pagina devuelve los eventos del más reciente al más antiguo', () => {
  const store = createActividadStore();
  for (let i = 0; i < 45; i += 1) store.log('pm', 'nota', `paso ${i}`);
  store.log('otro', 'nota', 'ajeno');
  const p1 = store.pagina('pm', { pagina: 1, porPagina: 20 });
  assert.equal(p1.total, 45);
  assert.equal(p1.paginas, 3);
  assert.equal(p1.pagina, 1);
  assert.equal(p1.eventos.length, 20);
  assert.equal(p1.eventos[0].texto, 'paso 44');
  assert.equal(p1.eventos[19].texto, 'paso 25');
  assert.deepEqual(store.pagina('pm', { pagina: 3, porPagina: 20 }).eventos.map((e) => e.texto), ['paso 4', 'paso 3', 'paso 2', 'paso 1', 'paso 0']);
  assert.equal(store.pagina('pm').eventos.length, 20);
});

test('pagina normaliza parámetros y devuelve vacío fuera de rango', () => {
  const store = createActividadStore();
  assert.deepEqual(store.pagina('nadie'), { eventos: [], total: 0, pagina: 1, paginas: 1 });
  for (let i = 0; i < 5; i += 1) store.log('pm', 'nota', `paso ${i}`);
  assert.equal(store.pagina('pm', { pagina: -3 }).pagina, 1);
  assert.equal(store.pagina('pm', { pagina: 'abc' }).pagina, 1);
  assert.equal(store.pagina('pm', { pagina: '2', porPagina: '2' }).eventos[0].texto, 'paso 2');
  const fuera = store.pagina('pm', { pagina: 4, porPagina: 2 });
  assert.deepEqual(fuera.eventos, []);
  assert.equal(fuera.paginas, 3);
  assert.equal(store.pagina('pm', { porPagina: 1000 }).eventos.length, 5);
  assert.equal(store.pagina('pm', { porPagina: -1 }).eventos.length, 1);
});

test('list sin límite sigue devolviendo como máximo 150 eventos', () => {
  const store = createActividadStore();
  for (let i = 0; i < 200; i += 1) store.log('pm', 'nota', `paso ${i}`);
  assert.equal(store.list('pm').length, 150);
  assert.equal(store.list('pm', { limite: 300 }).length, 200);
});
