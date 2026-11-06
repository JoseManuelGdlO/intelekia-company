const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, seguimientoFileName, describeSuccess } = require('../agents/seguimientoCRM');

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

test('runCycle writes a seguimiento message for the first prospecto nuevo and marks it contactado', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const prospectosPath = tempFile(
    'prospectos',
    JSON.stringify([
      { id: 'prospecto-1', negocio: 'Negocio uno', giro: 'Salud', razon: 'razon', estatus: 'nuevo' },
      { id: 'prospecto-2', negocio: 'Negocio dos', giro: 'Retail', razon: 'razon', estatus: 'nuevo' },
    ])
  );
  const seguimientosDir = tempDir('seguimientos');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Negocio uno/);
    return 'Mensaje de contacto inicial';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    seguimientosDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.mensajeCreado.prospectoId, 'prospecto-1');

  const content = fs.readFileSync(path.join(seguimientosDir, seguimientoFileName('prospecto-1')), 'utf-8');
  assert.equal(content, 'Mensaje de contacto inicial');

  const updated = JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
  assert.equal(updated.find((p) => p.id === 'prospecto-1').estatus, 'contactado');
  assert.equal(updated.find((p) => p.id === 'prospecto-2').estatus, 'nuevo');

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('runCycle returns mensajeCreado null when there are no prospectos nuevos', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([{ id: 'prospecto-1', negocio: 'x', estatus: 'contactado' }]));
  const seguimientosDir = tempDir('seguimientos');

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    seguimientosDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.mensajeCreado, null);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('chat throws a clear error and avoids filesystem access when itemId is missing or unsafe', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const seguimientosDir = tempDir('seguimientos');

  const fakeCreateChatCompletion = async () => {
    throw new Error('no debería llamarse');
  };

  await assert.rejects(
    chat({ message: 'hola', itemId: undefined, seguimientosDir, contextPath, rolePath, apiKey: 'k', model: 'm', createChatCompletion: fakeCreateChatCompletion }),
    /itemId inválido o faltante/
  );
  await assert.rejects(
    chat({ message: 'hola', itemId: '../../etc/passwd', seguimientosDir, contextPath, rolePath, apiKey: 'k', model: 'm', createChatCompletion: fakeCreateChatCompletion }),
    /itemId inválido o faltante/
  );

  assert.deepEqual(fs.readdirSync(seguimientosDir), []);

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('chat overwrites the seguimiento file with the edited message', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const seguimientosDir = tempDir('seguimientos');
  const itemId = 'prospecto-1';
  fs.writeFileSync(path.join(seguimientosDir, seguimientoFileName(itemId)), 'Mensaje original');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Mensaje original/);
    assert.match(messages[1].content, /hazlo más formal/);
    return 'Mensaje formal';
  };

  const result = await chat({
    message: 'hazlo más formal',
    itemId,
    seguimientosDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Mensaje formal');
  assert.equal(fs.readFileSync(path.join(seguimientosDir, seguimientoFileName(itemId)), 'utf-8'), 'Mensaje formal');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('describeSuccess reports listo_para_revision with ultimoItemId when a message was created', () => {
  const patch = describeSuccess({ mensajeCreado: { prospectoId: 'prospecto-9', prospectoNegocio: 'Negocio X' } });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Redactó un mensaje para: Negocio X',
    ultimoItemId: 'prospecto-9',
  });
});

test('describeSuccess reports idle when there was nothing to contact', () => {
  const patch = describeSuccess({ mensajeCreado: null });
  assert.deepEqual(patch, { estatus: 'idle', ultimaAccion: 'Sin prospectos nuevos por contactar' });
});
