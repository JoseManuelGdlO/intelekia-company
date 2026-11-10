const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAcceso } = require('../lib/acceso');

async function levantar(opciones) {
  const app = express();
  app.use(createAcceso(opciones));
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}/api/x`, server };
}

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

test('sin usuario/contraseña configurados la oficina queda abierta', async () => {
  const { url, server } = await levantar({});
  try {
    assert.equal((await fetch(url)).status, 200);
  } finally {
    server.close();
  }
});

test('con usuario/contraseña exige Basic Auth correcto', async () => {
  const { url, server } = await levantar({ usuario: 'jose', password: 'se:cre:to' });
  try {
    const sin = await fetch(url);
    assert.equal(sin.status, 401);
    assert.match(sin.headers.get('www-authenticate'), /Basic realm="Oficina Intelekia"/);
    assert.equal((await fetch(url, { headers: { Authorization: basic('jose', 'mal') } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: basic('otro', 'se:cre:to') } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer x' } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: basic('jose', 'se:cre:to') } })).status, 200);
  } finally {
    server.close();
  }
});

test('createAcceso indica si está activo', () => {
  assert.equal(createAcceso({}).activo, false);
  assert.equal(createAcceso({ usuario: 'a', password: 'b' }).activo, true);
});
