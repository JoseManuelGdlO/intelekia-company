const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeamSnapshot } = require('../lib/teamSnapshot');

test('el panorama refleja estatus, inactividad, conversaciones, herramientas y consultas reales', () => {
  const now = new Date('2026-11-07T20:00:00Z');
  const departments = [
    { id: 'marketing', label: 'Marketing', agents: [{ id: 'publicador', label: 'Publicador' }] },
    {
      id: 'comercial',
      label: 'Comercial',
      agents: [
        { id: 'seguimiento', label: 'Seguimiento' },
        { id: 'custom-x', label: 'Experto', isCustom: true, autonomous: false },
      ],
    },
    { id: 'administracion', label: 'Administración', agents: [{ id: 'pm', label: 'PM' }] },
  ];
  const snapshot = createTeamSnapshot({
    departments,
    statusPath: 'x',
    readStatus: () => ({
      publicador: { estatus: 'listo_para_revision', ultimaAccion: 'Redactó un draft', updatedAt: '2026-11-07T14:00:00Z' },
      seguimiento: { estatus: 'error', error: 'API caída', updatedAt: '2026-11-05T20:00:00Z' },
    }),
    conversaciones: {
      list: () => [
        { de: 'publicador', para: 'seguimiento', estado: 'completada' },
        { de: 'publicador', para: 'seguimiento', estado: 'error' },
      ],
    },
    comunicacion: { allowedTargetIds: (id) => (id === 'publicador' ? ['seguimiento'] : []) },
    profiles: {
      getProfile: (id) => ({ skills: id === 'publicador' ? [{ activo: true }, { activo: false }] : [], herramientas: { baseDatos: id === 'seguimiento' } }),
    },
    database: { consultas: () => [{ agentId: 'seguimiento', fecha: '2026-11-07T19:00:00Z', error: 'tabla no permitida' }] },
    now: () => now,
  });

  const data = snapshot.build({ excluir: ['pm'] });
  assert.deepEqual(data.agentes.map((a) => a.id), ['publicador', 'seguimiento', 'custom-x']);
  const [pub, seg, custom] = data.agentes;
  assert.equal(pub.horasSinActualizar, 6);
  assert.deepEqual(pub.conversaciones, { pregunto: 2, respondio: 0, fallidas: 1 });
  assert.equal(pub.skillsActivas, 1);
  assert.equal(seg.error, 'API caída');
  assert.equal(seg.horasSinActualizar, 48);
  assert.deepEqual(seg.consultasBD, { total: 1, conError: 1 });
  assert.equal(custom.estatus, 'sin registro');
  assert.equal(custom.autonomo, false);

  const text = snapshot.toText(data);
  assert.match(text, /Publicador \[publicador\] · área Marketing · base · autónomo/);
  assert.match(text, /ERROR: API caída/);
  assert.match(text, /Experto .* solo responde en chat/);
  assert.match(text, /nunca ha registrado actividad/);
  assert.doesNotMatch(text, /\[pm\]/);
});
