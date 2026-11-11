const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompletion } = require('../lib/openaiClient');

test('createChatCompletion returns the message content on success', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4o-mini');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hola' } }] }),
    };
  };

  const result = await createChatCompletion({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
  });

  assert.equal(result, 'hola');
});

test('createChatCompletion throws when the response is not ok', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'invalid api key',
  });

  await assert.rejects(
    createChatCompletion({
      apiKey: 'bad-key',
      model: 'gpt-4o-mini',
      messages: [],
      fetchImpl: fakeFetch,
    }),
    /OpenAI request failed: 401/
  );
});

test('createChatCompletionMessage envía herramientas y devuelve tool_calls', async () => {
  const { createChatCompletionMessage } = require('../lib/openaiClient');
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tool_choice, 'none');
    return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'x' }] } }] }) };
  };
  const message = await createChatCompletionMessage({
    apiKey: 'k',
    model: 'm',
    messages: [],
    tools: [{ type: 'function', function: { name: 'f' } }],
    toolChoice: 'none',
    fetchImpl: fakeFetch,
  });
  assert.equal(message.tool_calls[0].id, 'x');
});

test('createChatCompletion no envía tools cuando no hay', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal('tools' in JSON.parse(options.body), false);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  assert.equal(await createChatCompletion({ apiKey: 'k', model: 'm', messages: [], fetchImpl: fakeFetch }), 'ok');
});

test('setUsageListener recibe el modelo y el consumo de cada respuesta OK', async (t) => {
  const { setUsageListener } = require('../lib/openaiClient');
  t.after(() => setUsageListener(null));
  const recibidos = [];
  setUsageListener((model, usage) => recibidos.push({ model, usage }));
  const usage = { prompt_tokens: 10, completion_tokens: 5 };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ model: 'gpt-4o-mini-2024-07-18', usage, choices: [{ message: { content: 'ok' } }] }) });
  assert.equal(await createChatCompletion({ apiKey: 'k', model: 'gpt-4o-mini', messages: [], fetchImpl: fakeFetch }), 'ok');
  assert.deepEqual(recibidos, [{ model: 'gpt-4o-mini-2024-07-18', usage }]);
  // Sin usage en la respuesta no se llama.
  await createChatCompletion({ apiKey: 'k', model: 'm', messages: [], fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }) });
  assert.equal(recibidos.length, 1);
});

test('un listener de consumo que lanza no rompe la llamada', async (t) => {
  const { setUsageListener } = require('../lib/openaiClient');
  t.after(() => setUsageListener(null));
  setUsageListener(() => {
    throw new Error('medidor roto');
  });
  const fakeFetch = async () => ({ ok: true, json: async () => ({ usage: { prompt_tokens: 1 }, choices: [{ message: { content: 'sigue' } }] }) });
  assert.equal(await createChatCompletion({ apiKey: 'k', model: 'm', messages: [], fetchImpl: fakeFetch }), 'sigue');
});
