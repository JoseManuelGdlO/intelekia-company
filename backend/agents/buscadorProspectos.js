const fs = require('fs');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

async function runCycle({ contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const existingProspectos = readProspectos(prospectosPath);
  const existingNegocios = existingProspectos.map((p) => p.negocio);

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Prospectos que ya existen (no los repitas):\n${JSON.stringify(existingNegocios)}\n\n` +
    'Dame entre 3 y 5 prospectos nuevos.';

  const raw = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const nuevos = parseJsonArrayResponse(raw, {
    emptyArrayErrorMessage: 'La respuesta del modelo no es un arreglo de prospectos',
  });

  const addedProspectos = nuevos.map((p, index) => ({
    id: `prospecto-${Date.now()}-${index}`,
    negocio: p.negocio,
    giro: p.giro,
    razon: p.razon,
    estatus: 'nuevo',
    creadoEn: new Date().toISOString(),
  }));

  writeProspectos(prospectosPath, [...existingProspectos, ...addedProspectos]);

  return { addedProspectos };
}

async function chat({ message, guardar, contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const reply = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'system', content: `Contexto de negocio:\n${context}` },
      { role: 'user', content: message },
    ],
  });

  let savedProspecto = null;
  if (guardar) {
    const existingProspectos = readProspectos(prospectosPath);
    savedProspecto = {
      id: `prospecto-${Date.now()}`,
      negocio: reply,
      giro: null,
      razon: null,
      estatus: 'nuevo',
      creadoEn: new Date().toISOString(),
    };
    writeProspectos(prospectosPath, [...existingProspectos, savedProspecto]);
  }

  return { reply, savedProspecto };
}

function describeSuccess(result) {
  return {
    estatus: 'idle',
    ultimaAccion: `Encontró ${result.addedProspectos.length} prospecto(s) nuevo(s)`,
  };
}

module.exports = { runCycle, chat, describeSuccess };
