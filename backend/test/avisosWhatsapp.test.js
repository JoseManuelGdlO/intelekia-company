const test = require('node:test');
const assert = require('node:assert/strict');
const { createAvisosWhatsapp } = require('../lib/avisosWhatsapp');

test('registra avisos sin datos sensibles, asigna el trabajador y respeta el máximo', () => {
  let t = 0;
  const avisos = createAvisosWhatsapp({ max: 2, now: () => new Date(Date.UTC(2026, 10, 11, 10, t++)) });
  const a = avisos.recibido('wamid.1');
  avisos.recibido('wamid.2');
  avisos.asignado('wamid.1', 'cotizador');
  assert.deepEqual(Object.keys(a).sort(), ['agentId', 'fecha', 'id']);
  assert.deepEqual(avisos.recientes().map((x) => x.agentId), [null, 'cotizador']);
  avisos.recibido('wamid.3');
  assert.equal(avisos.recientes().length, 2);
  avisos.asignado('wamid.1', 'pm'); // ya salió de la lista: no truena
  assert.deepEqual(avisos.recientes({ desde: a.fecha }).length, 2);
});
