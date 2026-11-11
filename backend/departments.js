const path = require('path');
const buscadorTendencias = require('./agents/buscadorTendencias');
const publicador = require('./agents/publicador');
const respuestasRedes = require('./agents/respuestasRedes');
const buscadorProspectos = require('./agents/buscadorProspectos');
const seguimientoCRM = require('./agents/seguimientoCRM');
const cotizador = require('./agents/cotizador');
const pm = require('./agents/pm');
const revisorPRs = require('./agents/revisorPRs');

function buildDepartments({ rootDir, config, createChatCompletion }) {
  const CONTEXT_PATH = path.join(rootDir, 'CONTEXTO-INTELEKIA.md');
  const MARKETING_DIR = path.join(rootDir, 'departamentos', 'marketing');
  const COMERCIAL_DIR = path.join(rootDir, 'departamentos', 'comercial');
  const ADMINISTRACION_DIR = path.join(rootDir, 'departamentos', 'administracion');
  const DESARROLLO_DIR = path.join(rootDir, 'departamentos', 'desarrollo');

  const shared = { apiKey: config.openaiApiKey, model: config.openaiModel, createChatCompletion };

  return [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        {
          id: 'buscador-tendencias',
          label: 'Buscador de Tendencias',
          cicloHoras: 6, // Ideas para reels: cada 6 h (editable en la app)
          module: buscadorTendencias,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(MARKETING_DIR, 'agentes', 'buscador-tendencias.md'),
            ideasPath: path.join(MARKETING_DIR, 'content', 'ideas.json'),
            ...shared,
          },
        },
        {
          id: 'publicador',
          label: 'Publicador',
          module: publicador,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(MARKETING_DIR, 'agentes', 'publicador.md'),
            ideasPath: path.join(MARKETING_DIR, 'content', 'ideas.json'),
            draftsDir: path.join(MARKETING_DIR, 'content', 'drafts'),
            ...shared,
          },
        },
        {
          id: 'respuestas-redes',
          label: 'Respuestas en Redes',
          cicloHoras: 0.17, // ~10 min: revisa comentarios nuevos en FB e IG (editable en la app)
          cicloSilencioso: true,
          usaAutonomia: true, // muestra el switch Autónomo/Supervisado en su perfil
          module: respuestasRedes,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(MARKETING_DIR, 'agentes', 'respuestas-redes.md'),
            atendidosPath: path.join(rootDir, 'backend', 'state', 'comentarios-atendidos.json'),
            // server.js conecta aquí Meta, la bandeja de aprobaciones, el switch de autonomía y la bitácora.
            meta: null,
            aprobaciones: null,
            autonomia: null,
            bitacora: null,
            ...shared,
          },
        },
      ],
    },
    {
      id: 'comercial',
      label: 'Comercial',
      agents: [
        {
          id: 'buscador-prospectos',
          label: 'Buscador de Prospectos',
          module: buscadorProspectos,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'buscador-prospectos.md'),
            prospectosPath: path.join(COMERCIAL_DIR, 'content', 'prospectos.json'),
            ...shared,
          },
        },
        {
          id: 'seguimiento-crm',
          label: 'Seguimiento de Proyectos',
          cicloHoras: 24, // Reporte y avisos de tickets atrasados: una vez al día (editable en la app)
          module: seguimientoCRM,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'seguimiento-crm.md'),
            // Reportes generados con datos de la base de proyectos (herramienta consultar_base_datos).
            reportesDir: path.join(COMERCIAL_DIR, 'content', 'reportes-seguimiento'),
            // server.js conecta aquí el flujo de tickets atrasados → PM → correos (lib/atrasados.js).
            notificarAtrasados: null,
            ...shared,
          },
        },
        {
          id: 'cotizador',
          label: 'Cotizador',
          module: cotizador,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'cotizador.md'),
            serviciosPath: path.join(COMERCIAL_DIR, 'content', 'servicios.json'),
            cotizacionesDir: path.join(COMERCIAL_DIR, 'content', 'cotizaciones-tipo'),
            // Plantilla del fundador para todas las cotizaciones (se edita en el perfil del Cotizador).
            plantillaPath: path.join(COMERCIAL_DIR, 'agentes', 'plantilla-cotizacion.md'),
            ...shared,
          },
        },
      ],
    },
    {
      id: 'administracion',
      label: 'Administración',
      agents: [
        {
          id: 'pm',
          label: 'PM',
          module: pm,
          // Para dar seguimiento necesita poder preguntarle a cualquier agente (editable en Comunicación).
          comunicacionPorDefecto: 'todos',
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(ADMINISTRACION_DIR, 'agentes', 'pm.md'),
            reportesDir: path.join(ADMINISTRACION_DIR, 'content', 'reportes-equipo'),
            // server.js conecta aquí el panorama real del equipo (lib/teamSnapshot.js).
            getTeamSnapshot: null,
            ...shared,
          },
        },
      ],
    },
    {
      id: 'desarrollo',
      label: 'Desarrollo',
      agents: [
        {
          id: 'revisor-prs',
          label: 'Revisor de PRs',
          cicloHoras: 0.08, // ~5 min: revisa si hay PRs nuevos (editable en la app)
          cicloSilencioso: true, // un ciclo sin PRs no escribe en memoria ni en la bitácora
          module: revisorPRs,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(DESARROLLO_DIR, 'agentes', 'revisor-prs.md'),
            revisionesPath: path.join(rootDir, 'backend', 'state', 'revisiones-pr.json'),
            // server.js conecta aquí el acceso al plugin de GitHub (lib/githubPlugin.js).
            github: null,
            diasRecientes: config.revisorPrsDias,
            ...shared,
          },
        },
      ],
    },
  ];
}

module.exports = { buildDepartments };
