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

test('errores de red se envuelven en un mensaje claro', async () => {
  const meta = createMeta({ config: CONFIG, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(meta.responder({ red: 'facebook', comentarioId: 'a', mensaje: 'hi' }), /Meta: no se pudo conectar \(ECONNRESET\)/);
});

test('el fetch recibe una señal de timeout', async () => {
  let signal;
  const meta = createMeta({ config: CONFIG, fetchImpl: async (u, o) => { signal = o.signal; return { ok: true, status: 200, json: async () => ({}) }; } });
  await meta.responder({ red: 'facebook', comentarioId: 'a', mensaje: 'hi' });
  assert.ok(signal instanceof AbortSignal);
});

test('los ids se codifican en la ruta', async () => {
  const urls = [];
  const meta = createMeta({ config: CONFIG, fetchImpl: async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({}) }; } });
  await meta.responder({ red: 'facebook', comentarioId: 'a/b?c', mensaje: 'hi' });
  assert.match(urls[0], /\/a%2Fb%3Fc\/comments$/);
});

test('desde inválido lanza error', async () => {
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(RUTAS) });
  await assert.rejects(meta.comentariosRecientes({ desde: 'ayer' }), /desde debe ser una fecha válida/);
  await assert.rejects(meta.comentariosRecientes({ desde: new Date('x') }), /desde debe ser una fecha válida/);
});

test('respuesta HTTP 500 sin JSON se reporta con el código', async () => {
  const meta = createMeta({ config: CONFIG, fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error('no json'); } }) });
  await assert.rejects(meta.responder({ red: 'facebook', comentarioId: 'a', mensaje: 'hi' }), /respuesta 500/);
});

test('el error 190 de Meta explica que el token venció', async () => {
  const meta = createMeta({ config: CONFIG, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Error validating access token', code: 190 } }) }) });
  await assert.rejects(
    meta.responder({ red: 'facebook', comentarioId: 'a', mensaje: 'hi' }),
    (err) => err.message === 'Meta: el token venció o no es válido (genera uno nuevo y actualiza META_PAGE_TOKEN)'
  );
});

test('si falla una publicación, se reporta y se siguen leyendo las demás', async () => {
  const rutas = {
    ...RUTAS,
    'PAGE/posts': { data: [{ id: 'P0', message: 'rota' }, { id: 'P1', message: 'Lanzamos bots', permalink_url: 'https://fb.com/p1' }] },
    'P0/comments': { error: { message: 'Objeto no disponible' } },
    'IG/media': { data: [{ id: 'M0', caption: 'rota' }, { id: 'M1', caption: 'Tip del día', permalink: 'https://ig.com/m1' }] },
    'M0/comments': { error: { message: 'Sin permiso' } },
  };
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(rutas) });
  const { comentarios, errores } = await meta.comentariosRecientes({ desde: new Date('2026-11-06T00:00:00Z') });
  assert.deepEqual(comentarios.map((c) => c.id), ['IC1', 'FC2']);
  assert.deepEqual(errores, ['Facebook: P0: Meta: Objeto no disponible', 'Instagram: M0: Meta: Sin permiso']);
});

test('un comentario de Facebook sin "from" se trata como externo con autor Desconocido', async () => {
  const rutas = { ...RUTAS, 'P1/comments': { data: [{ id: 'FC9', message: 'Hola', created_time: '2026-11-09T10:00:00+0000' }] } };
  const meta = createMeta({ config: { ...CONFIG, igUserId: '' }, fetchImpl: fakeFetch(rutas) });
  const { comentarios } = await meta.comentariosRecientes({ desde: new Date('2026-11-06T00:00:00Z') });
  assert.deepEqual(comentarios.map((c) => [c.id, c.autor]), [['FC9', 'Desconocido']]);
});

test('yaRespondido detecta respuestas de la página en Facebook', async () => {
  const llamadas = [];
  const rutas = {
    'FC2/comments': { data: [{ id: 'r1', from: { id: 'U9' } }, { id: 'r2', from: { id: 'PAGE' } }] },
    'FC3/comments': { data: [{ id: 'r3', from: { id: 'U9' } }, { id: 'r4' }] },
  };
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(rutas, llamadas) });
  assert.equal(await meta.yaRespondido({ red: 'facebook', comentarioId: 'FC2' }), true);
  assert.equal(await meta.yaRespondido({ red: 'facebook', comentarioId: 'FC3' }), false);
  assert.deepEqual(llamadas[0].params, { fields: 'from', limit: '50' });
  assert.equal(llamadas[0].metodo, 'GET');
});

test('yaRespondido detecta respuestas de la cuenta en Instagram y guarda el usuario', async () => {
  const llamadas = [];
  const rutas = {
    IG: { id: 'IG', username: 'intelekia' },
    'IC1/replies': { data: [{ id: 'x', username: 'carla' }, { id: 'y', username: 'intelekia' }] },
    'IC5/replies': { data: [{ id: 'z', username: 'carla' }] },
  };
  const meta = createMeta({ config: CONFIG, fetchImpl: fakeFetch(rutas, llamadas) });
  assert.equal(await meta.yaRespondido({ red: 'instagram', comentarioId: 'IC1' }), true);
  assert.equal(await meta.yaRespondido({ red: 'instagram', comentarioId: 'IC5' }), false);
  assert.equal(llamadas.filter((l) => l.ruta === 'IG').length, 1);
  assert.deepEqual(llamadas.find((l) => l.ruta === 'IC1/replies').params, { fields: 'username', limit: '50' });
  await assert.rejects(meta.yaRespondido({ red: 'tiktok', comentarioId: 'a' }), /Red desconocida/);
});
