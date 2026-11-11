const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createOficinaRouter, estadoOficina, crearPuedeTrabajar } = require('../routes/oficina');
const { createHorario } = require('../lib/horario');
const { createGasto } = require('../lib/gasto');
const { createScheduler } = require('../scheduler');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-'));
const martes10 = new Date('2026-11-10T16:00:00Z'); // martes 10:00 en Monterrey

function crear() {
  const dir = tmpDir();
  const horario = createHorario({ filePath: path.join(dir, 'horario.json'), now: () => martes10 });
  const gasto = createGasto({ filePath: path.join(dir, 'gasto.json'), now: () => martes10 });
  return { horario, gasto };
}

async function levantar(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/oficina', createOficinaRouter(deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/oficina`;
  const pedir = async (ruta, metodo = 'GET', body) => {
    const res = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { pedir, cerrar: () => server.close() };
}

test('estadoOficina incluye el gasto de hoy y sigue trabajando bajo el límite', () => {
  const { horario, gasto } = crear();
  gasto.setLimite(5);
  gasto.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  const estado = estadoOficina({ horario, gasto });
  assert.equal(estado.puedeTrabajar, true);
  assert.equal(estado.gasto.usd, 2.5);
  assert.equal(estado.gasto.limiteUsd, 5);
  assert.equal(estado.frenadoPorGasto, false);
});

test('al exceder el límite la oficina no puede trabajar y explica el motivo', () => {
  const { horario, gasto } = crear();
  gasto.setLimite(2);
  gasto.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  const estado = estadoOficina({ horario, gasto });
  assert.equal(estado.puedeTrabajar, false);
  assert.equal(estado.frenadoPorGasto, true);
  assert.equal(estado.motivo, 'Límite de gasto del día alcanzado ($2.50 de $2.00): los ciclos automáticos vuelven mañana.');
  // Si además está cerrada, manda el motivo de la oficina cerrada.
  horario.cerrar();
  const cerrada = estadoOficina({ horario, gasto });
  assert.equal(cerrada.frenadoPorGasto, false);
  assert.match(cerrada.motivo, /Oficina cerrada/);
});

test('el planificador no inicia ciclos automáticos con el gasto excedido, pero Forzar sí', async () => {
  const { horario, gasto } = crear();
  const puedeTrabajar = crearPuedeTrabajar({ horario, gasto });
  assert.equal(puedeTrabajar(), true);
  let ahora = 0;
  const corridas = [];
  const scheduler = createScheduler({ intervalMs: 1000, agentRunners: { a: async () => corridas.push('a') }, now: () => ahora, puedeTrabajar });
  await scheduler.tick();
  ahora += 1000;
  gasto.setLimite(1);
  gasto.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(puedeTrabajar(), false);
  await scheduler.tick();
  assert.deepEqual(corridas, []);
  await scheduler.runOne('a');
  assert.deepEqual(corridas, ['a']);
  gasto.setLimite(null);
  assert.equal(puedeTrabajar(), true);
});

test('rutas: GET incluye gasto, PUT limite-gasto valida y todas devuelven el estado compuesto', async () => {
  const deps = crear();
  const { pedir, cerrar } = await levantar(deps);
  try {
    const inicial = await pedir('/');
    assert.equal(inicial.status, 200);
    assert.equal(inicial.body.gasto.usd, 0);
    assert.equal(inicial.body.gasto.limiteUsd, null);

    deps.gasto.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
    const limitado = await pedir('/limite-gasto', 'PUT', { usd: 2 });
    assert.equal(limitado.status, 200);
    assert.equal(limitado.body.gasto.limiteUsd, 2);
    assert.equal(limitado.body.puedeTrabajar, false);
    assert.match(limitado.body.motivo, /Límite de gasto del día alcanzado/);

    assert.equal((await pedir('/limite-gasto', 'PUT', { usd: -3 })).status, 400);
    assert.equal((await pedir('/limite-gasto', 'PUT', { usd: 'abc' })).status, 400);

    const abierta = await pedir('/abrir', 'POST');
    assert.equal(abierta.body.gasto.limiteUsd, 2);
    const conHorario = await pedir('/horario', 'PUT', { respetarHorario: false });
    assert.equal(conHorario.body.frenadoPorGasto, true);
    const cerrada = await pedir('/cerrar', 'POST');
    assert.equal(cerrada.body.gasto.usd, 2.5);

    const sinLimite = await pedir('/limite-gasto', 'PUT', { usd: null });
    assert.equal(sinLimite.body.gasto.limiteUsd, null);
    assert.equal(sinLimite.body.gasto.excedido, false);
  } finally {
    cerrar();
  }
});

test('el router funciona sin medidor de gasto (compatibilidad)', async () => {
  const { horario } = crear();
  const { pedir, cerrar } = await levantar({ horario });
  try {
    const r = await pedir('/');
    assert.equal(r.body.puedeTrabajar, true);
    assert.equal(r.body.gasto, undefined);
  } finally {
    cerrar();
  }
});
