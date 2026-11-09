const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, describeSuccess } = require('../agents/revisorPRs');
const { createRevisionesStore } = require('../lib/revisionesPR');

function tempFile(name, content) {
  const p = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(p, content);
  return p;
}

const PR_ITEM = { number: 7, title: 'Agrega login', html_url: 'https://github.com/jose/app/pull/7', draft: false, user: { login: 'beto' } };

/** merged(): se evalúa en cada `get`; mergeable: mergeable_state del PR; merge(args): respuesta de merge_pull_request; hilos: review_threads. */
function fakeGithub({ items = [PR_ITEM], merged = () => false, mergeable = 'clean', merge = async () => ({ merged: true }), hilos = [], estado = { ok: true, pluginId: 'github' } } = {}) {
  const llamadas = [];
  return {
    owner: 'jose',
    llamadas,
    estado: () => estado,
    llamar: async (tool, args) => {
      llamadas.push({ tool, args });
      if (tool === 'search_pull_requests') return { items };
      if (tool === 'pull_request_read' && args.method === 'get') return { head: { sha: 'abc123' }, merged: merged(), mergeable_state: mergeable };
      if (tool === 'pull_request_read' && args.method === 'get_diff') return 'diff --git a/x.js b/x.js\n+const a = 1;';
      if (tool === 'pull_request_read' && args.method === 'get_review_comments') return { review_threads: hilos };
      if (tool === 'pull_request_review_write') return { ok: true };
      if (tool === 'merge_pull_request') return merge(args);
      throw new Error(`llamada inesperada ${tool}`);
    },
  };
}

function deps(extra = {}) {
  return {
    contextPath: tempFile('ctx', '# Intelekia'),
    rolePath: tempFile('rol', 'Eres el Revisor de PRs.'),
    revisionesPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rev-')), 'revisiones-pr.json'),
    apiKey: 'k',
    model: 'm',
    now: () => new Date('2026-11-09T16:00:00Z'),
    ...extra,
  };
}

test('sin plugin o sin owner el ciclo se omite sin llamar a la IA y en silencio', async () => {
  let llamadasIA = 0;
  const result = await runCycle(deps({
    github: fakeGithub({ estado: { ok: false, motivo: 'Falta GITHUB_OWNER en backend/.env' } }),
    createChatCompletion: async () => { llamadasIA += 1; },
  }));
  assert.deepEqual(result, { omitido: true, motivo: 'Falta GITHUB_OWNER en backend/.env', revisados: [] });
  assert.equal(llamadasIA, 0);
  assert.equal(describeSuccess(result).silencioso, true);
});

test('sin PRs pendientes no llama a la IA y el ciclo es silencioso', async () => {
  let llamadasIA = 0;
  const result = await runCycle(deps({ github: fakeGithub({ items: [] }), createChatCompletion: async () => { llamadasIA += 1; } }));
  assert.deepEqual(result, { omitido: false, revisados: [] });
  assert.equal(llamadasIA, 0);
  assert.deepEqual(describeSuccess(result), { estatus: 'idle', ultimaAccion: 'Sin PRs nuevos por revisar', silencioso: true });
});

test('aprobado solo cuenta si GitHub confirma el merge', async () => {
  let gets = 0;
  const d = deps({
    github: fakeGithub({ merged: () => ++gets > 1 }), // el 1er get es la detección; el 2º, la verificación
    createChatCompletion: async ({ messages, ajustarHerramientas, maxRondas }) => {
      assert.equal(typeof ajustarHerramientas, 'function');
      assert.equal(maxRondas, 15);
      assert.match(messages[0].content, /^Eres el Revisor de PRs\.[\s\S]*Contexto de negocio/);
      assert.match(messages[1].content, /jose\/app/);
      assert.match(messages[1].content, /\+const a = 1;/);
      return 'Revisé el login, todo correcto. Aprobé y mergeé.\nVEREDICTO: APROBADO';
    },
  });
  const result = await runCycle(d);
  assert.deepEqual(result.revisados, [{ clave: 'jose/app#7', veredicto: 'aprobado_mergeado', motivo: null }]);
  const guardado = createRevisionesStore({ filePath: d.revisionesPath }).get('jose/app#7');
  assert.equal(guardado.sha, 'abc123');
  assert.equal(guardado.autor, 'beto');
  assert.deepEqual(describeSuccess(result), { estatus: 'listo_para_revision', ultimaAccion: 'PRs: 1 aprobado(s) y mergeado(s)' });
});

