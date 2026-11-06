# Trabajadores a la medida (custom agents) con memoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the founder create a new "trabajador a la medida" (custom agent) in any existing department at runtime — with just a name and a skill/context text, optionally autonomous — with no server restart, and give it persistent, editable, compressible conversational memory, per `docs/superpowers/specs/2026-11-06-trabajadores-a-la-medida-design.md` (Phase 1 — backend only; the 3D form is a later phase).

**Architecture:** A generic agent module factory (`createCustomAgentModule({role})`) produces `{runCycle, chat, describeSuccess}` from a user-supplied context string. A new registry (`backend/lib/customAgentsRegistry.js`) creates/updates/persists custom agents and mutates the SAME `departments`/`agentRunners`/`chatHandlers` objects `server.js` already passes to the scheduler and routers — so a new or edited agent is live immediately. `routes/departments.js` grows 5 new endpoints for create/update/memory. Memory is a plain-text file per agent, auto-appended on every chat and manually editable/compressible.

**Tech Stack:** Same as the rest of the backend — Node.js >= 18, Express 4, Node's built-in `node:test`.

## Global Constraints

- Node.js >= 18 required; backend uses CommonJS.
- Agent status is always one of exactly: `idle`, `trabajando`, `listo_para_revision`, `error`.
- The OpenAI API key lives only in `backend/.env`, never hardcoded or committed.
- Every custom agent is produced by `createCustomAgentModule({role})` in `backend/agents/customAgent.js` — a factory, not a fixed module, because each custom agent's `role` text differs.
- A custom agent's chat payload still follows the existing uniform shape consumed by `routes/agents.js` (`{message, guardar, itemId}`) — but `customAgent.chat` only reads `message` from it; `guardar`/`itemId` are irrelevant to this agent type and are safely ignored.
- Custom agent definitions persist in `backend/state/custom-agents.json`; each agent's memory persists in `backend/state/custom-agents/<agentId>-memoria.md` (plain text) and, if autonomous, its notes in `backend/state/custom-agents/<agentId>-notas.json` (same `{id, texto, creadoEn}` shape as `ideasStore`/`prospectosStore`).
- Memory is never compressed automatically — only via an explicit `compressMemory` call.
- Creating or editing a custom agent must take effect in the running server immediately (no restart) by mutating the existing `departments`/`agentRunners`/`chatHandlers` objects in place, not by replacing them.
- `GET /api/departments` must never expose `deps`, file paths, or the API key for ANY agent, core or custom — it already sanitizes via `sanitizeDepartments`, which custom agents pass through unchanged since they're pushed into the same `departments` array.
- Creating a department from this feature is out of scope — only adding agents to departments that already exist (`marketing`, `comercial`).
- Deleting a custom agent is out of scope.
- Automatic memory compression is out of scope — manual only.

---

### Task 1: Generic custom agent module

**Files:**
- Create: `backend/agents/customAgent.js`
- Test: `backend/test/customAgent.test.js`

**Interfaces:**
- Produces: `createCustomAgentModule({ role }) -> { runCycle, chat, describeSuccess }`.
  - `chat({ message, contextPath, memoryPath, apiKey, model, createChatCompletion }) -> Promise<{ reply }>` — reads existing memory (empty string if the file doesn't exist), includes it as a system message only when non-empty, calls the model, then appends `\n\nTú: <message>\nAgente: <reply>` to the memory file (creating it if needed).
  - `runCycle({ contextPath, notesPath, apiKey, model, createChatCompletion }) -> Promise<{ notaCreada: {id, texto, creadoEn} }>` — reads existing notes (default `[]`), asks the model for one new observation avoiding repeats, appends it, returns it.
  - `describeSuccess(result) -> statusPatch` — `{estatus: 'listo_para_revision', ultimaAccion: 'Nueva observación: <primeros 80 caracteres>', ultimoItemId: result.notaCreada.id}`.
  Task 2's registry calls all three directly.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/customAgent.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCustomAgentModule } = require('../agents/customAgent');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  if (content !== undefined) {
    fs.writeFileSync(filePath, content);
  }
  return filePath;
}

