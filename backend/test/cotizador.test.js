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

function setupPlantilla({ plantilla = 'Plantilla Intelekia\n## Alcance\n{{alcance}}', servicios = ['Servicio A', 'Servicio B'] } = {}) {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const serviciosPath = tempFile('servicios', JSON.stringify(servicios));
  const plantillaPath = path.join(tempDir('plantilla'), 'plantilla-cotizacion.md');
  if (plantilla !== null) fs.writeFileSync(plantillaPath, plantilla);
  const cotizacionesDir = tempDir('cotizaciones');
  return { contextPath, rolePath, serviciosPath, plantillaPath, cotizacionesDir, apiKey: 'k', model: 'm' };
}

test('runCycle con plantilla: la manda como formato obligatorio', async () => {
  const deps = setupPlantilla();
  let enviado = '';
  const r = await runCycle({ ...deps, createChatCompletion: async ({ messages }) => { enviado = messages[1].content; return 'Cotización A'; } });
  assert.equal(r.plantillaCreada.servicio, 'Servicio A');
  assert.match(enviado, /Plantilla Intelekia/);
  assert.match(enviado, /\{\{alcance\}\}/);
  assert.match(enviado, /estructura/i);
});

test('runCycle regenera las cotizaciones tipo cuando cambia la plantilla, una por ciclo', async () => {
  const deps = setupPlantilla({ plantilla: null });
  fs.writeFileSync(path.join(deps.cotizacionesDir, cotizacionFileName('Servicio A')), 'vieja A');
  fs.writeFileSync(path.join(deps.cotizacionesDir, cotizacionFileName('Servicio B')), 'vieja B');
  const llamar = async ({ messages }) => `nueva ${messages[1].content.includes('Servicio A') ? 'A' : 'B'}`;

  // Sin plantilla: la biblioteca existente se respeta.
  assert.equal((await runCycle({ ...deps, createChatCompletion: llamar })).plantillaCreada, null);

  fs.writeFileSync(deps.plantillaPath, 'Plantilla v1');
  assert.equal((await runCycle({ ...deps, createChatCompletion: llamar })).plantillaCreada.servicio, 'Servicio A');
  assert.equal((await runCycle({ ...deps, createChatCompletion: llamar })).plantillaCreada.servicio, 'Servicio B');
  assert.equal((await runCycle({ ...deps, createChatCompletion: llamar })).plantillaCreada, null);
  assert.equal(fs.readFileSync(path.join(deps.cotizacionesDir, cotizacionFileName('Servicio B')), 'utf-8'), 'nueva B');

  fs.writeFileSync(deps.plantillaPath, 'Plantilla v2');
  assert.equal((await runCycle({ ...deps, createChatCompletion: llamar })).plantillaCreada.servicio, 'Servicio A');
});

test('chat con plantilla: siempre la incluye, aunque no venga itemId', async () => {
  const deps = setupPlantilla();
  let enviado = '';
  await chat({ ...deps, message: 'cotiza un bot para la Cafetería Sol', createChatCompletion: async ({ messages }) => { enviado = messages[1].content; return 'ok'; } });
  assert.match(enviado, /Plantilla Intelekia/);
  assert.match(enviado, /Cafetería Sol/);
});

test('plantilla vacía o solo espacios cuenta como sin plantilla', async () => {
  const deps = setupPlantilla({ plantilla: '   \n' });
  let enviado = '';
  await chat({ ...deps, message: 'hola', createChatCompletion: async ({ messages }) => { enviado = messages[1].content; return 'ok'; } });
  assert.doesNotMatch(enviado, /plantilla/i);
});
