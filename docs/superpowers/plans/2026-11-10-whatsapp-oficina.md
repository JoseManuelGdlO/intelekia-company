# Canal de WhatsApp de la oficina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El fundador escribe (texto o audio) a la oficina por WhatsApp Cloud API; la oficina enruta al trabajador correcto, conversa o fuerza su ciclo, contesta (con nota de voz si entró audio) y avisa/gestiona la bandeja de aprobaciones.

**Architecture:** `lib/whatsapp.js` (cliente Cloud API + firma + parseo del webhook), `lib/voz.js` (OpenAI transcripción/voz), `lib/recepcionWhatsapp.js` (permitidos, duplicados, comandos, ruteo, seguimiento, avisos con ventana de 24 h, estado persistente) y `routes/whatsapp.js` (webhook). `server.js` conecta todo con `chatHandlers`, `scheduler.runOne` y `aprobaciones`.

**Tech Stack:** Node ≥18 (fetch, FormData, Blob, AbortSignal.timeout nativos), Express, `node:test`, `crypto`.

**Spec:** `docs/superpowers/specs/2026-11-10-whatsapp-oficina-design.md`

## Global Constraints

- Pruebas desde `backend/`: `node --test test/<archivo>.test.js`; suite completa `npm test` (base: 304).
- Textos al usuario y errores en español.
- Números en formato internacional solo dígitos (p. ej. `5218711234567`); solo se atienden los de `WHATSAPP_PERMITIDOS`.
- Mensajes de texto partidos en trozos de ≤ 4000 caracteres.
- Ventana de 24 h desde el último mensaje del fundador; fuera de ella: plantilla (si hay `WHATSAPP_PLANTILLA_AVISO`) una vez por periodo, y los avisos se acumulan y se entregan al volver a escribir.
- Seguimiento: 15 min con el último trabajador.
- Voz: transcripción `gpt-4o-mini-transcribe` (idioma `es`), voz `gpt-4o-mini-tts`, `response_format: 'opus'`, texto a voz recortado a 1500 caracteres.
- API de Meta por cabecera `Authorization: Bearer`, timeout 20 s, errores con prefijo `WhatsApp: `.
- Estado en `backend/state/whatsapp.json` (ignorado en git), escritura atómica, archivo dañado → respaldo `.corrupto-<ms>`.
- Nunca stagear ni revertir archivos de `backend/state/`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/config.js`, `backend/.env.example` (mod) | `config.whatsapp` |
| `backend/lib/whatsapp.js` (nuevo) | Cliente Cloud API, firma, parseo |
| `backend/lib/voz.js` (nuevo) | Transcribir / sintetizar con OpenAI |
| `backend/lib/aprobaciones.js` (mod) | `suscribir(fn)` |
| `backend/lib/recepcionWhatsapp.js` (nuevo) | Lógica del canal + `crearEnrutadorIA` |
| `backend/routes/whatsapp.js` (nuevo) | Webhook y estado |
| `backend/server.js`, `.gitignore` (mod) | Wiring |

---

### Task 1: Configuración y cliente de WhatsApp Cloud API

**Files:**
- Create: `backend/lib/whatsapp.js`
- Modify: `backend/config.js`, `backend/.env.example`
- Test: `backend/test/whatsapp.test.js`, `backend/test/config.test.js`

**Interfaces:**
- Produces: `loadConfig().whatsapp = { token, phoneNumberId, verifyToken, appSecret, permitidos: string[], plantillaAviso, plantillaIdioma, apiVersion, voz }`.
- Produces: `createWhatsapp({ config, fetchImpl, timeoutMs }) -> { estado(), enviarTexto(to, texto) -> Promise<number partes>, enviarAudio(to, buffer, mime?), enviarPlantilla(to, nombre, idioma, parametros), descargarMedia(mediaId) -> Promise<{ buffer, mime }>, verificarFirma(rawBody, firma) -> boolean, extraerMensajes(payload) }`; exports `partirTexto`, `extraerMensajes`, `MAX_TEXTO`.
- Mensaje: `{ id, de, tipo: 'texto'|'audio'|'otro', texto, mediaId, fecha }`.

- [ ] **Step 1: Failing tests**

Al final de `backend/test/config.test.js`:

```js
test('loadConfig lee la configuración de WhatsApp', () => {
  const c = loadConfig({
    WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's',
    WHATSAPP_PERMITIDOS: '+52 1 871 000 0000, 5218719999999', WHATSAPP_PLANTILLA_AVISO: 'aviso',
  });
  assert.deepEqual(c.whatsapp, {
    token: 't', phoneNumberId: 'p', verifyToken: 'v', appSecret: 's',
    permitidos: ['5218710000000', '5218719999999'], plantillaAviso: 'aviso', plantillaIdioma: 'es_MX', apiVersion: 'v21.0', voz: 'alloy',
  });
  assert.deepEqual(loadConfig({}).whatsapp.permitidos, []);
});
```

Crea `backend/test/whatsapp.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createWhatsapp, partirTexto, extraerMensajes } = require('../lib/whatsapp');

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
  assert.deepEqual(JSON.parse(llamadas[0].body), { messaging_product: 'whatsapp', to: '5218710000000', type: 'text', text: { body: 'Hola', preview_url: false } });
});

test('enviarAudio sube el archivo y manda el audio con su id', async () => {
  const llamadas = [];
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({ '/PHONE/media': { id: 'MED1' } }, llamadas) });
  await wa.enviarAudio('5218710000000', Buffer.from('ogg'));
  assert.equal(llamadas[0].url, 'https://graph.facebook.com/v21.0/PHONE/media');
  assert.ok(llamadas[0].body instanceof FormData);
  assert.deepEqual(JSON.parse(llamadas[1].body), { messaging_product: 'whatsapp', to: '5218710000000', type: 'audio', audio: { id: 'MED1' } });
});

test('enviarPlantilla arma la plantilla con sus parámetros', async () => {
  const llamadas = [];
  const wa = createWhatsapp({ config: CONFIG, fetchImpl: fakeFetch({}, llamadas) });
  await wa.enviarPlantilla('5218710000000', 'aviso', 'es_MX', [3]);
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
```

- [ ] **Step 2: Run** `node --test test/whatsapp.test.js test/config.test.js` → FAIL.

- [ ] **Step 3: Implement**

`backend/config.js`, dentro del objeto de `loadConfig`, después de `meta`:

```js
    // Canal de WhatsApp (Cloud API de Meta).
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      permitidos: list(env.WHATSAPP_PERMITIDOS || '').map((n) => n.replace(/\D/g, '')).filter(Boolean),
      plantillaAviso: env.WHATSAPP_PLANTILLA_AVISO || '',
      plantillaIdioma: env.WHATSAPP_PLANTILLA_IDIOMA || 'es_MX',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
      voz: env.WHATSAPP_VOZ || 'alloy',
    },
```

Al final de `backend/.env.example`:

```
# Canal de WhatsApp (Cloud API de Meta). Token permanente de usuario del sistema con
# whatsapp_business_messaging y whatsapp_business_management. El webhook es
# https://<tu-dominio-ngrok>/webhook/whatsapp con el verify token de abajo.
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
# Números que pueden usar el canal, separados por coma, solo dígitos con lada (México: 521 + 10 dígitos).
WHATSAPP_PERMITIDOS=
# Opcional: plantilla aprobada con un parámetro (número de pendientes) para avisar fuera de la ventana de 24 h.
WHATSAPP_PLANTILLA_AVISO=
WHATSAPP_PLANTILLA_IDIOMA=es_MX
WHATSAPP_API_VERSION=v21.0
WHATSAPP_VOZ=alloy
```

Crea `backend/lib/whatsapp.js`:

```js
const crypto = require('crypto');

/**
 * Cliente mínimo de la WhatsApp Cloud API (Meta): enviar texto, audio y plantillas, descargar
 * audios recibidos, verificar la firma del webhook y extraer los mensajes del payload.
 */
const GRAPH = 'https://graph.facebook.com';
const MAX_TEXTO = 4000;
const TIMEOUT_MS = 20000;

/** Parte un texto largo en trozos de ≤ max, cortando en salto de línea o espacio cuando se puede. */
function partirTexto(texto, max = MAX_TEXTO) {
  const partes = [];
  let resto = String(texto || '').trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Mensajes entrantes del payload del webhook (ignora confirmaciones de entrega/lectura). */
function extraerMensajes(payload) {
  const lista = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        const tipo = m.type === 'text' ? 'texto' : m.type === 'audio' ? 'audio' : 'otro';
        lista.push({
          id: m.id,
          de: String(m.from || ''),
          tipo,
          texto: m.text?.body || '',
          mediaId: m.audio?.id || null,
          fecha: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
        });
      }
    }
  }
  return lista;
}

