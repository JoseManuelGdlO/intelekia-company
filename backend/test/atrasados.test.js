const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createAtrasadosFlow, agrupar, redactarCorreo } = require('../lib/atrasados');
const { createComunicacionStore } = require('../lib/comunicacionStore');
const { createConversacionesStore } = require('../lib/conversacionesStore');

const ROWS = [
  { id: 1, proyecto: 'TLO', titulo: 'Cambios a módulo cuentas por pagar', estado: 'Por revisar', vence: '31/10/2026', dias: 7, userId: 2, responsable: 'Javier Karim', email: 'javier@intelekia.cloud' },
  { id: 2, proyecto: 'TLO', titulo: 'Error al cancelar un timbrado', estado: 'En proceso', vence: '31/10/2026', dias: 7, userId: 2, responsable: 'Javier Karim', email: 'javier@intelekia.cloud' },
  { id: 3, proyecto: 'Alanna', titulo: 'Cambios generales ', estado: 'En proceso', vence: '07/11/2026', dias: 0, userId: 2, responsable: 'Javier Karim', email: 'javier@intelekia.cloud' },
  { id: 4, proyecto: 'Poker de reyes', titulo: 'subir app a playstore', estado: 'En proceso', vence: '18/08/2026', dias: 81, userId: 3, responsable: 'Beto Galaviz', email: 'beto@gmail.com' },
  { id: 5, proyecto: 'Obras', titulo: 'Sin dueño', estado: 'Por hacer', vence: '01/11/2026', dias: 6, userId: null, responsable: null, email: null },
  { id: 6, proyecto: null, titulo: 'Tarea suelta', estado: 'En proceso', vence: '05/11/2026', dias: 2, userId: 4, responsable: 'Hugo', email: null },
];

test('agrupa por responsable y cuenta aparte los tickets sin responsable', () => {
  const datos = agrupar(ROWS);
  assert.deepEqual(datos.responsables.map((r) => [r.nombre, r.tickets.length]), [['Javier Karim', 3], ['Beto Galaviz', 1], ['Hugo', 1]]);
  assert.equal(datos.sinResponsable, 1);
  assert.equal(datos.total, 6);
  assert.equal(datos.responsables[2].tickets[0].proyecto, 'Sin proyecto');
});

test('el correo nombra a la persona, cuenta sus tickets y los lista con proyecto, estado y atraso', () => {
  const [javier] = agrupar(ROWS).responsables;
  const { asunto, cuerpo } = redactarCorreo(javier, new Date('2026-11-07T18:00:00Z'));
  assert.equal(asunto, 'Tickets atrasados al 07/11/2026 — 3 pendientes');
  assert.match(cuerpo, /^Hola Javier Karim,\n\nTienes tres tickets atrasados:\n\n/);
  assert.match(cuerpo, /1\. \[TLO\] Cambios a módulo cuentas por pagar — Por revisar — venció el 31\/10\/2026 \(7 días de atraso\)/);
  assert.match(cuerpo, /3\. \[Alanna\] Cambios generales — En proceso — venció el 07\/11\/2026 \(venció hoy\)/);
  const beto = agrupar(ROWS).responsables[1];
  assert.match(redactarCorreo(beto, new Date('2026-11-07T18:00:00Z')).cuerpo, /Tienes un ticket atrasado:/);
});

