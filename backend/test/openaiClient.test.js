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
