const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHorario } = require('../lib/horario');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'horario-')), 'horario.json');
// Fechas en UTC; la oficina usa America/Monterrey (UTC-6 todo el año).
const lunes10 = new Date('2026-11-09T16:00:00Z'); // lunes 10:00
const lunes20 = new Date('2026-11-09T02:00:00Z'); // domingo 20:00 (lunes 02:00 UTC)
const sabado10 = new Date('2026-11-14T16:00:00Z'); // sábado 10:00

test('por defecto está abierta y sin horario: siempre puede trabajar', () => {
  const h = createHorario({ filePath: tmpFile(), now: () => sabado10 });
  assert.equal(h.puedeTrabajar(), true);
  assert.equal(h.estado().respetarHorario, false);
});

test('con horario L-V 9-18 trabaja dentro y no fuera', () => {
  let ahora = lunes10;
  const h = createHorario({ filePath: tmpFile(), now: () => ahora });
  h.actualizar({ respetarHorario: true, dias: [1, 2, 3, 4, 5], entrada: '09:00', salida: '18:00' });
  assert.equal(h.puedeTrabajar(), true);
  ahora = sabado10;
  assert.equal(h.puedeTrabajar(), false);
  assert.match(h.estado().motivo, /lunes a las 09:00/);
  ahora = lunes20;
  assert.equal(h.puedeTrabajar(), false);
});

test('cerrada no trabaja aunque esté dentro de horario; al abrir vuelve', () => {
  const h = createHorario({ filePath: tmpFile(), now: () => lunes10 });
  h.cerrar();
  assert.equal(h.puedeTrabajar(), false);
  h.abrir();
  assert.equal(h.puedeTrabajar(), true);
});

test('turno que cruza la medianoche', () => {
  let ahora = new Date('2026-11-10T05:00:00Z'); // lunes 23:00
  const h = createHorario({ filePath: tmpFile(), now: () => ahora });
  h.actualizar({ respetarHorario: true, dias: [1], entrada: '22:00', salida: '06:00' });
  assert.equal(h.puedeTrabajar(), true);
  ahora = new Date('2026-11-10T10:00:00Z'); // martes 04:00 → sigue el turno del lunes
  assert.equal(h.puedeTrabajar(), true);
  ahora = new Date('2026-11-10T14:00:00Z'); // martes 08:00
  assert.equal(h.puedeTrabajar(), false);
});

test('se guarda en disco y un archivo dañado vuelve a los valores por defecto', () => {
  const file = tmpFile();
  createHorario({ filePath: file, now: () => lunes10 }).cerrar();
  assert.equal(createHorario({ filePath: file }).estado().abierta, false);
  fs.writeFileSync(file, '{no es json');
  assert.equal(createHorario({ filePath: file }).estado().abierta, true);
});

test('rechaza horas inválidas', () => {
  const h = createHorario({ filePath: tmpFile() });
  assert.throws(() => h.actualizar({ entrada: '25:00' }), /entrada inválida/);
});
