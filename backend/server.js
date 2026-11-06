const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus } = require('./lib/statusStore');
const { createChatCompletion } = require('./lib/openaiClient');
const buscadorTendencias = require('./agents/buscadorTendencias');
const publicador = require('./agents/publicador');
const { createAgentsRouter } = require('./routes/agents');

const config = loadConfig();

const ROOT = path.join(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXTO-INTELEKIA.md');
const MARKETING_DIR = path.join(ROOT, 'departamentos', 'marketing');
const IDEAS_PATH = path.join(MARKETING_DIR, 'content', 'ideas.json');
const DRAFTS_DIR = path.join(MARKETING_DIR, 'content', 'drafts');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');

const buscadorDeps = {
  contextPath: CONTEXT_PATH,
  rolePath: path.join(MARKETING_DIR, 'agentes', 'buscador-tendencias.md'),
  ideasPath: IDEAS_PATH,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  createChatCompletion,
};

const publicadorDeps = {
  contextPath: CONTEXT_PATH,
  rolePath: path.join(MARKETING_DIR, 'agentes', 'publicador.md'),
  ideasPath: IDEAS_PATH,
  draftsDir: DRAFTS_DIR,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  createChatCompletion,
};

const agentRunners = {
  'buscador-tendencias': wrapRunCycle({
    agentId: 'buscador-tendencias',
    statusPath: STATUS_PATH,
    runCycle: buscadorTendencias.runCycle,
    deps: buscadorDeps,
    describeSuccess: (result) => ({
      estatus: 'idle',
      ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s) nueva(s)`,
    }),
  }),
  publicador: wrapRunCycle({
    agentId: 'publicador',
    statusPath: STATUS_PATH,
    runCycle: publicador.runCycle,
    deps: publicadorDeps,
    describeSuccess: (result) =>
      result.draftCreated
        ? {
            estatus: 'listo_para_revision',
            ultimaAccion: `Redactó un draft para: ${result.draftCreated.ideaTexto}`,
            ultimoIdeaId: result.draftCreated.ideaId,
          }
        : { estatus: 'idle', ultimaAccion: 'Sin ideas pendientes por redactar' },
  }),
};

const chatHandlers = {
  'buscador-tendencias': (body) => buscadorTendencias.chat({ ...body, ...buscadorDeps }),
  publicador: (body) => publicador.chat({ ...body, ...publicadorDeps }),
};

const scheduler = createScheduler({
  intervalMs: config.agentIntervalHours * 60 * 60 * 1000,
  agentRunners,
});

const app = express();
app.use(express.json());
app.use('/api/agents', createAgentsRouter({ statusPath: STATUS_PATH, readStatus, scheduler, chatHandlers }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
