const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCustomAgentModule } = require('../agents/customAgent');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  if (content !== undefined) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, '');
  }
  return filePath;
}

test('chat sends no memory system message when the memory file does not exist, then creates it', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const memoryPath = tempFile('memoria');
  fs.unlinkSync(memoryPath);

  const { chat } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages.length, 3);
    assert.equal(messages[2].content, 'hola');
    return 'hola, ¿en qué te ayudo?';
  };

  const result = await chat({
    message: 'hola',
    contextPath,
    memoryPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'hola, ¿en qué te ayudo?');
  const memoriaGuardada = fs.readFileSync(memoryPath, 'utf-8');
  assert.match(memoriaGuardada, /Tú: hola/);
  assert.match(memoriaGuardada, /Agente: hola, ¿en qué te ayudo\?/);

  fs.unlinkSync(contextPath);
  fs.unlinkSync(memoryPath);
});

test('chat includes existing memory as context and appends the new exchange to it', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const memoryPath = tempFile('memoria', 'Tú: hola\nAgente: hola, ¿en qué te ayudo?');

  const { chat } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages.length, 4);
    assert.match(messages[2].content, /hola, ¿en qué te ayudo\?/);
    return 'claro, cuéntame más';
  };

  const result = await chat({
    message: 'quiero una cotización',
    contextPath,
    memoryPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'claro, cuéntame más');
  const memoriaActualizada = fs.readFileSync(memoryPath, 'utf-8');
  assert.match(memoriaActualizada, /hola, ¿en qué te ayudo\?/);
  assert.match(memoriaActualizada, /Tú: quiero una cotización/);
  assert.match(memoriaActualizada, /Agente: claro, cuéntame más/);

  fs.unlinkSync(contextPath);
  fs.unlinkSync(memoryPath);
});

test('runCycle produces a note, avoids repeating existing notes, and writes it to notesPath', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const notesPath = tempFile('notas', JSON.stringify([{ id: 'nota-1', texto: 'nota vieja', creadoEn: '2026-01-01T00:00:00.000Z' }]));

  const { runCycle } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /nota vieja/);
    return 'nota nueva accionable';
  };

  const result = await runCycle({
    contextPath,
    notesPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.notaCreada.texto, 'nota nueva accionable');

  const onDisk = JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[1].texto, 'nota nueva accionable');

  fs.unlinkSync(contextPath);
  fs.unlinkSync(notesPath);
});

test('describeSuccess reports listo_para_revision with a truncated preview and ultimoItemId', () => {
  const { describeSuccess } = createCustomAgentModule({ role: 'Eres un vendedor experto.' });

  const patch = describeSuccess({
    notaCreada: {
      id: 'nota-9',
      texto: 'una observación bastante larga que debería truncarse en la vista previa del estatus para no saturar la interfaz',
    },
  });

  assert.equal(patch.estatus, 'listo_para_revision');
  assert.equal(patch.ultimoItemId, 'nota-9');
  assert.match(patch.ultimaAccion, /^Nueva observación: una observación bastante larga/);
});
