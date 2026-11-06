const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, describeSuccess } = require('../agents/buscadorProspectos');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('runCycle appends new prospectos with estatus nuevo and does not duplicate existing negocios', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile(
    'prospectos',
    JSON.stringify([{ id: 'prospecto-1', negocio: 'Negocio viejo', giro: 'Retail', razon: 'x', estatus: 'nuevo', creadoEn: '2026-01-01T00:00:00.000Z' }])
  );

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Negocio viejo/);
    return JSON.stringify([
      { negocio: 'Negocio nuevo 1', giro: 'Salud', razon: 'razon 1' },
      { negocio: 'Negocio nuevo 2', giro: 'Educación', razon: 'razon 2' },
    ]);
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedProspectos.length, 2);
  assert.equal(result.addedProspectos[0].estatus, 'nuevo');
  assert.equal(result.addedProspectos[0].negocio, 'Negocio nuevo 1');

  const onDisk = JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
  assert.equal(onDisk.length, 3);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('runCycle strips markdown code fences before parsing the model response', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const fakeCreateChatCompletion = async () =>
    '```json\n[{"negocio": "Negocio fenced", "giro": "Retail", "razon": "razon"}]\n```';

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedProspectos.length, 1);
  assert.equal(result.addedProspectos[0].negocio, 'Negocio fenced');

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('runCycle throws a clear error when the model response is not a JSON array', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => '{}';

  await assert.rejects(
    runCycle({
      contextPath,
      rolePath,
      prospectosPath,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      createChatCompletion: fakeCreateChatCompletion,
    }),
    /no es un arreglo de prospectos/
  );

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('chat returns the reply without saving a prospecto by default', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const result = await chat({
    message: 'dame un prospecto de ejemplo',
    guardar: false,
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => 'una respuesta cualquiera',
  });

  assert.equal(result.reply, 'una respuesta cualquiera');
  assert.equal(result.savedProspecto, null);
  assert.equal(JSON.parse(fs.readFileSync(prospectosPath, 'utf-8')).length, 0);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('chat saves the reply as a prospecto nuevo when guardar is true', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const result = await chat({
    message: 'dame un prospecto de ejemplo',
    guardar: true,
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => 'prospecto de respuesta',
  });

  assert.equal(result.savedProspecto.negocio, 'prospecto de respuesta');
  assert.equal(result.savedProspecto.estatus, 'nuevo');
  assert.equal(JSON.parse(fs.readFileSync(prospectosPath, 'utf-8')).length, 1);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('describeSuccess reports how many prospectos were found', () => {
  const patch = describeSuccess({ addedProspectos: [1, 2] });
  assert.deepEqual(patch, {
    estatus: 'idle',
    ultimaAccion: 'Encontró 2 prospecto(s) nuevo(s)',
  });
});
