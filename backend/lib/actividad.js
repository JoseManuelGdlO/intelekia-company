const fs = require('fs');
const path = require('path');

/**
 * Bitácora de actividad por agente: cada paso que da mientras trabaja (inicio de ciclo,
 * "pensando", consultas a la base, a compañeros, correos, respuesta final, errores) con su
 * fecha y hora. El panel del agente la muestra en vivo.
 *
 * Tipos: inicio | pensando | nota | herramienta | resultado | chat | respuesta | fin | error
 */
const TIPOS = ['inicio', 'pensando', 'nota', 'herramienta', 'resultado', 'chat', 'respuesta', 'fin', 'error'];
const MAX_POR_AGENTE = 150;
const MAX_TEXTO = 1500;
const PERSIST_DEBOUNCE_MS = 500;

function createActividadStore({ filePath = null, now = () => new Date() } = {}) {
  let porAgente = {};
  if (filePath && fs.existsSync(filePath)) {
    try {
      porAgente = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      porAgente = {};
    }
  }
  let counter = 0;
  let timer = null;

  function persist() {
    if (!filePath || timer) return;
    timer = setTimeout(() => {
      timer = null;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(porAgente));
    }, PERSIST_DEBOUNCE_MS);
    if (timer.unref) timer.unref();
  }

  /** Registra un paso. Nunca lanza: la bitácora no debe romper el trabajo del agente. */
  function log(agentId, tipo, texto, detalle = null) {
    try {
      if (!agentId) return null;
      counter += 1;
      const evento = {
        id: `${Date.now()}-${counter}`,
        fecha: now().toISOString(),
        tipo: TIPOS.includes(tipo) ? tipo : 'nota',
        texto: String(texto ?? '').slice(0, MAX_TEXTO),
      };
      if (detalle) evento.detalle = String(detalle).slice(0, MAX_TEXTO);
      const lista = porAgente[agentId] || [];
      lista.push(evento);
      porAgente[agentId] = lista.slice(-MAX_POR_AGENTE);
      persist();
      return evento;
    } catch {
      return null;
    }
  }

  /** Eventos de un agente creados después de `desde` (ISO), del más viejo al más nuevo. */
  function list(agentId, { desde, limite = MAX_POR_AGENTE } = {}) {
    let lista = porAgente[agentId] || [];
    if (desde) lista = lista.filter((e) => e.fecha > desde);
    return lista.slice(-limite);
  }

  /** Para agentes que solo se conocen por id (p. ej. agentes "a la medida" creados en caliente). */
  function forAgent(agentId) {
    return (tipo, texto, detalle) => log(agentId, tipo, texto, detalle);
  }

  return { log, list, forAgent, TIPOS };
}

module.exports = { createActividadStore, TIPOS, MAX_POR_AGENTE };
