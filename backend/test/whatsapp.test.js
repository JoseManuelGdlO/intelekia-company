const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createWhatsapp, partirTexto, extraerMensajes, normalizarNumero } = require('../lib/whatsapp');

const CONFIG = { token: 'tok', phoneNumberId: 'PHONE', verifyToken: 'v', appSecret: 'secreto', permitidos: ['5218710000000'], apiVersion: 'v21.0' };

function fakeFetch(respuestas = {}, llamadas = []) {
  return async (url, opts = {}) => {
    llamadas.push({ url, metodo: opts.method || 'GET', auth: opts.headers?.Authorization, body: opts.body });
    const clave = Object.keys(respuestas).find((k) => url.includes(k));
    const r = clave ? respuestas[clave] : { messages: [{ id: 'wamid.X' }] };
    if (r instanceof Buffer) return { ok: true, status: 200, arrayBuffer: async () => r, json: async () => ({}) };
    return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r };
  };
}

test('partirTexto corta en saltos de línea o espacios sin pasar el máximo', () => {
  const largo = `${'a'.repeat(30)}\n${'b'.repeat(30)} ${'c'.repeat(30)}`;
  const partes = partirTexto(largo, 40);
  assert.ok(partes.every((p) => p.length <= 40));
  assert.equal(partes.join('').replace(/\s/g, ''), largo.replace(/\s/g, ''));
  assert.deepEqual(partirTexto('hola', 40), ['hola']);
  assert.deepEqual(partirTexto('   ', 40), []);
});

test('estado explica qué falta', () => {
  assert.deepEqual(createWhatsapp({ config: CONFIG }).estado(), { ok: true });
  assert.match(createWhatsapp({ config: { ...CONFIG, token: '', permitidos: [] } }).estado().motivo, /WHATSAPP_TOKEN.*WHATSAPP_PERMITIDOS/);
});

test('enviarTexto manda mensajes de texto con Bearer al endpoint del número', async () => {
  const llamadas = [];
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({}, llamadas) });
  const partes = await wa.enviarTexto('5218710000000', 'Hola');
  assert.equal(partes, 1);
  assert.equal(llamadas[0].url, 'https://graph.facebook.com/v21.0/PHONE/messages');
  assert.equal(llamadas[0].auth, 'Bearer tok');
  assert.deepEqual(JSON.parse(llamadas[0].body), { messaging_product: 'whatsapp', to: '528710000000', type: 'text', text: { body: 'Hola', preview_url: false } });
});

test('enviarAudio sube el archivo y manda el audio con su id', async () => {
  const llamadas = [];
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({ '/PHONE/media': { id: 'MED1' } }, llamadas) });
  await wa.enviarAudio('5218710000000', Buffer.from('ogg'));
  assert.equal(llamadas[0].url, 'https://graph.facebook.com/v21.0/PHONE/media');
  assert.ok(llamadas[0].body instanceof FormData);
  assert.deepEqual(JSON.parse(llamadas[1].body), { messaging_product: 'whatsapp', to: '528710000000', type: 'audio', audio: { id: 'MED1' } });
});

test('enviarPlantilla arma la plantilla con sus parámetros', async () => {
  const llamadas = [];
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({}, llamadas) });
  await wa.enviarPlantilla('5218710000000', 'aviso', 'es_MX', [3]);
  assert.equal(JSON.parse(llamadas[0].body).to, '528710000000');
  assert.deepEqual(JSON.parse(llamadas[0].body).template, {
    name: 'aviso', language: { code: 'es_MX' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '3' }] }],
  });
});

