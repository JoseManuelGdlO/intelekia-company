const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../scheduler');

test('runOne calls the matching agent runner and returns its result', async () => {
  let calls = 0;
  const scheduler = createScheduler({
    intervalMs: 1000,
    agentRunners: {
      'buscador-tendencias': async () => {
        calls += 1;
        return { addedIdeas: [] };
      },
    },
  });

  const result = await scheduler.runOne('buscador-tendencias');

  assert.equal(calls, 1);
  assert.deepEqual(result, { addedIdeas: [] });
});

test('runOne throws for an unknown agent id', async () => {
  const scheduler = createScheduler({ intervalMs: 1000, agentRunners: {} });

  await assert.rejects(scheduler.runOne('no-existe'), /Agente desconocido: no-existe/);
});

test('runAllOnce calls every registered agent runner once', async () => {
  const calledIds = [];
  const scheduler = createScheduler({
    intervalMs: 1000,
    agentRunners: {
      a: async () => {
        calledIds.push('a');
      },
      b: async () => {
        calledIds.push('b');
      },
    },
  });

  await scheduler.runAllOnce();

  assert.deepEqual(calledIds.sort(), ['a', 'b']);
});

test('start sets isRunning to true and stop sets it back to false', () => {
  const scheduler = createScheduler({ intervalMs: 1000, agentRunners: {} });
  assert.equal(scheduler.isRunning(), false);
  scheduler.start();
  assert.equal(scheduler.isRunning(), true);
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const HORA = 3600000;

function relojFalso(inicio = Date.UTC(2026, 10, 7, 12)) {
  let t = inicio;
  return { now: () => t, avanzar: (ms) => (t += ms) };
}

test('cada agente corre según su propio intervalo (p. ej. 6 h y 24 h)', async () => {
  const reloj = relojFalso();
  const corridas = [];
  const scheduler = createScheduler({
    intervalMs: 6 * HORA,
    agentRunners: { tendencias: async () => corridas.push('tendencias'), seguimiento: async () => corridas.push('seguimiento') },
    intervalFor: (id) => (id === 'seguimiento' ? 24 * HORA : 6 * HORA),
    now: reloj.now,
  });
  await scheduler.tick(); // primera vez: empieza a contar, no corre nada
  assert.deepEqual(corridas, []);
  for (let h = 0; h < 24; h += 1) {
    reloj.avanzar(HORA);
    await scheduler.tick();
  }
  assert.equal(corridas.filter((c) => c === 'tendencias').length, 4);
  assert.equal(corridas.filter((c) => c === 'seguimiento').length, 1);
  const prox = scheduler.proximos();
  assert.equal(prox.seguimiento.cadaHoras, 24);
  assert.equal(prox.tendencias.proxima, new Date(reloj.now() + 6 * HORA).toISOString());
});

test('intervalo 0 o null significa que el agente no corre solo', async () => {
  const reloj = relojFalso();
  let corridas = 0;
  const scheduler = createScheduler({ intervalMs: HORA, agentRunners: { a: async () => (corridas += 1) }, intervalFor: () => 0, now: reloj.now });
  await scheduler.tick();
  reloj.avanzar(100 * HORA);
  await scheduler.tick();
  assert.equal(corridas, 0);
  assert.equal(scheduler.proximos().a.cadaHoras, null);
});

test('Forzar ciclo reinicia el contador de ese agente', async () => {
  const reloj = relojFalso();
  let corridas = 0;
  const scheduler = createScheduler({ intervalMs: 24 * HORA, agentRunners: { a: async () => (corridas += 1) }, now: reloj.now });
  await scheduler.tick();
  reloj.avanzar(23 * HORA);
  await scheduler.runOne('a');
  reloj.avanzar(2 * HORA);
  await scheduler.tick();
  assert.equal(corridas, 1, 'no vuelve a correr a las 2 h de haberlo forzado');
});

test('la última ejecución sobrevive a un reinicio del servidor', async () => {
  const statePath = path.join(os.tmpdir(), `ciclos-${Date.now()}.json`);
  const reloj = relojFalso();
  let corridas = 0;
  const runners = { a: async () => (corridas += 1) };
  const s1 = createScheduler({ intervalMs: 6 * HORA, agentRunners: runners, statePath, now: reloj.now });
  await s1.tick();
  reloj.avanzar(7 * HORA);
  const s2 = createScheduler({ intervalMs: 6 * HORA, agentRunners: runners, statePath, now: reloj.now });
  await s2.tick();
  assert.equal(corridas, 1, 'al reiniciar respeta lo que ya llevaba contado');
  assert.ok(JSON.parse(fs.readFileSync(statePath, 'utf-8')).a);
});

test('un ciclo que falla no detiene a los demás', async () => {
  const reloj = relojFalso();
  const corridas = [];
  const errores = [];
  const scheduler = createScheduler({
    intervalMs: HORA,
    agentRunners: {
      malo: async () => {
        throw new Error('API caída');
      },
      bueno: async () => corridas.push('bueno'),
    },
    now: reloj.now,
    onError: (id, err) => errores.push(`${id}: ${err.message}`),
  });
  await scheduler.tick();
  reloj.avanzar(HORA);
  await scheduler.tick();
  assert.deepEqual(corridas, ['bueno']);
  assert.deepEqual(errores, ['malo: API caída']);
});