test('dice APROBADO pero GitHub no permite el merge → aprobado_sin_merge; el siguiente ciclo solo reintenta el merge sin IA', async () => {
  let mergeado = false;
  let llamadasIA = 0;
  const github = fakeGithub({
    merged: () => mergeado,
    merge: async (args) => {
      mergeado = true;
      return { merged: true, sha: args.expectedHeadSha };
    },
  });
  const d = deps({ github, createChatCompletion: async () => { llamadasIA += 1; return 'Aprobé; el merge fue rechazado por checks.\nVEREDICTO: APROBADO'; } });
  const r1 = await runCycle(d);
  assert.equal(r1.revisados[0].veredicto, 'aprobado_sin_merge');
  assert.match(r1.revisados[0].motivo, /^Aprobado; GitHub aún no permite el merge \(checks pendientes o reglas del repo\)/);
  assert.match(r1.revisados[0].motivo, /merge fue rechazado/);
  assert.deepEqual(describeSuccess(r1), { estatus: 'listo_para_revision', ultimaAccion: 'PRs: 1 aprobado(s) esperando merge' });

  const r2 = await runCycle(d);
  assert.equal(llamadasIA, 1, 'no vuelve a llamar a la IA');
  const merge = github.llamadas.filter((l) => l.tool === 'merge_pull_request');
  assert.deepEqual(merge.map((l) => l.args), [{ owner: 'jose', repo: 'app', pullNumber: 7, expectedHeadSha: 'abc123' }]);
  assert.deepEqual(r2.revisados, [{ clave: 'jose/app#7', veredicto: 'aprobado_mergeado', motivo: null, soloMerge: true }]);
  assert.equal(createRevisionesStore({ filePath: d.revisionesPath }).get('jose/app#7').veredicto, 'aprobado_mergeado');
  assert.notEqual(describeSuccess(r2).silencioso, true);
});

test('soloMerge: si GitHub sigue sin permitir el merge queda esperando y el ciclo es silencioso', async () => {
  const d = deps({ github: fakeGithub({ merge: async () => ({ merged: false }) }) });
  createRevisionesStore({ filePath: d.revisionesPath }).registrar('jose/app#7', { sha: 'abc123', veredicto: 'aprobado_sin_merge', motivo: 'x' });
  const r = await runCycle({ ...d, createChatCompletion: async () => assert.fail('no debe llamar a la IA') });
  assert.equal(r.revisados[0].veredicto, 'aprobado_sin_merge');
  assert.equal(describeSuccess(r).silencioso, true);
});

test('soloMerge: con comentarios sin resolver no intenta el merge', async () => {
  const github = fakeGithub({ hilos: [{ is_resolved: false }] });
  const d = deps({ github, createChatCompletion: async () => assert.fail('no debe llamar a la IA') });
  createRevisionesStore({ filePath: d.revisionesPath }).registrar('jose/app#7', { sha: 'abc123', veredicto: 'aprobado_sin_merge' });
  const r = await runCycle(d);
  assert.equal(r.revisados[0].veredicto, 'aprobado_sin_merge');
  assert.match(r.revisados[0].motivo, /comentario/);
  assert.equal(github.llamadas.filter((l) => l.tool === 'merge_pull_request').length, 0);
});

