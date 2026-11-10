const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { createWhatsapp } = require('../lib/whatsapp');
const { createWhatsappRouter } = require('../routes/whatsapp');

const CONFIG = { token: 't', phoneNumberId: 'p', verifyToken: 'palabra', appSecret: 'secreto', permitidos: ['5218710000000'] };

async function levantar(recepcion, config = CONFIG) {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  const registros = [];
  app.use(createWhatsappRouter({ whatsapp: createWhatsapp({ config }), recepcion, config, registrar: (...a) => registros.push(a) }));
  const server = app.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}`, server, registros };
}

const PAYLOAD = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '5218710000000', timestamp: '1', type: 'text', text: { body: 'PM hola' } }] } }] }] };
const firmar = (body) => `sha256=${crypto.createHmac('sha256', 'secreto').update(body).digest('hex')}`;

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
  const { url, server, registros } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({ permitidos: ['…0000'] }) });
  try {
    const body = JSON.stringify(PAYLOAD);
    const ok = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(Buffer.from(body)) }, body });
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(procesados.map((m) => [m.id, m.texto]), [['m1', 'PM hola']]);
    const mal = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' }, body });
    assert.equal(mal.status, 401);
    assert.match(registros.at(-1)[2], /firma inválida/);
    const estado = await (await fetch(`${url}/api/whatsapp/estado`)).json();
    assert.deepEqual(estado, { ok: true, permitidos: ['…0000'] });
  } finally {
    server.close();
  }
});

test('sin configuración completa responde 200 pero no procesa', async () => {
  const procesados = [];
  const config = { ...CONFIG, token: '' };
  const { url, server } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({}) }, config);
  try {
    const body = JSON.stringify(PAYLOAD);
    const res = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(Buffer.from(body)) }, body });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(procesados.length, 0);
  } finally {
    server.close();
  }
});
