const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, describeSuccess, ultimoReporte, resumenDe, SIN_ACCESO } = require('../agents/seguimientoCRM');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

const REPORTE = `### Resumen
- 6 tareas vencidas, la más atrasada es Poker de reyes (81 días).

### 🔴 Urgente hoy
- **Poker de reyes** · subir app a playstore · Beto Galaviz`;

function deps(overrides = {}) {
  return {
    contextPath: tempFile('context', '# Intelekia'),
    rolePath: tempFile('role', 'Eres el responsable de seguimiento de proyectos.'),
    reportesDir: tempDir('reportes'),
    apiKey: 'k',
    model: 'm',
    now: () => new Date('2026-11-07T20:45:00Z'),
    ...overrides,
  };
}

test('runCycle guarda el reporte con la fecha de Durango y lo resume', async () => {
  const d = deps({
    createChatCompletion: async ({ messages }) => {
      assert.equal(messages[0].content, 'Eres el responsable de seguimiento de proyectos.');
      assert.match(messages[1].content, /consulta la base de datos/);
      assert.match(messages[1].content, new RegExp(SIN_ACCESO));
      return REPORTE;
    },
  });
  const result = await runCycle(d);
  // 20:45 UTC = 14:45 en Durango
  assert.equal(result.reporte.id, 'reporte-2026-11-07-1445');
  assert.equal(fs.readFileSync(path.join(d.reportesDir, 'reporte-2026-11-07-1445.md'), 'utf-8'), REPORTE);
  assert.equal(result.reporte.resumen, '6 tareas vencidas, la más atrasada es Poker de reyes (81 días).');
});

test('runCycle incluye el reporte anterior para comparar avances', async () => {
  const d = deps();
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-2026-11-06-0900.md'), 'REPORTE DE AYER');
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-2026-11-05-0900.md'), 'REPORTE VIEJO');
  let prompt = '';
  await runCycle({
    ...d,
    createChatCompletion: async ({ messages }) => {
      prompt = messages[1].content;
      return REPORTE;
    },
  });
  assert.match(prompt, /reporte-2026-11-06-0900/);
  assert.match(prompt, /REPORTE DE AYER/);
  assert.doesNotMatch(prompt, /REPORTE VIEJO/);
});

test('sin acceso a la base no guarda nada y lo explica', async () => {
  const d = deps({ createChatCompletion: async () => `${SIN_ACCESO}` });
  const result = await runCycle(d);
  assert.equal(result.reporte, null);
  assert.deepEqual(fs.readdirSync(d.reportesDir), []);
  const patch = describeSuccess(result);
  assert.equal(patch.estatus, 'idle');
  assert.match(patch.ultimaAccion, /Herramientas/);
});

test('describeSuccess deja el reporte listo para revisión', () => {
  const patch = describeSuccess({ reporte: { id: 'reporte-x', resumen: 'Todo en orden' } });
  assert.deepEqual(patch, { estatus: 'listo_para_revision', ultimaAccion: 'Reporte de seguimiento: Todo en orden', ultimoItemId: 'reporte-x' });
});

test('chat responde preguntas libres con el último reporte como referencia (no edita archivos)', async () => {
  const d = deps();
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-2026-11-07-0900.md'), REPORTE);
  const result = await chat({
    ...d,
    message: '¿Cómo va Poker de reyes?',
    itemId: 'reporte-2026-11-07-0900',
    createChatCompletion: async ({ messages }) => {
      assert.match(messages[2].content, /Poker de reyes \(81 días\)/);
      assert.equal(messages.at(-1).content, '¿Cómo va Poker de reyes?');
      return 'Está atrasado 81 días.';
    },
  });
  assert.equal(result.reply, 'Está atrasado 81 días.');
  assert.equal(fs.readFileSync(path.join(d.reportesDir, 'reporte-2026-11-07-0900.md'), 'utf-8'), REPORTE);
});

test('ultimoReporte y resumenDe manejan carpetas vacías y reportes sin sección Resumen', () => {
  assert.equal(ultimoReporte(path.join(os.tmpdir(), 'no-existe-xyz')), null);
  assert.equal(resumenDe('# Título\n\nPrimera línea útil'), 'Primera línea útil');
  assert.ok(resumenDe(`### Resumen\n${'a'.repeat(300)}`).length <= 161);
});

test('al iniciar el ciclo entrega los atrasados al PM y lo refleja en el reporte y la última acción', async () => {
  const orden = [];
  const d = deps({
    notificarAtrasados: async () => {
      orden.push('atrasados');
      return { estado: 'ok', resumen: '2 correos enviados', envios: [] };
    },
    createChatCompletion: async ({ messages }) => {
      orden.push('reporte');
      assert.match(messages[1].content, /Atrasados al PM: 2 correos enviados/);
      return REPORTE;
    },
  });
  const result = await runCycle(d);
  assert.deepEqual(orden, ['atrasados', 'reporte']);
  assert.match(describeSuccess(result).ultimaAccion, / · Atrasados al PM: 2 correos enviados$/);
});

test('si la entrega de atrasados falla, el reporte se genera igual', async () => {
  const d = deps({
    notificarAtrasados: async () => {
      throw new Error('MySQL caído');
    },
    createChatCompletion: async () => REPORTE,
  });
  const result = await runCycle(d);
  assert.ok(result.reporte);
  assert.match(describeSuccess(result).ultimaAccion, /Atrasados no notificados: MySQL caído/);
});
