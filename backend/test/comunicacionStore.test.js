const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createComunicacionStore } = require('../lib/comunicacionStore');

function departments() {
  return [
    { id: 'marketing', label: 'Marketing', agents: [{ id: 'tendencias' }, { id: 'publicador' }] },
    { id: 'comercial', label: 'Comercial', agents: [{ id: 'prospectos' }, { id: 'cotizador' }] },
  ];
}

function tempConfigPath() {
  return path.join(os.tmpdir(), `comunicacion-${Date.now()}-${Math.random()}.json`);
}

test('sin configuración, cada agente puede consultar solo a su área', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  assert.deepEqual(store.allowedTargetIds('tendencias'), ['publicador']);
  assert.deepEqual(store.allowedTargetIds('cotizador'), ['prospectos']);
  assert.equal(store.canTalk('tendencias', 'cotizador'), false);
});

test('alcance "todos" permite consultar a cualquier área, nunca a sí mismo', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  store.setRule('publicador', { alcance: 'todos' });
  assert.deepEqual(store.allowedTargetIds('publicador'), ['tendencias', 'prospectos', 'cotizador']);
});

test('alcance "personalizado" permite exactamente la lista dada y es dirigido', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  store.setRule('publicador', { alcance: 'personalizado', permitidos: ['cotizador', 'publicador'] });
  assert.deepEqual(store.allowedTargetIds('publicador'), ['cotizador']);
  assert.equal(store.canTalk('cotizador', 'publicador'), false);
});

test('alcance "nadie" bloquea toda consulta', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  store.setRule('tendencias', { alcance: 'nadie' });
  assert.deepEqual(store.allowedTargetIds('tendencias'), []);
});

test('la regla se persiste en disco y "heredar" vuelve al valor por defecto', () => {
  const configPath = tempConfigPath();
  const store = createComunicacionStore({ configPath, departments: departments() });
  store.setRule('tendencias', { alcance: 'todos' });
  const reloaded = createComunicacionStore({ configPath, departments: departments() });
  assert.equal(reloaded.ruleFor('tendencias').alcance, 'todos');
  reloaded.setRule('tendencias', { alcance: 'heredar' });
  assert.equal(reloaded.ruleFor('tendencias').alcance, 'area');
  assert.equal(reloaded.ruleFor('tendencias').heredada, true);
});

test('setAll aplica un alcance a todos y borra reglas individuales', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  store.setRule('tendencias', { alcance: 'nadie' });
  store.setAll('todos');
  const snap = store.snapshot();
  assert.equal(snap.porDefecto, 'todos');
  assert.equal(snap.permitidos.tendencias.length, 3);
});

test('rechaza alcances inválidos y agentes desconocidos', () => {
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: departments() });
  assert.throws(() => store.setRule('tendencias', { alcance: 'algunos' }), /alcance inválido/);
  assert.throws(() => store.setRule('fantasma', { alcance: 'todos' }), /Agente desconocido/);
  assert.throws(() => store.setRule('tendencias', { alcance: 'personalizado', permitidos: ['fantasma'] }), /fantasma/);
  assert.throws(() => store.setDefault('personalizado'), /porDefecto/);
});

test('los agentes agregados en caliente se incluyen automáticamente', () => {
  const depts = departments();
  const store = createComunicacionStore({ configPath: tempConfigPath(), departments: depts });
  depts[1].agents.push({ id: 'custom-nuevo' });
  assert.deepEqual(store.allowedTargetIds('cotizador'), ['prospectos', 'custom-nuevo']);
});
