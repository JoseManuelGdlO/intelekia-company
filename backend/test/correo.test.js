const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMailer, normalizarRegla, cumpleRegla } = require('../lib/correo');

const SMTP = { host: 'smtp.hostinger.com', port: 465, secure: true, user: 'pm@intelekia.cloud', password: 'x', fromName: 'PM · Intelekia', replyTo: 'jose@intelekia.cloud', firma: 'Enviado por el PM.' };

function setup({ smtp = SMTP, permitidos = ['@intelekia.cloud', 'beto@gmail.com'], limiteDiario = 20, failSend = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-'));
  const sent = [];
  const mailer = createMailer({
    smtp,
    settingsPath: path.join(dir, 'correo.json'),
    logPath: path.join(dir, 'correos.json'),
    createTransport: () => ({
      sendMail: async (msg) => {
        if (failSend) throw new Error('535 Authentication failed');
        sent.push(msg);
        return { messageId: `<id-${sent.length}>` };
      },
      verify: async () => true,
    }),
  });
  if (smtp.host) mailer.saveSettings({ permitidos, limiteDiario });
  return { mailer, sent, dir };
}

const CORREO = { agentId: 'pm', para: ['javier@intelekia.cloud'], asunto: 'Tareas vencidas en TLO', cuerpo: 'Hola Javier, ¿me ayudas con fecha nueva?' };

test('envía directo cuando todos los destinatarios están permitidos (con remitente, reply-to y firma)', async () => {
  const { mailer, sent } = setup();
  const item = await mailer.enviar(CORREO);
  assert.equal(item.estado, 'enviado');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, '"PM · Intelekia" <pm@intelekia.cloud>');
  assert.equal(sent[0].to, 'javier@intelekia.cloud');
  assert.equal(sent[0].replyTo, 'jose@intelekia.cloud');
  assert.match(sent[0].text, /¿me ayudas con fecha nueva\?\n\n--\nEnviado por el PM\.$/);
  assert.equal(mailer.status().enviadosHoy, 1);
});

test('si un destinatario (o cc) no está permitido, NO se envía y queda por aprobar', async () => {
  const { mailer, sent } = setup();
  const item = await mailer.enviar({ ...CORREO, cc: ['cliente@empresa.com'] });
  assert.equal(item.estado, 'por_aprobar');
  assert.match(item.motivo, /cliente@empresa\.com/);
  assert.equal(sent.length, 0);
  assert.equal(mailer.status().porAprobar, 1);
});

test('el fundador puede editar y aprobar, o descartar, un correo pendiente', async () => {
  const { mailer, sent } = setup();
  const a = await mailer.enviar({ ...CORREO, para: ['cliente@empresa.com'] });
  const aprobado = await mailer.aprobar(a.id, { asunto: 'Asunto corregido' });
  assert.equal(aprobado.estado, 'enviado');
  assert.equal(sent[0].subject, 'Asunto corregido');
  await assert.rejects(mailer.aprobar(a.id), /ya está enviado/);

  const b = await mailer.enviar({ ...CORREO, para: ['otro@empresa.com'], asunto: 'Otro' });
  assert.equal(mailer.descartar(b.id).estado, 'descartado');
  assert.equal(sent.length, 1);
});

test('respeta el límite diario: al llegar, lo demás queda por aprobar', async () => {
  const { mailer, sent } = setup({ limiteDiario: 1 });
  await mailer.enviar(CORREO);
  const segundo = await mailer.enviar({ ...CORREO, asunto: 'Otro asunto' });
  assert.equal(segundo.estado, 'por_aprobar');
  assert.match(segundo.motivo, /límite diario de 1/);
  assert.equal(sent.length, 1);
});

test('bloquea duplicados (mismo destinatario y asunto) para evitar spam', async () => {
  const { mailer, sent } = setup();
  await mailer.enviar(CORREO);
  await assert.rejects(mailer.enviar({ ...CORREO, cuerpo: 'otro texto' }), /Ya existe un correo igual/);
  assert.equal(sent.length, 1);
});

test('valida destinatarios, asunto y cuerpo, y evita inyección de cabeceras en el asunto', async () => {
  const { mailer, sent } = setup();
  await assert.rejects(mailer.enviar({ ...CORREO, para: [] }), /destinatario/);
  await assert.rejects(mailer.enviar({ ...CORREO, para: ['no-es-correo'] }), /inválido/);
  await assert.rejects(mailer.enviar({ ...CORREO, asunto: '' }), /asunto/);
  await assert.rejects(mailer.enviar({ ...CORREO, para: Array.from({ length: 11 }, (_, i) => `a${i}@intelekia.cloud`) }), /Máximo 10/);
  const item = await mailer.enviar({ ...CORREO, asunto: 'Hola\r\nBcc: espia@malo.com' });
  assert.equal(item.asunto, 'Hola Bcc: espia@malo.com');
  assert.equal(sent.at(-1).bcc, undefined);
});

test('si el SMTP falla, queda en error y se puede reintentar aprobándolo', async () => {
  const { mailer } = setup({ failSend: true });
  const item = await mailer.enviar(CORREO);
  assert.equal(item.estado, 'error');
  assert.match(item.error, /535/);
});

test('sin configuración SMTP lo dice claramente y no intenta conectar', async () => {
  const mailer = createMailer({ smtp: { ...SMTP, host: '' }, settingsPath: null, logPath: null, createTransport: () => assert.fail('no debe conectar') });
  assert.equal(mailer.status().configurado, false);
  await assert.rejects(mailer.enviar(CORREO), /no está configurado/);
});

test('reglas de la lista blanca: correo exacto o dominio completo (sin subdominios ni imitaciones)', () => {
  assert.equal(normalizarRegla(' @Intelekia.cloud '), '@intelekia.cloud');
  assert.throws(() => normalizarRegla('intelekia'), /inválido/);
  assert.equal(cumpleRegla('ana@intelekia.cloud', '@intelekia.cloud'), true);
  assert.equal(cumpleRegla('ana@falso-intelekia.cloud', '@intelekia.cloud'), false);
  assert.equal(cumpleRegla('ana@sub.intelekia.cloud', '@intelekia.cloud'), false);
  assert.equal(cumpleRegla('beto@gmail.com', 'beto@gmail.com'), true);
  assert.equal(cumpleRegla('otro@gmail.com', 'beto@gmail.com'), false);
});

test('SMTP_BCC agrega copia oculta a cada envío sin contar para la lista blanca', async () => {
  const { mailer, sent } = setup({ smtp: { ...SMTP, bcc: 'direccion@intelekia.cloud, no-es-correo' }, permitidos: ['@intelekia.cloud'] });
  const item = await mailer.enviar(CORREO);
  assert.equal(item.estado, 'enviado');
  assert.equal(sent[0].bcc, 'direccion@intelekia.cloud');
  assert.deepEqual(item.copiaOculta, ['direccion@intelekia.cloud']);
  assert.deepEqual(mailer.status().copiaOculta, ['direccion@intelekia.cloud']);

  // También al aprobar uno pendiente.
  const pendiente = await mailer.enviar({ ...CORREO, para: ['cliente@empresa.com'], asunto: 'Otro' });
  await mailer.aprobar(pendiente.id);
  assert.equal(sent[1].bcc, 'direccion@intelekia.cloud');
});

test('sin SMTP_BCC no se agrega copia oculta', async () => {
  const { mailer, sent } = setup();
  await mailer.enviar(CORREO);
  assert.equal(sent[0].bcc, undefined);
});
