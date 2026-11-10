const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoz } = require('../lib/voz');

function fakeFetch(respuesta, llamadas = []) {
  return async (url, opts = {}) => {
    llamadas.push({ url, opts });
    return respuesta;
  };
}

test('transcribir manda el audio a OpenAI y devuelve el texto', async () => {
  const llamadas = [];
  const voz = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: true, json: async () => ({ text: '  hola PM  ' }) }, llamadas) });
  assert.equal(await voz.transcribir(Buffer.from('ogg'), 'audio/ogg'), 'hola PM');
  assert.equal(llamadas[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(llamadas[0].opts.headers.Authorization, 'Bearer sk');
  const form = llamadas[0].opts.body;
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(form.get('language'), 'es');
});

test('transcribir falla con mensaje claro si no hay texto o hay error', async () => {
  const vacio = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: true, json: async () => ({ text: '' }) }) });
  await assert.rejects(vacio.transcribir(Buffer.from('x')), /No se entendió el audio/);
  const error = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: false, status: 401, text: async () => 'bad key' }) });
  await assert.rejects(error.transcribir(Buffer.from('x')), /OpenAI: respuesta 401 bad key/);
  await assert.rejects(createVoz({ apiKey: '' }).transcribir(Buffer.from('x')), /OPENAI_API_KEY/);
});

test('sintetizar pide opus con la voz configurada y quita el formato de WhatsApp', async () => {
  const llamadas = [];
  const voz = createVoz({ apiKey: 'sk', voz: 'nova', fetchImpl: fakeFetch({ ok: true, arrayBuffer: async () => Buffer.from('OGG') }, llamadas) });
  const audio = await voz.sintetizar('*PM:* todo bien');
  assert.equal(audio.toString(), 'OGG');
  assert.equal(llamadas[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.deepEqual(JSON.parse(llamadas[0].opts.body), { model: 'gpt-4o-mini-tts', voice: 'nova', input: 'PM: todo bien', response_format: 'opus' });
});

test('recortar deja máximo ~1500 caracteres y avisa que el resto va por escrito', () => {
  const voz = createVoz({ apiKey: 'sk' });
  const largo = 'Frase de prueba. '.repeat(200);
  const r = voz.recortar(largo);
  assert.ok(r.length <= 1500 + 40);
  assert.match(r, /El resto te lo dejé por escrito\.$/);
  assert.equal(voz.recortar('corto'), 'corto');
});
