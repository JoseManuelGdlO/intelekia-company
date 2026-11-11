const express = require('express');

function createStatusHandler({ statusPath, readStatus }) {
  return (req, res) => {
    res.json(readStatus(statusPath));
  };
}

function createChatHandler({ chatHandlers, actividad = null }) {
  return async (req, res) => {
    const { id } = req.params;
    const handler = chatHandlers[id];
    if (!handler) {
      res.status(404).json({ error: `Agente desconocido: ${id}` });
      return;
    }
    const mensaje = String(req.body?.message ?? '');
    actividad?.log(id, 'chat', `👤 El fundador escribió: ${mensaje.length > 300 ? `${mensaje.slice(0, 300)}…` : mensaje}`);
    try {
      const result = await handler(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

function createForzarHandler({ scheduler }) {
  return async (req, res) => {
    const { id } = req.params;
    try {
      const result = await scheduler.runOne(id);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createActividadHandler({ actividad }) {
  return (req, res) => {
    const { desde, limite, pagina, porPagina } = req.query;
    // Con `pagina` responde paginado (más reciente primero); sin ella, como siempre.
    if (pagina !== undefined) {
      res.json(actividad ? actividad.pagina(req.params.id, { pagina, porPagina }) : { eventos: [], total: 0, pagina: 1, paginas: 1 });
      return;
    }
    res.json(actividad ? actividad.list(req.params.id, { desde, limite: limite ? Number(limite) : undefined }) : []);
  };
}

function createAgentsRouter({ statusPath, readStatus, scheduler, chatHandlers, actividad = null }) {
  const router = express.Router();
  router.get('/status', createStatusHandler({ statusPath, readStatus }));
  // Próximo ciclo de cada agente (intervalo propio, última y próxima ejecución).
  router.get('/ciclos', (req, res) => res.json(scheduler.proximos ? scheduler.proximos() : {}));
  router.get('/:id/actividad', createActividadHandler({ actividad }));
  router.post('/:id/chat', createChatHandler({ chatHandlers, actividad }));
  router.post('/:id/forzar', createForzarHandler({ scheduler }));
  return router;
}

module.exports = {
  createAgentsRouter,
  createStatusHandler,
  createChatHandler,
  createForzarHandler,
  createActividadHandler,
};
