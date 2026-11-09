const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgentProfiles, MAX_CONTENIDO } = require('../lib/agentProfiles');

function setup({ createChatCompletion = async () => 'resumen' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfiles-'));
  const rolePath = path.join(dir, 'publicador.md');
  fs.writeFileSync(rolePath, 'Eres el Publicador.');
  const customMemoryPath = path.join(dir, 'custom-memoria.md');
  const updates = [];
  const departments = [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        { id: 'publicador', label: 'Publicador', deps: { rolePath } },
        { id: 'custom-x', label: 'Experto', isCustom: true, roleText: 'Eres experto.', autonomous: false, deps: { memoryPath: customMemoryPath } },
      ],
    },
  ];
  const profiles = createAgentProfiles({
    profilesPath: path.join(dir, 'perfiles.json'),
    memoriasDir: path.join(dir, 'memorias'),
    departments,
    createChatCompletion,
    config: { openaiApiKey: 'k', openaiModel: 'm' },
    updateCustomAgent: (id, patch) => {
      updates.push({ id, patch });
      if (patch.context) departments[0].agents[1].roleText = patch.context;
    },
    now: () => new Date('2026-11-07T10:30:00Z'),
  });
  return { profiles, rolePath, customMemoryPath, updates, dir };
}

const SKILL = { tipo: 'skill', nombre: 'Copy para Reels', contenido: 'Gancho en 3 segundos.' };

test('getProfile de un agente base lee su archivo de rol', () => {
  const { profiles } = setup();
  const profile = profiles.getProfile('publicador');
  assert.equal(profile.tipo, 'base');
  assert.equal(profile.rol, 'Eres el Publicador.');
  assert.deepEqual(profile.skills, []);
  assert.equal(profile.autonomous, null);
});

test('editar el rol de un agente base reescribe su archivo .md', () => {
  const { profiles, rolePath } = setup();
  profiles.updateProfile('publicador', { rol: 'Eres el Publicador, ahora con humor.' });
  assert.equal(fs.readFileSync(rolePath, 'utf-8'), 'Eres el Publicador, ahora con humor.');
});

test('editar un trabajador a la medida delega en el registro (contexto, nombre, autónomo)', () => {
  const { profiles, updates } = setup();
  profiles.updateProfile('custom-x', { rol: 'Nuevo contexto', label: ' Experto 2 ', autonomous: true });
  assert.deepEqual(updates, [{ id: 'custom-x', patch: { context: 'Nuevo contexto', label: 'Experto 2', autonomous: true } }]);
});

test('no permite renombrar ni cambiar autonomía de un agente base, ni dejar el rol vacío', () => {
  const { profiles, rolePath } = setup();
  assert.throws(() => profiles.updateProfile('publicador', { label: 'Otro' }), /agentes base/);
  assert.throws(() => profiles.updateProfile('publicador', { autonomous: false }), /autónomos/);
  assert.throws(() => profiles.updateProfile('publicador', { rol: '   ' }), /vacío/);
  assert.equal(fs.readFileSync(rolePath, 'utf-8'), 'Eres el Publicador.');
});

test('guarda skills normalizadas y rechaza las inválidas sin escribir nada', () => {
  const { profiles } = setup();
  const saved = profiles.updateProfile('publicador', { skills: [SKILL, { ...SKILL, tipo: 'plugin', nombre: 'Canva', activo: false }] });
  assert.equal(saved.skills.length, 2);
  assert.equal(saved.skills[0].activo, true);
  assert.ok(saved.skills[0].id);
  assert.throws(() => profiles.updateProfile('publicador', { skills: [{ ...SKILL, tipo: 'virus' }] }), /Tipo inválido/);
  assert.throws(() => profiles.updateProfile('publicador', { skills: [{ ...SKILL, nombre: '' }] }), /nombre/);
  assert.throws(() => profiles.updateProfile('publicador', { skills: [{ ...SKILL, contenido: 'x'.repeat(MAX_CONTENIDO + 1) }] }), /muy largo/);
  assert.throws(() => profiles.updateProfile('publicador', { rol: 'otro', skills: 'no-lista' }), /lista/);
  assert.equal(profiles.getProfile('publicador').skills.length, 2);
  assert.equal(profiles.getProfile('publicador').rol, 'Eres el Publicador.');
});

test('decorate inyecta solo las skills activas y la memoria de agentes base', () => {
  const { profiles } = setup();
  profiles.updateProfile('publicador', { skills: [SKILL, { ...SKILL, nombre: 'Apagada', activo: false }] });
  profiles.remember('publicador', 'El fundador pidió más humor');
  const messages = profiles.decorate('publicador', [{ role: 'system', content: 'rol' }, { role: 'user', content: 'tarea' }]);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].content, 'rol');
  assert.match(messages[1].content, /Copy para Reels \(skill\)/);
  assert.doesNotMatch(messages[1].content, /Apagada/);
  assert.match(messages[2].content, /\[2026-11-07 10:30\] El fundador pidió más humor/);
  assert.equal(messages[3].content, 'tarea');
});

