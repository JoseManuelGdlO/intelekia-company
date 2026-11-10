const express = require('express');

/**
 * Webhook de la WhatsApp Cloud API: verificación de Meta (GET) y mensajes entrantes (POST).
 * El POST responde 200 de inmediato (Meta reintenta si tarda) y procesa en segundo plano.
 */
function createWhatsappRouter({ whatsapp, recepcion, config, registrar = () => {} }) {
  const router = express.Router();

  router.get('/webhook/whatsapp', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && config.verifyToken && req.query['hub.verify_token'] === config.verifyToken;
    if (!ok) return res.sendStatus(403);
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  });

  router.post('/webhook/whatsapp', (req, res) => {
    if (!whatsapp.verificarFirma(req.rawBody, req.get('x-hub-signature-256'))) {
      registrar(null, 'error', 'WhatsApp: llegó una llamada al webhook con firma inválida');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    if (!whatsapp.estado().ok) return undefined;
    whatsapp.extraerMensajes(req.body).forEach((mensaje) => {
      Promise.resolve()
        .then(() => recepcion.procesar(mensaje))
        .catch((err) => registrar(null, 'error', `WhatsApp: ${err.message}`));
    });
    return undefined;
  });

  router.get('/api/whatsapp/estado', (req, res) => {
    res.json({ ...whatsapp.estado(), ...recepcion.estadoCanal() });
  });

  return router;
}

module.exports = { createWhatsappRouter };
