const express = require('express');

const dinero = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * Estado de la oficina = horario (abierta/cerrada, dentro/fuera de horario) + gasto del día.
 * Si la oficina podría trabajar pero ya se alcanzó el límite de gasto, los ciclos automáticos se frenan.
 */
function estadoOficina({ horario, gasto }) {
  const base = horario.estado();
  if (!gasto) return base;
  const hoy = gasto.hoy();
  const frenadoPorGasto = base.puedeTrabajar && hoy.excedido;
  if (!frenadoPorGasto) return { ...base, gasto: hoy, frenadoPorGasto: false };
  return {
    ...base,
    gasto: hoy,
    frenadoPorGasto: true,
    puedeTrabajar: false,
    motivo: `Límite de gasto del día alcanzado (${dinero(hoy.usd)} de ${dinero(hoy.limiteUsd)}): los ciclos automáticos vuelven mañana.`,
  };
}

/** `puedeTrabajar` del planificador: horario y, si hay medidor, que no se haya pasado el límite de gasto. */
function crearPuedeTrabajar({ horario, gasto }) {
  return () => horario.puedeTrabajar() && !(gasto && gasto.hoy().excedido);
}

/** Horario de trabajo, abrir/cerrar la oficina y límite de gasto diario (solo frenan los ciclos automáticos). */
function createOficinaRouter({ horario, gasto }) {
  const router = express.Router();
  const estado = () => estadoOficina({ horario, gasto });
  const responder = (fn) => (req, res) => {
    try {
      fn(req);
      res.json(estado());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
  router.get('/', responder(() => {}));
  router.put('/horario', responder((req) => horario.actualizar(req.body || {})));
  router.post('/abrir', responder(() => horario.abrir()));
  router.post('/cerrar', responder(() => horario.cerrar()));
  router.put(
    '/limite-gasto',
    responder((req) => {
      if (!gasto) throw new Error('El medidor de gasto no está activo');
      gasto.setLimite((req.body || {}).usd ?? null);
    })
  );
  return router;
}

module.exports = { createOficinaRouter, estadoOficina, crearPuedeTrabajar };