function createWhatsapp({ config, fetchImpl = (...a) => fetch(...a), timeoutMs = TIMEOUT_MS }) {
  const { token, phoneNumberId, appSecret, apiVersion = 'v21.0' } = config || {};
  const base = () => `${GRAPH}/${apiVersion}`;

  function estado() {
    const faltan = [
      ['WHATSAPP_TOKEN', token],
      ['WHATSAPP_PHONE_NUMBER_ID', phoneNumberId],
      ['WHATSAPP_VERIFY_TOKEN', config?.verifyToken],
      ['WHATSAPP_APP_SECRET', appSecret],
      ['WHATSAPP_PERMITIDOS', (config?.permitidos || []).length],
    ]
      .filter(([, valor]) => !valor)
      .map(([nombre]) => nombre);
    return faltan.length ? { ok: false, motivo: `Falta configurar en backend/.env: ${faltan.join(', ')}` } : { ok: true };
  }

  async function llamar(url, opts = {}) {
    try {
      return await fetchImpl(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new Error(`WhatsApp: no se pudo conectar (${err.message})`);
    }
  }

  async function json(url, opts) {
    const res = await llamar(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`WhatsApp: ${data.error?.message || `respuesta ${res.status}`}`);
    return data;
  }

  function enviar(cuerpo) {
    return json(`${base()}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
    });
  }

  async function enviarTexto(to, texto) {
    const partes = partirTexto(texto);
    for (const body of partes) await enviar({ to, type: 'text', text: { body, preview_url: false } });
    return partes.length;
  }

  async function enviarAudio(to, buffer, mime = 'audio/ogg') {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buffer], { type: mime }), 'respuesta.ogg');
    const { id } = await json(`${base()}/${encodeURIComponent(phoneNumberId)}/media`, { method: 'POST', body: form });
    return enviar({ to, type: 'audio', audio: { id } });
  }

  function enviarPlantilla(to, nombre, idioma, parametros = []) {
    const components = parametros.length ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }] : [];
    return enviar({ to, type: 'template', template: { name: nombre, language: { code: idioma }, components } });
  }

  async function descargarMedia(mediaId) {
    const info = await json(`${base()}/${encodeURIComponent(mediaId)}`);
    const res = await llamar(info.url);
    if (!res.ok) throw new Error(`WhatsApp: no se pudo descargar el audio (respuesta ${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: info.mime_type || 'audio/ogg' };
  }

  /** Firma `X-Hub-Signature-256` = "sha256=" + HMAC(appSecret, cuerpo crudo). */
  function verificarFirma(rawBody, firma) {
    if (!appSecret || !rawBody || !firma) return false;
    const esperada = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
    const recibida = Buffer.from(String(firma));
    return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
  }

  return { estado, enviarTexto, enviarAudio, enviarPlantilla, descargarMedia, verificarFirma, extraerMensajes };
}

module.exports = { createWhatsapp, partirTexto, extraerMensajes, MAX_TEXTO };
```

- [ ] **Step 4: Verify** `node --test test/whatsapp.test.js test/config.test.js` → PASS; `npm test` → todo pasa.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/whatsapp.js backend/test/whatsapp.test.js backend/config.js backend/test/config.test.js backend/.env.example
git commit -m "Add WhatsApp Cloud API client: send text/audio/templates, download media, verify webhook signature"
```

---

### Task 2: Voz (transcripción y notas de voz) y `aprobaciones.suscribir`

**Files:**
- Create: `backend/lib/voz.js`
- Modify: `backend/lib/aprobaciones.js`
- Test: `backend/test/voz.test.js`, `backend/test/aprobaciones.test.js`

**Interfaces:**
- Produces: `createVoz({ apiKey, fetchImpl, modeloTranscripcion, modeloVoz, voz, timeoutMs }) -> { transcribir(buffer, mime) -> Promise<string>, sintetizar(texto) -> Promise<Buffer>, recortar(texto) -> string }`.
- Produces: `aprobaciones.suscribir(fn) -> () => void` (desuscribir); `fn(item)` se llama tras cada `proponer`; errores (síncronos o promesas rechazadas) del oyente no afectan a `proponer`.

- [ ] **Step 1: Failing tests**

Crea `backend/test/voz.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoz } = require('../lib/voz');

function fakeFetch(respuesta, llamadas = []) {
  return async (url, opts = {}) => {
    llamadas.push({ url, opts });
    return respuesta;
  };
}

test('transcribir manda el audio a OpenAI y devuelve el texto', async () => {
  const llamadas = [];
  const voz = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: true, json: async () => ({ text: '  hola PM  ' }) }, llamadas) });
  assert.equal(await voz.transcribir(Buffer.from('ogg'), 'audio/ogg'), 'hola PM');
  assert.equal(llamadas[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(llamadas[0].opts.headers.Authorization, 'Bearer sk');
  const form = llamadas[0].opts.body;
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(form.get('language'), 'es');
});

test('transcribir falla con mensaje claro si no hay texto o hay error', async () => {
  const vacio = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: true, json: async () => ({ text: '' }) }) });
  await assert.rejects(vacio.transcribir(Buffer.from('x')), /No se entendió el audio/);
  const error = createVoz({ apiKey: 'sk', fetchImpl: fakeFetch({ ok: false, status: 401, text: async () => 'bad key' }) });
  await assert.rejects(error.transcribir(Buffer.from('x')), /OpenAI: respuesta 401 bad key/);
  await assert.rejects(createVoz({ apiKey: '' }).transcribir(Buffer.from('x')), /OPENAI_API_KEY/);
});

test('sintetizar pide opus con la voz configurada y quita el formato de WhatsApp', async () => {
  const llamadas = [];
  const voz = createVoz({ apiKey: 'sk', voz: 'nova', fetchImpl: fakeFetch({ ok: true, arrayBuffer: async () => Buffer.from('OGG') }, llamadas) });
  const audio = await voz.sintetizar('*PM:* todo bien');
  assert.equal(audio.toString(), 'OGG');
  assert.equal(llamadas[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.deepEqual(JSON.parse(llamadas[0].opts.body), { model: 'gpt-4o-mini-tts', voice: 'nova', input: 'PM: todo bien', response_format: 'opus' });
});

test('recortar deja máximo ~1500 caracteres y avisa que el resto va por escrito', () => {
  const voz = createVoz({ apiKey: 'sk' });
  const largo = 'Frase de prueba. '.repeat(200);
  const r = voz.recortar(largo);
  assert.ok(r.length <= 1500 + 40);
  assert.match(r, /El resto te lo dejé por escrito\.$/);
  assert.equal(voz.recortar('corto'), 'corto');
});
```

Al final de `backend/test/aprobaciones.test.js`:

```js
test('suscribir avisa de cada propuesta y los errores del oyente no rompen proponer', async () => {
  const a = createAprobaciones({ filePath: tmpFile() });
  const vistos = [];
  const quitar = a.suscribir((item) => vistos.push(item.id));
  a.suscribir(() => { throw new Error('oyente roto'); });
  a.suscribir(async () => { throw new Error('oyente async roto'); });
  const item = a.proponer(BASE);
  assert.deepEqual(vistos, [item.id]);
  quitar();
  a.proponer(BASE);
  assert.equal(vistos.length, 1);
  await new Promise((r) => setImmediate(r));
});
```

- [ ] **Step 2: Run** `node --test test/voz.test.js test/aprobaciones.test.js` → FAIL.

- [ ] **Step 3: Implement**

Crea `backend/lib/voz.js`:

```js
/**
 * Voz para el canal de WhatsApp con OpenAI: transcribe notas de voz y genera respuestas habladas
 * (Ogg/Opus, el formato de las notas de voz de WhatsApp).
 */
const OPENAI = 'https://api.openai.com/v1';
const MAX_VOZ = 1500;

function createVoz({
  apiKey,
  fetchImpl = (...a) => fetch(...a),
  modeloTranscripcion = 'gpt-4o-mini-transcribe',
  modeloVoz = 'gpt-4o-mini-tts',
  voz = 'alloy',
  timeoutMs = 60000,
}) {
  async function llamar(ruta, opts) {
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY para la voz');
    let res;
    try {
      res = await fetchImpl(`${OPENAI}${ruta}`, { ...opts, headers: { Authorization: `Bearer ${apiKey}`, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new Error(`OpenAI: no se pudo conectar (${err.message})`);
    }
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`OpenAI: respuesta ${res.status} ${String(detalle).slice(0, 200)}`.trim());
    }
    return res;
  }

  async function transcribir(buffer, mime = 'audio/ogg') {
    const form = new FormData();
    form.append('model', modeloTranscripcion);
    form.append('language', 'es');
    form.append('file', new Blob([buffer], { type: mime }), 'audio.ogg');
    const data = await (await llamar('/audio/transcriptions', { method: 'POST', body: form })).json();
    const texto = String(data.text || '').trim();
    if (!texto) throw new Error('No se entendió el audio');
    return texto;
  }

  /** Quita el formato de WhatsApp y recorta a ~1500 caracteres en un final de oración. */
  function recortar(texto) {
    const limpio = String(texto || '').replace(/[*_~`]/g, '').trim();
    if (limpio.length <= MAX_VOZ) return limpio;
    const corte = limpio.lastIndexOf('. ', MAX_VOZ);
    const base = corte > MAX_VOZ * 0.5 ? limpio.slice(0, corte + 1) : limpio.slice(0, MAX_VOZ);
    return `${base} El resto te lo dejé por escrito.`;
  }

  async function sintetizar(texto) {
    const res = await llamar('/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modeloVoz, voice: voz, input: recortar(texto), response_format: 'opus' }),
    });
    return Buffer.from(await res.arrayBuffer());
  }

  return { transcribir, sintetizar, recortar };
}

