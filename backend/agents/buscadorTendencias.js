const fs = require('fs');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

async function runCycle({ contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const existingIdeas = readIdeas(ideasPath);
  const existingTexts = existingIdeas.map((idea) => idea.texto);

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Ideas que ya existen (no las repitas):\n${JSON.stringify(existingTexts)}\n\n` +
    'Dame entre 3 y 5 ideas nuevas de post/reel.';

  const raw = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const nuevasIdeas = parseJsonArrayResponse(raw, {
    emptyArrayErrorMessage: 'La respuesta del modelo no es un arreglo de ideas',
  });

  const addedIdeas = nuevasIdeas.map((texto, index) => ({
    id: `idea-${Date.now()}-${index}`,
    texto,
    estatus: 'pendiente',
    creadaEn: new Date().toISOString(),
  }));

  writeIdeas(ideasPath, [...existingIdeas, ...addedIdeas]);

  return { addedIdeas };
}

async function chat({ message, guardar, contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) {
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

  let savedIdea = null;
  if (guardar) {
    const existingIdeas = readIdeas(ideasPath);
    savedIdea = {
      id: `idea-${Date.now()}`,
      texto: reply,
      estatus: 'pendiente',
      creadaEn: new Date().toISOString(),
    };
    writeIdeas(ideasPath, [...existingIdeas, savedIdea]);
  }

  return { reply, savedIdea };
}

function describeSuccess(result) {
  return {
    estatus: 'idle',
    ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s) nueva(s)`,
  };
}

module.exports = { runCycle, chat, describeSuccess };
