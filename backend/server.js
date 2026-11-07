const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus } = require('./lib/statusStore');
const { createChatCompletion, createChatCompletionMessage } = require('./lib/openaiClient');
const { buildDepartments } = require('./departments');
const { createCustomAgentRegistry } = require('./lib/customAgentsRegistry');
const { createAgentsRouter } = require('./routes/agents');
const { createDepartmentsRouter } = require('./routes/departments');
const { createComunicacionStore } = require('./lib/comunicacionStore');
const { createConversacionesStore } = require('./lib/conversacionesStore');
const { createColleagues } = require('./lib/colleagues');
const { createComunicacionRouter } = require('./routes/comunicacion');
const { createAgentProfiles } = require('./lib/agentProfiles');
const { createPerfilesRouter } = require('./routes/perfiles');

const config = loadConfig();
const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXTO-INTELEKIA.md');
const CUSTOM_AGENTS_PATH = path.join(__dirname, 'state', 'custom-agents.json');
const COMUNICACION_PATH = path.join(__dirname, 'state', 'comunicacion.json');
const CONVERSACIONES_PATH = path.join(__dirname, 'state', 'conversaciones.json');
const PERFILES_PATH = path.join(__dirname, 'state', 'perfiles.json');
const MEMORIAS_DIR = path.join(__dirname, 'state', 'memorias');

const departments = buildDepartments({ rootDir: ROOT, config, createChatCompletion });
const allAgents = departments.flatMap((department) => department.agents);

// Comunicación entre agentes: reglas de quién puede consultar a quién + bitácora de conversaciones.
const comunicacion = createComunicacionStore({ configPath: COMUNICACION_PATH, departments });
const conversaciones = createConversacionesStore({ filePath: CONVERSACIONES_PATH });
// Perfil editable de cada agente: rol, skills/plugins/documentos y memoria.
const profiles = createAgentProfiles({
  profilesPath: PERFILES_PATH,
  memoriasDir: MEMORIAS_DIR,
  departments,
  createChatCompletion,
  config,
  // El registro se crea más abajo; solo se usa al editar un trabajador a la medida.
  updateCustomAgent: (id, patch) => customAgentsRegistry.updateAgent(id, patch),
});
const colleagues = createColleagues({
  profiles,
  comunicacion,
  conversaciones,
  createChatCompletion,
  createChatCompletionMessage,
  contextPath: CONTEXT_PATH,
});
for (const agent of allAgents) {
  agent.deps.createChatCompletion = colleagues.completionFor(agent.id);
}

const agentRunners = {};
const chatHandlers = {};

for (const agent of allAgents) {
  agentRunners[agent.id] = wrapRunCycle({
    agentId: agent.id,
    statusPath: STATUS_PATH,
    runCycle: agent.module.runCycle,
    deps: agent.deps,
    describeSuccess: (result) => {
      const patch = agent.module.describeSuccess(result);
      profiles.remember(agent.id, `Ciclo autónomo: ${patch.ultimaAccion}`);
      return patch;
    },
  });
  chatHandlers[agent.id] = async (body) => {
    const result = await agent.module.chat({ ...body, ...agent.deps });
    profiles.remember(agent.id, `El fundador me escribió: ${body.message}\nRespondí: ${result.reply}`);
    return result;
  };
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
  completionForAgent: colleagues.completionFor,
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
app.use('/api/perfiles', createPerfilesRouter({ profiles }));
app.use('/api/comunicacion', createComunicacionRouter({ comunicacion, conversaciones }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