module.exports = { createVoz };
```

En `backend/lib/aprobaciones.js` (lee el archivo; ya tiene `proponer`, `aprobar`, etc.):
- Dentro de `createAprobaciones`, junto a `const ejecutores = {};`, agrega `const oyentes = new Set();`
- Agrega la función:

```js
  /** Avisa a `fn(item)` cada vez que se propone algo (p. ej. para notificar por WhatsApp). */
  function suscribir(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  }

  function notificar(item) {
    oyentes.forEach((fn) => {
      try {
        const r = fn(item);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch {
        // un oyente roto nunca debe impedir proponer
      }
    });
  }
```

- En `proponer`, justo antes de `return item;`, llama `notificar(item);`.
- Agrega `suscribir` al objeto que devuelve `createAprobaciones`.

- [ ] **Step 4: Verify** `node --test test/voz.test.js test/aprobaciones.test.js` → PASS; `npm test` → todo pasa.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/voz.js backend/test/voz.test.js backend/lib/aprobaciones.js backend/test/aprobaciones.test.js
git commit -m "Add OpenAI voice (transcribe/speak) and approval subscriptions"
```

---

### Task 3: Recepción de WhatsApp (lógica del canal)

**Files:**
- Create: `backend/lib/recepcionWhatsapp.js`
- Test: `backend/test/recepcionWhatsapp.test.js`

**Interfaces:**
- Consumes: forma de `whatsapp` (Task 1), `voz` (Task 2), `aprobaciones.list/aprobar/descartar` (existente).
- Produces: `createRecepcionWhatsapp({ whatsapp, voz, estadoPath, permitidos, agentes: () => [{ id, label, rol }], chatDe: async (agentId, texto) => string, forzarCiclo: async (agentId) => string, aprobaciones, enrutarConIA: async (texto, agentes) => { agentId, accion, duda }, labelOf, registrar: (agentId|null, tipo, texto) => void, plantilla: { nombre, idioma } | null, now }) -> { procesar(mensaje), avisarAprobacion(item), estadoCanal() }`.
- Produces: `crearEnrutadorIA({ createChatCompletion, apiKey, model }) -> async (texto, agentes) => { agentId: string|null, accion: 'chat'|'forzar_ciclo', duda: string[] }`; `detectarPorNombre(texto, agentes) -> { agente, resto } | null`; `normalizar(s)`.

- [ ] **Step 1: Failing tests** — crea `backend/test/recepcionWhatsapp.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre } = require('../lib/recepcionWhatsapp');
const { createAprobaciones } = require('../lib/aprobaciones');

const YO = '5218710000000';
const AGENTES = [
  { id: 'pm', label: 'PM', rol: 'Da seguimiento al equipo' },
  { id: 'cotizador', label: 'Cotizador', rol: 'Cotiza proyectos' },
  { id: 'seguimiento-crm', label: 'Seguimiento de Proyectos', rol: 'Proyectos y tickets' },
  { id: 'buscador-tendencias', label: 'Buscador de Tendencias', rol: 'Ideas de contenido' },
  { id: 'buscador-prospectos', label: 'Buscador de Prospectos', rol: 'Prospectos' },
  { id: 'revisor-prs', label: 'Revisor de PRs', rol: 'Revisa PRs' },
];
const msg = (id, texto, extra = {}) => ({ id, de: YO, tipo: 'texto', texto, mediaId: null, fecha: null, ...extra });

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const enviados = [];
  const whatsapp = {
    enviarTexto: async (to, texto) => enviados.push({ to, tipo: 'texto', texto }),
    enviarAudio: async (to, buffer) => enviados.push({ to, tipo: 'audio', audio: buffer.toString() }),
    enviarPlantilla: async (to, nombre, idioma, params) => enviados.push({ to, tipo: 'plantilla', nombre, idioma, params }),
    descargarMedia: async () => ({ buffer: Buffer.from('ogg'), mime: 'audio/ogg' }),
  };
  const voz = { transcribir: async () => 'PM, cómo va el equipo', sintetizar: async (t) => Buffer.from(`voz:${t}`) };
  const chats = [];
  const ciclos = [];
  const rutas = [];
  const aprob = createAprobaciones({ filePath: path.join(dir, 'aprob.json') });
  aprob.registrarEjecutor('responder_comentario', async () => {});
  let t = Date.parse('2026-11-10T12:00:00Z');
  const reloj = { now: () => new Date(t), avanzar: (ms) => { t += ms; } };
  const deps = {
    whatsapp,
    voz,
    estadoPath: path.join(dir, 'whatsapp.json'),
    permitidos: [YO],
    agentes: () => AGENTES,
    chatDe: async (id, texto) => {
      chats.push({ id, texto });
      return `respuesta de ${id}`;
    },
    forzarCiclo: async (id) => {
      ciclos.push(id);
      return `ciclo de ${id} listo`;
    },
    aprobaciones: aprob,
    enrutarConIA: async (texto, lista) => {
      rutas.push({ texto, ids: lista.map((a) => a.id) });
      return { agentId: null, accion: 'chat', duda: [] };
    },
    labelOf: (id) => AGENTES.find((a) => a.id === id)?.label || id,
    registrar: () => {},
    plantilla: null,
    now: reloj.now,
    ...extra,
  };
  return { r: createRecepcionWhatsapp(deps), deps, enviados, chats, ciclos, rutas, aprob, reloj, dir };
}
const textos = (enviados) => enviados.filter((e) => e.tipo === 'texto').map((e) => e.texto);
const ITEM = { agentId: 'respuestas-redes', tipo: 'responder_comentario', titulo: 'Instagram · carla', propuesta: '¡Gracias!', contexto: { comentario: 'Me interesa' } };

test('detectarPorNombre: nombre completo, primera palabra única, y deja el resto del texto', () => {
  assert.deepEqual(detectarPorNombre('PM, ¿cómo va el equipo?', AGENTES), { agente: AGENTES[0], resto: '¿cómo va el equipo?' });
  assert.equal(detectarPorNombre('revisor: revisa lo nuevo', AGENTES).agente.id, 'revisor-prs');
  assert.equal(detectarPorNombre('Buscador de Prospectos dame 5', AGENTES).agente.id, 'buscador-prospectos');
  assert.equal(detectarPorNombre('Buscador dame ideas', AGENTES), null);
  assert.equal(detectarPorNombre('pmo del proyecto', AGENTES), null);
  assert.equal(detectarPorNombre('Cotizador', AGENTES).resto, '');
});

test('ignora números no permitidos y mensajes repetidos', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar({ ...msg('x1', 'PM hola'), de: '5210000000000' });
  await r.procesar(msg('m1', 'PM hola'));
  await r.procesar(msg('m1', 'PM hola'));
  assert.equal(chats.length, 1);
  assert.ok(enviados.every((e) => e.to === YO));
});

test('por nombre: avisa, conversa con el trabajador y le contesta', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  assert.deepEqual(chats, [{ id: 'pm', texto: '¿cómo va el equipo?' }]);
  assert.deepEqual(textos(enviados), ['⏳ Se lo paso a PM…', '*PM:* respuesta de pm']);
});

test('por nombre también puede forzar el ciclo si la IA lo indica', async () => {
  const { r, enviados, ciclos } = setup({ enrutarConIA: async () => ({ agentId: 'revisor-prs', accion: 'forzar_ciclo', duda: [] }) });
  await r.procesar(msg('m1', 'Revisor, revisa los PRs ahora'));
  assert.deepEqual(ciclos, ['revisor-prs']);
  assert.deepEqual(textos(enviados), ['⏳ Le pido a Revisor de PRs que corra su ciclo ahora…', '*Revisor de PRs:* ✅ Ciclo terminado: ciclo de revisor-prs listo']);
});

test('sin nombre: la IA elige al trabajador', async () => {
  const { r, chats, rutas } = setup({ enrutarConIA: async (texto, lista) => ({ agentId: 'cotizador', accion: 'chat', duda: [], _n: lista.length }) });
  await r.procesar(msg('m1', 'Cotiza una app de citas'));
  assert.deepEqual(chats, [{ id: 'cotizador', texto: 'Cotiza una app de citas' }]);
  assert.equal(rutas.length, 0);
});

test('con duda pregunta, y al contestar con el nombre usa el mensaje anterior', async () => {
  const { r, enviados, chats } = setup({ enrutarConIA: async () => ({ agentId: null, accion: 'chat', duda: ['buscador-tendencias', 'buscador-prospectos'] }) });
  await r.procesar(msg('m1', 'Búscame algo nuevo'));
  assert.match(textos(enviados)[0], /\*Buscador de Tendencias\*.*\*Buscador de Prospectos\*/s);
  await r.procesar(msg('m2', 'Buscador de Prospectos'));
  assert.deepEqual(chats, [{ id: 'buscador-prospectos', texto: 'Búscame algo nuevo' }]);
});

test('sin nombre ni duda: explica cómo dirigir el mensaje', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', 'algo'));
  assert.equal(chats.length, 0);
  assert.match(textos(enviados)[0], /Empieza tu mensaje con el nombre/);
  assert.match(textos(enviados)[0], /Revisor de PRs/);
});

test('seguimiento: en 15 min sigue con el mismo trabajador sin preguntar a la IA', async () => {
  const { r, chats, rutas, reloj } = setup();
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  const rutasTrasNombre = rutas.length;
  reloj.avanzar(10 * 60 * 1000);
  await r.procesar(msg('m2', '¿y ayer?'));
  assert.deepEqual(chats[1], { id: 'pm', texto: '¿y ayer?' });
  assert.equal(rutas.length, rutasTrasNombre);
  reloj.avanzar(16 * 60 * 1000);
  await r.procesar(msg('m3', '¿y hoy?'));
  assert.equal(rutas.length, rutasTrasNombre + 1);
});

test('audio: transcribe, confirma lo entendido y responde también con nota de voz', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'MED1' }));
  assert.deepEqual(chats, [{ id: 'pm', texto: 'cómo va el equipo' }]);
  assert.deepEqual(enviados.map((e) => e.tipo), ['texto', 'texto', 'texto', 'audio']);
  assert.equal(enviados[0].texto, '🎙️ Entendí: "PM, cómo va el equipo"');
  assert.equal(enviados[3].audio, 'voz:respuesta de pm');
});

test('audio: si falla la voz manda solo texto; si falla la transcripción lo dice', async () => {
  const sinVoz = setup({ voz: { transcribir: async () => 'PM hola', sintetizar: async () => { throw new Error('tts caído'); } } });
  await sinVoz.r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'X' }));
  assert.ok(sinVoz.enviados.every((e) => e.tipo === 'texto'));
  assert.equal(textos(sinVoz.enviados).at(-1), '*PM:* respuesta de pm');
  const sinOido = setup({ voz: { transcribir: async () => { throw new Error('ruido'); }, sintetizar: async () => Buffer.from('') } });
  await sinOido.r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'X' }));
  assert.deepEqual(textos(sinOido.enviados), ['⚠️ No pude entender el audio: ruido']);
});

test('otros tipos y errores del trabajador se explican', async () => {
  const { r, enviados } = setup({ chatDe: async () => { throw new Error('boom'); } });
  await r.procesar(msg('m1', '', { tipo: 'otro' }));
  await r.procesar(msg('m2', 'PM hola'));
  assert.equal(textos(enviados)[0], 'Por ahora solo entiendo texto y audios 🙂');
  assert.equal(textos(enviados).at(-1), '⚠️ No pude completar tu pedido con PM: boom');
});

test('comandos: pendientes, aprobar y descartar por número corto', async () => {
  const { r, enviados, aprob } = setup();
  const a1 = aprob.proponer(ITEM);
  const a2 = aprob.proponer({ ...ITEM, titulo: 'Facebook · ana' });
  await r.procesar(msg('m1', 'pendientes'));
  assert.match(textos(enviados).at(-1), /Tienes 2 pendiente\(s\)/);
  assert.match(textos(enviados).at(-1), /#1.*Instagram · carla.*#2.*Facebook · ana/s);
  await r.procesar(msg('m2', 'aprobar 1'));
  assert.equal(aprob.list({ estado: 'aprobado' })[0].id, a1.id);
  assert.equal(textos(enviados).at(-1), '✅ #1 aprobado y ejecutado.');
  await r.procesar(msg('m3', 'Descartar #2'));
  assert.equal(aprob.list({ estado: 'descartado' })[0].id, a2.id);
  assert.equal(textos(enviados).at(-1), '🗑️ #2 descartado.');
  await r.procesar(msg('m4', 'aprobar 9'));
  assert.match(textos(enviados).at(-1), /No encuentro el pendiente #9/);
  await r.procesar(msg('m5', 'pendientes'));
  assert.equal(textos(enviados).at(-1), 'No hay pendientes ✨');
});

test('avisos dentro de la ventana de 24 h se mandan al momento con número corto', async () => {
  const { r, enviados, aprob } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  const item = aprob.proponer(ITEM);
  await r.avisarAprobacion(item);
  assert.match(textos(enviados).at(-1), /✋ #1 · respuestas-redes — Instagram · carla/);
  assert.match(textos(enviados).at(-1), /aprobar 1/);
});

test('fuera de la ventana sin plantilla: se acumulan y llegan al volver a escribir', async () => {
  const { r, enviados, aprob, reloj } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  reloj.avanzar(25 * 3600 * 1000);
  const antes = enviados.length;
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.equal(enviados.length, antes);
  await r.procesar(msg('m2', 'PM hola'));
  assert.match(enviados[antes].texto, /Mientras no estabas llegaron 1 pendiente/);
});

test('fuera de la ventana con plantilla: una sola plantilla por periodo', async () => {
  const { r, enviados, aprob, reloj } = setup({ plantilla: { nombre: 'aviso_pendientes', idioma: 'es_MX' } });
  await r.procesar(msg('m1', 'pendientes'));
  reloj.avanzar(25 * 3600 * 1000);
  await r.avisarAprobacion(aprob.proponer(ITEM));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  const plantillas = enviados.filter((e) => e.tipo === 'plantilla');
  assert.equal(plantillas.length, 1);
  assert.deepEqual(plantillas[0], { to: YO, tipo: 'plantilla', nombre: 'aviso_pendientes', idioma: 'es_MX', params: ['1'] });
});

test('los números cortos vuelven a 1 cuando ya no hay pendientes', async () => {
  const { r, enviados, aprob } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  await r.procesar(msg('m2', 'descartar 1'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.match(textos(enviados).at(-1), /✋ #1 /);
});

test('estado dañado se respalda y el canal sigue funcionando', async () => {
  const { r, deps, chats } = setup();
  fs.writeFileSync(deps.estadoPath, '{roto');
  const r2 = createRecepcionWhatsapp(deps);
  await r2.procesar(msg('m1', 'PM hola'));
  assert.equal(chats.length, 1);
  assert.ok(fs.readdirSync(path.dirname(deps.estadoPath)).some((f) => f.includes('.corrupto-')));
  assert.ok(r);
});

test('estadoCanal enmascara números e indica la ventana', async () => {
  const { r } = setup();
  assert.deepEqual(r.estadoCanal(), { permitidos: ['…0000'], ventanas: { '…0000': false } });
  await r.procesar(msg('m1', 'pendientes'));
  assert.deepEqual(r.estadoCanal().ventanas, { '…0000': true });
});

test('crearEnrutadorIA valida la respuesta del modelo', async () => {
  const conRespuesta = (raw) => crearEnrutadorIA({ createChatCompletion: async ({ messages }) => {
    assert.match(messages[1].content, /cotizador/);
    return raw;
  }, apiKey: 'k', model: 'm' });
  assert.deepEqual(await conRespuesta('{"agentId":"cotizador","accion":"chat","duda":[]}')('cotiza', AGENTES), { agentId: 'cotizador', accion: 'chat', duda: [] });
  assert.deepEqual(await conRespuesta('ok {"agentId":"revisor-prs","accion":"forzar_ciclo"}')('x', AGENTES), { agentId: 'revisor-prs', accion: 'forzar_ciclo', duda: [] });
  assert.deepEqual(await conRespuesta('{"agentId":"nadie","accion":"chat","duda":["pm","fantasma"]}')('x', AGENTES), { agentId: null, accion: 'chat', duda: ['pm'] });
  assert.deepEqual(await conRespuesta('no sé')('x', AGENTES), { agentId: null, accion: 'chat', duda: [] });
});
```

- [ ] **Step 2: Run** `node --test test/recepcionWhatsapp.test.js` → FAIL (`Cannot find module`).

- [ ] **Step 3: Implement** — crea `backend/lib/recepcionWhatsapp.js`:

```js
const fs = require('fs');
const path = require('path');

/**
 * Recepción del canal de WhatsApp: decide qué hacer con cada mensaje del fundador.
 * Comandos (pendientes / aprobar N / descartar N / ayuda), ruteo al trabajador (por nombre,
 * seguimiento de 15 min o IA), conversación o ciclo forzado, respuesta en texto y voz, y avisos
 * de la bandeja de aprobaciones respetando la ventana de 24 h de WhatsApp.
 */
const SEGUIMIENTO_MS = 15 * 60 * 1000;
const VENTANA_MS = 24 * 3600 * 1000;
const MAX_VISTOS = 500;
const ABIERTOS = ['por_aprobar', 'error'];

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** "PM, ¿cómo va?" → { agente: PM, resto: "¿cómo va?" }. Acepta nombre completo o primera palabra única. */
function detectarPorNombre(texto, agentes) {
  const original = String(texto || '').normalize('NFC').trimStart();
  const t = normalizar(original);
  const primeras = {};
  agentes.forEach((a) => {
    const p = normalizar(a.label).split(/\s+/)[0];
    primeras[p] = (primeras[p] || 0) + 1;
  });
  const candidatos = [];
  agentes.forEach((a) => {
    const completo = normalizar(a.label);
    candidatos.push({ agente: a, c: completo });
    const p = completo.split(/\s+/)[0];
    if (p !== completo && p.length >= 2 && primeras[p] === 1) candidatos.push({ agente: a, c: p });
  });
  candidatos.sort((x, y) => y.c.length - x.c.length);
  for (const { agente, c } of candidatos) {
    if (t.startsWith(c) && !/[a-z0-9ñ]/.test(t.charAt(c.length))) {
      return { agente, resto: original.slice(c.length).replace(/^[\s,:;.\-–—]+/, '').trim() };
    }
  }
  return null;
}

/** Enrutador con IA (sin herramientas): a qué trabajador va el mensaje y si es chat o ciclo. */
function crearEnrutadorIA({ createChatCompletion, apiKey, model }) {
  return async function enrutarConIA(texto, agentes) {
    const ids = agentes.map((a) => a.id);
    let raw = '';
    try {
      raw = await createChatCompletion({
        apiKey,
        model,
        messages: [
          {
            role: 'system',
            content:
              'Eres la recepción de la oficina virtual de Intelekia. Decide a qué trabajador va el mensaje del fundador ' +
              'y si quiere conversar ("chat") o que el trabajador corra su ciclo automático ahora ("forzar_ciclo", p. ej. ' +
              '"revisa los PRs ahora", "genera las ideas de hoy"). Responde SOLO JSON: ' +
              '{"agentId": "id o null", "accion": "chat" | "forzar_ciclo", "duda": ["id1", "id2"]}. ' +
              'Si dos o más trabajadores encajan igual de bien, usa agentId null y pon sus ids en duda.',
          },
          { role: 'user', content: `Trabajadores (JSON):\n${JSON.stringify(agentes)}\n\nMensaje del fundador:\n${texto}` },
        ],
      });
    } catch {
      return { agentId: null, accion: 'chat', duda: [] };
    }
    try {
      const s = String(raw || '');
      const d = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      return {
        agentId: ids.includes(d.agentId) ? d.agentId : null,
        accion: d.accion === 'forzar_ciclo' ? 'forzar_ciclo' : 'chat',
        duda: (Array.isArray(d.duda) ? d.duda : []).filter((id) => ids.includes(id)).slice(0, 3),
      };
    } catch {
      return { agentId: null, accion: 'chat', duda: [] };
    }
  };
}

function estadoVacio() {
  return { ultimoMensaje: {}, vistos: [], numeros: {}, siguienteNumero: 1, cola: {}, ultimoAgente: {}, sinRuta: {}, plantillaEnviadaEn: {} };
}

function enmascarar(numero) {
  return `…${String(numero).slice(-4)}`;
}

function createRecepcionWhatsapp({
  whatsapp,
  voz,
  estadoPath,
  permitidos = [],
  agentes,
  chatDe,
  forzarCiclo,
  aprobaciones,
  enrutarConIA,
  labelOf = (id) => id,
  registrar = () => {},
  plantilla = null,
  now = () => new Date(),
}) {
  function cargar() {
    if (!fs.existsSync(estadoPath)) return estadoVacio();
    try {
      return { ...estadoVacio(), ...JSON.parse(fs.readFileSync(estadoPath, 'utf-8')) };
    } catch {
      const respaldo = `${estadoPath}.corrupto-${now().getTime()}`;
      try {
        fs.renameSync(estadoPath, respaldo);
      } catch {
        // si no se puede respaldar, se sigue con estado vacío
      }
      registrar(null, 'error', `WhatsApp: el estado estaba dañado; lo respaldé en ${respaldo}`);
      return estadoVacio();
    }
  }

  const estado = cargar();

  function guardar() {
    fs.mkdirSync(path.dirname(estadoPath), { recursive: true });
    const tmp = `${estadoPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(estado, null, 2));
    fs.renameSync(tmp, estadoPath);
  }

  const reciente = (iso, ms) => Boolean(iso) && now().getTime() - Date.parse(iso) < ms;
  const ventanaAbierta = (num) => reciente(estado.ultimoMensaje[num], VENTANA_MS);

  async function responder(num, texto) {
    try {
      await whatsapp.enviarTexto(num, texto);
    } catch (err) {
      registrar(null, 'error', `WhatsApp: no pude enviar un mensaje (${err.message})`);
    }
  }

  // ---------- Pendientes (números cortos) ----------
  function abiertos() {
    return aprobaciones.list({ limite: 500 }).filter((i) => ABIERTOS.includes(i.estado));
  }

  function limpiarNumeros() {
    const ids = new Set(abiertos().map((i) => i.id));
    Object.entries(estado.numeros).forEach(([n, id]) => {
      if (!ids.has(id)) delete estado.numeros[n];
    });
    if (!Object.keys(estado.numeros).length) estado.siguienteNumero = 1;
  }

  function numeroDe(id) {
    const existente = Object.entries(estado.numeros).find(([, v]) => v === id);
    if (existente) return Number(existente[0]);
    const n = estado.siguienteNumero;
    estado.siguienteNumero += 1;
    estado.numeros[n] = id;
    return n;
  }

  function formatoAviso(n, item) {
    const lineas = [`✋ #${n} · ${labelOf(item.agentId)} — ${item.titulo}`];
    if (item.contexto?.comentario) lineas.push(`«${item.contexto.comentario}»`);
    lineas.push(`Propone: ${item.propuesta || '(sin texto)'}`);
    if (item.estado === 'error' && item.error) lineas.push(`Falló: ${item.error}`);
    else if (item.motivo) lineas.push(`Motivo: ${item.motivo}`);
    lineas.push(`Contesta *aprobar ${n}* o *descartar ${n}*.`);
    return lineas.join('\n');
  }

  async function entregarCola(num) {
    const ids = estado.cola[num];
    if (!ids || !ids.length) return;
    delete estado.cola[num];
    limpiarNumeros();
    const items = abiertos().filter((i) => ids.includes(i.id));
    if (items.length) {
      const avisos = items.map((i) => formatoAviso(numeroDe(i.id), i)).join('\n\n');
      await responder(num, `Mientras no estabas llegaron ${items.length} pendiente(s):\n\n${avisos}`);
    }
    guardar();
  }

  async function avisarAprobacion(item) {
    limpiarNumeros();
    const n = numeroDe(item.id);
    guardar();
    for (const num of permitidos) {
      if (ventanaAbierta(num)) {
        await responder(num, formatoAviso(n, item));
        continue;
      }
      estado.cola[num] = [...new Set([...(estado.cola[num] || []), item.id])];
      const yaAvisado = estado.plantillaEnviadaEn[num] && estado.plantillaEnviadaEn[num] > (estado.ultimoMensaje[num] || '');
      if (plantilla?.nombre && !yaAvisado) {
        try {
          await whatsapp.enviarPlantilla(num, plantilla.nombre, plantilla.idioma || 'es_MX', [String(estado.cola[num].length)]);
          estado.plantillaEnviadaEn[num] = now().toISOString();
        } catch (err) {
          registrar(null, 'error', `WhatsApp: no pude mandar la plantilla de aviso (${err.message})`);
        }
      }
      guardar();
    }
  }

  // ---------- Comandos ----------
  async function comando(num, texto) {
    const t = normalizar(texto).trim();
    if (/^(pendientes?|aprobaciones)$/.test(t)) {
      limpiarNumeros();
      const items = abiertos();
      const cuerpo = items.length
        ? `Tienes ${items.length} pendiente(s):\n\n${items.map((i) => formatoAviso(numeroDe(i.id), i)).join('\n\n')}`
        : 'No hay pendientes ✨';
      guardar();
      await responder(num, cuerpo);
      return true;
    }
    if (/^(ayuda|\?)$/.test(t)) {
      const nombres = agentes().map((a) => a.label).join(', ');
      await responder(
        num,
        'Escríbeme o mándame un audio. Empieza con el nombre del trabajador para ir directo (p. ej. "PM, ¿cómo va el equipo?"); ' +
          'si no, yo elijo. También: *pendientes*, *aprobar N*, *descartar N*.\n' +
          `Trabajadores: ${nombres}`
      );
      return true;
    }
    const m = t.match(/^(aprobar|aprueba|descartar|descarta)\s+#?(\d+)$/);
    if (!m) return false;
    const n = Number(m[2]);
    limpiarNumeros();
    const id = estado.numeros[n];
    guardar();
    if (!id) {
      await responder(num, `No encuentro el pendiente #${n}. Escribe *pendientes* para ver la lista.`);
      return true;
    }
    const aprobar = m[1].startsWith('aprob');
    try {
      if (aprobar) {
        const r = await aprobaciones.aprobar(id);
        await responder(num, r.estado === 'aprobado' ? `✅ #${n} aprobado y ejecutado.` : `⚠️ #${n} falló: ${r.error}`);
      } else {
        aprobaciones.descartar(id);
        await responder(num, `🗑️ #${n} descartado.`);
      }
    } catch (err) {
      await responder(num, `⚠️ No pude ${aprobar ? 'aprobar' : 'descartar'} #${n}: ${err.message}`);
    }
    return true;
  }

  // ---------- Ruteo ----------
  async function rutear(num, texto) {
    const lista = agentes();
    const directo = detectarPorNombre(texto, lista);
    if (directo) {
      let resto = directo.resto;
      const previo = estado.sinRuta[num];
      if (!resto && previo && reciente(previo.at, SEGUIMIENTO_MS)) resto = previo.texto;
      delete estado.sinRuta[num];
      if (!resto) {
        await responder(num, `¿Qué le digo a ${directo.agente.label}?`);
        return null;
      }
      let accion = 'chat';
      try {
        const r = await enrutarConIA(resto, [directo.agente]);
        if (r?.accion === 'forzar_ciclo') accion = 'forzar_ciclo';
      } catch {
        // si la IA falla, se conversa
      }
      return { agentId: directo.agente.id, accion, texto: resto };
    }

    const ultimo = estado.ultimoAgente[num];
    if (ultimo && reciente(ultimo.at, SEGUIMIENTO_MS) && lista.some((a) => a.id === ultimo.agentId)) {
      return { agentId: ultimo.agentId, accion: 'chat', texto };
    }

    let r = { agentId: null, accion: 'chat', duda: [] };
    try {
      r = (await enrutarConIA(texto, lista)) || r;
    } catch {
      // se pregunta al fundador
    }
    if (r.agentId && lista.some((a) => a.id === r.agentId)) return { agentId: r.agentId, accion: r.accion, texto };

    estado.sinRuta[num] = { texto, at: now().toISOString() };
    guardar();
    const duda = (r.duda || []).map((id) => lista.find((a) => a.id === id)).filter(Boolean);
    if (duda.length >= 2) {
      await responder(num, `¿A quién se lo paso: ${duda.map((a) => `*${a.label}*`).join(' o ')}? Contesta con su nombre.`);
    } else {
      await responder(num, `No supe a quién pasárselo. Empieza tu mensaje con el nombre del trabajador: ${lista.map((a) => a.label).join(', ')}.`);
    }
    return null;
  }

  async function responderAgente(num, label, texto, conVoz) {
    await responder(num, `*${label}:* ${texto}`);
    if (!conVoz) return;
    try {
      await whatsapp.enviarAudio(num, await voz.sintetizar(texto));
    } catch (err) {
      registrar(null, 'error', `WhatsApp: no pude generar la nota de voz (${err.message})`);
    }
  }

  async function ejecutar(num, { agentId, accion, texto }, conVoz) {
    const label = labelOf(agentId);
    estado.ultimoAgente[num] = { agentId, at: now().toISOString() };
    guardar();
    registrar(agentId, 'chat', `📱 WhatsApp: ${texto}`);
    if (accion === 'forzar_ciclo') {
      await responder(num, `⏳ Le pido a ${label} que corra su ciclo ahora…`);
      try {
        await responderAgente(num, label, `✅ Ciclo terminado: ${await forzarCiclo(agentId)}`, conVoz);
      } catch (err) {
        await responder(num, `⚠️ ${label} no pudo correr su ciclo: ${err.message}`);
      }
      return;
    }
    await responder(num, `⏳ Se lo paso a ${label}…`);
    try {
      await responderAgente(num, label, await chatDe(agentId, texto), conVoz);
    } catch (err) {
      await responder(num, `⚠️ No pude completar tu pedido con ${label}: ${err.message}`);
    }
  }

  async function procesar(m) {
    if (!m?.id || estado.vistos.includes(m.id)) return;
    estado.vistos.push(m.id);
    estado.vistos = estado.vistos.slice(-MAX_VISTOS);
    if (!permitidos.includes(m.de)) {
      guardar();
      registrar(null, 'error', `WhatsApp: ignoré un mensaje de un número no permitido (${enmascarar(m.de)})`);
      return;
    }
    const num = m.de;
    estado.ultimoMensaje[num] = now().toISOString();
    guardar();
    await entregarCola(num);

    if (m.tipo === 'otro') {
      await responder(num, 'Por ahora solo entiendo texto y audios 🙂');
      return;
    }
    let texto = m.texto;
    const fueAudio = m.tipo === 'audio';
    if (fueAudio) {
      try {
        const { buffer, mime } = await whatsapp.descargarMedia(m.mediaId);
        texto = await voz.transcribir(buffer, mime);
      } catch (err) {
        await responder(num, `⚠️ No pude entender el audio: ${err.message}`);
        return;
      }
      await responder(num, `🎙️ Entendí: "${texto}"`);
    }
    texto = String(texto || '').trim();
    if (!texto) return;
    if (await comando(num, texto)) return;
    const ruta = await rutear(num, texto);
    if (ruta) await ejecutar(num, ruta, fueAudio);
  }

  function estadoCanal() {
    return {
      permitidos: permitidos.map(enmascarar),
      ventanas: Object.fromEntries(permitidos.map((n) => [enmascarar(n), ventanaAbierta(n)])),
    };
  }

  return { procesar, avisarAprobacion, estadoCanal };
}

