const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, draftFileName, describeSuccess } = require('../agents/publicador');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function tempDir(name) {
  const dirPath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

test('runCycle writes a draft file for the first pending idea and marks it redactada', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const ideasPath = tempFile(
    'ideas',
    JSON.stringify([
      { id: 'idea-1', texto: 'idea uno', estatus: 'pendiente' },
      { id: 'idea-2', texto: 'idea dos', estatus: 'pendiente' },
    ])
  );
  const draftsDir = tempDir('drafts');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /idea uno/);
    return 'Caption final con #hashtag';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    draftsDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.draftCreated.ideaId, 'idea-1');

  const draftContent = fs.readFileSync(path.join(draftsDir, draftFileName('idea-1')), 'utf-8');
  assert.equal(draftContent, 'Caption final con #hashtag');

  const updatedIdeas = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(updatedIdeas.find((i) => i.id === 'idea-1').estatus, 'redactada');
  assert.equal(updatedIdeas.find((i) => i.id === 'idea-2').estatus, 'pendiente');

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('runCycle returns draftCreated null when there are no pending ideas', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const ideasPath = tempFile('ideas', JSON.stringify([{ id: 'idea-1', texto: 'idea uno', estatus: 'redactada' }]));
  const draftsDir = tempDir('drafts');

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    draftsDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.draftCreated, null);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('chat overwrites the draft file with the edited copy', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const draftsDir = tempDir('drafts');
  const itemId = 'idea-1';
  fs.writeFileSync(path.join(draftsDir, draftFileName(itemId)), 'Caption original');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Caption original/);
    assert.match(messages[1].content, /hazlo más corto/);
    return 'Caption corto';
  };

  const result = await chat({
    message: 'hazlo más corto',
    itemId,
    draftsDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Caption corto');
  assert.equal(fs.readFileSync(path.join(draftsDir, draftFileName(itemId)), 'utf-8'), 'Caption corto');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('chat throws a clear error when itemId is missing', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const draftsDir = tempDir('drafts');

  await assert.rejects(
    () =>
      chat({
        message: 'hazlo más corto',
        itemId: undefined,
        draftsDir,
        contextPath,
        rolePath,
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        createChatCompletion: async () => {
          throw new Error('no debería llamarse');
        },
      }),
    /itemId inválido o faltante/
  );

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('chat throws a clear error and avoids filesystem access when itemId contains path-traversal characters', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const draftsDir = tempDir('drafts');
  let createChatCompletionCalled = false;

  await assert.rejects(
    () =>
      chat({
        message: 'hazlo más corto',
        itemId: '../../etc/passwd',
        draftsDir,
        contextPath,
        rolePath,
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        createChatCompletion: async () => {
          createChatCompletionCalled = true;
          return 'no debería llegar aquí';
        },
      }),
    /itemId inválido o faltante/
  );

  assert.equal(createChatCompletionCalled, false);
  assert.deepEqual(fs.readdirSync(draftsDir), []);

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('describeSuccess reports listo_para_revision with ultimoItemId when a draft was created', () => {
  const patch = describeSuccess({
    draftCreated: { ideaId: 'idea-9', ideaTexto: 'una idea', draftPath: '/tmp/x.md' },
  });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Redactó un draft para: una idea',
    ultimoItemId: 'idea-9',
  });
});

test('describeSuccess reports idle when there was nothing to draft', () => {
  const patch = describeSuccess({ draftCreated: null });
  assert.deepEqual(patch, {
    estatus: 'idle',
    ultimaAccion: 'Sin ideas pendientes por redactar',
  });
});
