const fs = require('fs');
const path = require('path');
const { paginar } = require('./paginar');

const MAX_CONVERSACIONES = 2000;

/**
 * Bitácora de conversaciones entre agentes (quién preguntó qué a quién y qué le respondieron).
 * Se guarda en disco para sobrevivir reinicios; solo se conservan las más recientes.
 */
function createConversacionesStore({ filePath, now = () => new Date() }) {
  let items = [];
  if (fs.existsSync(filePath)) {
    try {
      items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      items = [];
    }
  }
  let counter = 0;

  function persist() {
    items = items.slice(-MAX_CONVERSACIONES);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(items));
  }

  function start({ de, para, pregunta }) {
    const fecha = now().toISOString();
    counter += 1;
    const item = {
      id: `conv-${Date.now()}-${counter}`,
      de,
      para,
      pregunta,
      respuesta: null,
      error: null,
      estado: 'en_curso',
      inicio: fecha,
      actualizado: fecha,
    };
    items.push(item);
    persist();
    return item;
  }

  function finish(id, { respuesta = null, error = null }) {
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, {
      respuesta,
      error,
      estado: error ? 'error' : 'completada',
      actualizado: now().toISOString(),
    });
    persist();
    return item;
  }

  /** Conversaciones creadas o actualizadas después de `desde` (ISO). Sin `desde`, las últimas `limite`. */
  function list({ desde, agentId, limite = 50 } = {}) {
    let result = items;
    if (desde) result = result.filter((i) => i.actualizado > desde);
    if (agentId) result = result.filter((i) => i.de === agentId || i.para === agentId);
    return result.slice(-limite);
  }

  /** Página de conversaciones (del agente, si se indica), de la más reciente a la más antigua: { items, total, pagina, paginas }. */
  function pagina({ agentId, pagina: num = 1, porPagina = 20 } = {}) {
    const lista = agentId ? items.filter((i) => i.de === agentId || i.para === agentId) : items;
    const { lista: recortada, ...meta } = paginar(lista, { pagina: num, porPagina });
    return { items: recortada, ...meta };
  }

  return { start, finish, list, pagina };
}

module.exports = { createConversacionesStore, MAX_CONVERSACIONES };
