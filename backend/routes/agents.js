const express = require('express');

function createStatusHandler({ statusPath, readStatus }) {
  return (req, res) => {
    res.json(readStatus(statusPath));
  };
}

function createChatHandler({ chatHandlers }) {
  return async (req, res) => {
    const { id } = req.params;
    const handler = chatHandlers[id];
    if (!handler) {
      res.status(404).json({ error: `Agente desconocido: ${id}` });
      return;
    }
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

function createAgentsRouter({ statusPath, readStatus, scheduler, chatHandlers }) {
  const router = express.Router();
  router.get('/status', createStatusHandler({ statusPath, readStatus }));
  router.post('/:id/chat', createChatHandler({ chatHandlers }));
  router.post('/:id/forzar', createForzarHandler({ scheduler }));
  return router;
}

module.exports = {
  createAgentsRouter,
  createStatusHandler,
  createChatHandler,
  createForzarHandler,
};
