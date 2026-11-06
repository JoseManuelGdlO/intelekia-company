const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat } = require('../agents/buscadorTendencias');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('runCycle appends new ideas with estatus pendiente and does not duplicate existing texts', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile(
    'ideas',
    JSON.stringify([
      { id: 'idea-1', texto: 'idea vieja', estatus: 'pendiente', creadaEn: '2026-01-01T00:00:00.000Z' },
    ])
  );

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages[0].role, 'system');
    assert.match(messages[1].content, /idea vieja/);
    return JSON.stringify(['idea nueva 1', 'idea nueva 2']);
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedIdeas.length, 2);
  assert.equal(result.addedIdeas[0].estatus, 'pendiente');

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 3);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});

test('chat returns the reply without saving an idea by default', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile('ideas', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => 'una respuesta cualquiera';

  const result = await chat({
    message: 'dame una idea sobre dentistas',
    saveAsIdea: false,
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'una respuesta cualquiera');
  assert.equal(result.savedIdea, null);

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 0);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});

test('chat saves the reply as a pending idea when saveAsIdea is true', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile('ideas', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => 'idea para guardar';

  const result = await chat({
    message: 'dame una idea sobre dentistas',
    saveAsIdea: true,
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.savedIdea.texto, 'idea para guardar');
  assert.equal(result.savedIdea.estatus, 'pendiente');

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 1);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});
