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