module.exports = { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre, normalizar };
```

- [ ] **Step 4: Verify** `node --test test/recepcionWhatsapp.test.js` → PASS (19); `npm test` → todo pasa.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/recepcionWhatsapp.js backend/test/recepcionWhatsapp.test.js
git commit -m "Add the WhatsApp reception: commands, routing, follow-ups, voice replies and approval notices"
```

---

### Task 4: Webhook y conexión en el servidor

**Files:**
- Create: `backend/routes/whatsapp.js`
- Modify: `backend/server.js`, `.gitignore`
- Test: `backend/test/whatsappRoute.test.js`

**Interfaces:**
- Consumes: Tasks 1–3; `chatHandlers`, `scheduler.runOne`, `readStatus(STATUS_PATH)`, `profiles.getProfile(id).rol`, `actividad.log`, `createChatCompletion` de `lib/openaiClient`.
- Produces: `createWhatsappRouter({ whatsapp, recepcion, config, registrar }) -> express.Router` con `GET /webhook/whatsapp`, `POST /webhook/whatsapp`, `GET /api/whatsapp/estado`.

- [ ] **Step 1: Failing test** — crea `backend/test/whatsappRoute.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { createWhatsapp } = require('../lib/whatsapp');
const { createWhatsappRouter } = require('../routes/whatsapp');

const CONFIG = { token: 't', phoneNumberId: 'p', verifyToken: 'palabra', appSecret: 'secreto', permitidos: ['5218710000000'] };

async function levantar(recepcion, config = CONFIG) {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  const registros = [];
  app.use(createWhatsappRouter({ whatsapp: createWhatsapp({ config }), recepcion, config, registrar: (...a) => registros.push(a) }));
  const server = app.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}`, server, registros };
}

