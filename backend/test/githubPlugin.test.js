const test = require('node:test');
const assert = require('node:assert/strict');
const { createGithubPlugin } = require('../lib/githubPlugin');

const HERRAMIENTAS = ['search_pull_requests', 'pull_request_read', 'pull_request_review_write', 'merge_pull_request'].map((nombre) => ({ nombre }));

function setup({ asignados = ['github'], respuesta = '{"items":[]}', owner = 'jose' } = {}) {
  const llamadas = [];
  const instalables = {
    list: () => ({ plugins: [{ id: 'deepwiki', herramientas: [{ nombre: 'ask' }] }, { id: 'github', herramientas: HERRAMIENTAS }] }),
    llamar: async (...args) => {
      llamadas.push(args);
      return typeof respuesta === 'function' ? respuesta(...args) : respuesta;
    },
  };
  const profiles = { instaladosOf: () => ({ skills: [], plugins: asignados }) };
  return { github: createGithubPlugin({ instalables, profiles, agentId: 'revisor-prs', owner }), llamadas };
}

test('estado encuentra el plugin de GitHub asignado al agente', () => {
  assert.deepEqual(setup().github.estado(), { ok: true, pluginId: 'github' });
});

test('estado explica qué falta: owner o plugin asignado', () => {
  assert.match(setup({ owner: '' }).github.estado().motivo, /GITHUB_OWNER/);
  assert.match(setup({ asignados: ['deepwiki'] }).github.estado().motivo, /plugin de GitHub/);
});

test('llamar parsea JSON, pide el resultado sin recorte y devuelve texto si no es JSON', async () => {
  const { github, llamadas } = setup({ respuesta: '{"items":[{"number":1}]}' });
  assert.deepEqual(await github.llamar('search_pull_requests', { query: 'q' }), { items: [{ number: 1 }] });
  assert.deepEqual(llamadas[0], ['github', 'search_pull_requests', { query: 'q' }, { maxChars: Infinity }]);
  const texto = setup({ respuesta: 'diff --git a b' }).github;
  assert.equal(await texto.llamar('pull_request_read', { method: 'get_diff' }), 'diff --git a b');
});

test('llamar lanza si el plugin responde con error o no está disponible', async () => {
  await assert.rejects(setup({ respuesta: 'Error del plugin: Not Found' }).github.llamar('pull_request_read', {}), /Not Found/);
  await assert.rejects(setup({ asignados: [] }).github.llamar('pull_request_read', {}), /plugin de GitHub/);
});
