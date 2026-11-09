const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevisionesStore, detectar, parsePrUrl, hilosAbiertos, herramientasRevision, herramientasSoloLectura, herramientaDe } = require('../lib/revisionesPR');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'revisiones-')), 'revisiones-pr.json');
}

function item(numero, { autor = 'beto', draft = false, repo = 'app' } = {}) {
  return { number: numero, title: `PR ${numero}`, html_url: `https://github.com/jose/${repo}/pull/${numero}`, draft, user: { login: autor } };
}

/** GitHub simulado: shas[numero] = sha del head; hilos[numero] = [{ is_resolved }]. */
function fakeGithub({ items = [], shas = {}, hilos = {} } = {}) {
  const llamadas = [];
  return {
    owner: 'Jose',
    llamadas,
    llamar: async (tool, args) => {
      llamadas.push({ tool, args });
      if (tool === 'search_pull_requests') return { total_count: items.length, items };
      if (tool === 'pull_request_read' && args.method === 'get') {
        return { number: args.pullNumber, head: { sha: shas[args.pullNumber] || 'sha1' }, mergeable_state: 'clean' };
      }
      if (tool === 'pull_request_read' && args.method === 'get_review_comments') {
        return { review_threads: hilos[args.pullNumber] || [], totalCount: 0 };
      }
      throw new Error(`llamada inesperada ${tool}`);
    },
  };
}

test('parsePrUrl y hilosAbiertos', () => {
  assert.deepEqual(parsePrUrl('https://github.com/jose/app/pull/12'), { owner: 'jose', repo: 'app', numero: 12 });
  assert.equal(parsePrUrl('https://github.com/jose/app/issues/12'), null);
  assert.equal(hilosAbiertos({ review_threads: [{ is_resolved: true }, { is_resolved: false }, { is_resolved: false, is_outdated: true }] }), 2);
  assert.equal(hilosAbiertos(null), Infinity);
  assert.equal(hilosAbiertos({ review_threads: [], pageInfo: { hasNextPage: true } }), Infinity);
  assert.equal(hilosAbiertos({ review_threads: [{ is_resolved: true }], totalCount: 3 }), Infinity);
  assert.equal(hilosAbiertos({ review_threads: [{ is_resolved: true }], totalCount: 1 }), 0);
});

test('el store guarda, lee y lista; tolera archivo corrupto', () => {
  const filePath = tmpFile();
  let t = 0;
  const store = createRevisionesStore({ filePath, now: () => new Date(Date.UTC(2026, 10, 9, 10, t++)) });
  assert.equal(store.get('jose/app#1'), null);
  store.registrar('jose/app#1', { sha: 'a', veredicto: 'cambios_pedidos' });
  store.registrar('jose/app#2', { sha: 'b', veredicto: 'aprobado_mergeado' });
  assert.equal(store.get('jose/app#1').sha, 'a');
  assert.deepEqual(store.lista().map((r) => r.clave), ['jose/app#2', 'jose/app#1']);
  fs.writeFileSync(filePath, '{roto');
  assert.deepEqual(store.lista(), []);
});

test('detectar: PR nuevo de otra persona es pendiente; propios y borradores no', async () => {
  const store = createRevisionesStore({ filePath: tmpFile() });
  const github = fakeGithub({ items: [item(1), item(2, { autor: 'jose' }), item(3, { draft: true })], shas: { 1: 'abc' } });
  const pendientes = await detectar({ github, store });
  assert.deepEqual(pendientes, [
    { owner: 'jose', repo: 'app', numero: 1, clave: 'jose/app#1', sha: 'abc', titulo: 'PR 1', autor: 'beto', url: 'https://github.com/jose/app/pull/1', mergeableState: 'clean' },
  ]);
  assert.equal(github.llamadas[0].args.query, 'is:pr is:open draft:false user:Jose');
});

test('detectar: cambios_pedidos solo vuelve con commit nuevo Y todos los hilos resueltos', async () => {
  const store = createRevisionesStore({ filePath: tmpFile() });
  store.registrar('jose/app#1', { sha: 'viejo', veredicto: 'cambios_pedidos' }); // sin commits nuevos
  store.registrar('jose/app#2', { sha: 'viejo', veredicto: 'cambios_pedidos' }); // commit nuevo, hilo abierto
  store.registrar('jose/app#3', { sha: 'viejo', veredicto: 'cambios_pedidos' }); // commit nuevo, todo resuelto
  const github = fakeGithub({
    items: [item(1), item(2), item(3)],
    shas: { 1: 'viejo', 2: 'nuevo', 3: 'nuevo' },
    hilos: { 2: [{ is_resolved: true }, { is_resolved: false }], 3: [{ is_resolved: true }] },
  });
  const pendientes = await detectar({ github, store });
  assert.deepEqual(pendientes.map((p) => p.numero), [3]);
});

