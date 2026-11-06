const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, slugify, cotizacionFileName, describeSuccess } = require('../agents/cotizador');

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

test('slugify normalizes accents and spaces', () => {
  assert.equal(slugify('Bot de WhatsApp con IA'), 'bot-de-whatsapp-con-ia');
  assert.equal(slugify('Automatización de Procesos'), 'automatizacion-de-procesos');
});

test('runCycle creates a template for the first service without one, leaving existing templates untouched', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const serviciosPath = tempFile('servicios', JSON.stringify(['Servicio A', 'Servicio B']));
  const cotizacionesDir = tempDir('cotizaciones');
  fs.writeFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'Plantilla existente A');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Servicio B/);
    return 'Plantilla nueva para Servicio B';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    serviciosPath,
    cotizacionesDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.plantillaCreada.servicio, 'Servicio B');
  assert.equal(
    fs.readFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio B')), 'utf-8'),
    'Plantilla nueva para Servicio B'
  );
  assert.equal(
    fs.readFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'utf-8'),
    'Plantilla existente A'
  );

  [contextPath, rolePath, serviciosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('runCycle returns plantillaCreada null when every service already has a template', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const serviciosPath = tempFile('servicios', JSON.stringify(['Servicio A']));
  const cotizacionesDir = tempDir('cotizaciones');
  fs.writeFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'Plantilla existente A');

  const result = await runCycle({
    contextPath,
    rolePath,
    serviciosPath,
    cotizacionesDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.plantillaCreada, null);

  [contextPath, rolePath, serviciosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat without itemId generates a fresh quote with no template reference', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.doesNotMatch(messages[1].content, /Plantilla de referencia/);
    return 'Cotización personalizada';
  };

  const result = await chat({
    message: 'cliente X necesita un bot de WhatsApp',
    itemId: undefined,
    cotizacionesDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Cotización personalizada');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat with a valid itemId includes the matching template as reference', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');
  const slug = slugify('Servicio A');
  fs.writeFileSync(path.join(cotizacionesDir, `cotizacion-${slug}.md`), 'Plantilla de Servicio A');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Plantilla de referencia/);
    assert.match(messages[1].content, /Plantilla de Servicio A/);
    return 'Cotización basada en plantilla';
  };

  const result = await chat({
    message: 'personaliza esto para el cliente Y',
    itemId: slug,
    cotizacionesDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Cotización basada en plantilla');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat throws a clear error when itemId is present but unsafe', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');

  await assert.rejects(
    chat({
      message: 'hola',
      itemId: '../../etc/passwd',
      cotizacionesDir,
      contextPath,
      rolePath,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      createChatCompletion: async () => {
        throw new Error('no debería llamarse');
      },
    }),
    /itemId inválido/
  );

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('describeSuccess reports listo_para_revision with ultimoItemId when a template was created', () => {
  const patch = describeSuccess({ plantillaCreada: { servicio: 'Servicio A', cotizacionPath: '/tmp/x.md', slug: 'servicio-a' } });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Generó cotización tipo para: Servicio A',
    ultimoItemId: 'servicio-a',
  });
});

test('describeSuccess reports idle when the template library is already complete', () => {
  const patch = describeSuccess({ plantillaCreada: null });
  assert.deepEqual(patch, { estatus: 'idle', ultimaAccion: 'Biblioteca de cotizaciones tipo completa' });
});
