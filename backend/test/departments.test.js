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

test('buildDepartments returns the marketing and comercial departments with their agent ids', () => {
  const departments = build();
  assert.deepEqual(
    departments.map((d) => d.id),
    ['marketing', 'comercial']
  );
  assert.deepEqual(
    departments.find((d) => d.id === 'marketing').agents.map((a) => a.id),
    ['buscador-tendencias', 'publicador']
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

test('publicador deps point at the marketing drafts directory and seguimiento-crm deps point at the comercial seguimientos directory', () => {
  const departments = build();
  const publicadorAgent = departments.find((d) => d.id === 'marketing').agents.find((a) => a.id === 'publicador');
  const seguimientoAgent = departments.find((d) => d.id === 'comercial').agents.find((a) => a.id === 'seguimiento-crm');

  assert.equal(
    publicadorAgent.deps.draftsDir,
    path.join('/fake/root', 'departamentos', 'marketing', 'content', 'drafts')
  );
  assert.equal(
    seguimientoAgent.deps.seguimientosDir,
    path.join('/fake/root', 'departamentos', 'comercial', 'content', 'seguimientos')
  );
});
