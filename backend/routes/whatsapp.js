const express = require('express');

/**
 * Webhook de la WhatsApp Cloud API: verificación de Meta (GET) y mensajes entrantes (POST).
 * El POST responde 200 de inmediato (Meta reintenta si tarda) y procesa en segundo plano.
 * Se monta en una app APARTE, en su propio puerto: es lo único que se expone con ngrok.
 */
function createWhatsappWebhookRouter({ whatsapp, recepcion, config, registrar = () => {} }) {
  const router = express.Router();
  let avisoSinConfiguracion = false;

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
    if (!whatsapp.estado().ok) {
      if (!avisoSinConfiguracion) {
        avisoSinConfiguracion = true;
        registrar(null, 'error', 'WhatsApp: llegó un mensaje pero falta configuración');
      }
      return undefined;
    }
    whatsapp.extraerMensajes(req.body).forEach((mensaje) => {
      Promise.resolve()
        .then(() => recepcion.procesar(mensaje))
        .catch((err) => registrar(null, 'error', `WhatsApp: ${err.message}`));
    });
    return undefined;
  });

  return router;
}

/** Estado del canal para la oficina (se monta en la app principal, nunca en la del webhook). */
function createWhatsappEstadoRouter({ whatsapp, recepcion, avisos = null }) {
  const router = express.Router();
  router.get('/api/whatsapp/estado', (req, res) => {
    res.json({ ...whatsapp.estado(), ...recepcion.estadoCanal() });
  });
  // Avisos de mensajes recibidos (sin número ni texto) para mostrarlos en la oficina.
  router.get('/api/whatsapp/avisos', (req, res) => {
    res.json(avisos ? avisos.recientes({ desde: req.query.desde ? String(req.query.desde) : null, limite: 20 }) : []);
  });
  return router;
}

/** App mínima del webhook: cuerpo crudo para la firma + rutas del webhook + 404 para todo lo demás. */
function createWhatsappWebhookApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(createWhatsappWebhookRouter(deps));
  app.use((req, res) => res.sendStatus(404));
  // JSON inválido o demasiado grande: sin detalles ni stack hacia internet.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.sendStatus(err.status || 400));
  return app;
}

module.exports = { createWhatsappWebhookRouter, createWhatsappEstadoRouter, createWhatsappWebhookApp };
