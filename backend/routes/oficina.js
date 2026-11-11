const express = require('express');

/** Horario de trabajo y abrir/cerrar la oficina (solo frena los ciclos automáticos). */
function createOficinaRouter({ horario }) {
  const router = express.Router();
  const responder = (fn) => (req, res) => {
    try {
      res.json(fn(req));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
  router.get('/', responder(() => horario.estado()));
  router.put('/horario', responder((req) => horario.actualizar(req.body || {})));
  router.post('/abrir', responder(() => horario.abrir()));
  router.post('/cerrar', responder(() => horario.cerrar()));
  return router;
}

module.exports = { createOficinaRouter };
