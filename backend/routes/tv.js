const express = require('express');

const CACHE_MS = 5000;

/**
 * API de la pantalla (TV) de la oficina: solo lectura y solo datos limpios (ver lib/tvEstado.js).
 * La TV consulta cada 10 s; el estado se guarda 5 s en caché para no releer los archivos en cada consulta.
 */
function createTvRouter({ tvEstado, now = () => Date.now(), cacheMs = CACHE_MS }) {
  const router = express.Router();
  let cache = null;

  router.get('/estado', (req, res) => {
    const ahora = now();
    if (!cache || ahora - cache.en >= cacheMs) {
      try {
        cache = { en: ahora, valor: tvEstado.estado() };
      } catch (err) {
        console.warn(`TV: no se pudo calcular el estado: ${err.message}`);
        return res.status(500).json({ error: 'No se pudo obtener el estado de la oficina' });
      }
    }
    res.set('Cache-Control', 'no-store');
    return res.json(cache.valor);
  });

  return router;
}

module.exports = { createTvRouter };
