const crypto = require('crypto');

/**
 * Avisos de "llegó un mensaje por WhatsApp" para las pantallas (oficina y TV).
 * Solo en memoria y SIN datos sensibles: ni número ni texto; a lo más, a qué trabajador se le pasó.
 */
function createAvisosWhatsapp({ max = 30, now = () => new Date() } = {}) {
  const avisos = []; // más reciente al final
  const porMensaje = new Map(); // id del mensaje de Meta → aviso

  function recibido(mensajeId) {
    const aviso = { id: crypto.randomUUID(), fecha: now().toISOString(), agentId: null };
    avisos.push(aviso);
    if (mensajeId) porMensaje.set(mensajeId, aviso);
    while (avisos.length > max) {
      const viejo = avisos.shift();
      porMensaje.forEach((a, k) => a === viejo && porMensaje.delete(k));
    }
    return aviso;
  }

  /** El mensaje ya se le pasó a un trabajador: el aviso dice para quién era. */
  function asignado(mensajeId, agentId) {
    const aviso = porMensaje.get(mensajeId);
    if (aviso) aviso.agentId = agentId || null;
  }

  /** Avisos más recientes primero (copias). Con `desde` (ISO) solo los posteriores. */
  function recientes({ desde = null, limite = max } = {}) {
    return avisos
      .filter((a) => !desde || a.fecha > desde)
      .slice(-limite)
      .reverse()
      .map((a) => ({ ...a }));
  }

  return { recibido, asignado, recientes };
}

module.exports = { createAvisosWhatsapp };
