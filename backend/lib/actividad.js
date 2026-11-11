const fs = require('fs');
const path = require('path');
const { paginar } = require('./paginar');

/**
 * Bitácora de actividad por agente: cada paso que da mientras trabaja (inicio de ciclo,
 * "pensando", consultas a la base, a compañeros, correos, respuesta final, errores) con su
 * fecha y hora. El panel del agente la muestra en vivo.
 *
 * Tipos: inicio | pensando | nota | herramienta | resultado | chat | respuesta | fin | error
 */
const TIPOS = ['inicio', 'pensando', 'nota', 'herramienta', 'resultado', 'chat', 'respuesta', 'fin', 'error'];
const MAX_POR_AGENTE = 1000;
// Lo que devuelve list() sin `limite` (el panel en vivo no necesita más).
const LIMITE_LIST_DEFECTO = 150;
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
  function list(agentId, { desde, limite = LIMITE_LIST_DEFECTO } = {}) {
    let lista = porAgente[agentId] || [];
    if (desde) lista = lista.filter((e) => e.fecha > desde);
    return lista.slice(-limite);
  }

  /** Página de la bitácora de un agente, del más reciente al más antiguo: { eventos, total, pagina, paginas }. */
  function pagina(agentId, opciones = {}) {
    const { lista, ...meta } = paginar(porAgente[agentId] || [], opciones);
    return { eventos: lista, ...meta };
  }

  /**
   * Eventos de TODOS los agentes (cada uno con su `agentId`), del más reciente al más antiguo.
   * `desde` (ISO) descarta los anteriores; `limite` corta la lista (por defecto 50).
   */
  function recientes({ limite = 50, desde } = {}) {
    const todos = [];
    for (const [agentId, lista] of Object.entries(porAgente)) {
      for (const e of lista || []) {
        if (!desde || e.fecha > desde) todos.push({ ...e, agentId });
      }
    }
    todos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return todos.slice(0, limite);
  }

  /** Para agentes que solo se conocen por id (p. ej. agentes "a la medida" creados en caliente). */
  function forAgent(agentId) {
    return (tipo, texto, detalle) => log(agentId, tipo, texto, detalle);
  }

  return { log, list, pagina, recientes, forAgent, TIPOS };
}

module.exports = { createActividadStore, TIPOS, MAX_POR_AGENTE };
