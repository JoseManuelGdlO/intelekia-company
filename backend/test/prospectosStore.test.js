const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');

function tempProspectosPath() {
  return path.join(os.tmpdir(), `prospectos-${Date.now()}-${Math.random()}.json`);
}

test('readProspectos returns an empty array when the file does not exist', () => {
  const filePath = tempProspectosPath();
  assert.deepEqual(readProspectos(filePath), []);
});

test('writeProspectos then readProspectos returns the same array', () => {
  const filePath = tempProspectosPath();
  const prospectos = [
    { id: 'prospecto-1', negocio: 'Consultorio X', giro: 'Salud', razon: 'Pierde citas', estatus: 'nuevo', creadoEn: '2026-01-01T00:00:00.000Z' },
  ];

  writeProspectos(filePath, prospectos);

  assert.deepEqual(readProspectos(filePath), prospectos);
  fs.unlinkSync(filePath);
});
