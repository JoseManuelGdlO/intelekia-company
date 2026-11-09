const express = require('express');

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      const status = /desconocido/i.test(err.message) ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  };
}

function createPerfilesRouter({ profiles }) {
  const router = express.Router();
  router.get('/:agentId', wrap((req) => profiles.getProfile(req.params.agentId)));
  router.put(
    '/:agentId',
    wrap((req) => {
      const { rol, label, autonomous, skills, herramientas, cicloHoras, instalados } = req.body || {};
      return profiles.updateProfile(req.params.agentId, { rol, label, autonomous, skills, herramientas, cicloHoras, instalados });
    })
  );
  router.get('/:agentId/memoria', wrap((req) => ({ content: profiles.getMemory(req.params.agentId) })));
  router.put('/:agentId/memoria', wrap((req) => ({ content: profiles.setMemory(req.params.agentId, (req.body || {}).content) })));
  router.post('/:agentId/memoria/comprimir', wrap(async (req) => ({ content: await profiles.compressMemory(req.params.agentId) })));
  return router;
}

module.exports = { createPerfilesRouter };