const PAYLOAD = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '5218710000000', timestamp: '1', type: 'text', text: { body: 'PM hola' } }] } }] }] };
const firmar = (body) => `sha256=${crypto.createHmac('sha256', 'secreto').update(body).digest('hex')}`;

test('GET verifica el webhook con el verify token', async () => {
  const { url, server } = await levantar({ procesar: async () => {}, estadoCanal: () => ({}) });
  try {
    const ok = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=palabra&hub.challenge=123`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '123');
    const mal = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=123`);
    assert.equal(mal.status, 403);
  } finally {
    server.close();
  }
});

test('POST con firma válida responde 200 y procesa en segundo plano; firma inválida → 401', async () => {
  const procesados = [];
  const { url, server, registros } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({ permitidos: ['…0000'] }) });
  try {
    const body = JSON.stringify(PAYLOAD);
    const ok = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(Buffer.from(body)) }, body });
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(procesados.map((m) => [m.id, m.texto]), [['m1', 'PM hola']]);
    const mal = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' }, body });
    assert.equal(mal.status, 401);
    assert.match(registros.at(-1)[2], /firma inválida/);
    const estado = await (await fetch(`${url}/api/whatsapp/estado`)).json();
    assert.deepEqual(estado, { ok: true, permitidos: ['…0000'] });
  } finally {
    server.close();
  }
});

