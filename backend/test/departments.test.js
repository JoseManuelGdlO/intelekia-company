const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildDepartments } = require('../departments');
const buscadorTendencias = require('../agents/buscadorTendencias');
const publicador = require('../agents/publicador');
const buscadorProspectos = require('../agents/buscadorProspectos');
const seguimientoCRM = require('../agents/seguimientoCRM');
const cotizador = require('../agents/cotizador');

function build() {
  return buildDepartments({
    rootDir: '/fake/root',
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion: () => {},
  });
}

test('buildDepartments returns marketing, comercial and administracion with their agent ids', () => {
  const departments = build();
  assert.deepEqual(
    departments.map((d) => d.id),
    ['marketing', 'comercial', 'administracion', 'desarrollo']
  );
  const admin = departments.find((d) => d.id === 'administracion');
  assert.deepEqual(admin.agents.map((a) => a.id), ['pm']);
  assert.equal(admin.agents[0].module, require('../agents/pm'));
  assert.equal(admin.agents[0].comunicacionPorDefecto, 'todos');
  assert.equal(admin.agents[0].deps.reportesDir, path.join('/fake/root', 'departamentos', 'administracion', 'content', 'reportes-equipo'));
  assert.deepEqual(
    departments.find((d) => d.id === 'marketing').agents.map((a) => a.id),
    ['buscador-tendencias', 'publicador', 'respuestas-redes']
  );
  assert.deepEqual(
    departments.find((d) => d.id === 'comercial').agents.map((a) => a.id),
    ['buscador-prospectos', 'seguimiento-crm', 'cotizador']
  );
});

test('each agent entry references the actual required agent module', () => {
  const departments = build();
  const byId = {};
  departments.forEach((d) => d.agents.forEach((a) => { byId[a.id] = a; }));

  assert.equal(byId['buscador-tendencias'].module, buscadorTendencias);
  assert.equal(byId['publicador'].module, publicador);
  assert.equal(byId['buscador-prospectos'].module, buscadorProspectos);
  assert.equal(byId['seguimiento-crm'].module, seguimientoCRM);
  assert.equal(byId['cotizador'].module, cotizador);
});

test('every agent deps object carries the shared apiKey, model, and createChatCompletion', () => {
  const createChatCompletion = () => {};
  const departments = buildDepartments({
    rootDir: '/fake/root',
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion,
  });

  departments.forEach((d) => {
    d.agents.forEach((a) => {
      assert.equal(a.deps.apiKey, 'sk-test');
      assert.equal(a.deps.model, 'gpt-4o-mini');
      assert.equal(a.deps.createChatCompletion, createChatCompletion);
      assert.equal(a.deps.contextPath, path.join('/fake/root', 'CONTEXTO-INTELEKIA.md'));
    });
  });
});

test('publicador deps point at the marketing drafts directory and seguimiento-crm deps point at the comercial reportes directory', () => {
  const departments = build();
  const publicadorAgent = departments.find((d) => d.id === 'marketing').agents.find((a) => a.id === 'publicador');
  const seguimientoAgent = departments.find((d) => d.id === 'comercial').agents.find((a) => a.id === 'seguimiento-crm');

  assert.equal(
    publicadorAgent.deps.draftsDir,
    path.join('/fake/root', 'departamentos', 'marketing', 'content', 'drafts')
  );
  assert.equal(
    seguimientoAgent.deps.reportesDir,
    path.join('/fake/root', 'departamentos', 'comercial', 'content', 'reportes-seguimiento')
  );
  assert.equal(seguimientoAgent.label, 'Seguimiento de Proyectos');
  assert.equal(seguimientoAgent.cicloHoras, 24);
  assert.equal(departments.find((d) => d.id === 'marketing').agents.find((a) => a.id === 'buscador-tendencias').cicloHoras, 6);
  assert.equal(seguimientoAgent.deps.prospectosPath, undefined, 'ya no toca prospectos.json');
});

test('desarrollo tiene al Revisor de PRs con ciclo corto y silencioso', () => {
  const dev = build().find((d) => d.id === 'desarrollo');
  assert.equal(dev.label, 'Desarrollo');
  const revisor = dev.agents[0];
  assert.equal(revisor.id, 'revisor-prs');
  assert.equal(revisor.module, require('../agents/revisorPRs'));
  assert.equal(revisor.cicloHoras, 0.08);
  assert.equal(revisor.cicloSilencioso, true);
  assert.equal(revisor.usaAutonomia, undefined, 'solo Respuestas en Redes usa el switch de autonomía');
  assert.equal(revisor.deps.github, null);
  assert.equal(revisor.deps.revisionesPath, path.join('/fake/root', 'backend', 'state', 'revisiones-pr.json'));
  assert.equal(revisor.deps.rolePath, path.join('/fake/root', 'departamentos', 'desarrollo', 'agentes', 'revisor-prs.md'));
});

test('marketing tiene a Respuestas en Redes con ciclo de ~10 min, silencioso y deps por conectar', () => {
  const agente = build().find((d) => d.id === 'marketing').agents.find((a) => a.id === 'respuestas-redes');
  assert.equal(agente.label, 'Respuestas en Redes');
  assert.equal(agente.module, require('../agents/respuestasRedes'));
  assert.equal(agente.cicloHoras, 0.17);
  assert.equal(agente.cicloSilencioso, true);
  assert.equal(agente.usaAutonomia, true);
  for (const dep of ['meta', 'aprobaciones', 'autonomia', 'bitacora']) assert.equal(agente.deps[dep], null);
  assert.equal(agente.deps.atendidosPath, path.join('/fake/root', 'backend', 'state', 'comentarios-atendidos.json'));
  assert.equal(agente.deps.rolePath, path.join('/fake/root', 'departamentos', 'marketing', 'agentes', 'respuestas-redes.md'));
});
