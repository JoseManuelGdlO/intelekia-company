const fs = require('fs');
const { fechaLocal, reporteIdFor, ultimoReporte, resumenDe, guardarReporte } = require('../lib/reportes');

/**
 * PM (Administración): da seguimiento a los agentes de IA de la oficina.
 * Ciclo autónomo: recibe el panorama real del equipo (`getTeamSnapshot`), puede consultar a los
 * agentes con la herramienta de compañeros y escribe un reporte de gestión en `reportesDir`.
 * Chat: responde sobre el estado del equipo con el panorama actual y su último reporte.
 */
const MAX_REPORTE_ANTERIOR = 3000;

function panorama(getTeamSnapshot) {
  if (typeof getTeamSnapshot !== 'function') return 'No hay datos del equipo disponibles.';
  return getTeamSnapshot();
}

async function runCycle({ contextPath, rolePath, reportesDir, getTeamSnapshot, apiKey, model, createChatCompletion, now = () => new Date() }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const fecha = now();
  const anterior = ultimoReporte(reportesDir, 'reporte-equipo');

  let userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Fecha y hora actual (Durango): ${fechaLocal(fecha)}.\n\n` +
    `${panorama(getTeamSnapshot)}\n\n` +
    'Genera el reporte de seguimiento del equipo virtual de hoy, siguiendo exactamente el formato de tu rol. ' +
    'Basa cada afirmación en el panorama anterior; si necesitas saber en qué está un agente, consúltalo con tu herramienta.\n';
  if (anterior) {
    userPrompt += `\nReporte anterior (${anterior.id}), úsalo solo para señalar qué cambió:\n${anterior.contenido.slice(0, MAX_REPORTE_ANTERIOR)}\n`;
  }

  const reporte = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const id = reporteIdFor(fecha, 'reporte-equipo');
  const reportePath = guardarReporte(reportesDir, id, reporte);
  return { reporte: { id, path: reportePath, resumen: resumenDe(reporte) } };
}

async function chat({ message, contextPath, rolePath, reportesDir, getTeamSnapshot, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const messages = [
    { role: 'system', content: role },
    { role: 'system', content: `Contexto de negocio:\n${context}` },
    { role: 'system', content: panorama(getTeamSnapshot) },
  ];
  const ultimo = ultimoReporte(reportesDir, 'reporte-equipo');
  if (ultimo) {
    messages.push({ role: 'system', content: `Tu último reporte del equipo (${ultimo.id}):\n${ultimo.contenido}` });
  }
  messages.push({ role: 'user', content: message });
  const reply = await createChatCompletion({ apiKey, model, messages });
  return { reply };
}

function describeSuccess(result) {
  return {
    estatus: 'listo_para_revision',
    ultimaAccion: `Reporte del equipo: ${result.reporte.resumen}`,
    ultimoItemId: result.reporte.id,
  };
}

module.exports = { runCycle, chat, describeSuccess };
