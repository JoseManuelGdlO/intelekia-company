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
const { createMeta } = require('./lib/meta');
const { createAprobaciones } = require('./lib/aprobaciones');
const { createAprobacionesRouter } = require('./routes/aprobaciones');
const { crearEjecutorRespuesta, AGENT_ID: RESPUESTAS_REDES_ID } = require('./agents/respuestasRedes');
const { createCorreoRouter } = require('./routes/correo');
const { createAtrasadosFlow } = require('./lib/atrasados');
const { createActividadStore } = require('./lib/actividad');
const { createGithubPlugin } = require('./lib/githubPlugin');
const { createRevisionesPRRouter } = require('./routes/revisionesPR');
const { createWhatsapp } = require('./lib/whatsapp');
const { createVoz } = require('./lib/voz');
const { createRecepcionWhatsapp, crearEnrutadorIA } = require('./lib/recepcionWhatsapp');
const { createWhatsappEstadoRouter, createWhatsappWebhookApp } = require('./routes/whatsapp');

const { createAcceso } = require('./lib/acceso');
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
function conActividad(agentId, runCycle, { silencioso = false } = {}) {
  return async (deps) => {
    // Los agentes de ciclo muy corto (Revisor de PRs) no anuncian cada inicio.
    if (!silencioso) actividad.log(agentId, 'inicio', '▶️ Inicia ciclo autónomo');
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
// Graph API de Meta (Respuestas en Redes) y bandeja general de aprobaciones.
const meta = createMeta({ config: config.meta });
const aprobaciones = createAprobaciones({ filePath: path.join(__dirname, 'state', 'aprobaciones.json') });
// Antes de publicar verifica que la página no lo haya respondido ya (p. ej. el fundador a mano).
aprobaciones.registrarEjecutor(
  'responder_comentario',
  crearEjecutorRespuesta({ meta, log: (tipo, texto) => actividad.log(RESPUESTAS_REDES_ID, tipo, texto) })
);
// Skills (GitHub) y plugins (servidores MCP) instalados desde internet; cada agente elige cuáles usa.
// 3 min de espera: algunos plugins (p. ej. mcp-remote) abren el navegador para iniciar sesión al conectar.
const instalables = createInstalables({ dir: path.join(__dirname, 'state', 'instalados'), timeoutMs: 180000 });
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
  if ('meta' in agent.deps) agent.deps.meta = meta;
  if ('aprobaciones' in agent.deps) agent.deps.aprobaciones = aprobaciones;
  if ('autonomia' in agent.deps) agent.deps.autonomia = () => profiles.autonomiaOf(agent.id);
  if ('bitacora' in agent.deps) agent.deps.bitacora = (tipo, texto, detalle) => actividad.log(agent.id, tipo, texto, detalle);
  if ('github' in agent.deps) {
    agent.deps.github = createGithubPlugin({ instalables, profiles, agentId: agent.id, owner: config.githubOwner });
  }
}

const agentRunners = {};
const chatHandlers = {};

for (const agent of allAgents) {
  agentRunners[agent.id] = wrapRunCycle({
    agentId: agent.id,
    statusPath: STATUS_PATH,
    runCycle: conActividad(agent.id, agent.module.runCycle, { silencioso: Boolean(agent.cicloSilencioso) }),
    deps: agent.deps,
    describeSuccess: (result) => {
      const { silencioso, ...patch } = agent.module.describeSuccess(result);
      if (!silencioso) {
        profiles.remember(agent.id, `Ciclo autónomo: ${patch.ultimaAccion}`);
        actividad.log(agent.id, 'fin', `🏁 Terminó: ${patch.ultimaAccion}`);
      }
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

// Canal de WhatsApp: el fundador le escribe a la oficina (texto o audio).
const whatsapp = createWhatsapp({ config: config.whatsapp });
const voz = createVoz({ apiKey: config.openaiApiKey, voz: config.whatsapp.voz });
// Los avisos del canal que no son de un trabajador quedan en la bitácora bajo el id 'whatsapp'.
function registrarWhatsapp(agentId, tipo, texto) {
  if (agentId) {
    actividad.log(agentId, tipo, texto);
    return;
  }
  actividad.log('whatsapp', tipo, texto);
  console.warn(texto);
}
function agentesParaWhatsapp() {
  return departments
    .flatMap((d) => d.agents)
    .filter((a) => chatHandlers[a.id])
    .map((a) => {
      let rol = '';
      try {
        rol = String(profiles.getProfile(a.id).rol || '').slice(0, 300);
      } catch {
        rol = '';
      }
      return { id: a.id, label: a.label, rol };
    });
}
const recepcionWhatsapp = createRecepcionWhatsapp({
  whatsapp,
  voz,
  estadoPath: path.join(__dirname, 'state', 'whatsapp.json'),
  permitidos: config.whatsapp.permitidos,
  agentes: agentesParaWhatsapp,
  chatDe: async (agentId, texto) => {
    const handler = chatHandlers[agentId];
    if (!handler) throw new Error(`No existe el trabajador ${agentId}`);
    const result = await handler({ message: texto });
    return result.reply;
  },
  forzarCiclo: async (agentId) => {
    await scheduler.runOne(agentId);
    return readStatus(STATUS_PATH)[agentId]?.ultimaAccion || 'Listo';
  },
  aprobaciones,
  enrutarConIA: crearEnrutadorIA({ createChatCompletion, apiKey: config.openaiApiKey, model: config.openaiModel }),
  labelOf: (id) => departments.flatMap((d) => d.agents).find((a) => a.id === id)?.label || id,
  registrar: registrarWhatsapp,
  plantilla: config.whatsapp.plantillaAviso ? { nombre: config.whatsapp.plantillaAviso, idioma: config.whatsapp.plantillaIdioma } : null,
});
aprobaciones.suscribir((item) => recepcionWhatsapp.avisarAprobacion(item));

const app = express();
// Usuario y contraseña para toda la oficina (si OFICINA_USUARIO/OFICINA_PASSWORD están definidos).
const acceso = createAcceso(config.acceso);
if (!acceso.activo && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  La oficina está SIN contraseña: define OFICINA_USUARIO y OFICINA_PASSWORD.');
}
app.use(acceso);
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
app.use('/api/aprobaciones', createAprobacionesRouter({ aprobaciones }));
const revisorPRsAgent = allAgents.find((a) => a.id === 'revisor-prs');
if (revisorPRsAgent) {
  app.use('/api/revisiones-pr', createRevisionesPRRouter({ filePath: revisorPRsAgent.deps.revisionesPath }));
}
app.use('/api/comunicacion', createComunicacionRouter({ comunicacion, conversaciones }));
app.use(createWhatsappEstadoRouter({ whatsapp, recepcion: recepcionWhatsapp }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

// El webhook de WhatsApp vive en OTRA app y OTRO puerto: es lo único que se expone con ngrok,
// así la oficina (puerto principal) nunca queda en internet.
const webhookApp = createWhatsappWebhookApp({ whatsapp, recepcion: recepcionWhatsapp, config: config.whatsapp, registrar: registrarWhatsapp });
// Siempre escucha: así Meta puede verificar el webhook aunque falte otra variable; los mensajes
// solo se procesan cuando la configuración está completa.
webhookApp.listen(config.whatsapp.webhookPort, () => {
  const estadoWhatsapp = whatsapp.estado();
  console.log(
    `Webhook de WhatsApp escuchando en el puerto ${config.whatsapp.webhookPort} (/webhook/whatsapp)` +
      (estadoWhatsapp.ok ? ' — configuración completa ✓' : ` — ⚠️ ${estadoWhatsapp.motivo}`)
  );
});

module.exports = app;
