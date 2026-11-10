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

test('archivo corrupto se respalda y no borra la bandeja en silencio', () => {
  const filePath = tmpFile();
  fs.writeFileSync(filePath, '{garbage');
  const a = createAprobaciones({ filePath, now: () => new Date('2026-11-09T10:00:00Z') });
  const warn = console.warn;
  console.warn = () => {};
  let item;
  try {
    item = a.proponer(BASE);
  } finally {
    console.warn = warn;
  }
  const dir = path.dirname(filePath);
  const backups = fs.readdirSync(dir).filter((f) => f.includes('.corrupto-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf-8'), '{garbage');
  assert.deepEqual(a.list().map((i) => i.id), [item.id]);
});

test('guardar es atómico: no deja .tmp', () => {
  const filePath = tmpFile();
  createAprobaciones({ filePath }).proponer(BASE);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  assert.ok(fs.existsSync(filePath));
});

test('una ejecución atascada más de 5 minutos se muestra como error', async () => {
  const filePath = tmpFile();
  let t = new Date('2026-11-09T10:00:00Z').getTime();
  const a = createAprobaciones({ filePath, now: () => new Date(t) });
  let liberar;
  a.registrarEjecutor('responder_comentario', () => new Promise((r) => (liberar = r)));
  const item = a.proponer(BASE);
  const p = a.aprobar(item.id);
  assert.equal(a.list()[0].estado, 'ejecutando');
  t += 6 * 60 * 1000;
  const visto = a.list()[0];
  assert.equal(visto.estado, 'error');
  assert.match(visto.error, /Se interrumpió/);
  liberar();
  await p;
});

test('doble aprobación simultánea ejecuta una sola vez', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  let n = 0;
  a.registrarEjecutor('responder_comentario', async () => {
    n += 1;
    await new Promise((r) => setTimeout(r, 30));
  });
  const item = a.proponer(BASE);
  const res = await Promise.allSettled([a.aprobar(item.id), a.aprobar(item.id)]);
  assert.equal(n, 1);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  const ok = res.find((r) => r.status === 'fulfilled');
  assert.equal(ok.value.estado, 'aprobado');
  const ko = res.find((r) => r.status === 'rejected');
  assert.match(ko.reason.message, /se está ejecutando ahora/);
});

test('al recortar se descartan primero los resueltos y nunca los abiertos', () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const abierto = a.proponer(BASE);
  const resuelto = a.proponer(BASE);
  a.descartar(resuelto.id);
  for (let i = 0; i < 499; i++) a.proponer(BASE);
  const ids = a.list({ limite: 1000 }).map((i) => i.id);
  assert.ok(ids.includes(abierto.id));
  assert.ok(!ids.includes(resuelto.id));
  assert.equal(ids.length, 500);
});

test('la propuesta debe ser texto', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  a.registrarEjecutor('responder_comentario', async () => {});
  const item = a.proponer(BASE);
  await assert.rejects(a.aprobar(item.id, { propuesta: 42 }), /La propuesta debe ser texto/);
});

test('suscribir avisa de cada propuesta y los errores del oyente no rompen proponer', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const vistos = [];
  const quitar = a.suscribir((item) => vistos.push(item.id));
  a.suscribir(() => { throw new Error('oyente roto'); });
  a.suscribir(async () => { throw new Error('oyente async roto'); });
  const item = a.proponer(BASE);
  assert.deepEqual(vistos, [item.id]);
  quitar();
  a.proponer(BASE);
  assert.equal(vistos.length, 1);
  await new Promise((r) => setImmediate(r));
});
