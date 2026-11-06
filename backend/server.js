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
