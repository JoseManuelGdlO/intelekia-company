const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createAprobaciones } = require('../lib/aprobaciones');
const { createAprobacionesRouter } = require('../routes/aprobaciones');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aprob-')), 'aprobaciones.json');
}

const BASE = { agentId: 'respuestas-redes', tipo: 'responder_comentario', titulo: 'Instagram · ana', propuesta: '¡Gracias, Ana!', contexto: { red: 'instagram', comentarioId: 'c1' } };

test('proponer crea un pendiente que persiste y se lista', () => {
  const filePath = tmpFile();
  const a = createAprobaciones({ filePath });
  const item = a.proponer({ ...BASE, motivo: 'Supervisado' });
  assert.equal(item.estado, 'por_aprobar');
  assert.equal(item.motivo, 'Supervisado');
  const b = createAprobaciones({ filePath });
  assert.deepEqual(b.list({ estado: 'por_aprobar' }).map((i) => i.id), [item.id]);
  assert.equal(b.pendientes(), 1);
});

test('aprobar ejecuta con la propuesta (editable) y queda aprobado; no se aprueba dos veces', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const ejecutados = [];
  a.registrarEjecutor('responder_comentario', async (item) => ejecutados.push(item.propuesta));
  const item = a.proponer(BASE);
  const hecho = await a.aprobar(item.id, { propuesta: '  ¡Mil gracias, Ana!  ' });
  assert.equal(hecho.estado, 'aprobado');
  assert.ok(hecho.resueltoEn);
  assert.deepEqual(ejecutados, ['¡Mil gracias, Ana!']);
  await assert.rejects(a.aprobar(item.id), /ya está aprobado/);
  assert.equal(a.pendientes(), 0);
});

test('si el ejecutor falla queda en error y se puede reintentar', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  let falla = true;
  a.registrarEjecutor('responder_comentario', async () => {
    if (falla) throw new Error('Meta: token vencido');
  });
  const item = a.proponer(BASE);
  const r1 = await a.aprobar(item.id);
  assert.equal(r1.estado, 'error');
  assert.equal(r1.error, 'Meta: token vencido');
  assert.equal(a.pendientes(), 1);
  falla = false;
  const r2 = await a.aprobar(item.id);
  assert.equal(r2.estado, 'aprobado');
  assert.equal(r2.error, null);
});

test('proponer con error crea el elemento en estado error', () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const item = a.proponer({ ...BASE, motivo: 'Falló al publicar', error: 'Meta: sin permiso' });
  assert.equal(item.estado, 'error');
  assert.equal(item.error, 'Meta: sin permiso');
});

test('validaciones: propuesta vacía, tipo sin ejecutor, id desconocido, descartar', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const vacio = a.proponer({ ...BASE, propuesta: '' });
  a.registrarEjecutor('responder_comentario', async () => {});
  await assert.rejects(a.aprobar(vacio.id), /vacía/);
  const otro = a.proponer({ ...BASE, tipo: 'otra_cosa' });
  await assert.rejects(a.aprobar(otro.id), /No hay cómo ejecutar/);
  await assert.rejects(a.aprobar('nada'), /desconocida/);
  const d = a.descartar(vacio.id);
  assert.equal(d.estado, 'descartado');
  assert.throws(() => a.descartar(vacio.id), /ya está descartado/);
  assert.throws(() => a.proponer({ agentId: 'x', propuesta: 'y' }), /Faltan/);
});

test('rutas: listar, aprobar y descartar', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  a.registrarEjecutor('responder_comentario', async () => {});
  const i1 = a.proponer(BASE);
  const i2 = a.proponer(BASE);
  const app = express();
  app.use(express.json());
  app.use('/api/aprobaciones', createAprobacionesRouter({ aprobaciones: a }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/aprobaciones`;
  try {
    const lista = await (await fetch(`${url}?estado=por_aprobar`)).json();
    assert.equal(lista.items.length, 2);
    assert.equal(lista.pendientes, 2);
    const ok = await (await fetch(`${url}/${i1.id}/aprobar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propuesta: 'Editada' }) })).json();
    assert.equal(ok.estado, 'aprobado');
    assert.equal(ok.propuesta, 'Editada');
    const desc = await (await fetch(`${url}/${i2.id}/descartar`, { method: 'POST' })).json();
    assert.equal(desc.estado, 'descartado');
    const nf = await fetch(`${url}/nada/descartar`, { method: 'POST' });
    assert.equal(nf.status, 404);
  } finally {
    server.close();
  }
});
