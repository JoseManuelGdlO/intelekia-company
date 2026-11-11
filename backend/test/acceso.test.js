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

// --- Usuario de solo lectura para la TV ---
const http = require('http');

const ADMIN = { usuario: 'jose', password: 'admin-pass' };
const TV = { tvUsuario: 'tele', tvPassword: 'tv-pass' };

async function levantarRoles(opciones) {
  const app = express();
  app.use(createAcceso(opciones));
  app.all('*', (req, res) => res.json({ ruta: req.path, rol: req.rolAcceso || null }));
  const server = app.listen(0);
  return { port: server.address().port, server };
}

/** Petición cruda (sin que el cliente normalice la ruta: '..' y '%2e' llegan tal cual). */
function pedir(port, ruta, { metodo = 'GET', auth } = {}) {
  return new Promise((resolve, reject) => {
    const headers = auth ? { Authorization: auth } : {};
    const req = http.request({ host: '127.0.0.1', port, path: ruta, method: metodo, headers }, (res) => {
      let cuerpo = '';
      res.on('data', (c) => (cuerpo += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, cuerpo }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('rol tv: solo GET/HEAD de la pantalla, estáticos y /api/tv', async () => {
  const { port, server } = await levantarRoles({ ...ADMIN, ...TV });
  const tv = basic('tele', 'tv-pass');
  try {
    for (const ruta of ['/tv.html', '/tv.css', '/styles.css', '/src/scene.js', '/src/a/b.js', '/assets/logo.png', '/vendor/x.js', '/favicon.ico', '/api/tv', '/api/tv/estado']) {
      const res = await pedir(port, ruta, { auth: tv });
      assert.equal(res.status, 200, ruta);
      assert.equal(JSON.parse(res.cuerpo).rol, 'tv');
    }
    assert.equal((await pedir(port, '/api/tv/estado', { metodo: 'HEAD', auth: tv })).status, 200);
  } finally {
    server.close();
  }
});

test('rol tv: 403 en todo lo demás (otras APIs, POST, index, rutas parecidas)', async () => {
  const { port, server } = await levantarRoles({ ...ADMIN, ...TV });
  const tv = basic('tele', 'tv-pass');
  try {
    for (const ruta of ['/api/agents', '/api/oficina', '/index.html', '/api/tvx', '/srcx/a.js', '/API/agents']) {
      const res = await pedir(port, ruta, { auth: tv });
      assert.equal(res.status, 403, ruta);
      assert.match(res.cuerpo, /Solo lectura \(pantalla de la oficina\)/);
    }
    assert.equal((await pedir(port, '/api/tv/estado', { metodo: 'POST', auth: tv })).status, 403);
    assert.equal((await pedir(port, '/src/main.js', { metodo: 'PUT', auth: tv })).status, 403);
  } finally {
    server.close();
  }
});

test('rol tv: rechaza rutas con ".." aunque vengan codificadas', async () => {
  const { port, server } = await levantarRoles({ ...ADMIN, ...TV });
  const tv = basic('tele', 'tv-pass');
  try {
    for (const ruta of ['/src/../api/agents', '/src/%2e%2e/api/agents', '/src/%2E%2E/api/agents', '/src/..%2fapi/agents', '/src/%252e%252e/api/agents', '/src/%zz', '/api/tv/..%5c..%5capi']) {
      assert.equal((await pedir(port, ruta, { auth: tv })).status, 403, ruta);
    }
  } finally {
    server.close();
  }
});

test('rol tv: la raíz redirige a /tv.html', async () => {
  const { port, server } = await levantarRoles({ ...ADMIN, ...TV });
  try {
    const res = await pedir(port, '/', { auth: basic('tele', 'tv-pass') });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/tv.html');
  } finally {
    server.close();
  }
});

test('admin tiene acceso completo y contraseñas incorrectas dan 401', async () => {
  const { port, server } = await levantarRoles({ ...ADMIN, ...TV });
  const admin = basic('jose', 'admin-pass');
  try {
    for (const [ruta, metodo] of [['/api/agents', 'GET'], ['/', 'GET'], ['/api/tv/estado', 'POST'], ['/index.html', 'GET']]) {
      const res = await pedir(port, ruta, { metodo, auth: admin });
      assert.equal(res.status, 200, ruta);
      assert.equal(JSON.parse(res.cuerpo).rol, 'admin');
    }
    assert.equal((await pedir(port, '/tv.html', { auth: basic('tele', 'mal') })).status, 401);
    assert.equal((await pedir(port, '/tv.html', { auth: basic('jose', 'tv-pass') })).status, 401);
    assert.equal((await pedir(port, '/tv.html')).status, 401);
  } finally {
    server.close();
  }
});

test('solo con usuario de TV (sin admin) la oficina sigue abierta', async () => {
  const acceso = createAcceso({ ...TV });
  assert.equal(acceso.activo, false);
  const { port, server } = await levantarRoles({ ...TV });
  try {
    assert.equal((await pedir(port, '/api/agents')).status, 200);
  } finally {
    server.close();
  }
});