test('detectar: error se reintenta; bloqueado solo con commit nuevo; aprobado nunca', async () => {
  const store = createRevisionesStore({ filePath: tmpFile() });
  store.registrar('jose/app#1', { sha: 's', veredicto: 'error', intentos: 1 });
  store.registrar('jose/app#2', { sha: 's', veredicto: 'bloqueado' });
  store.registrar('jose/app#3', { sha: 's', veredicto: 'bloqueado' });
  store.registrar('jose/app#4', { sha: 's', veredicto: 'aprobado_mergeado' });
  const github = fakeGithub({ items: [item(1), item(2), item(3), item(4)], shas: { 1: 's', 2: 's', 3: 'nuevo', 4: 'nuevo' } });
  const pendientes = await detectar({ github, store });
  assert.deepEqual(pendientes.map((p) => p.numero), [1, 3]);
});

test('detectar respeta el tope por ciclo', async () => {
  const store = createRevisionesStore({ filePath: tmpFile() });
  const github = fakeGithub({ items: [1, 2, 3, 4, 5, 6, 7].map((n) => item(n)) });
  assert.equal((await detectar({ github, store })).length, 5);
  assert.equal((await detectar({ github, store, max: 2 })).length, 2);
});

const PR = { owner: 'jose', repo: 'app', numero: 7, clave: 'jose/app#7', sha: 'abc123' };
const MIO = { owner: 'jose', repo: 'app', pullNumber: 7 };

function toolsDePlugin(nombres) {
  const handlers = {};
  const llamadas = [];
  const tools = nombres.map((n) => {
    const name = `mcp_github__${n}`;
    handlers[name] = async (args) => {
      llamadas.push({ n, args });
      return `ok ${n}`;
    };
    return { type: 'function', function: { name, parameters: { type: 'object', properties: {} } } };
  });
  tools.push({ type: 'function', function: { name: 'consultar_companero', parameters: { type: 'object', properties: {} } } });
  handlers.consultar_companero = async () => 'hola';
  return { tools, handlers, llamadas };
}

const TODAS = ['search_pull_requests', 'pull_request_read', 'get_file_contents', 'pull_request_review_write', 'add_comment_to_pending_review', 'merge_pull_request', 'create_or_update_file', 'push_files'];

test('herramientaDe extrae el nombre real de la herramienta del plugin', () => {
  assert.equal(herramientaDe('mcp_github__merge_pull_request'), 'merge_pull_request');
  assert.equal(herramientaDe('consultar_companero'), null);
});

test('herramientasRevision deja solo leer el PR y publicar su revisión', () => {
  const base = toolsDePlugin(TODAS);
  const ajustado = herramientasRevision({ pr: PR, github: fakeGithub() })({ ...base, instrucciones: ['x'] });
  assert.deepEqual(ajustado.tools.map((t) => herramientaDe(t.function.name)).sort(), [
    'add_comment_to_pending_review', 'get_file_contents', 'merge_pull_request', 'pull_request_read', 'pull_request_review_write',
  ]);
  assert.match(ajustado.instrucciones.join(' '), /jose\/app#7/);
});

test('las escrituras solo aceptan el PR en revisión', async () => {
  const base = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(base);
  const otro = await handlers.mcp_github__pull_request_review_write({ owner: 'jose', repo: 'otro', pullNumber: 7, method: 'create', event: 'APPROVE' });
  assert.match(otro, /^Bloqueado/);
  assert.equal(await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'create', event: 'APPROVE' }), 'ok pull_request_review_write');
  assert.deepEqual(base.llamadas.map((l) => l.n), ['pull_request_review_write']);
});