function setup({ tools = { 'seguimiento-crm': ['baseDatos'], pm: ['correo'] }, canTalk = true, rows = ROWS, mailerConfigured = true } = {}) {
  const departments = [
    { id: 'comercial', agents: [{ id: 'seguimiento-crm', label: 'Seguimiento de Proyectos' }] },
    { id: 'administracion', agents: [{ id: 'pm', label: 'PM' }] },
  ];
  const comunicacion = createComunicacionStore({ configPath: path.join(os.tmpdir(), `com-${Date.now()}-${Math.random()}.json`), departments });
  if (canTalk) comunicacion.setRule('seguimiento-crm', { alcance: 'todos' });
  const conversaciones = createConversacionesStore({ filePath: path.join(os.tmpdir(), `conv-${Date.now()}-${Math.random()}.json`) });
  const sent = [];
  const mailer = {
    isConfigured: () => mailerConfigured,
    list: () => sent,
    enviar: async ({ agentId, para, asunto, cuerpo }) => {
      const estado = para[0].endsWith('@intelekia.cloud') ? 'enviado' : 'por_aprobar';
      const item = { agentId, para, asunto, cuerpo, estado, motivo: estado === 'por_aprobar' ? 'fuera de la lista' : null };
      sent.push(item);
      return item;
    },
  };
  const remembered = [];
  const pmActions = [];
  const queries = [];
  const flow = createAtrasadosFlow({
    database: {
      isConfigured: () => true,
      queryInterna: async (sql, params, opts) => {
        queries.push({ sql, opts });
        return rows;
      },
    },
    mailer,
    comunicacion,
    conversaciones,
    profiles: { hasTool: (id, h) => (tools[id] || []).includes(h), remember: (id, t) => remembered.push({ id, t }) },
    onPmAction: (id, patch) => pmActions.push({ id, patch }),
    now: () => new Date('2026-11-07T18:00:00Z'),
  });
  return { flow, sent, conversaciones, remembered, pmActions, queries };
}

test('Seguimiento entrega al PM y el PM envía un correo por responsable', async () => {
  const { flow, sent, conversaciones, remembered, pmActions, queries } = setup();
  const result = await flow.ejecutar();
  assert.equal(result.estado, 'ok');
  assert.match(queries[0].sql, /u\.email/);
  assert.equal(queries[0].opts.agentId, 'seguimiento-crm');
  assert.deepEqual(sent.map((c) => [c.agentId, c.para[0], c.estado]), [
    ['pm', 'javier@intelekia.cloud', 'enviado'],
    ['pm', 'beto@gmail.com', 'por_aprobar'],
  ]);
  assert.deepEqual(result.envios.map((e) => [e.nombre, e.estado]), [['Javier Karim', 'enviado'], ['Beto Galaviz', 'por_aprobar'], ['Hugo', 'sin_correo']]);
  assert.equal(result.resumen, '1 correo enviado, 1 por aprobar, 1 sin correo');

  const [conv] = conversaciones.list();
  assert.equal(conv.de, 'seguimiento-crm');
  assert.equal(conv.para, 'pm');
  assert.match(conv.pregunta, /6 tickets de 3 responsables \(1 sin responsable asignado\)/);
  assert.match(conv.respuesta, /Beto Galaviz: por_aprobar \(fuera de la lista\)/);
  assert.deepEqual(remembered.map((r) => r.id), ['seguimiento-crm', 'pm']);
  assert.deepEqual(pmActions, [{ id: 'pm', patch: { ultimaAccion: 'Tickets atrasados: 1 correo enviado, 1 por aprobar, 1 sin correo' } }]);
});

test('cada persona recibe máximo un aviso al día aunque el ciclo corra varias veces', async () => {
  const { flow, sent } = setup();
  await flow.ejecutar();
  const segundo = await flow.ejecutar();
  assert.equal(sent.length, 2);
  assert.deepEqual(segundo.envios.map((e) => e.estado), ['ya_notificado', 'ya_notificado', 'sin_correo']);
});

test('respeta la configuración: base de datos, permiso de comunicación y correo del PM', async () => {
  let r = await setup({ tools: { pm: ['correo'] } }).flow.ejecutar();
  assert.equal(r.estado, 'omitido');
  assert.match(r.motivo, /Base de datos/);

  r = await setup({ canTalk: false }).flow.ejecutar();
  assert.equal(r.estado, 'omitido');
  assert.match(r.motivo, /permiso para hablar con PM/);

  const sinCorreo = setup({ tools: { 'seguimiento-crm': ['baseDatos'] } });
  r = await sinCorreo.flow.ejecutar();
  assert.equal(r.estado, 'sin_correo');
  assert.match(r.motivo, /PM no tiene activado el Correo/);
  assert.equal(sinCorreo.sent.length, 0);
  assert.match(sinCorreo.conversaciones.list()[0].respuesta, /no puedo enviar correos/);
});

test('sin tickets atrasados no molesta a nadie ni registra conversación', async () => {
  const { flow, sent, conversaciones } = setup({ rows: [] });
  const r = await flow.ejecutar();
  assert.equal(r.estado, 'sin_atrasados');
  assert.equal(sent.length, 0);
  assert.equal(conversaciones.list().length, 0);
});
