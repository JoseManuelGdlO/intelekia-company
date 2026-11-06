const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCustomAgentRegistry } = require('../lib/customAgentsRegistry');

function tempDir(name) {
  const dirPath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function fakeWrapRunCycle(opts) {
  return async () => ({ ranFor: opts.agentId });
}

function setup() {
  const rootDir = tempDir('root');
  const customAgentsPath = path.join(rootDir, 'custom-agents.json');
  const contextPath = tempFile('context', '# Intelekia');
  const departments = [
    { id: 'comercial', label: 'Comercial', agents: [] },
    { id: 'marketing', label: 'Marketing', agents: [] },
  ];
  const agentRunners = {};
  const chatHandlers = {};
  const config = { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' };
  const createChatCompletion = async () => 'respuesta de prueba';

  const registry = createCustomAgentRegistry({
    rootDir,
    customAgentsPath,
    contextPath,
    config,
    createChatCompletion,
    departments,
    agentRunners,
    chatHandlers,
    wrapRunCycle: fakeWrapRunCycle,
    statusPath: path.join(rootDir, 'agents-status.json'),
  });

  return { registry, rootDir, customAgentsPath, departments, agentRunners, chatHandlers };
}

test('createAgent adds the new agent to the matching department with the right id/label', () => {
  const { registry, departments } = setup();

  const result = registry.createAgent({
    departmentId: 'comercial',
    label: 'Objection Handling',
    context: 'Eres experto en manejo de objeciones.',
    autonomous: false,
  });

  assert.match(result.id, /^custom-objection-handling-/);
  assert.equal(result.label, 'Objection Handling');

  const comercial = departments.find((d) => d.id === 'comercial');
  assert.equal(comercial.agents.length, 1);
  assert.equal(comercial.agents[0].id, result.id);
  assert.equal(comercial.agents[0].label, 'Objection Handling');
});

test('createAgent throws for an unknown departmentId and registers nothing', () => {
  const { registry, chatHandlers } = setup();

  assert.throws(
    () => registry.createAgent({ departmentId: 'no-existe', label: 'X', context: 'Y', autonomous: false }),
    /Departamento desconocido: no-existe/
  );

  assert.deepEqual(Object.keys(chatHandlers), []);
});

test('createAgent registers a working chat handler', async () => {
  const { registry, chatHandlers } = setup();

  const { id } = registry.createAgent({
    departmentId: 'comercial',
    label: 'Closer',
    context: 'Eres un cerrador de ventas experto.',
    autonomous: false,
  });

  assert.equal(typeof chatHandlers[id], 'function');
  const result = await chatHandlers[id]({ message: 'hola' });
  assert.equal(result.reply, 'respuesta de prueba');
});

test('createAgent only adds to agentRunners when autonomous is true', () => {
  const { registry, agentRunners } = setup();

  const reactivo = registry.createAgent({ departmentId: 'comercial', label: 'Reactivo', context: 'x', autonomous: false });
  assert.equal(agentRunners[reactivo.id], undefined);

  const autonomo = registry.createAgent({ departmentId: 'comercial', label: 'Autonomo', context: 'x', autonomous: true });
  assert.equal(typeof agentRunners[autonomo.id], 'function');
});

test('createAgent persists the new agent to customAgentsPath', () => {
  const { registry, customAgentsPath } = setup();

  const { id } = registry.createAgent({
    departmentId: 'marketing',
    label: 'Storyteller',
    context: 'Eres un experto en storytelling.',
    autonomous: true,
  });

  const onDisk = JSON.parse(fs.readFileSync(customAgentsPath, 'utf-8'));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].id, id);
  assert.equal(onDisk[0].departmentId, 'marketing');
  assert.equal(onDisk[0].autonomous, true);
});

test('updateAgent changes label/context/autonomous, updates the department entry, and persists', () => {
  const { registry, departments, agentRunners, customAgentsPath } = setup();

  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'Discovery', context: 'contexto original', autonomous: false });
  assert.equal(agentRunners[id], undefined);

  const updated = registry.updateAgent(id, { label: 'Discovery Pro', context: 'contexto actualizado', autonomous: true });

  assert.equal(updated.label, 'Discovery Pro');
  assert.equal(typeof agentRunners[id], 'function');

  const comercial = departments.find((d) => d.id === 'comercial');
  assert.equal(comercial.agents[0].label, 'Discovery Pro');

  const onDisk = JSON.parse(fs.readFileSync(customAgentsPath, 'utf-8'));
  assert.equal(onDisk[0].label, 'Discovery Pro');
  assert.equal(onDisk[0].context, 'contexto actualizado');
  assert.equal(onDisk[0].autonomous, true);
});

