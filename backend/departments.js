const path = require('path');
const buscadorTendencias = require('./agents/buscadorTendencias');
const publicador = require('./agents/publicador');
const buscadorProspectos = require('./agents/buscadorProspectos');
const seguimientoCRM = require('./agents/seguimientoCRM');
const cotizador = require('./agents/cotizador');

function buildDepartments({ rootDir, config, createChatCompletion }) {
  const CONTEXT_PATH = path.join(rootDir, 'CONTEXTO-INTELEKIA.md');
  const MARKETING_DIR = path.join(rootDir, 'departamentos', 'marketing');
  const COMERCIAL_DIR = path.join(rootDir, 'departamentos', 'comercial');

  const shared = { apiKey: config.openaiApiKey, model: config.openaiModel, createChatCompletion };

  return [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        {
          id: 'buscador-tendencias',
          label: 'Buscador de Tendencias',
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
          label: 'Seguimiento / CRM',
          module: seguimientoCRM,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'seguimiento-crm.md'),
            prospectosPath: path.join(COMERCIAL_DIR, 'content', 'prospectos.json'),
            seguimientosDir: path.join(COMERCIAL_DIR, 'content', 'seguimientos'),
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
            ...shared,
          },
        },
      ],
    },
  ];
}

module.exports = { buildDepartments };