test('el merge se bloquea con hilos sin resolver y fuerza el SHA revisado', async () => {
  const conHilo = toolsDePlugin(TODAS);
  const bloqueado = herramientasRevision({ pr: PR, github: fakeGithub({ hilos: { 7: [{ is_resolved: false }] } }) })(conHilo);
  assert.match(await bloqueado.handlers.mcp_github__merge_pull_request({ ...MIO }), /Merge bloqueado: el PR tiene 1 comentario/);
  assert.equal(conHilo.llamadas.length, 0);

  const limpio = toolsDePlugin(TODAS);
  const permitido = herramientasRevision({ pr: PR, github: fakeGithub({ hilos: { 7: [{ is_resolved: true }] } }) })(limpio);
  assert.equal(await permitido.handlers.mcp_github__merge_pull_request({ ...MIO, expectedHeadSha: 'otro' }), 'ok merge_pull_request');
  assert.equal(limpio.llamadas[0].args.expectedHeadSha, 'abc123');
});

test('el merge se bloquea (fail closed) si la respuesta de hilos es inválida', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: { owner: 'Jose', llamar: async () => 'oops' } })(t);
  assert.match(await handlers.mcp_github__merge_pull_request({ ...MIO }), /no se pudo confirmar/);
  assert.equal(t.llamadas.length, 0);
});

test('el merge de otro repo se bloquea sin llamar al handler original', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(t);
  assert.match(await handlers.mcp_github__merge_pull_request({ owner: 'jose', repo: 'otro', pullNumber: 7 }), /^Bloqueado/);
  assert.equal(t.llamadas.length, 0);
});

test('herramientasSoloLectura deja solo consultas para el chat', () => {
  const ajustado = herramientasSoloLectura()(toolsDePlugin(TODAS));
  assert.deepEqual(ajustado.tools.map((t) => herramientaDe(t.function.name)).sort(), ['get_file_contents', 'pull_request_read', 'search_pull_requests']);
  assert.deepEqual(Object.keys(ajustado.handlers).length, 3);
  assert.match(ajustado.instrucciones[0], /nunca desde el chat/);
});

test('review_write: resolve/unresolve de hilos se bloquean sin llamar al handler original', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(t);
  for (const method of ['resolve_thread', 'unresolve_thread']) {
    const r = await handlers.mcp_github__pull_request_review_write({ ...MIO, method, threadId: 'T1' });
    assert.equal(r, `Bloqueado: no puedes usar el método "${method}"; solo puedes crear y enviar tu review.`);
  }
  assert.equal(t.llamadas.length, 0);
});

test('review_write: un event desconocido se bloquea', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(t);
  assert.match(await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'submit_pending', event: 'DISMISS' }), /^Bloqueado/);
  assert.equal(t.llamadas.length, 0);
  await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'submit_pending', event: 'REQUEST_CHANGES', body: 'x' });
  await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'delete_pending' });
  assert.equal(t.llamadas.length, 2);
});

test('review_write create fuerza commitID al SHA revisado', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(t);
  await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'create', event: 'APPROVE', commitID: 'otro' });
  await handlers.mcp_github__pull_request_review_write({ ...MIO, method: 'create' });
  assert.deepEqual(t.llamadas.map((l) => l.args.commitID), ['abc123', 'abc123']);
});

test('las lecturas solo aceptan el PR en revisión y su repo', async () => {
  const t = toolsDePlugin(TODAS);
  const { handlers } = herramientasRevision({ pr: PR, github: fakeGithub() })(t);
  assert.match(await handlers.mcp_github__pull_request_read({ method: 'get_diff', owner: 'jose', repo: 'app', pullNumber: 8 }), /^Bloqueado/);
  assert.match(await handlers.mcp_github__pull_request_read({ method: 'get', owner: 'otra', repo: 'app', pullNumber: 7 }), /^Bloqueado/);
  assert.match(await handlers.mcp_github__get_file_contents({ owner: 'jose', repo: 'secreto', path: '.env' }), /^Bloqueado/);
  assert.match(await handlers.mcp_github__get_file_contents({ owner: 'otra', repo: 'app', path: 'x.js' }), /^Bloqueado/);
  assert.equal(t.llamadas.length, 0);
  assert.equal(await handlers.mcp_github__pull_request_read({ ...MIO, method: 'get_files' }), 'ok pull_request_read');
  assert.equal(await handlers.mcp_github__get_file_contents({ owner: 'Jose', repo: 'APP', path: 'x.js', ref: 'refs/heads/feature' }), 'ok get_file_contents');
  assert.equal(t.llamadas.length, 2);
});