test('updateAgent can turn autonomous off and removes the agent from agentRunners', () => {
  const { registry, agentRunners } = setup();

  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'Closer', context: 'x', autonomous: true });
  assert.equal(typeof agentRunners[id], 'function');

  registry.updateAgent(id, { autonomous: false });
  assert.equal(agentRunners[id], undefined);
});

test('updateAgent throws for an unknown id', () => {
  const { registry } = setup();
  assert.throws(() => registry.updateAgent('no-existe', { label: 'x' }), /Trabajador desconocido: no-existe/);
});

test('loadAllAtStartup re-registers every persisted agent', () => {
  const rootDir = tempDir('root');
  const customAgentsPath = path.join(rootDir, 'custom-agents.json');
  const persisted = [
    { id: 'custom-closer-1', departmentId: 'comercial', label: 'Closer', context: 'x', autonomous: true, createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  fs.writeFileSync(customAgentsPath, JSON.stringify(persisted, null, 2));

  const contextPath = tempFile('context', '# Intelekia');
  const departments = [{ id: 'comercial', label: 'Comercial', agents: [] }];
  const agentRunners = {};
  const chatHandlers = {};

  const registry = createCustomAgentRegistry({
    rootDir,
    customAgentsPath,
    contextPath,
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion: async () => 'x',
    departments,
    agentRunners,
    chatHandlers,
    wrapRunCycle: fakeWrapRunCycle,
    statusPath: path.join(rootDir, 'agents-status.json'),
  });

  registry.loadAllAtStartup();

  assert.equal(departments[0].agents.length, 1);
  assert.equal(departments[0].agents[0].id, 'custom-closer-1');
  assert.equal(typeof chatHandlers['custom-closer-1'], 'function');
  assert.equal(typeof agentRunners['custom-closer-1'], 'function');
});

test('loadAllAtStartup does nothing when no file exists yet', () => {
  const { registry, departments } = setup();
  registry.loadAllAtStartup();
  assert.equal(departments[0].agents.length, 0);
  assert.equal(departments[1].agents.length, 0);
});

test('getMemory returns an empty string when no memory file exists yet', () => {
  const { registry } = setup();
  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'X', context: 'x', autonomous: false });
  assert.equal(registry.getMemory(id), '');
});

test('setMemory then getMemory round-trips the content', () => {
  const { registry } = setup();
  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'X', context: 'x', autonomous: false });

  registry.setMemory(id, 'Tú: hola\nAgente: hola de vuelta');

  assert.equal(registry.getMemory(id), 'Tú: hola\nAgente: hola de vuelta');
});

test('compressMemory replaces the memory with the model summary', async () => {
  const rootDir = tempDir('root');
  const customAgentsPath = path.join(rootDir, 'custom-agents.json');
  const contextPath = tempFile('context', '# Intelekia');
  const departments = [{ id: 'comercial', label: 'Comercial', agents: [] }];

  const registry = createCustomAgentRegistry({
    rootDir,
    customAgentsPath,
    contextPath,
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion: async ({ messages }) => {
      assert.match(messages[1].content, /historial largo/);
      return 'resumen corto';
    },
    departments,
    agentRunners: {},
    chatHandlers: {},
    wrapRunCycle: fakeWrapRunCycle,
    statusPath: path.join(rootDir, 'agents-status.json'),
  });

  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'X', context: 'x', autonomous: false });
  registry.setMemory(id, 'historial largo de conversación...');

  const resumen = await registry.compressMemory(id);

  assert.equal(resumen, 'resumen corto');
  assert.equal(registry.getMemory(id), 'resumen corto');
});

test('compressMemory does nothing and makes no model call when memory is empty', async () => {
  const { registry } = setup();
  const { id } = registry.createAgent({ departmentId: 'comercial', label: 'X', context: 'x', autonomous: false });

  const resumen = await registry.compressMemory(id);

  assert.equal(resumen, '');
  assert.equal(registry.getMemory(id), '');
});
