const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeta } = require('../lib/meta');

const CONFIG = { pageToken: 'tok', pageId: 'PAGE', igUserId: 'IG', apiVersion: 'v21.0' };

/** Graph API simulada: rutas -> respuesta; registra cada llamada. */
function fakeFetch(rutas, llamadas = []) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    const ruta = u.pathname.replace('/v21.0/', '');
    llamadas.push({ ruta, metodo: opts.method || 'GET', params: Object.fromEntries(u.searchParams), body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    const data = typeof rutas[ruta] === 'function' ? rutas[ruta](u, opts) : rutas[ruta];
    if (data === undefined) return { ok: false, status: 404, json: async () => ({ error: { message: `sin ruta ${ruta}` } }) };
    return { ok: !data.error, status: data.error ? 400 : 200, json: async () => data };
  };
}

const RUTAS = {
  'PAGE/posts': { data: [{ id: 'P1', message: 'Lanzamos bots', permalink_url: 'https://fb.com/p1' }] },
  'P1/comments': {
    data: [
      { id: 'FC2', message: '¿Cuánto cuesta?', from: { id: 'U1', name: 'Ana López' }, created_time: '2026-11-09T10:00:00+0000' },
      { id: 'FC3', message: 'Gracias por comentar', from: { id: 'PAGE', name: 'Intelekia' }, created_time: '2026-11-09T11:00:00+0000' },
      { id: 'FC1', message: 'viejo', from: { id: 'U2', name: 'Beto' }, created_time: '2026-11-01T10:00:00+0000' },
    ],
  },
  IG: { id: 'IG', username: 'intelekia' },
  'IG/media': { data: [{ id: 'M1', caption: 'Tip del día', permalink: 'https://ig.com/m1' }] },
  'M1/comments': {
    data: [
      { id: 'IC1', text: 'Me interesa', username: 'carla', timestamp: '2026-11-09T09:00:00+0000' },
      { id: 'IC2', text: 'Te escribimos por DM', username: 'intelekia', timestamp: '2026-11-09T09:30:00+0000' },
    ],
  },
};

test('estado explica la configuración faltante', () => {
  assert.match(createMeta({ config: { ...CONFIG, pageToken: '' } }).estado().motivo, /META_PAGE_TOKEN/);
  assert.match(createMeta({ config: { ...CONFIG, pageId: '', igUserId: '' } }).estado().motivo, /META_PAGE_ID/);
  assert.deepEqual(createMeta({ config: { ...CONFIG, igUserId: '' } }).estado(), { ok: true, facebook: true, instagram: false });
});

test('comentariosRecientes normaliza FB e IG, excluye propios y viejos, y usa Bearer', async () => {
  const llamadas = [];
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(RUTAS, llamadas) });
  const { comentarios, errores } = await meta.comentariosRecientes({ desde: new Date('2026-11-06T00:00:00Z') });
  assert.deepEqual(errores, []);
  assert.deepEqual(comentarios, [
    { id: 'IC1', red: 'instagram', texto: 'Me interesa', autor: 'carla', creadoEn: '2026-11-09T09:00:00.000Z', publicacionId: 'M1', publicacionTexto: 'Tip del día', permalink: 'https://ig.com/m1' },
    { id: 'FC2', red: 'facebook', texto: '¿Cuánto cuesta?', autor: 'Ana López', creadoEn: '2026-11-09T10:00:00.000Z', publicacionId: 'P1', publicacionTexto: 'Lanzamos bots', permalink: 'https://fb.com/p1' },
  ]);
  assert.ok(llamadas.every((l) => l.auth === 'Bearer tok'));
  assert.ok(llamadas.every((l) => !('access_token' in l.params)));
});

test('si una red falla, devuelve la otra y reporta el error', async () => {
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch({ ...RUTAS, 'PAGE/posts': { error: { message: 'Token vencido' } } }) });
  const { comentarios, errores } = await meta.comentariosRecientes({ desde: new Date('2026-11-06T00:00:00Z') });
  assert.deepEqual(comentarios.map((c) => c.id), ['IC1']);
  assert.match(errores[0], /Facebook: Meta: Token vencido/);
});

test('responder usa /comments en Facebook y /replies en Instagram', async () => {
  const llamadas = [];
  const rutas = { 'FC2/comments': { id: 'R1' }, 'IC1/replies': { id: 'R2' } };
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(rutas, llamadas) });
  assert.deepEqual(await meta.responder({ red: 'facebook', comentarioId: 'FC2', mensaje: '¡Hola Ana!' }), { id: 'R1' });
  assert.deepEqual(await meta.responder({ red: 'instagram', comentarioId: 'IC1', mensaje: '¡Hola Carla!' }), { id: 'R2' });
  assert.deepEqual(llamadas.map((l) => [l.ruta, l.metodo, l.body]), [
    ['FC2/comments', 'POST', { message: '¡Hola Ana!' }],
    ['IC1/replies', 'POST', { message: '¡Hola Carla!' }],
  ]);
  await assert.rejects(meta.responder({ red: 'tiktok', comentarioId: 'x', mensaje: 'y' }), /Red desconocida/);
  await assert.rejects(meta.responder({ red: 'facebook', comentarioId: 'x', mensaje: '  ' }), /vacío/);
});