test('decorate no duplica la memoria de un trabajador a la medida (él la inyecta en su chat)', () => {
  const { profiles } = setup();
  profiles.remember('custom-x', 'algo');
  const original = [{ role: 'system', content: 'rol' }, { role: 'user', content: 'hola' }];
  assert.equal(profiles.decorate('custom-x', original), original);
});

test('la memoria usa el archivo propio del trabajador a la medida y se puede comprimir', async () => {
  const { profiles, customMemoryPath } = setup({ createChatCompletion: async ({ messages }) => `resumen de: ${messages[1].content.length}` });
  profiles.setMemory('custom-x', 'mucho texto');
  assert.equal(fs.readFileSync(customMemoryPath, 'utf-8'), 'mucho texto');
  assert.equal(await profiles.compressMemory('custom-x'), 'resumen de: 11');
  assert.equal(profiles.getMemory('custom-x'), 'resumen de: 11');
});

test('remember nunca lanza aunque el agente no exista', () => {
  const { profiles } = setup();
  assert.doesNotThrow(() => profiles.remember('fantasma', 'x'));
  assert.throws(() => profiles.getProfile('fantasma'), /Agente desconocido/);
});

test('las herramientas se activan por agente y se validan', () => {
  const { profiles } = setup();
  assert.deepEqual(profiles.getProfile('publicador').herramientas, { baseDatos: false, correo: false });
  assert.equal(profiles.hasTool('publicador', 'baseDatos'), false);
  profiles.updateProfile('publicador', { herramientas: { baseDatos: true } });
  assert.equal(profiles.hasTool('publicador', 'baseDatos'), true);
  assert.equal(profiles.hasTool('custom-x', 'baseDatos'), false);
  profiles.updateProfile('publicador', { skills: [SKILL] });
  assert.equal(profiles.hasTool('publicador', 'baseDatos'), true, 'guardar skills no apaga herramientas');
  assert.throws(() => profiles.updateProfile('publicador', { herramientas: { shell: true } }), /desconocida/);
});

test('cada agente tiene su ciclo: valor de departments.js, general de .env, o el propio editado', () => {
  const { profiles } = setup();
  // publicador no declara cicloHoras: usa el general (config.agentIntervalHours no está en el setup → 6)
  assert.deepEqual(profiles.cicloOf('publicador'), { cadaHoras: 6, porDefecto: 6, personalizado: false });
  profiles.updateProfile('publicador', { cicloHoras: 24 });
  assert.deepEqual(profiles.cicloOf('publicador'), { cadaHoras: 24, porDefecto: 6, personalizado: true });
  profiles.updateProfile('publicador', { cicloHoras: 0 });
  assert.equal(profiles.cicloOf('publicador').cadaHoras, 0);
  profiles.updateProfile('publicador', { cicloHoras: null });
  assert.equal(profiles.cicloOf('publicador').personalizado, false);
  assert.throws(() => profiles.updateProfile('publicador', { cicloHoras: -1 }), /entre 0 y 720/);
  assert.throws(() => profiles.updateProfile('publicador', { cicloHoras: 'mucho' }), /entre 0 y 720/);
  assert.equal(profiles.getProfile('custom-x').ciclo, null, 'un trabajador que solo responde en chat no tiene ciclo');
});

test('instalados: se guardan por agente, se validan y salen en el perfil', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { createAgentProfiles } = require('../lib/agentProfiles');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-inst-'));
  const rolePath = path.join(dir, 'rol.md');
  fs.writeFileSync(rolePath, 'rol');
  const profiles = createAgentProfiles({
    profilesPath: path.join(dir, 'perfiles.json'),
    memoriasDir: dir,
    departments: [{ id: 'd', label: 'D', agents: [{ id: 'a', label: 'A', deps: { rolePath } }] }],
    createChatCompletion: async () => '',
    config: {},
  });
  assert.deepStrictEqual(profiles.getProfile('a').instalados, { skills: [], plugins: [] });
  profiles.updateProfile('a', { instalados: { skills: ['s1', 's1'], plugins: ['p1'] } });
  assert.deepStrictEqual(profiles.instaladosOf('a'), { skills: ['s1'], plugins: ['p1'] });
  assert.throws(() => profiles.updateProfile('a', { instalados: { skills: 'x' } }), /lista de ids/);
  assert.throws(() => profiles.updateProfile('a', { instalados: [] }), /objeto/);
});
