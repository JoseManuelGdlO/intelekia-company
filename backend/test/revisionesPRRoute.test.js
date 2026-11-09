const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createRevisionesPRRouter } = require('../routes/revisionesPR');
const { createRevisionesStore } = require('../lib/revisionesPR');

test('GET /api/revisiones-pr devuelve la lista de PRs revisados', async () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rev-route-')), 'revisiones-pr.json');
  createRevisionesStore({ filePath }).registrar('jose/app#7', { titulo: 'Login', veredicto: 'cambios_pedidos', sha: 'abc' });
  const app = express();
  app.use('/api/revisiones-pr', createRevisionesPRRouter({ filePath }));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/revisiones-pr`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].clave, 'jose/app#7');
    assert.equal(body[0].veredicto, 'cambios_pedidos');
  } finally {
    server.close();
  }
});