test('soloMerge: un error del merge deja el PR esperando (no error)', async () => {
  const d = deps({ github: fakeGithub({ merge: async () => { throw new Error('Required status check "ci" is expected'); } }) });
  createRevisionesStore({ filePath: d.revisionesPath }).registrar('jose/app#7', { sha: 'abc123', veredicto: 'aprobado_sin_merge' });
  const r = await runCycle({ ...d, createChatCompletion: async () => assert.fail('no debe llamar a la IA') });
  assert.equal(r.revisados[0].veredicto, 'aprobado_sin_merge');
  assert.match(r.revisados[0].motivo, /Required status check/);
});

test('sin VEREDICTO → error; al tercer fallo con el mismo commit queda bloqueado', async () => {
  const d = deps({ github: fakeGithub(), createChatCompletion: async () => 'Me perdí.' });
  const r1 = await runCycle(d);
  assert.equal(r1.revisados[0].veredicto, 'error');
  assert.match(r1.revisados[0].motivo, /sin VEREDICTO/);
  await runCycle(d);
  const r3 = await runCycle(d);
  assert.equal(r3.revisados[0].veredicto, 'bloqueado');
  assert.match(r3.revisados[0].motivo, /Falló 3 veces/);
});

test('cambios pedidos se registran con el resumen del modelo', async () => {
  const d = deps({ github: fakeGithub(), createChatCompletion: async () => 'Encontré una inyección SQL en x.js.\nVEREDICTO: CAMBIOS' });
  const result = await runCycle(d);
  assert.deepEqual(result.revisados, [{ clave: 'jose/app#7', veredicto: 'cambios_pedidos', motivo: 'Encontré una inyección SQL en x.js.' }]);
  assert.equal(describeSuccess(result).ultimaAccion, 'PRs: 1 con cambios pedidos');
});

test('conflictos con la rama base: comenta sin IA y queda bloqueado', async () => {
  let llamadasIA = 0;
  const github = fakeGithub({ mergeable: 'dirty' });
  const result = await runCycle(deps({ github, createChatCompletion: async () => { llamadasIA += 1; } }));
  assert.equal(llamadasIA, 0);
  assert.equal(result.revisados[0].veredicto, 'bloqueado');
  const comentario = github.llamadas.find((l) => l.tool === 'pull_request_review_write');
  assert.equal(comentario.args.event, 'COMMENT');
  assert.match(comentario.args.body, /conflictos/);
});

test('un error de GitHub en un PR se registra como error y no tumba el ciclo', async () => {
  const github = fakeGithub();
  const original = github.llamar;
  github.llamar = async (tool, args) => {
    if (args.method === 'get_diff') throw new Error('GitHub 502');
    return original(tool, args);
  };
  const result = await runCycle(deps({ github, createChatCompletion: async () => 'x' }));
  assert.deepEqual(result.revisados, [{ clave: 'jose/app#7', veredicto: 'error', motivo: 'GitHub 502' }]);
});

test('chat responde con sus revisiones como contexto y herramientas de solo lectura', async () => {
  const d = deps({ github: fakeGithub() });
  createRevisionesStore({ filePath: d.revisionesPath }).registrar('jose/app#7', { sha: 'abc123', veredicto: 'cambios_pedidos', motivo: 'SQL' });
  const { reply } = await chat({
    ...d,
    message: '¿Qué revisaste?',
    createChatCompletion: async ({ messages, ajustarHerramientas }) => {
      const sistema = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      assert.match(sistema, /jose\/app#7/);
      const ajustado = ajustarHerramientas({
        tools: [{ type: 'function', function: { name: 'mcp_github__merge_pull_request' } }],
        handlers: { mcp_github__merge_pull_request: async () => 'x' },
      });
      assert.equal(ajustado.tools.length, 0);
      return 'Revisé el #7 y pedí cambios.';
    },
  });
  assert.equal(reply, 'Revisé el #7 y pedí cambios.');
});
