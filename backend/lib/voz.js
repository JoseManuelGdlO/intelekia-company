/**
 * Voz para el canal de WhatsApp con OpenAI: transcribe notas de voz y genera respuestas habladas
 * (Ogg/Opus, el formato de las notas de voz de WhatsApp).
 */
const { segundosDeAudio } = require('./gasto');

const OPENAI = 'https://api.openai.com/v1';
const MAX_VOZ = 1500;

function createVoz({
  apiKey,
  fetchImpl = (...a) => fetch(...a),
  modeloTranscripcion = 'gpt-4o-mini-transcribe',
  modeloVoz = 'gpt-4o-mini-tts',
  voz = 'alloy',
  timeoutMs = 60000,
  onUso = () => {}, // medidor de gasto: recibe { tipo: 'transcripcion', segundos } o { tipo: 'voz', caracteres }
}) {
  function usar(uso) {
    try {
      onUso(uso);
    } catch {
      // El medidor nunca debe romper la voz.
    }
  }

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
    // La API no devuelve la duración: se estima por el tamaño del Ogg/Opus (ver segundosDeAudio).
    usar({ tipo: 'transcripcion', segundos: segundosDeAudio(buffer?.length ?? buffer?.byteLength) });
    return texto;
  }

  /** Quita el formato de WhatsApp y los emojis (✅/⚠️…) y recorta a ~1500 caracteres en un final de oración. */
  function recortar(texto) {
    const limpio = String(texto || '')
      .replace(/[*_~`]/g, '')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, '')
      .replace(/[ \t]+([:;,.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (limpio.length <= MAX_VOZ) return limpio;
    const corte = limpio.lastIndexOf('. ', MAX_VOZ);
    const base = corte > MAX_VOZ * 0.5 ? limpio.slice(0, corte + 1) : limpio.slice(0, MAX_VOZ);
    return `${base} El resto te lo dejé por escrito.`;
  }

  async function sintetizar(texto) {
    const input = recortar(texto);
    const res = await llamar('/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modeloVoz, voice: voz, input, response_format: 'opus' }),
    });
    const audio = Buffer.from(await res.arrayBuffer());
    usar({ tipo: 'voz', caracteres: input.length });
    return audio;
  }

  return { transcribir, sintetizar, recortar };
}

module.exports = { createVoz };
