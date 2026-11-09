const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, describeSuccess } = require('../agents/pm');

function tempFile(name, content) {
  const p = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(p, content);
  return p;
}

function deps(extra = {}) {
  return {
    contextPath: tempFile('ctx', '# Intelekia'),
    rolePath: tempFile('rol', 'Eres el PM.'),
    reportesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'reportes-equipo-')),
    getTeamSnapshot: () => 'Panorama: Seguimiento en ERROR',
    apiKey: 'k',
    model: 'm',
    now: () => new Date('2026-11-07T15:30:00Z'),
    ...extra,
  };
}

test('runCycle le da al PM el panorama real del equipo y guarda su reporte', async () => {
  const d = deps({
    createChatCompletion: async ({ messages }) => {
      assert.equal(messages[0].content, 'Eres el PM.');
      assert.match(messages[1].content, /Panorama: Seguimiento en ERROR/);
      return '### Resumen\n- Seguimiento está en error.';
    },
  });
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-equipo-2026-11-06-0900.md'), 'AYER');
  const result = await runCycle(d);
  assert.equal(result.reporte.id, 'reporte-equipo-2026-11-07-0930');
  assert.ok(fs.existsSync(path.join(d.reportesDir, 'reporte-equipo-2026-11-07-0930.md')));
  assert.deepEqual(describeSuccess(result), {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Reporte del equipo: Seguimiento está en error.',
    ultimoItemId: 'reporte-equipo-2026-11-07-0930',
  });
});

test('runCycle incluye el reporte anterior para señalar cambios', async () => {
  let prompt = '';
  const d = deps({
    createChatCompletion: async ({ messages }) => {
      prompt = messages[1].content;
      return 'ok';
    },
  });
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-equipo-2026-11-06-0900.md'), 'REPORTE DE AYER');
  await runCycle(d);
  assert.match(prompt, /REPORTE DE AYER/);
});

test('chat responde con el panorama actual y su último reporte', async () => {
  const d = deps();
  fs.writeFileSync(path.join(d.reportesDir, 'reporte-equipo-2026-11-07-0900.md'), 'ULTIMO REPORTE');
  const result = await chat({
    ...d,
    message: '¿Quién está atorado?',
    createChatCompletion: async ({ messages }) => {
      assert.match(messages[2].content, /Seguimiento en ERROR/);
      assert.match(messages[3].content, /ULTIMO REPORTE/);
      assert.equal(messages.at(-1).content, '¿Quién está atorado?');
      return 'Seguimiento.';
    },
  });
  assert.equal(result.reply, 'Seguimiento.');
});

test('sin panorama conectado, avisa en vez de inventar', async () => {
  const d = deps({ getTeamSnapshot: null });
  await chat({
    ...d,
    message: 'hola',
    createChatCompletion: async ({ messages }) => {
      assert.match(messages[2].content, /No hay datos del equipo/);
      return 'ok';
    },
  });
});
