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