test('chat sends no memory system message when the memory file does not exist, then creates it', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const memoryPath = tempFile('memoria');
  fs.unlinkSync(memoryPath);

  const { chat } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages.length, 3);
    assert.equal(messages[2].content, 'hola');
    return 'hola, ¿en qué te ayudo?';
  };

  const result = await chat({
    message: 'hola',
    contextPath,
    memoryPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'hola, ¿en qué te ayudo?');
  const memoriaGuardada = fs.readFileSync(memoryPath, 'utf-8');
  assert.match(memoriaGuardada, /Tú: hola/);
  assert.match(memoriaGuardada, /Agente: hola, ¿en qué te ayudo\?/);

  fs.unlinkSync(contextPath);
  fs.unlinkSync(memoryPath);
});

test('chat includes existing memory as context and appends the new exchange to it', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const memoryPath = tempFile('memoria', 'Tú: hola\nAgente: hola, ¿en qué te ayudo?');

  const { chat } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages.length, 4);
    assert.match(messages[2].content, /hola, ¿en qué te ayudo\?/);
    return 'claro, cuéntame más';
  };

  const result = await chat({
    message: 'quiero una cotización',
    contextPath,
    memoryPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'claro, cuéntame más');
  const memoriaActualizada = fs.readFileSync(memoryPath, 'utf-8');
  assert.match(memoriaActualizada, /hola, ¿en qué te ayudo\?/);
  assert.match(memoriaActualizada, /Tú: quiero una cotización/);
  assert.match(memoriaActualizada, /Agente: claro, cuéntame más/);

  fs.unlinkSync(contextPath);
  fs.unlinkSync(memoryPath);
});

test('runCycle produces a note, avoids repeating existing notes, and writes it to notesPath', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const notesPath = tempFile('notas', JSON.stringify([{ id: 'nota-1', texto: 'nota vieja', creadoEn: '2026-01-01T00:00:00.000Z' }]));

  const { runCycle } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /nota vieja/);
    return 'nota nueva accionable';
  };

  const result = await runCycle({
    contextPath,
    notesPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.notaCreada.texto, 'nota nueva accionable');

  const onDisk = JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[1].texto, 'nota nueva accionable');

  fs.unlinkSync(contextPath);
  fs.unlinkSync(notesPath);
});

