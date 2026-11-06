const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

test('loadConfig applies defaults when env vars are missing', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.openaiModel, 'gpt-4o-mini');
  assert.equal(config.agentIntervalHours, 6);
  assert.equal(config.openaiApiKey, '');
});

test('loadConfig reads values from the given env object', () => {
  const config = loadConfig({
    PORT: '4000',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-4o',
    AGENT_INTERVAL_HOURS: '2',
  });
  assert.equal(config.port, 4000);
  assert.equal(config.openaiApiKey, 'sk-test');
  assert.equal(config.openaiModel, 'gpt-4o');
  assert.equal(config.agentIntervalHours, 2);
});
