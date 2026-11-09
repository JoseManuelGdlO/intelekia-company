const express = require('express');

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(/desconocida/i.test(err.message) ? 404 : 400).json({ error: err.message });
    }
  };
}

/** Bandeja general de aprobaciones de los trabajadores. */
function createAprobacionesRouter({ aprobaciones }) {
  const router = express.Router();
  router.get(
    '/',
    wrap((req) => {
      const { estado, agentId, limite } = req.query;
      return { items: aprobaciones.list({ estado, agentId, limite: Number.isInteger(Number(limite)) && Number(limite) > 0 ? Number(limite) : undefined }), pendientes: aprobaciones.pendientes() };
    })
  );
  router.post('/:id/aprobar', wrap((req) => aprobaciones.aprobar(req.params.id, { propuesta: (req.body || {}).propuesta })));
  router.post('/:id/descartar', wrap((req) => aprobaciones.descartar(req.params.id)));
  return router;
}

module.exports = { createAprobacionesRouter };
