const fs = require('fs');
const path = require('path');

/**
 * Bandeja general de aprobaciones: acciones que los trabajadores proponen (p. ej. responder un
 * comentario) y que el fundador aprueba (opcionalmente editando el texto) o descarta.
 * Cada tipo de acción registra con `registrarEjecutor` cómo se ejecuta al aprobarse.
 */
const MAX_ITEMS = 500;
const ABIERTOS = ['por_aprobar', 'error'];

function createAprobaciones({ filePath, now = () => new Date() }) {
  const ejecutores = {};
  let counter = 0;

  function leer() {
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function guardar(items) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(items.slice(-MAX_ITEMS), null, 2));
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
    return item;
  }

  async function aprobar(id, { propuesta } = {}) {
    const item = encontrar(leer(), id);
    if (!ABIERTOS.includes(item.estado)) throw new Error(`Esta aprobación ya está ${item.estado}`);
    const ejecutor = ejecutores[item.tipo];
    if (!ejecutor) throw new Error(`No hay cómo ejecutar acciones de tipo ${item.tipo}`);
    if (propuesta !== undefined) item.propuesta = String(propuesta).trim();
    if (!item.propuesta.trim()) throw new Error('La propuesta está vacía: escríbela antes de aprobar');
    // Marca transitoria para que un doble clic no la ejecute dos veces.
    item.estado = 'ejecutando';
    reemplazar(item);
    try {
      await ejecutor(item);
      Object.assign(item, { estado: 'aprobado', resueltoEn: now().toISOString(), error: null });
    } catch (err) {
      Object.assign(item, { estado: 'error', error: err.message });
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

  return { registrarEjecutor, proponer, aprobar, descartar, list, pendientes };
}

module.exports = { createAprobaciones };
