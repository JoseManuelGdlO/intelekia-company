const express = require('express');

function sendError(res, err) {
  res.status(400).json({ error: err.message });
}

function createGetHandler({ comunicacion }) {
  return (req, res) => {
    res.json(comunicacion.snapshot());
  };
}

function createSetRuleHandler({ comunicacion }) {
  return (req, res) => {
    try {
      const { alcance, permitidos } = req.body || {};
      comunicacion.setRule(req.params.agentId, { alcance, permitidos });
      res.json(comunicacion.snapshot());
    } catch (err) {
      sendError(res, err);
    }
  };
}

function createSetDefaultHandler({ comunicacion }) {
  return (req, res) => {
    try {
      const { alcance, aplicarATodos } = req.body || {};
      if (aplicarATodos) comunicacion.setAll(alcance);
      else comunicacion.setDefault(alcance);
      res.json(comunicacion.snapshot());
    } catch (err) {
      sendError(res, err);
    }
  };
}

function createListConversacionesHandler({ conversaciones }) {
  return (req, res) => {
    const { desde, agentId, limite, pagina, porPagina } = req.query;
    // Con `pagina` responde paginado (más reciente primero); sin ella, como siempre.
    if (pagina !== undefined) {
      res.json(conversaciones.pagina({ agentId, pagina, porPagina }));
      return;
    }
    res.json(conversaciones.list({ desde, agentId, limite: limite ? Number(limite) : undefined }));
  };
}

function createComunicacionRouter({ comunicacion, conversaciones }) {
  const router = express.Router();
  router.get('/', createGetHandler({ comunicacion }));
  router.put('/por-defecto', createSetDefaultHandler({ comunicacion }));
  router.put('/reglas/:agentId', createSetRuleHandler({ comunicacion }));
  router.get('/conversaciones', createListConversacionesHandler({ conversaciones }));
  return router;
}

module.exports = {
  createComunicacionRouter,
  createGetHandler,
  createSetRuleHandler,
  createSetDefaultHandler,
  createListConversacionesHandler,
};
