const fs = require('fs');
const path = require('path');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');
const { editItemChat } = require('../lib/editItemChat');

function draftFileName(ideaId) {
  return `draft-${ideaId}.md`;
}

async function runCycle({ contextPath, rolePath, ideasPath, draftsDir, apiKey, model, createChatCompletion }) {
  const ideas = readIdeas(ideasPath);
  const pendiente = ideas.find((idea) => idea.estatus === 'pendiente');

  if (!pendiente) {
    return { draftCreated: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt = `Contexto de negocio:\n${context}\n\nIdea a convertir en post:\n${pendiente.texto}`;

  const copy = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.mkdirSync(draftsDir, { recursive: true });
  const draftPath = path.join(draftsDir, draftFileName(pendiente.id));
  fs.writeFileSync(draftPath, copy);

  const updatedIdeas = ideas.map((idea) => (idea.id === pendiente.id ? { ...idea, estatus: 'redactada' } : idea));
  writeIdeas(ideasPath, updatedIdeas);

  return {
    draftCreated: {
      ideaId: pendiente.id,
      ideaTexto: pendiente.texto,
      draftPath,
    },
  };
}

async function chat({ message, itemId, draftsDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  return editItemChat({
    message,
    itemId,
    dir: draftsDir,
    fileNameFor: draftFileName,
    invalidIdErrorMessage: 'No se encontró un draft para editar (itemId inválido o faltante)',
    contentLabel: 'Draft',
    contextPath,
    rolePath,
    apiKey,
    model,
    createChatCompletion,
  });
}

function describeSuccess(result) {
  return result.draftCreated
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Redactó un draft para: ${result.draftCreated.ideaTexto}`,
        ultimoItemId: result.draftCreated.ideaId,
      }
    : { estatus: 'idle', ultimaAccion: 'Sin ideas pendientes por redactar' };
}

module.exports = { runCycle, chat, draftFileName, describeSuccess };
