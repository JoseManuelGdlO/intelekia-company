const fs = require('fs');
const { fechaLocal, reporteIdFor, ultimoReporte, resumenDe, guardarReporte } = require('../lib/reportes');

/**
 * Seguimiento de Proyectos.
 * Ciclo autónomo: genera un reporte de seguimiento consultando la base de datos de proyectos
 * (herramienta `consultar_base_datos`, que se activa en Editar → Herramientas) y lo guarda en
 * `reportesDir`. Chat: responde preguntas sobre proyectos usando la base y el último reporte.
 */
const SIN_ACCESO = 'SIN_ACCESO_BD';
const MAX_REPORTE_ANTERIOR = 3000;

function reporteFileName(reporteId) {
  return `${reporteId}.md`;
}

/** Paso fijo al inicio de cada ciclo: entregar los tickets atrasados al PM para que avise. */
async function entregarAtrasados(notificarAtrasados) {
  if (typeof notificarAtrasados !== 'function') return null;
  try {
    return await notificarAtrasados();
  } catch (err) {
    return { estado: 'error', motivo: err.message, envios: [] };
  }
}

function describirAtrasados(atrasados) {
  if (!atrasados) return '';
  if (atrasados.estado === 'ok') return `Atrasados al PM: ${atrasados.resumen}`;
  if (atrasados.estado === 'sin_atrasados') return 'Sin tickets atrasados';
  return `Atrasados no notificados: ${atrasados.motivo}`;
}

async function runCycle({
  contextPath,
  rolePath,
  reportesDir,
  notificarAtrasados,
  apiKey,
  model,
  createChatCompletion,
  now = () => new Date(),
}) {
  const atrasados = await entregarAtrasados(notificarAtrasados);
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const fecha = now();
  const anterior = ultimoReporte(reportesDir);

  let userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Fecha y hora actual (Durango): ${fechaLocal(fecha)}.\n\n` +
    'Genera el reporte de seguimiento de proyectos de hoy, siguiendo exactamente el formato de tu rol. ' +
    'Antes de escribirlo, consulta la base de datos con tu herramienta para usar datos reales y actuales.\n';
  if (atrasados) {
    userPrompt += `\nAl iniciar este ciclo le entregaste al PM los tickets atrasados para que avise a cada responsable. Resultado: ${describirAtrasados(atrasados)}. Menciónalo en una línea del reporte.\n`;
  }
  if (anterior) {
    const previo = anterior.contenido.slice(0, MAX_REPORTE_ANTERIOR);
    userPrompt += `\nReporte anterior (${anterior.id}), úsalo solo para señalar qué cambió:\n${previo}\n`;
  }
  userPrompt += `\nSi NO tienes disponible la herramienta consultar_base_datos, responde únicamente: ${SIN_ACCESO}`;

  const reporte = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!reporte || reporte.trim().startsWith(SIN_ACCESO)) {
    return { reporte: null, motivo: 'sin_acceso_bd', atrasados };
  }

  const id = reporteIdFor(fecha);
  const reportePath = guardarReporte(reportesDir, id, reporte);

  return { reporte: { id, path: reportePath, resumen: resumenDe(reporte) }, atrasados };
}

async function chat({ message, contextPath, rolePath, reportesDir, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const messages = [
    { role: 'system', content: role },
    { role: 'system', content: `Contexto de negocio:\n${context}` },
  ];
  const ultimo = ultimoReporte(reportesDir);
  if (ultimo) {
    messages.push({
      role: 'system',
      content: `Tu último reporte de seguimiento (${ultimo.id}). Úsalo como referencia, pero consulta la base si necesitas datos actuales:\n${ultimo.contenido}`,
    });
  }
  messages.push({ role: 'user', content: message });

  const reply = await createChatCompletion({ apiKey, model, messages });
  return { reply };
}

function describeSuccess(result) {
  const extra = describirAtrasados(result.atrasados);
  const conExtra = (texto) => (extra ? `${texto} · ${extra}` : texto);
  if (result.reporte) {
    return {
      estatus: 'listo_para_revision',
      ultimaAccion: conExtra(`Reporte de seguimiento: ${result.reporte.resumen}`),
      ultimoItemId: result.reporte.id,
    };
  }
  return {
    estatus: 'idle',
    ultimaAccion: conExtra('No pudo generar el reporte: activa "Base de datos" en Editar → Herramientas'),
  };
}

module.exports = { runCycle, chat, describeSuccess, reporteFileName, ultimoReporte, resumenDe, SIN_ACCESO };
