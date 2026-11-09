const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus, updateAgentStatus } = require('./lib/statusStore');
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
const { createInstalables } = require('./lib/instalables');
const { createInstalablesRouter } = require('./routes/instalables');
const { createPerfilesRouter } = require('./routes/perfiles');
const { createDatabase } = require('./lib/database');
const { createBaseDatosRouter } = require('./routes/baseDatos');
const { createTeamSnapshot } = require('./lib/teamSnapshot');
const { createMailer } = require('./lib/correo');
const { createCorreoRouter } = require('./routes/correo');
const { createAtrasadosFlow } = require('./lib/atrasados');
const { createActividadStore } = require('./lib/actividad');

const config = loadConfig();
const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXTO-INTELEKIA.md');
const CUSTOM_AGENTS_PATH = path.join(__dirname, 'state', 'custom-agents.json');
const COMUNICACION_PATH = path.join(__dirname, 'state', 'comunicacion.json');
const CONVERSACIONES_PATH = path.join(__dirname, 'state', 'conversaciones.json');
const PERFILES_PATH = path.join(__dirname, 'state', 'perfiles.json');
const MEMORIAS_DIR = path.join(__dirname, 'state', 'memorias');
const CONSULTAS_BD_PATH = path.join(__dirname, 'state', 'consultas-bd.json');
const CORREO_SETTINGS_PATH = path.join(__dirname, 'state', 'correo.json');
const CORREOS_PATH = path.join(__dirname, 'state', 'correos.json');
const CICLOS_PATH = path.join(__dirname, 'state', 'ciclos.json');
const ACTIVIDAD_PATH = path.join(__dirname, 'state', 'actividad.json');

const departments = buildDepartments({ rootDir: ROOT, config, createChatCompletion });
// Bitácora en vivo de lo que hace cada agente (se ve en su panel → 🧠 Actividad).
const actividad = createActividadStore({ filePath: ACTIVIDAD_PATH });

/** Envuelve un ciclo autónomo para registrar su inicio, fin y errores en la bitácora. */
function conActividad(agentId, runCycle) {
  return async (deps) => {
    actividad.log(agentId, 'inicio', '▶️ Inicia ciclo autónomo');
    try {
      return await runCycle(deps);
    } catch (err) {
      actividad.log(agentId, 'error', `❌ El ciclo falló: ${err.message}`);
      throw err;
    }
  };
}
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
// Base de datos externa de solo lectura que los agentes pueden consultar si se les activa.
const database = createDatabase({ dbConfig: config.db, logPath: CONSULTAS_BD_PATH });
if (database.isConfigured() && config.db.user === 'root') {
  console.warn('⚠️  DB_USER es root: crea un usuario MySQL de solo lectura para los agentes.');
}
// Correo saliente (SMTP) para los agentes que lo tengan activado.
const mailer = createMailer({ smtp: config.smtp, settingsPath: CORREO_SETTINGS_PATH, logPath: CORREOS_PATH });
// Skills (GitHub) y plugins (servidores MCP) instalados desde internet; cada agente elige cuáles usa.
const instalables = createInstalables({ dir: path.join(__dirname, 'state', 'instalados') });
const colleagues = createColleagues({
  instalables,
  profiles,
  database,
  mailer,
  actividad,
  comunicacion,
  conversaciones,
  createChatCompletion,
  createChatCompletionMessage,
  contextPath: CONTEXT_PATH,
});
for (const agent of allAgents) {
  agent.deps.createChatCompletion = colleagues.completionFor(agent.id);
}

// Panorama real del equipo para el PM (estatus, errores, conversaciones, herramientas…).
const teamSnapshot = createTeamSnapshot({
  departments,
  statusPath: STATUS_PATH,
  readStatus,
  conversaciones,
  comunicacion,
  profiles,
  database,
});
// Al iniciar cada ciclo, Seguimiento entrega los tickets atrasados al PM y el PM avisa por correo.
const atrasadosFlow = createAtrasadosFlow({
  database,
  mailer,
  comunicacion,
  conversaciones,
  profiles,
  origenId: 'seguimiento-crm',
  pmId: 'pm',
  onPmAction: (id, patch) => updateAgentStatus(STATUS_PATH, id, patch),
  actividad,
});
for (const agent of allAgents) {
  if ('notificarAtrasados' in agent.deps) agent.deps.notificarAtrasados = atrasadosFlow.ejecutar;
  if ('getTeamSnapshot' in agent.deps) {
    agent.deps.getTeamSnapshot = () => teamSnapshot.toText(teamSnapshot.build({ excluir: [agent.id] }));
  }
}

const agentRunners = {};
const chatHandlers = {};

for (const agent of allAgents) {
  agentRunners[agent.id] = wrapRunCycle({
    agentId: agent.id,
    statusPath: STATUS_PATH,
    runCycle: conActividad(agent.id, agent.module.runCycle),
    deps: agent.deps,
    describeSuccess: (result) => {
      const patch = agent.module.describeSuccess(result);
      profiles.remember(agent.id, `Ciclo autónomo: ${patch.ultimaAccion}`);
      actividad.log(agent.id, 'fin', `🏁 Terminó: ${patch.ultimaAccion}`);
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
  // Los trabajadores a la medida también registran inicio/fin de sus ciclos en la bitácora.
  wrapRunCycle: (opts) =>
    wrapRunCycle({
      ...opts,
      runCycle: conActividad(opts.agentId, opts.runCycle),
      describeSuccess: (result) => {
        const patch = opts.describeSuccess(result);
        actividad.log(opts.agentId, 'fin', `🏁 Terminó: ${patch.ultimaAccion}`);
        return patch;
      },
    }),
  statusPath: STATUS_PATH,
  completionForAgent: colleagues.completionFor,
});
customAgentsRegistry.loadAllAtStartup();

// Cada agente tiene su propio intervalo (perfil → Rol y contexto → Ciclo automático).
const scheduler = createScheduler({
  intervalMs: config.agentIntervalHours * 60 * 60 * 1000,
  agentRunners,
  intervalFor: (agentId) => {
    const { cadaHoras } = profiles.cicloOf(agentId);
    return cadaHoras > 0 ? cadaHoras * 60 * 60 * 1000 : null;
  },
  statePath: CICLOS_PATH,
});

const app = express();
app.use(express.json());
app.use('/api/agents', createAgentsRouter({ statusPath: STATUS_PATH, readStatus, scheduler, chatHandlers, actividad }));
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
app.use('/api/instalables', createInstalablesRouter({ instalables }));
app.use('/api/base-datos', createBaseDatosRouter({ database }));
app.use('/api/correo', createCorreoRouter({ mailer }));
app.use('/api/comunicacion', createComunicacionRouter({ comunicacion, conversaciones }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
