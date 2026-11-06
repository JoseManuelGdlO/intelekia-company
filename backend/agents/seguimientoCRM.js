const fs = require('fs');
const path = require('path');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');
const { assertSafeItemId } = require('../lib/validateItemId');

function seguimientoFileName(prospectoId) {
  return `seguimiento-${prospectoId}.md`;
}

async function runCycle({ contextPath, rolePath, prospectosPath, seguimientosDir, apiKey, model, createChatCompletion }) {
  const prospectos = readProspectos(prospectosPath);
  const nuevo = prospectos.find((p) => p.estatus === 'nuevo');

  if (!nuevo) {
    return { mensajeCreado: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Prospecto a contactar:\nNegocio: ${nuevo.negocio}\nGiro: ${nuevo.giro}\nRazón: ${nuevo.razon}`;

  const mensaje = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.mkdirSync(seguimientosDir, { recursive: true });
  const seguimientoPath = path.join(seguimientosDir, seguimientoFileName(nuevo.id));
  fs.writeFileSync(seguimientoPath, mensaje);

  const updatedProspectos = prospectos.map((p) => (p.id === nuevo.id ? { ...p, estatus: 'contactado' } : p));
  writeProspectos(prospectosPath, updatedProspectos);

  return {
    mensajeCreado: {
      prospectoId: nuevo.id,
      prospectoNegocio: nuevo.negocio,
      seguimientoPath,
    },
  };
}

async function chat({ message, itemId, seguimientosDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  assertSafeItemId(itemId, 'No se encontró un mensaje de seguimiento para editar (itemId inválido o faltante)');
  const seguimientoPath = path.join(seguimientosDir, seguimientoFileName(itemId));
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const currentMessage = fs.readFileSync(seguimientoPath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Mensaje actual:\n${currentMessage}\n\n` +
    `Instrucción del fundador: ${message}`;

  const updatedMessage = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.writeFileSync(seguimientoPath, updatedMessage);

  return { reply: updatedMessage };
}

function describeSuccess(result) {
  return result.mensajeCreado
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Redactó un mensaje para: ${result.mensajeCreado.prospectoNegocio}`,
        ultimoItemId: result.mensajeCreado.prospectoId,
      }
    : { estatus: 'idle', ultimaAccion: 'Sin prospectos nuevos por contactar' };
}

module.exports = { runCycle, chat, seguimientoFileName, describeSuccess };
