const crypto = require('crypto');

/**
 * Cliente mínimo de la WhatsApp Cloud API (Meta): enviar texto, audio y plantillas, descargar
 * audios recibidos, verificar la firma del webhook y extraer los mensajes del payload.
 */
const GRAPH = 'https://graph.facebook.com';
const MAX_TEXTO = 4000;
const TIMEOUT_MS = 20000;
const MAX_MEDIA = 16 * 1024 * 1024;
const HOSTS_MEDIA = ['.fbsbx.com', '.facebook.com', '.fbcdn.net', '.whatsapp.net'];

/** Solo dígitos; los celulares de México llegan como 521 + 10 dígitos y se envían como 52 + 10. */
function normalizarNumero(n) {
  return String(n || '')
    .replace(/\D/g, '')
    .replace(/^521(\d{10})$/, '52$1');
}

function urlMediaConfiable(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS_MEDIA.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/** Parte un texto largo en trozos de ≤ max, cortando en salto de línea o espacio cuando se puede. */
function partirTexto(texto, max = MAX_TEXTO) {
  const partes = [];
  let resto = String(texto || '').trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) {
      corte = max;
      // no partir un emoji u otro carácter fuera del BMP (par sustituto)
      const c = resto.charCodeAt(corte - 1);
      if (c >= 0xd800 && c <= 0xdbff) corte -= 1;
    }
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
    if (!res.ok || data.error) {
      const e = data.error || {};
      const extra = [
        e.code != null && `código ${e.code}${e.error_subcode != null ? `/${e.error_subcode}` : ''}`,
        e.error_data?.details,
        e.fbtrace_id && `fbtrace ${e.fbtrace_id}`,
      ].filter(Boolean);
      throw new Error(`WhatsApp: ${e.message || `respuesta ${res.status}`}${extra.length ? ` [${extra.join(' · ')}]` : ''}`);
    }
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
    for (const body of partes) await enviar({ to: normalizarNumero(to), type: 'text', text: { body, preview_url: false } });
    return partes.length;
  }

  async function enviarAudio(to, buffer, mime = 'audio/ogg') {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buffer], { type: mime }), 'respuesta.ogg');
    const { id } = await json(`${base()}/${encodeURIComponent(phoneNumberId)}/media`, { method: 'POST', body: form });
    return enviar({ to: normalizarNumero(to), type: 'audio', audio: { id } });
  }

  function enviarPlantilla(to, nombre, idioma, parametros = []) {
    const components = parametros.length ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }] : [];
    return enviar({ to: normalizarNumero(to), type: 'template', template: { name: nombre, language: { code: idioma }, components } });
  }

  async function descargarMedia(mediaId) {
    const info = await json(`${base()}/${encodeURIComponent(mediaId)}`);
    // El token solo viaja a dominios de Meta por https.
    if (!urlMediaConfiable(info.url)) throw new Error('WhatsApp: URL de descarga no confiable');
    const res = await llamar(info.url);
    if (!res.ok) throw new Error(`WhatsApp: no se pudo descargar el audio (respuesta ${res.status})`);
    const demasiado = 'WhatsApp: el audio es demasiado grande (máximo 16 MB)';
    if (Number(res.headers?.get?.('content-length') || 0) > MAX_MEDIA) throw new Error(demasiado);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_MEDIA) throw new Error(demasiado);
    return { buffer, mime: info.mime_type || 'audio/ogg' };
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

module.exports = { createWhatsapp, partirTexto, extraerMensajes, normalizarNumero, MAX_TEXTO };
