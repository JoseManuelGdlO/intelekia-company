const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTvRouter } = require('../routes/tv');

async function levantar(deps) {
  const app = express();
  app.use('/api/tv', createTvRouter(deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/tv`;
  return { base, cerrar: () => server.close() };
}

test('GET /api/tv/estado devuelve el estado y lo guarda 5 s en caché', async () => {
  let llamadas = 0;
  let t = 0;
  const tvEstado = { estado: () => ({ n: ++llamadas }) };
  const { base, cerrar } = await levantar({ tvEstado, now: () => t });
  try {
    assert.deepEqual(await (await fetch(`${base}/estado`)).json(), { n: 1 });
    t = 4999;
    assert.deepEqual(await (await fetch(`${base}/estado`)).json(), { n: 1 });
    t = 5000;
    assert.deepEqual(await (await fetch(`${base}/estado`)).json(), { n: 2 });
    assert.equal(llamadas, 2);
  } finally {
    cerrar();
  }
});

test('si calcular el estado falla responde 500 sin detalles y no guarda la falla', async () => {
  let falla = true;
  const tvEstado = {
    estado: () => {
      if (falla) throw new Error('ruta/secreta');
      return { ok: true };
    },
  };
  const { base, cerrar } = await levantar({ tvEstado, now: () => 0 });
  try {
    const res = await fetch(`${base}/estado`);
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /secreta/);
    falla = false;
    assert.deepEqual(await (await fetch(`${base}/estado`)).json(), { ok: true });
  } finally {
    cerrar();
  }
});