test('descargarMedia pide la URL y descarga con el token', async () => {
  const llamadas = [];
  const fetchImpl = fakeFetch({ '/MEDIA9': { url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg; codecs=opus' }, 'lookaside': Buffer.from('audio') }, llamadas);
  const wa = createWhatsapp({ config: CONFIG, fetchImpl });
  const { buffer, mime } = await wa.descargarMedia('MEDIA9');
  assert.equal(buffer.toString(), 'audio');
  assert.equal(mime, 'audio/ogg; codecs=opus');
  assert.equal(llamadas[1].auth, 'Bearer tok');
});

test('errores de Meta y de red llevan el prefijo WhatsApp', async () => {
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({ '/messages': { error: { message: 'Número inválido' } } }) });
  await assert.rejects(wa.enviarTexto('1', 'x'), /WhatsApp: Número inválido/);
  const caido = createWhatsapp({ config: CONFIG, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(caido.enviarTexto('1', 'x'), /WhatsApp: no se pudo conectar \(ECONNRESET\)/);
});

test('verificarFirma valida el HMAC SHA-256 del cuerpo crudo', () => {
  const wa = createWhatsapp({ config: CONFIG });
  const body = Buffer.from('{"a":1}');
  const firma = `sha256=${crypto.createHmac('sha256', 'secreto').update(body).digest('hex')}`;
  assert.equal(wa.verificarFirma(body, firma), true);
  assert.equal(wa.verificarFirma(body, 'sha256=00'), false);
  assert.equal(wa.verificarFirma(body, undefined), false);
  assert.equal(wa.verificarFirma(null, firma), false);
});

test('extraerMensajes normaliza texto, audio y otros; ignora statuses', () => {
  const payload = {
    entry: [{ changes: [{ value: {
      messages: [
        { id: 'm1', from: '5218710000000', timestamp: '1794300000', type: 'text', text: { body: 'Hola PM' } },
        { id: 'm2', from: '5218710000000', timestamp: '1794300001', type: 'audio', audio: { id: 'MED1', mime_type: 'audio/ogg' } },
        { id: 'm3', from: '5218710000000', timestamp: '1794300002', type: 'image', image: { id: 'IMG' } },
      ],
      statuses: [{ id: 's1', status: 'read' }],
    } }] }],
  };
  assert.deepEqual(extraerMensajes(payload), [
    { id: 'm1', de: '5218710000000', tipo: 'texto', texto: 'Hola PM', mediaId: null, fecha: new Date(1794300000 * 1000).toISOString() },
    { id: 'm2', de: '5218710000000', tipo: 'audio', texto: '', mediaId: 'MED1', fecha: new Date(1794300001 * 1000).toISOString() },
    { id: 'm3', de: '5218710000000', tipo: 'otro', texto: '', mediaId: null, fecha: new Date(1794300002 * 1000).toISOString() },
  ]);
  assert.deepEqual(extraerMensajes({}), []);
});

test('normalizarNumero deja solo dígitos y quita el 1 de los celulares de México', () => {
  assert.equal(normalizarNumero('5218710000000'), '528710000000');
  assert.equal(normalizarNumero('+52 1 871 000 0000'), '528710000000');
  assert.equal(normalizarNumero('528710000000'), '528710000000');
  assert.equal(normalizarNumero('15551234567'), '15551234567');
  assert.equal(normalizarNumero(''), '');
  assert.equal(normalizarNumero(undefined), '');
});

test('descargarMedia no manda el token a hosts que no son de Meta', async () => {
  for (const url of ['https://evil.example.com/x', 'http://lookaside.fbsbx.com/x', 'https://fbsbx.com.evil.io/x']) {
    const llamadas = [];
    const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({ '/MEDIA9': { url, mime_type: 'audio/ogg' } }, llamadas) });
    await assert.rejects(wa.descargarMedia('MEDIA9'), /WhatsApp: URL de descarga no confiable/);
    assert.equal(llamadas.length, 1);
  }
  for (const url of ['https://mmg.whatsapp.net/a', 'https://scontent.xx.fbcdn.net/a', 'https://x.facebook.com/a']) {
    const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({ '/MEDIA9': { url, mime_type: 'audio/ogg' }, [url]: Buffer.from('ok') }) });
    assert.equal((await wa.descargarMedia('MEDIA9')).buffer.toString(), 'ok');
  }
});

test('descargarMedia rechaza audios de más de 16 MB', async () => {
  const info = { url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg' };
  const porCabecera = async (url) => (url.includes('/MEDIA9')
    ? { ok: true, status: 200, json: async () => info }
    : { ok: true, status: 200, headers: new Headers({ 'content-length': String(17 * 1024 * 1024) }), arrayBuffer: async () => { throw new Error('no debía leerse'); } });
  await assert.rejects(createWhatsapp({ config: CONFIG, fetchImpl: porCabecera }).descargarMedia('MEDIA9'), /demasiado grande/);
  const porTamano = async (url) => (url.includes('/MEDIA9')
    ? { ok: true, status: 200, json: async () => info }
    : { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(16 * 1024 * 1024 + 1) });
  await assert.rejects(createWhatsapp({ config: CONFIG, fetchImpl: porTamano }).descargarMedia('MEDIA9'), /demasiado grande/);
});

test('partirTexto no parte un emoji (par sustituto) en un corte forzado', () => {
  const texto = `${'a'.repeat(9)}😀${'b'.repeat(20)}`;
  const partes = partirTexto(texto, 10);
  assert.equal(partes[0], 'a'.repeat(9));
  assert.ok(partes[1].startsWith('😀'));
  assert.equal(partes.join(''), texto);
  assert.ok(partes.every((p) => !/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p)));
});