test('describeSuccess reports listo_para_revision with a truncated preview and ultimoItemId', () => {
  const { describeSuccess } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const patch = describeSuccess({
    notaCreada: {
      id: 'nota-9',
      texto: 'una observación bastante larga que debería truncarse en la vista previa del estatus para no saturar la interfaz',
    },
  });

  assert.equal(patch.estatus, 'listo_para_revision');
  assert.equal(patch.ultimoItemId, 'nota-9');
  assert.match(patch.ultimaAccion, /^Nueva observación: una observación bastante larga/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/customAgent.test.js`
Expected: FAIL — `Cannot find module '../agents/customAgent'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/customAgent.js`:

```js
const fs = require('fs');

function readNotes(notesPath) {
  if (!fs.existsSync(notesPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
}

function writeNotes(notesPath, notes) {
  fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));
}

function readMemory(memoryPath) {
  return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';
}

function appendMemory(memoryPath, entrada) {
  fs.writeFileSync(memoryPath, readMemory(memoryPath) + entrada);
}

function createCustomAgentModule({ role }) {
  async function chat({ message, contextPath, memoryPath, apiKey, model, createChatCompletion }) {
    const context = fs.readFileSync(contextPath, 'utf-8');
    const memoria = readMemory(memoryPath);

    const messages = [
      { role: 'system', content: role },
      { role: 'system', content: `Contexto de negocio:\n${context}` },
    ];
    if (memoria.trim()) {
      messages.push({ role: 'system', content: `Memoria de conversaciones previas:\n${memoria}` });
    }
    messages.push({ role: 'user', content: message });

    const reply = await createChatCompletion({ apiKey, model, messages });

    appendMemory(memoryPath, `\n\nTú: ${message}\nAgente: ${reply}`);

    return { reply };
  }

  async function runCycle({ contextPath, notesPath, apiKey, model, createChatCompletion }) {
    const context = fs.readFileSync(contextPath, 'utf-8');
    const existingNotes = readNotes(notesPath);
    const existingTexts = existingNotes.map((nota) => nota.texto);

    const userPrompt =
      `Contexto de negocio:\n${context}\n\n` +
      `Notas que ya existen (no las repitas):\n${JSON.stringify(existingTexts)}\n\n` +
      'Da una observación o sugerencia breve y accionable, relevante ahora mismo, según tu rol.';

    const texto = await createChatCompletion({
      apiKey,
      model,
      messages: [
        { role: 'system', content: role },
        { role: 'user', content: userPrompt },
      ],
    });

    const notaCreada = {
      id: `nota-${Date.now()}`,
      texto,
      creadoEn: new Date().toISOString(),
    };

    writeNotes(notesPath, [...existingNotes, notaCreada]);

    return { notaCreada };
  }

  function describeSuccess(result) {
    return {
      estatus: 'listo_para_revision',
      ultimaAccion: `Nueva observación: ${result.notaCreada.texto.slice(0, 80)}`,
      ultimoItemId: result.notaCreada.id,
    };
  }

  return { runCycle, chat, describeSuccess };
}

module.exports = { createCustomAgentModule };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/customAgent.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/customAgent.js backend/test/customAgent.test.js
git commit -m "Add generic custom agent module factory with memory-aware chat"
```

---

### Task 2: Custom agents registry

**Files:**
- Create: `backend/lib/customAgentsRegistry.js`
- Test: `backend/test/customAgentsRegistry.test.js`

**Interfaces:**
- Consumes: `createCustomAgentModule` (Task 1); an injected `wrapRunCycle`-shaped function (the real one is `backend/lib/runWithStatus.js`'s `wrapRunCycle`, already built).
- Produces: `createCustomAgentRegistry({rootDir, customAgentsPath, contextPath, config, createChatCompletion, departments, agentRunners, chatHandlers, wrapRunCycle, statusPath}) -> {createAgent, updateAgent, loadAllAtStartup, getMemory, setMemory, compressMemory}`, plus a standalone `slugify(texto) -> string` export. Task 4 (`server.js`) constructs this once and wires its functions into Task 3's routes.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/customAgentsRegistry.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCustomAgentRegistry, slugify } = require('../lib/customAgentsRegistry');

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

test('slugify produces a url-safe id fragment', () => {
  assert.equal(slugify('Objection Handling'), 'objection-handling');
});

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/customAgentsRegistry.test.js`
Expected: FAIL — `Cannot find module '../lib/customAgentsRegistry'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/customAgentsRegistry.js`:

```js
const fs = require('fs');
const path = require('path');
const { createCustomAgentModule } = require('../agents/customAgent');

function slugify(texto) {
  const sinAcentos = texto
    .normalize('NFD')
    .split('')
    .filter((char) => char.charCodeAt(0) < 128)
    .join('');
  return sinAcentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function createCustomAgentRegistry({
  rootDir,
  customAgentsPath,
  contextPath,
  config,
  createChatCompletion,
  departments,
  agentRunners,
  chatHandlers,
  wrapRunCycle,
  statusPath,
}) {
  const entries = new Map();

  function memoryPathFor(id) {
    return path.join(rootDir, 'backend', 'state', 'custom-agents', `${id}-memoria.md`);
  }

  function notesPathFor(id) {
    return path.join(rootDir, 'backend', 'state', 'custom-agents', `${id}-notas.json`);
  }

  function buildDeps(id) {
    return {
      contextPath,
      memoryPath: memoryPathFor(id),
      notesPath: notesPathFor(id),
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      createChatCompletion,
    };
  }

  function attachOrDetachRunner(id) {
    const record = entries.get(id);
    if (record.entry.autonomous) {
      agentRunners[id] = wrapRunCycle({
        agentId: id,
        statusPath,
        runCycle: record.module.runCycle,
        deps: record.deps,
        describeSuccess: record.module.describeSuccess,
      });
    } else {
      delete agentRunners[id];
    }
  }

  function registerInMemory(entry) {
    const department = departments.find((d) => d.id === entry.departmentId);
    if (!department) {
      throw new Error(`Departamento desconocido: ${entry.departmentId}`);
    }

    const module = createCustomAgentModule({ role: entry.context });
    const deps = buildDeps(entry.id);
    const agentRef = { id: entry.id, label: entry.label, module, deps };

    department.agents.push(agentRef);
    entries.set(entry.id, { entry, module, deps, agentRef });

    chatHandlers[entry.id] = (body) => entries.get(entry.id).module.chat({ ...body, ...entries.get(entry.id).deps });
    attachOrDetachRunner(entry.id);
  }

  function persist() {
    const list = Array.from(entries.values()).map((record) => record.entry);
    fs.mkdirSync(path.dirname(customAgentsPath), { recursive: true });
    fs.writeFileSync(customAgentsPath, JSON.stringify(list, null, 2));
  }

  function createAgent({ departmentId, label, context, autonomous }) {
    const id = `custom-${slugify(label)}-${Date.now()}`;
    const entry = {
      id,
      departmentId,
      label,
      context,
      autonomous: Boolean(autonomous),
      createdAt: new Date().toISOString(),
    };

    registerInMemory(entry);
    persist();

    return { id: entry.id, label: entry.label };
  }

  function updateAgent(id, { label, context, autonomous }) {
    const record = entries.get(id);
    if (!record) {
      throw new Error(`Trabajador desconocido: ${id}`);
    }

    if (label !== undefined) {
      record.entry.label = label;
      record.agentRef.label = label;
    }
    if (context !== undefined) {
      record.entry.context = context;
      record.module = createCustomAgentModule({ role: context });
      record.agentRef.module = record.module;
    }
    if (autonomous !== undefined) {
      record.entry.autonomous = Boolean(autonomous);
    }

    attachOrDetachRunner(id);
    persist();

    return { id: record.entry.id, label: record.entry.label };
  }

  function loadAllAtStartup() {
    if (!fs.existsSync(customAgentsPath)) {
      return;
    }
    const persisted = JSON.parse(fs.readFileSync(customAgentsPath, 'utf-8'));
    persisted.forEach(registerInMemory);
  }

  function getMemory(id) {
    const record = entries.get(id);
    if (!record) {
      throw new Error(`Trabajador desconocido: ${id}`);
    }
    return fs.existsSync(record.deps.memoryPath) ? fs.readFileSync(record.deps.memoryPath, 'utf-8') : '';
  }

  function setMemory(id, content) {
    const record = entries.get(id);
    if (!record) {
      throw new Error(`Trabajador desconocido: ${id}`);
    }
    fs.mkdirSync(path.dirname(record.deps.memoryPath), { recursive: true });
    fs.writeFileSync(record.deps.memoryPath, content);
  }

  async function compressMemory(id) {
    const record = entries.get(id);
    if (!record) {
      throw new Error(`Trabajador desconocido: ${id}`);
    }
    const current = getMemory(id);
    if (!current.trim()) {
      return current;
    }
    const resumen = await createChatCompletion({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      messages: [
        {
          role: 'system',
          content: 'Resume esta memoria de conversación de forma breve, conservando los puntos importantes para futuras conversaciones.',
        },
        { role: 'user', content: current },
      ],
    });
    setMemory(id, resumen);
    return resumen;
  }

  return { createAgent, updateAgent, loadAllAtStartup, getMemory, setMemory, compressMemory };
}

module.exports = { createCustomAgentRegistry, slugify };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/customAgentsRegistry.test.js`
Expected: PASS — 16 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/customAgentsRegistry.js backend/test/customAgentsRegistry.test.js
git commit -m "Add custom agents registry: hot create/update/persist, memory read/write/compress"
```

---

### Task 3: Custom-agent routes

**Files:**
- Modify: `backend/routes/departments.js`
- Modify: `backend/test/departmentsRoute.test.js`

**Interfaces:**
- Consumes: `createCustomAgent`, `updateCustomAgent`, `getMemory`, `setMemory`, `compressMemory` (Task 2's registry functions, injected).
- Produces: `createDepartmentsRouter` now also mounts `POST /:departmentId/agents`, `PATCH /:departmentId/agents/:agentId`, `GET /:departmentId/agents/:agentId/memory`, `PUT /:departmentId/agents/:agentId/memory`, `POST /:departmentId/agents/:agentId/memory/compress`. Exports grow to include the 5 new handler factories. Task 4 (`server.js`) passes the registry's functions in when constructing the router.

- [ ] **Step 1: Update the test file to cover the new routes (will fail — handlers don't exist yet)**

Replace the contents of `backend/test/departmentsRoute.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeDepartments,
  createDepartmentsHandler,
  createCreateAgentHandler,
  createUpdateAgentHandler,
  createGetMemoryHandler,
  createSetMemoryHandler,
  createCompressMemoryHandler,
} = require('../routes/departments');

const FAKE_DEPARTMENTS = [
  {
    id: 'marketing',
    label: 'Marketing',
    agents: [
      { id: 'buscador-tendencias', label: 'Buscador de Tendencias', module: {}, deps: { apiKey: 'sk-secret', rolePath: '/secret/path.md' } },
      { id: 'publicador', label: 'Publicador', module: {}, deps: { apiKey: 'sk-secret' } },
    ],
  },
];

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('sanitizeDepartments strips module and deps, keeping only id/label', () => {
  const sanitized = sanitizeDepartments(FAKE_DEPARTMENTS);

  assert.deepEqual(sanitized, [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        { id: 'buscador-tendencias', label: 'Buscador de Tendencias' },
        { id: 'publicador', label: 'Publicador' },
      ],
    },
  ]);

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /sk-secret/);
  assert.doesNotMatch(serialized, /secret\/path/);
});

