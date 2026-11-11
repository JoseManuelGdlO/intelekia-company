const fs = require('fs');
const path = require('path');

const DEFAULT_TICK_MS = 60 * 1000;

/**
 * Planificador de ciclos autónomos con un intervalo POR AGENTE.
 *
 * - `intervalFor(agentId)` devuelve cada cuántos ms corre ese agente (null o 0 = no corre solo).
 *   Si no se da, todos usan `intervalMs` (comportamiento original).
 * - Cada `tickMs` revisa a quién le toca y los ejecuta de uno en uno (cola), sin encimar
 *   dos ejecuciones del mismo agente.
 * - La última ejecución de cada agente se guarda en `statePath`, así un reinicio del servidor
 *   no reinicia los contadores. Un agente nuevo empieza a contar desde que se ve por primera vez.
 * - `runOne` (Forzar ciclo) corre de inmediato y también reinicia el contador de ese agente;
 *   falla si ese agente ya tiene un ciclo en curso.
 */
function createScheduler({
  intervalMs,
  agentRunners,
  intervalFor = () => intervalMs,
  statePath = null,
  tickMs = DEFAULT_TICK_MS,
  now = () => Date.now(),
  // Horario / oficina cerrada: si devuelve false no se inicia ningún ciclo automático.
  puedeTrabajar = () => true,
  onError = (agentId, err) => console.error(`Ciclo de ${agentId} falló:`, err.message),
}) {
  let timer = null;
  let lastRun = {};
  if (statePath && fs.existsSync(statePath)) {
    try {
      lastRun = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
      lastRun = {};
    }
  }
  const running = new Set();
  const queued = new Set();
  let queue = Promise.resolve();

  function persist() {
    if (!statePath) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(lastRun, null, 2));
  }

  function markRun(agentId) {
    lastRun[agentId] = new Date(now()).toISOString();
    persist();
  }

  function intervalOf(agentId) {
    const ms = intervalFor(agentId);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  async function runSafe(agentId) {
    queued.delete(agentId);
    const runner = agentRunners[agentId];
    if (!runner || running.has(agentId)) return;
    // Si se cerró la oficina mientras esperaba en la cola, ya no arranca (le tocará al reabrir).
    if (!puedeTrabajar()) return;
    running.add(agentId);
    markRun(agentId);
    try {
      await runner();
    } catch (err) {
      onError(agentId, err);
    } finally {
      running.delete(agentId);
    }
  }

  function enqueue(agentId) {
    if (queued.has(agentId) || running.has(agentId)) return;
    queued.add(agentId);
    queue = queue.then(() => runSafe(agentId));
  }

  /** Revisa qué agentes ya cumplieron su intervalo y los pone en la cola. */
  function tick() {
    if (!puedeTrabajar()) return queue;
    let changed = false;
    Object.keys(agentRunners).forEach((agentId) => {
      const ms = intervalOf(agentId);
      if (!ms) return;
      if (!lastRun[agentId]) {
        // Primera vez que lo vemos: empieza a contar desde ahora (no corre todo al arrancar).
        lastRun[agentId] = new Date(now()).toISOString();
        changed = true;
        return;
      }
      if (now() - Date.parse(lastRun[agentId]) >= ms) enqueue(agentId);
    });
    if (changed) persist();
    return queue;
  }

  function start() {
    tick();
    timer = setInterval(tick, tickMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function isRunning() {
    return timer !== null;
  }

  async function runAllOnce() {
    const ids = Object.keys(agentRunners);
    for (const id of ids) {
      await agentRunners[id]();
    }
  }

  async function runOne(agentId) {
    const runner = agentRunners[agentId];
    if (!runner) {
      throw new Error(`Agente desconocido: ${agentId}`);
    }
    if (running.has(agentId)) {
      throw new Error('El ciclo de este agente ya está en curso');
    }
    // Se marca en curso para que un tick no lo arranque encima mientras corre.
    running.add(agentId);
    markRun(agentId);
    try {
      return await runner();
    } finally {
      running.delete(agentId);
    }
  }

  /** Para la interfaz: intervalo, última y próxima ejecución de cada agente con ciclo. */
  function proximos() {
    const out = {};
    Object.keys(agentRunners).forEach((agentId) => {
      const ms = intervalOf(agentId);
      const ultima = lastRun[agentId] || null;
      out[agentId] = {
        cadaHoras: ms ? Math.round((ms / 3600000) * 100) / 100 : null,
        ultimaVez: ultima,
        proxima: ms && ultima ? new Date(Date.parse(ultima) + ms).toISOString() : null,
        enCurso: running.has(agentId),
        enCola: queued.has(agentId),
      };
    });
    return out;
  }

  return { start, stop, tick, runAllOnce, runOne, isRunning, proximos };
}

module.exports = { createScheduler };
