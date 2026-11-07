const fs = require('fs');
const path = require('path');
const { createCustomAgentModule } = require('../agents/customAgent');
const { slugify } = require('./slugify');

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
  completionForAgent,
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
      // Con reglas de comunicación activas, el trabajador puede consultar a sus compañeros.
      createChatCompletion: completionForAgent ? completionForAgent(id) : createChatCompletion,
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
    fs.mkdirSync(path.dirname(deps.memoryPath), { recursive: true });
    const agentRef = { id: entry.id, label: entry.label, module, deps, roleText: entry.context, isCustom: true, autonomous: entry.autonomous };

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
      record.agentRef.roleText = context;
    }
    if (autonomous !== undefined) {
      record.entry.autonomous = Boolean(autonomous);
      record.agentRef.autonomous = record.entry.autonomous;
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

module.exports = { createCustomAgentRegistry };
