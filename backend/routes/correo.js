const express = require('express');

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(/desconocido/i.test(err.message) ? 404 : 400).json({ error: err.message });
    }
  };
}

function createCorreoRouter({ mailer }) {
  const router = express.Router();
  router.get('/estado', wrap(() => mailer.status()));
  router.put(
    '/config',
    wrap((req) => {
      const { permitidos, limiteDiario } = req.body || {};
      mailer.saveSettings({ permitidos, limiteDiario });
      return mailer.status();
    })
  );
  router.post('/probar', wrap(() => mailer.test()));
  router.get(
    '/correos',
    wrap((req) => {
      const { estado, agentId, limite } = req.query;
      return mailer.list({ estado, agentId, limite: limite ? Number(limite) : undefined });
    })
  );
  router.post('/correos/:id/aprobar', wrap((req) => mailer.aprobar(req.params.id, req.body || {})));
  router.post('/correos/:id/descartar', wrap((req) => mailer.descartar(req.params.id)));
  return router;
}

module.exports = { createCorreoRouter };
