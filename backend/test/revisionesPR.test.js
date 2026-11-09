const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevisionesStore, detectar, parsePrUrl, hilosAbiertos } = require('../lib/revisionesPR');

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
  assert.equal(hilosAbiertos(null), 0);
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
