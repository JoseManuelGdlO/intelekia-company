const fs = require('fs');
const path = require('path');

/**
 * Bandeja general de aprobaciones: acciones que los trabajadores proponen (p. ej. responder un
 * comentario) y que el fundador aprueba (opcionalmente editando el texto) o descarta.
 * Cada tipo de acción registra con `registrarEjecutor` cómo se ejecuta al aprobarse.
 */
const MAX_ITEMS = 500;
const ABIERTOS = ['por_aprobar', 'error'];
const MAX_EJECUTANDO_MS = 5 * 60 * 1000;

function createAprobaciones({ filePath, now = () => new Date() }) {
  const ejecutores = {};
  const oyentes = new Set();
  let counter = 0;

  function leer() {
    if (!filePath || !fs.existsSync(filePath)) return [];
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(raw)) throw new Error('no es una lista');
    } catch {
      const respaldo = `${filePath}.corrupto-${now().getTime()}`;
      try {
        fs.renameSync(filePath, respaldo);
        console.warn(`aprobaciones: archivo ilegible, respaldado en ${respaldo}`);
      } catch (err) {
        console.warn(`aprobaciones: archivo ilegible y no se pudo respaldar (${err.message})`);
      }
      return [];
    }
    const ahora = now().getTime();
    return raw.map((i) =>
      i && i.estado === 'ejecutando' && ahora - new Date(i.ejecutandoDesde).getTime() > MAX_EJECUTANDO_MS
        ? { ...i, estado: 'error', error: 'Se interrumpió mientras se ejecutaba; revisa en la red si se publicó antes de reintentar' }
        : i
    );
  }

  /** Recorta a MAX_ITEMS descartando primero los resueltos más antiguos; los abiertos nunca se pierden. */
  function recortar(items) {
    let sobran = items.length - MAX_ITEMS;
    if (sobran <= 0) return items;
    return items.filter((i) => {
      if (sobran > 0 && (i.estado === 'aprobado' || i.estado === 'descartado')) {
        sobran -= 1;
        return false;
      }
      return true;
    });
  }

  function guardar(items) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(recortar(items), null, 2));
    fs.renameSync(tmp, filePath);
  }

  function encontrar(items, id) {
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`Aprobación desconocida: ${id}`);
    return item;
  }

  function reemplazar(item) {
    const items = leer();
    const index = items.findIndex((i) => i.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
    guardar(items);
    return item;
  }

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

  function registrarEjecutor(tipo, fn) {
    ejecutores[tipo] = fn;
  }

  function proponer({ agentId, tipo, titulo, propuesta = '', contexto = {}, motivo = null, error = null }) {
    if (!agentId || !tipo) throw new Error('Faltan agentId o tipo para proponer una aprobación');
    counter += 1;
    const item = {
      id: `apr-${now().getTime()}-${counter}`,
      agentId,
      tipo,
      titulo: String(titulo || tipo),
      propuesta: String(propuesta ?? ''),
      contexto,
      motivo,
      estado: error ? 'error' : 'por_aprobar',
      creadoEn: now().toISOString(),
      resueltoEn: null,
      error: error || null,
    };
    const items = leer();
    items.push(item);
    guardar(items);
    notificar(item);
    return item;
  }

  async function aprobar(id, { propuesta } = {}) {
    const item = encontrar(leer(), id);
    if (item.estado === 'ejecutando') throw new Error('Esta aprobación se está ejecutando ahora');
    if (!ABIERTOS.includes(item.estado)) throw new Error(`Esta aprobación ya está ${item.estado}`);
    if (propuesta !== undefined && typeof propuesta !== 'string') throw new Error('La propuesta debe ser texto');
    const ejecutor = ejecutores[item.tipo];
    if (!ejecutor) throw new Error(`No hay cómo ejecutar acciones de tipo ${item.tipo}`);
    if (propuesta !== undefined) item.propuesta = propuesta.trim();
    if (!item.propuesta.trim()) throw new Error('La propuesta está vacía: escríbela antes de aprobar');
    // Marca transitoria para que un doble clic no la ejecute dos veces.
    item.estado = 'ejecutando';
    item.ejecutandoDesde = now().toISOString();
    reemplazar(item);
    try {
      await ejecutor(item);
      Object.assign(item, { estado: 'aprobado', resueltoEn: now().toISOString(), error: null, ejecutandoDesde: null });
    } catch (err) {
      Object.assign(item, { estado: 'error', error: err.message, ejecutandoDesde: null });
    }
    return reemplazar(item);
  }

  function descartar(id) {
    const item = encontrar(leer(), id);
    if (!ABIERTOS.includes(item.estado)) throw new Error(`Esta aprobación ya está ${item.estado}`);
    Object.assign(item, { estado: 'descartado', resueltoEn: now().toISOString() });
    return reemplazar(item);
  }

  function list({ estado, agentId, limite = 100 } = {}) {
    let items = leer();
    if (estado) items = items.filter((i) => i.estado === estado);
    if (agentId) items = items.filter((i) => i.agentId === agentId);
    return items.slice(-limite);
  }

  function pendientes() {
    return leer().filter((i) => ABIERTOS.includes(i.estado)).length;
  }

  return { registrarEjecutor, suscribir, proponer, aprobar, descartar, list, pendientes };
}

module.exports = { createAprobaciones };