test('departments handler responds with the sanitized departments list', () => {
  const handler = createDepartmentsHandler({ departments: FAKE_DEPARTMENTS });
  const res = fakeRes();

  handler({}, res);

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'marketing');
  assert.equal(Object.keys(res.body[0].agents[0]).length, 2);
});

test('create-agent handler responds 201 with the new agent on success', () => {
  const handler = createCreateAgentHandler({
    createCustomAgent: ({ departmentId, label, context, autonomous }) => {
      assert.equal(departmentId, 'comercial');
      assert.equal(label, 'Closer');
      assert.equal(context, 'Eres un cerrador experto.');
      assert.equal(autonomous, true);
      return { id: 'custom-closer-123', label: 'Closer' };
    },
  });
  const req = { params: { departmentId: 'comercial' }, body: { label: 'Closer', context: 'Eres un cerrador experto.', autonomous: true } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: 'custom-closer-123', label: 'Closer' });
});

test('create-agent handler responds 400 when label is missing', () => {
  const handler = createCreateAgentHandler({ createCustomAgent: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { departmentId: 'comercial' }, body: { context: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /label/);
});

test('create-agent handler responds 400 when context is missing', () => {
  const handler = createCreateAgentHandler({ createCustomAgent: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { departmentId: 'comercial' }, body: { label: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /context/);
});

test('create-agent handler responds 400 when createCustomAgent throws', () => {
  const handler = createCreateAgentHandler({
    createCustomAgent: () => {
      throw new Error('Departamento desconocido: no-existe');
    },
  });
  const req = { params: { departmentId: 'no-existe' }, body: { label: 'x', context: 'y' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Departamento desconocido/);
});

test('update-agent handler responds with the updated agent on success', () => {
  const handler = createUpdateAgentHandler({
    updateCustomAgent: (id, patch) => {
      assert.equal(id, 'custom-closer-123');
      assert.deepEqual(patch, { label: 'Closer Pro', context: undefined, autonomous: undefined });
      return { id, label: 'Closer Pro' };
    },
  });
  const req = { params: { agentId: 'custom-closer-123' }, body: { label: 'Closer Pro' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { id: 'custom-closer-123', label: 'Closer Pro' });
});

test('update-agent handler responds 400 when updateCustomAgent throws', () => {
  const handler = createUpdateAgentHandler({
    updateCustomAgent: () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' }, body: {} };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Trabajador desconocido/);
});

test('get-memory handler responds with the current memory content', () => {
  const handler = createGetMemoryHandler({ getMemory: (id) => `memoria de ${id}` });
  const req = { params: { agentId: 'custom-closer-123' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { content: 'memoria de custom-closer-123' });
});

test('get-memory handler responds 400 when getMemory throws', () => {
  const handler = createGetMemoryHandler({
    getMemory: () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
});

test('set-memory handler responds with the new content on success', () => {
  const handler = createSetMemoryHandler({ setMemory: () => {} });
  const req = { params: { agentId: 'custom-closer-123' }, body: { content: 'nueva memoria' } };
  const res = fakeRes();

  handler(req, res);

  assert.deepEqual(res.body, { content: 'nueva memoria' });
});

test('set-memory handler responds 400 when content is missing', () => {
  const handler = createSetMemoryHandler({ setMemory: () => { throw new Error('no debería llamarse'); } });
  const req = { params: { agentId: 'custom-closer-123' }, body: {} };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 400);
});

test('compress-memory handler responds with the compressed content', async () => {
  const handler = createCompressMemoryHandler({ compressMemory: async () => 'resumen' });
  const req = { params: { agentId: 'custom-closer-123' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(res.body, { content: 'resumen' });
});

test('compress-memory handler responds 400 when compressMemory throws', async () => {
  const handler = createCompressMemoryHandler({
    compressMemory: async () => {
      throw new Error('Trabajador desconocido: x');
    },
  });
  const req = { params: { agentId: 'x' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/departmentsRoute.test.js`
Expected: FAIL — `createCreateAgentHandler is not a function` (and similar for the other 4 new handlers).

- [ ] **Step 3: Write the implementation**

Replace the contents of `backend/routes/departments.js` with:

```js
const express = require('express');

function sanitizeDepartments(departments) {
  return departments.map((dept) => ({
    id: dept.id,
    label: dept.label,
    agents: dept.agents.map((agent) => ({ id: agent.id, label: agent.label })),
  }));
}

function createDepartmentsHandler({ departments }) {
  return (req, res) => {
    res.json(sanitizeDepartments(departments));
  };
}

function createCreateAgentHandler({ createCustomAgent }) {
  return (req, res) => {
    const { departmentId } = req.params;
    const { label, context, autonomous } = req.body;

    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label es requerido' });
      return;
    }
    if (!context || typeof context !== 'string' || !context.trim()) {
      res.status(400).json({ error: 'context es requerido' });
      return;
    }

    try {
      const agent = createCustomAgent({
        departmentId,
        label: label.trim(),
        context: context.trim(),
        autonomous: Boolean(autonomous),
      });
      res.status(201).json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createUpdateAgentHandler({ updateCustomAgent }) {
  return (req, res) => {
    const { agentId } = req.params;
    const { label, context, autonomous } = req.body;

    try {
      const agent = updateCustomAgent(agentId, { label, context, autonomous });
      res.json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createGetMemoryHandler({ getMemory }) {
  return (req, res) => {
    const { agentId } = req.params;
    try {
      res.json({ content: getMemory(agentId) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createSetMemoryHandler({ setMemory }) {
  return (req, res) => {
    const { agentId } = req.params;
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content es requerido' });
      return;
    }
    try {
      setMemory(agentId, content);
      res.json({ content });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createCompressMemoryHandler({ compressMemory }) {
  return async (req, res) => {
    const { agentId } = req.params;
    try {
      const content = await compressMemory(agentId);
      res.json({ content });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createDepartmentsRouter({ departments, createCustomAgent, updateCustomAgent, getMemory, setMemory, compressMemory }) {
  const router = express.Router();
  router.get('/', createDepartmentsHandler({ departments }));
  router.post('/:departmentId/agents', createCreateAgentHandler({ createCustomAgent }));
  router.patch('/:departmentId/agents/:agentId', createUpdateAgentHandler({ updateCustomAgent }));
  router.get('/:departmentId/agents/:agentId/memory', createGetMemoryHandler({ getMemory }));
  router.put('/:departmentId/agents/:agentId/memory', createSetMemoryHandler({ setMemory }));
  router.post('/:departmentId/agents/:agentId/memory/compress', createCompressMemoryHandler({ compressMemory }));
  return router;
}

module.exports = {
  createDepartmentsRouter,
  createDepartmentsHandler,
  sanitizeDepartments,
  createCreateAgentHandler,
  createUpdateAgentHandler,
  createGetMemoryHandler,
  createSetMemoryHandler,
  createCompressMemoryHandler,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/departmentsRoute.test.js`
Expected: PASS — 14 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/departments.js backend/test/departmentsRoute.test.js
git commit -m "Add create/update/memory routes for custom agents to routes/departments.js"
```

---

### Task 4: Wire server.js to the custom agents registry

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `createCustomAgentRegistry` (Task 2), the extended `createDepartmentsRouter` (Task 3).
- Produces: the same running Express app as before, now also able to create/edit custom agents live and expose their memory endpoints.

- [ ] **Step 1: Rewrite server.js**

Replace the contents of `backend/server.js` with:

```js
const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus } = require('./lib/statusStore');
const { createChatCompletion } = require('./lib/openaiClient');
const { buildDepartments } = require('./departments');
const { createCustomAgentRegistry } = require('./lib/customAgentsRegistry');
const { createAgentsRouter } = require('./routes/agents');
const { createDepartmentsRouter } = require('./routes/departments');

const config = loadConfig();
const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXTO-INTELEKIA.md');
const CUSTOM_AGENTS_PATH = path.join(__dirname, 'state', 'custom-agents.json');

const departments = buildDepartments({ rootDir: ROOT, config, createChatCompletion });
const allAgents = departments.flatMap((department) => department.agents);

const agentRunners = {};
const chatHandlers = {};

for (const agent of allAgents) {
  agentRunners[agent.id] = wrapRunCycle({
    agentId: agent.id,
    statusPath: STATUS_PATH,
    runCycle: agent.module.runCycle,
    deps: agent.deps,
    describeSuccess: agent.module.describeSuccess,
  });
  chatHandlers[agent.id] = (body) => agent.module.chat({ ...body, ...agent.deps });
}

const customAgentsRegistry = createCustomAgentRegistry({
  rootDir: ROOT,
  customAgentsPath: CUSTOM_AGENTS_PATH,
  contextPath: CONTEXT_PATH,
  config,
  createChatCompletion,
  departments,
  agentRunners,
  chatHandlers,
  wrapRunCycle,
  statusPath: STATUS_PATH,
});
customAgentsRegistry.loadAllAtStartup();

const scheduler = createScheduler({
  intervalMs: config.agentIntervalHours * 60 * 60 * 1000,
  agentRunners,
});

const app = express();
app.use(express.json());
app.use('/api/agents', createAgentsRouter({ statusPath: STATUS_PATH, readStatus, scheduler, chatHandlers }));
app.use(
  '/api/departments',
  createDepartmentsRouter({
    departments,
    createCustomAgent: customAgentsRegistry.createAgent,
    updateCustomAgent: customAgentsRegistry.updateAgent,
    getMemory: customAgentsRegistry.getMemory,
    setMemory: customAgentsRegistry.setMemory,
    compressMemory: customAgentsRegistry.compressMemory,
  })
);
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
```

- [ ] **Step 2: Run the full backend suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all tests across every module pass.

- [ ] **Step 3: Manually verify create/update/memory without needing a real OpenAI key**

Creating, updating, reading, and writing memory never call the model — only `chat` and `memory/compress` do. So this verification needs no real API key.

```bash
cd backend
node server.js
```

```bash
curl -s -X POST http://localhost:3000/api/departments/comercial/agents \
  -H "Content-Type: application/json" \
  -d '{"label":"Prueba Manual","context":"Eres un asistente de prueba.","autonomous":false}'
```
Expected: `201` with `{"id":"custom-prueba-manual-<timestamp>","label":"Prueba Manual"}`. Copy that `id` for the next commands (call it `$AGENT_ID`).

```bash
curl -s http://localhost:3000/api/departments
```
Expected: `comercial`'s `agents` array now includes `{"id":"$AGENT_ID","label":"Prueba Manual"}` — no `deps`/`apiKey` anywhere.

```bash
curl -s http://localhost:3000/api/departments/comercial/agents/$AGENT_ID/memory
```
Expected: `{"content":""}` (no chat happened yet).

```bash
curl -s -X PUT http://localhost:3000/api/departments/comercial/agents/$AGENT_ID/memory \
  -H "Content-Type: application/json" \
  -d '{"content":"memoria de prueba"}'
```
Expected: `{"content":"memoria de prueba"}`.

```bash
curl -s -X PATCH http://localhost:3000/api/departments/comercial/agents/$AGENT_ID \
  -H "Content-Type: application/json" \
  -d '{"label":"Prueba Manual Editada"}'
```
Expected: `{"id":"$AGENT_ID","label":"Prueba Manual Editada"}`, and a follow-up `GET /api/departments` shows the updated label.

Stop the server (Ctrl+C), then confirm `backend/state/custom-agents.json` contains one entry with the updated label and `backend/state/custom-agents/<id>-memoria.md` contains `memoria de prueba`.

Restart the server (`node server.js`) and run `curl -s http://localhost:3000/api/departments` again — the test agent must still be there (confirms `loadAllAtStartup` works). Stop the server and confirm port 3000 is free afterward (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` should fail to connect).

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Wire server.js to the custom agents registry: hot create/update, memory routes"
```

---

### Task 5: End-to-end manual validation

**Files:** none created — this task only exercises what Tasks 1-4 built.

**Interfaces:** none produced.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass across every file, including the new `customAgent.test.js` and `customAgentsRegistry.test.js`, and the extended `departmentsRoute.test.js`.

- [ ] **Step 2: Start the server with a real OPENAI_API_KEY**

```bash
cd backend && node server.js
```

- [ ] **Step 3: Create a real custom agent with an actual skill**

```bash
curl -s -X POST http://localhost:3000/api/departments/comercial/agents \
  -H "Content-Type: application/json" \
  -d '{"label":"Objection Handling","context":"objection-handling: \"ya tenemos algo para esto\" y \"nuestros ingenieros lo van a construir\" son las dos objeciones mas comunes vendiendo a devs. Ayuda a Jose a responderlas con confianza.","autonomous":false}'
```
Expected: `201` with a real `id`/`label`. Save `$AGENT_ID`.

- [ ] **Step 4: Validate conversational memory across two chat calls**

```bash
curl -s -X POST http://localhost:3000/api/agents/$AGENT_ID/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Un prospecto me acaba de decir que ya tienen algo para esto, ¿qué le respondo?"}'
```
Expected: a real, relevant response addressing that specific objection.

```bash
curl -s -X POST http://localhost:3000/api/agents/$AGENT_ID/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"¿Puedes resumir lo que acabamos de hablar?"}'
```
Expected: the reply references the previous exchange (proves memory is being read and used — without memory, the model would have no idea what "lo que acabamos de hablar" refers to).

- [ ] **Step 5: Validate editing**

```bash
curl -s -X PATCH http://localhost:3000/api/departments/comercial/agents/$AGENT_ID \
  -H "Content-Type: application/json" \
  -d '{"context":"Responde SIEMPRE en una sola oración muy breve, sin importar la pregunta."}'
```

```bash
curl -s -X POST http://localhost:3000/api/agents/$AGENT_ID/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Dame consejos para manejar objeciones de precio"}'
```
Expected: a notably short, one-sentence reply — proves the edited context took effect immediately without a restart.

- [ ] **Step 6: Validate memory compression**

```bash
curl -s -X POST http://localhost:3000/api/departments/comercial/agents/$AGENT_ID/memory/compress
```
Expected: a real, shorter summary returned. Then:

```bash
curl -s http://localhost:3000/api/departments/comercial/agents/$AGENT_ID/memory
```
Expected: the stored memory is now the short summary, not the full original transcript.

- [ ] **Step 7: Validate persistence across a restart**

Stop the server, restart it (`node server.js`), then:

```bash
curl -s http://localhost:3000/api/departments
```
Expected: the "Objection Handling" (now relabeled, if Step 5 included a label change) agent is still present in `comercial`'s agent list.

- [ ] **Step 8: Stop the server and confirm it's fully stopped**

Find the actual process (not just a failed curl) and terminate it — run `netstat -ano | grep ':3000' | grep LISTENING` (or equivalent) and confirm there is no output, not only a curl timeout.

- [ ] **Step 9: Commit any runtime artifacts generated during validation, if desired**

```bash
git status
```

If you want to keep the real-data snapshot (same choice made for the previous two live validations), commit `backend/state/custom-agents.json`, `backend/state/custom-agents/`, and `backend/state/agents-status.json`.
