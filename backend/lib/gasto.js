const fs = require('fs');
const path = require('path');

/**
 * Medidor del gasto diario en OpenAI (estimado a partir de los tokens y del audio) con un límite opcional.
 * Al llegar al límite se frenan los ciclos AUTOMÁTICOS hasta el día siguiente (el chat y WhatsApp siguen).
 * Se acumula por día local (zona de la oficina) en state/gasto.json; se conservan los últimos 31 días.
 * Nunca lanza errores al registrar: un medidor no debe tumbar a los agentes.
 */

// USD por 1M de tokens (entrada / salida). Se busca por el prefijo más largo del nombre del modelo.
const PRECIOS_TOKENS = Object.freeze({
  'gpt-4o-mini': { entrada: 0.15, salida: 0.6 },
  'gpt-4o': { entrada: 2.5, salida: 10 },
  'gpt-4.1-mini': { entrada: 0.4, salida: 1.6 },
  'gpt-4.1-nano': { entrada: 0.1, salida: 0.4 },
  'gpt-4.1': { entrada: 2.0, salida: 8.0 },
});
// Modelo desconocido → precios de gpt-4o (estimación conservadora).
const MODELO_RESPALDO = 'gpt-4o';
const PRECIOS_AUDIO = Object.freeze({
  transcripcionPorMinuto: 0.003, // USD por minuto de audio transcrito
  vozPorMilCaracteres: 0.015, // USD por cada 1000 caracteres leídos en voz alta
});
const DIAS_GUARDADOS = 31;

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function createGasto({ filePath, now = () => new Date(), timeZone = 'America/Monterrey', precios = {}, alExceder = () => {} } = {}) {
  const tablaTokens = { ...PRECIOS_TOKENS, ...(precios.tokens || {}) };
  const audio = { ...PRECIOS_AUDIO, ...(precios.audio || {}) };
  const prefijos = Object.keys(tablaTokens).sort((a, b) => b.length - a.length);
  const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

  function leer() {
    const vacio = { limiteUsd: null, avisadoEn: null, dias: {} };
    if (!filePath || !fs.existsSync(filePath)) return vacio;
    try {
      const datos = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!datos || typeof datos !== 'object') return vacio;
      return {
        limiteUsd: numero(datos.limiteUsd) || null,
        avisadoEn: typeof datos.avisadoEn === 'string' ? datos.avisadoEn : null,
        dias: datos.dias && typeof datos.dias === 'object' && !Array.isArray(datos.dias) ? datos.dias : {},
      };
    } catch {
      return vacio;
    }
  }

  let datos = leer();

  function guardar() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
    fs.renameSync(tmp, filePath);
  }

  /** Fecha local YYYY-MM-DD en la zona de la oficina. */
  const fechaLocal = (fecha = now()) => formatoDia.format(fecha);

  function precioDe(model) {
    const nombre = String(model || '').toLowerCase();
    const clave = prefijos.find((p) => nombre.startsWith(p)) || MODELO_RESPALDO;
    return tablaTokens[clave] || PRECIOS_TOKENS[MODELO_RESPALDO];
  }

  function dia(fecha) {
    const d = datos.dias[fecha] || {};
    return { usd: numero(d.usd), llamadas: numero(d.llamadas), tokensEntrada: numero(d.tokensEntrada), tokensSalida: numero(d.tokensSalida) };
  }

  function excedido(usd) {
    return datos.limiteUsd != null && usd >= datos.limiteUsd;
  }

  /** Avisa una sola vez por día cuando se alcanza el límite. */
  function revisarAviso(fecha) {
    if (datos.avisadoEn === fecha || !excedido(dia(fecha).usd)) return false;
    datos.avisadoEn = fecha;
    try {
      alExceder({ fecha, usd: Math.round(dia(fecha).usd * 10000) / 10000, limiteUsd: datos.limiteUsd });
    } catch {
      // El aviso es opcional: si falla no importa.
    }
    return true;
  }

  function sumar({ usd = 0, tokensEntrada = 0, tokensSalida = 0 }) {
    const fecha = fechaLocal();
    const d = dia(fecha);
    datos.dias[fecha] = {
      usd: d.usd + usd,
      llamadas: d.llamadas + 1,
      tokensEntrada: d.tokensEntrada + tokensEntrada,
      tokensSalida: d.tokensSalida + tokensSalida,
    };
    // Solo se conservan los últimos 31 días.
    const fechas = Object.keys(datos.dias).sort();
    fechas.slice(0, Math.max(0, fechas.length - DIAS_GUARDADOS)).forEach((f) => delete datos.dias[f]);
    revisarAviso(fecha);
    guardar();
  }

  /** usage = { prompt_tokens, completion_tokens } tal como lo devuelve OpenAI. */
  function registrarTokens(model, usage) {
    try {
      if (!usage || typeof usage !== 'object') return;
      const tokensEntrada = numero(usage.prompt_tokens);
      const tokensSalida = numero(usage.completion_tokens);
      const precio = precioDe(model);
      const usd = (tokensEntrada * precio.entrada + tokensSalida * precio.salida) / 1e6;
      sumar({ usd, tokensEntrada, tokensSalida });
    } catch (err) {
      console.warn(`No se pudo registrar el gasto de tokens: ${err.message}`);
    }
  }

  /** { tipo: 'transcripcion', segundos } o { tipo: 'voz', caracteres }. */
  function registrarAudio(uso) {
    try {
      if (!uso || typeof uso !== 'object') return;
      let usd;
      if (uso.tipo === 'transcripcion') usd = (numero(uso.segundos) / 60) * audio.transcripcionPorMinuto;
      else if (uso.tipo === 'voz') usd = (numero(uso.caracteres) / 1000) * audio.vozPorMilCaracteres;
      else return;
      sumar({ usd });
    } catch (err) {
      console.warn(`No se pudo registrar el gasto de audio: ${err.message}`);
    }
  }

  /** Límite diario en USD; 0 o null quitan el límite. */
  function setLimite(usd) {
    if (usd === null || usd === undefined || usd === '') {
      datos.limiteUsd = null;
    } else {
      const n = Number(usd);
      if (!Number.isFinite(n) || n < 0) throw new Error('Límite de gasto inválido (usa un número mayor o igual a 0)');
      datos.limiteUsd = n > 0 ? n : null;
    }
    // Si el nuevo límite ya está rebasado hoy, se avisa; si se sube o quita, se podrá volver a avisar hoy.
    const fecha = fechaLocal();
    if (!excedido(dia(fecha).usd) && datos.avisadoEn === fecha) datos.avisadoEn = null;
    revisarAviso(fecha);
    guardar();
    return hoy();
  }

  function hoy() {
    const fecha = fechaLocal();
    const d = dia(fecha);
    return {
      fecha,
      usd: Math.round(d.usd * 10000) / 10000,
      llamadas: d.llamadas,
      tokensEntrada: d.tokensEntrada,
      tokensSalida: d.tokensSalida,
      limiteUsd: datos.limiteUsd,
      excedido: excedido(d.usd),
    };
  }

  return { registrarTokens, registrarAudio, setLimite, hoy };
}

/**
 * Segundos estimados de una nota de voz Ogg/Opus a partir de su tamaño: las notas de WhatsApp van a
 * ~16 kbps (≈ 2000 bytes por segundo). Es una estimación para el medidor, no una medida exacta.
 */
function segundosDeAudio(bytes) {
  return numero(bytes) / 2000;
}

module.exports = { createGasto, segundosDeAudio, PRECIOS_TOKENS, PRECIOS_AUDIO };
