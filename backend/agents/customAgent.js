const fs = require('fs');

function readNotes(notesPath) {
  if (!fs.existsSync(notesPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
}

function writeNotes(notesPath, notes) {
  fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));
}

function readMemory(memoryPath) {
  return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';
}

function appendMemory(memoryPath, entrada) {
  fs.writeFileSync(memoryPath, readMemory(memoryPath) + entrada);
}

function createCustomAgentModule({ role }) {
  async function chat({ message, contextPath, memoryPath, apiKey, model, createChatCompletion }) {
    const context = fs.readFileSync(contextPath, 'utf-8');
    const memoria = readMemory(memoryPath);

    const messages = [
      { role: 'system', content: role },
      { role: 'system', content: `Contexto de negocio:\n${context}` },
    ];
    if (memoria.trim()) {
      messages.push({ role: 'system', content: `Memoria de conversaciones previas:\n${memoria}` });
    }
    messages.push({ role: 'user', content: message });

    const reply = await createChatCompletion({ apiKey, model, messages });

    appendMemory(memoryPath, `\n\nTú: ${message}\nAgente: ${reply}`);

    return { reply };
  }

  async function runCycle({ contextPath, notesPath, apiKey, model, createChatCompletion }) {
    const context = fs.readFileSync(contextPath, 'utf-8');
    const existingNotes = readNotes(notesPath);
    const existingTexts = existingNotes.map((nota) => nota.texto);

    const userPrompt =
      `Contexto de negocio:\n${context}\n\n` +
      `Notas que ya existen (no las repitas):\n${JSON.stringify(existingTexts)}\n\n` +
      'Da una observación o sugerencia breve y accionable, relevante ahora mismo, según tu rol.';

    const texto = await createChatCompletion({
      apiKey,
      model,
      messages: [
        { role: 'system', content: role },
        { role: 'user', content: userPrompt },
      ],
    });

    const notaCreada = {
      id: `nota-${Date.now()}`,
      texto,
      creadoEn: new Date().toISOString(),
    };

    writeNotes(notesPath, [...existingNotes, notaCreada]);

    return { notaCreada };
  }

  function describeSuccess(result) {
    return {
      estatus: 'listo_para_revision',
      ultimaAccion: `Nueva observación: ${result.notaCreada.texto.slice(0, 80)}`,
      ultimoItemId: result.notaCreada.id,
    };
  }

  return { runCycle, chat, describeSuccess };
}

module.exports = { createCustomAgentModule };