test('sin configuración completa responde 200 pero no procesa', async () => {
  const procesados = [];
  const config = { ...CONFIG, token: '' };
  const { url, server } = await levantar({ procesar: async (m) => procesados.push(m), estadoCanal: () => ({}) }, config);
  try {
    const body = JSON.stringify(PAYLOAD);
    const res = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(Buffer.from(body)) }, body });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(procesados.length, 0);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run** `node --test test/whatsappRoute.test.js` → FAIL.

- [ ] **Step 3: Implement** — crea `backend/routes/whatsapp.js`:

```js
const express = require('express');

/**
 * Webhook de la WhatsApp Cloud API: verificación de Meta (GET) y mensajes entrantes (POST).
 * El POST responde 200 de inmediato (Meta reintenta si tarda) y procesa en segundo plano.
 */
function createWhatsappRouter({ whatsapp, recepcion, config, registrar = () => {} }) {
  const router = express.Router();

  router.get('/webhook/whatsapp', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && config.verifyToken && req.query['hub.verify_token'] === config.verifyToken;
    if (!ok) return res.sendStatus(403);
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  });

  router.post('/webhook/whatsapp', (req, res) => {
    if (!whatsapp.verificarFirma(req.rawBody, req.get('x-hub-signature-256'))) {
      registrar(null, 'error', 'WhatsApp: llegó una llamada al webhook con firma inválida');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    if (!whatsapp.estado().ok) return undefined;
    whatsapp.extraerMensajes(req.body).forEach((mensaje) => {
      Promise.resolve()
        .then(() => recepcion.procesar(mensaje))
        .catch((err) => registrar(null, 'error', `WhatsApp: ${err.message}`));
    });
    return undefined;
  });

  router.get('/api/whatsapp/estado', (req, res) => {
    res.json({ ...whatsapp.estado(), ...recepcion.estadoCanal() });
  });

  return router;
}

module.exports = { createWhatsappRouter };
```

