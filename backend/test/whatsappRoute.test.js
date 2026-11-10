const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { createWhatsapp } = require('../lib/whatsapp');
const { createWhatsappWebhookApp, createWhatsappEstadoRouter } = require('../routes/whatsapp');

const CONFIG = { token: 't', phoneNumberId: 'p', verifyToken: 'palabra', appSecret: 'secreto', permitidos: ['528710000000'] };

/** Levanta la app SOLO del webhook (la que se expone con ngrok). */
async function levantar(recepcion, config = CONFIG) {
  const registros = [];
  const app = createWhatsappWebhookApp({ whatsapp: createWhatsapp({ config }), recepcion, config, registrar: (...a) => registros.push(a) });
  const server = app.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}`, server, registros };
}

const PAYLOAD = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '5218710000000', timestamp: '1', type: 'text', text: { body: 'PM hola' } }] } }] }] };
const firmar = (body) => `sha256=${crypto.createHmac('sha256', 'secreto').update(body).digest('hex')}`;
const postFirmado = (url, body) =>
  fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(Buffer.from(body)) }, body });

test('GET verifica el webhook con el verify token', async () => {
  const { url, server } = await levantar({ procesar: async () => {}, estadoCanal: () => ({}) });
  try {
    const ok = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=palabra&hub.challenge=123`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '123');
    const mal = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=123`);
    assert.equal(mal.status, 403);
  } finally {
    server.close();
  }
});

test('POST con firma válida responde 200 y procesa en segundo plano; firma inválida → 401', async () => {
  const procesados = [];
  const { url, server, registros } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({}) });
  try {
    const body = JSON.stringify(PAYLOAD);
    const ok = await postFirmado(url, body);
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(procesados.map((m) => [m.id, m.texto]), [['m1', 'PM hola']]);
    const mal = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' }, body });
    assert.equal(mal.status, 401);
    assert.match(registros.at(-1)[2], /firma inválida/);
  } finally {
    server.close();
  }
});

test('la app del webhook no expone la oficina: todo lo demás es 404', async () => {
  const { url, server } = await levantar({ procesar: async () => {}, estadoCanal: () => ({}) });
  try {
    for (const ruta of ['/api/agents', '/api/whatsapp/estado', '/', '/index.html']) {
      assert.equal((await fetch(`${url}${ruta}`)).status, 404, ruta);
    }
    assert.equal((await fetch(`${url}/api/agents/pm/chat`, { method: 'POST' })).status, 404);
  } finally {
    server.close();
  }
});

test('sin configuración completa responde 200, no procesa y lo registra una sola vez', async () => {
  const procesados = [];
  const config = { ...CONFIG, token: '' };
  const { url, server, registros } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({}) }, config);
  try {
    const body = JSON.stringify(PAYLOAD);
    assert.equal((await postFirmado(url, body)).status, 200);
    assert.equal((await postFirmado(url, body)).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(procesados.length, 0);
    const avisos = registros.filter((r) => /llegó un mensaje pero falta configuración/.test(r[2]));
    assert.equal(avisos.length, 1);
  } finally {
    server.close();
  }
});

test('GET /api/whatsapp/estado (en la app de la oficina) junta configuración y canal', async () => {
  const app = express();
  app.use(createWhatsappEstadoRouter({ whatsapp: createWhatsapp({ config: CONFIG }), recepcion: { estadoCanal: () => ({ permitidos: ['…0000'] }) } }));
  const server = app.listen(0);
  try {
    const estado = await (await fetch(`http://127.0.0.1:${server.address().port}/api/whatsapp/estado`)).json();
    assert.deepEqual(estado, { ok: true, permitidos: ['…0000'] });
  } finally {
    server.close();
  }
});
