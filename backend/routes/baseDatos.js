const express = require('express');

function createBaseDatosRouter({ database }) {
  const router = express.Router();

  router.get('/estado', (req, res) => {
    res.json(database.status());
  });

  router.post('/probar', async (req, res) => {
    try {
      res.json(await database.test());
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.get('/consultas', (req, res) => {
    const { agentId, limite } = req.query;
    res.json(database.consultas({ agentId, limite: limite ? Number(limite) : undefined }));
  });

  return router;
}

module.exports = { createBaseDatosRouter };