`backend/server.js` (léelo primero):
- Requires junto a los demás:

```js
const { createWhatsapp } = require('./lib/whatsapp');
const { createVoz } = require('./lib/voz');
const { createRecepcionWhatsapp, crearEnrutadorIA } = require('./lib/recepcionWhatsapp');
const { createWhatsappRouter } = require('./routes/whatsapp');
```

- Cambia `app.use(express.json());` por:

```js
// Se guarda el cuerpo crudo para verificar la firma del webhook de WhatsApp.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
```

- Después de crear `scheduler` (necesita `chatHandlers` y `scheduler`) y antes de `const app = express();`:

```js
// Canal de WhatsApp: el fundador le escribe a la oficina (texto o audio).
const whatsapp = createWhatsapp({ config: config.whatsapp });
const voz = createVoz({ apiKey: config.openaiApiKey, voz: config.whatsapp.voz });
function registrarWhatsapp(agentId, tipo, texto) {
  if (agentId) actividad.log(agentId, tipo, texto);
  else console.warn(texto);
}
function agentesParaWhatsapp() {
  return departments
    .flatMap((d) => d.agents)
    .filter((a) => chatHandlers[a.id])
    .map((a) => {
      let rol = '';
      try {
        rol = String(profiles.getProfile(a.id).rol || '').slice(0, 300);
      } catch {
        rol = '';
      }
      return { id: a.id, label: a.label, rol };
    });
}
const recepcionWhatsapp = createRecepcionWhatsapp({
  whatsapp,
  voz,
  estadoPath: path.join(__dirname, 'state', 'whatsapp.json'),
  permitidos: config.whatsapp.permitidos,
  agentes: agentesParaWhatsapp,
  chatDe: async (agentId, texto) => {
    const handler = chatHandlers[agentId];
    if (!handler) throw new Error(`No existe el trabajador ${agentId}`);
    const result = await handler({ message: texto });
    return result.reply;
  },
  forzarCiclo: async (agentId) => {
    await scheduler.runOne(agentId);
    return readStatus(STATUS_PATH)[agentId]?.ultimaAccion || 'Listo';
  },
  aprobaciones,
  enrutarConIA: crearEnrutadorIA({ createChatCompletion, apiKey: config.openaiApiKey, model: config.openaiModel }),
  labelOf: (id) => departments.flatMap((d) => d.agents).find((a) => a.id === id)?.label || id,
  registrar: registrarWhatsapp,
  plantilla: config.whatsapp.plantillaAviso ? { nombre: config.whatsapp.plantillaAviso, idioma: config.whatsapp.plantillaIdioma } : null,
});
aprobaciones.suscribir((item) => recepcionWhatsapp.avisarAprobacion(item));
```

  (`createChatCompletion` ya se importa de `./lib/openaiClient` en server.js; es la función sin herramientas. `readStatus` y `STATUS_PATH` ya existen.)

