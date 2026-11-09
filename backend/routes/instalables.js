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

/** Catálogo de skills (GitHub) y plugins (servidores MCP) instalados en la oficina. */
function createInstalablesRouter({ instalables }) {
  const router = express.Router();
  router.get('/', wrap(() => instalables.list()));
  router.post('/skills', wrap((req) => instalables.instalarSkill((req.body || {}).url)));
  router.get('/skills/:id/archivo', wrap((req) => ({ contenido: instalables.leerArchivoSkill(req.params.id, req.query.ruta || 'SKILL.md') })));
  router.delete('/skills/:id', wrap((req) => instalables.quitarSkill(req.params.id)));
  router.post('/plugins', wrap((req) => instalables.instalarPlugin(req.body || {})));
  router.post('/plugins/:id/probar', wrap((req) => instalables.probarPlugin(req.params.id)));
  router.delete('/plugins/:id', wrap((req) => instalables.quitarPlugin(req.params.id)));
  return router;
}

module.exports = { createInstalablesRouter };