- Con las demás rutas (antes de `express.static`):

```js
app.use(createWhatsappRouter({ whatsapp, recepcion: recepcionWhatsapp, config: config.whatsapp, registrar: registrarWhatsapp }));
```

`.gitignore` (raíz): agrega `backend/state/whatsapp.json`.

- [ ] **Step 4: Verify** — `node --test test/whatsappRoute.test.js` → PASS; `npm test` → todo pasa. Smoke desde `backend/`: `PORT=3995 node server.js` en segundo plano, `curl -s "localhost:3995/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"` → 403 (sin config), `curl -s localhost:3995/api/whatsapp/estado` → `{"ok":false,"motivo":"Falta configurar…", …}`; detener el servidor y confirmar que el puerto quedó libre. No stagear `backend/state`.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/whatsapp.js backend/test/whatsappRoute.test.js backend/server.js .gitignore
git commit -m "Wire the WhatsApp channel: webhook, reception, routing to workers and approval notices"
```

---

### Task 5: Validación en vivo (requiere al fundador)

- [ ] **Step 1:** En developers.facebook.com crear (o usar) la app tipo Empresa, agregar el producto **WhatsApp**, registrar el número de la oficina y crear un **usuario del sistema** con token permanente (`whatsapp_business_messaging`, `whatsapp_business_management`). Copiar Phone Number ID y App Secret.
- [ ] **Step 2:** Instalar ngrok, reclamar el dominio fijo gratuito y correr `ngrok http --url=<dominio> 3000`.
- [ ] **Step 3:** En `backend/.env`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (inventado), `WHATSAPP_APP_SECRET`, `WHATSAPP_PERMITIDOS` (número del fundador). Reiniciar.
- [ ] **Step 4:** En Meta → WhatsApp → Configuración → Webhook: URL `https://<dominio>/webhook/whatsapp`, verify token, suscribir `messages`.
- [ ] **Step 5:** Probar: texto "PM, ¿cómo va el equipo?", audio, un mensaje sin nombre, "Revisor, revisa los PRs ahora", `pendientes`, `aprobar N`. Anotar resultados en el spec ("Validación en vivo") y commitear.
