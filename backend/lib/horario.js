const fs = require('fs');
const path = require('path');

/**
 * Horario de trabajo de la oficina y el botón de abrir/cerrar.
 * Solo frena los ciclos AUTOMÁTICOS: lo que el fundador pide a mano (chat, WhatsApp, Forzar ciclo,
 * aprobar) siempre funciona. Se guarda en state/horario.json (sobrevive a los despliegues).
 *
 * dias: 0 = domingo … 6 = sábado. entrada/salida "HH:MM" en la zona horaria de la oficina.
 * Si salida < entrada el turno cruza la medianoche (p. ej. 22:00 → 06:00); si son iguales, todo el día.
 */
const DEFAULT = Object.freeze({ abierta: true, respetarHorario: false, dias: [1, 2, 3, 4, 5], entrada: '09:00', salida: '18:00' });
const NOMBRES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function normalizar(datos = {}) {
  const c = { ...DEFAULT, ...datos };
  const dias = Array.isArray(c.dias) ? [...new Set(c.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT.dias;
  return {
    abierta: c.abierta !== false,
    respetarHorario: c.respetarHorario === true,
    dias,
    entrada: HORA.test(c.entrada) ? c.entrada : DEFAULT.entrada,
    salida: HORA.test(c.salida) ? c.salida : DEFAULT.salida,
  };
}

function createHorario({ filePath, now = () => new Date(), timeZone = 'America/Monterrey', registrar = () => {} }) {
  const formato = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function leer() {
    if (!filePath || !fs.existsSync(filePath)) return normalizar();
    try {
      return normalizar(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {
      return normalizar();
    }
  }

  let config = leer();

  function guardar() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, filePath);
  }

  /** Día (0-6) y minuto del día en la zona horaria de la oficina. */
  function local(fecha) {
    const partes = Object.fromEntries(formato.formatToParts(fecha).map((p) => [p.type, p.value]));
    return { dia: DIAS_EN[partes.weekday], min: Number(partes.hour) * 60 + Number(partes.minute) };
  }

  function dentroDeHorario(fecha = now()) {
    const { dias, entrada, salida } = config;
    const { dia, min } = local(fecha);
    const e = minutos(entrada);
    const s = minutos(salida);
    if (e === s) return dias.includes(dia);
    if (e < s) return dias.includes(dia) && min >= e && min < s;
    // Turno nocturno: desde la entrada de un día laboral hasta la salida del día siguiente.
    return (dias.includes(dia) && min >= e) || (dias.includes((dia + 6) % 7) && min < s);
  }

  function puedeTrabajar() {
    if (!config.abierta) return false;
    return !config.respetarHorario || dentroDeHorario();
  }

  /** Próxima entrada (texto) dentro de los siguientes 7 días, o null si no hay días. */
  function proximaApertura() {
    if (!config.dias.length) return null;
    const { dia, min } = local(now());
    const e = minutos(config.entrada);
    for (let i = 0; i <= 7; i += 1) {
      const d = (dia + i) % 7;
      if (!config.dias.includes(d) || (i === 0 && min >= e)) continue;
      const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${NOMBRES[d]}`;
      return `${cuando} a las ${config.entrada}`;
    }
    return null;
  }

  function estado() {
    const puede = puedeTrabajar();
    let motivo;
    if (!config.abierta) motivo = 'Oficina cerrada: los ciclos automáticos están detenidos hasta que la abras.';
    else if (!config.respetarHorario) motivo = 'Oficina abierta sin horario: los ciclos corren a cualquier hora.';
    else if (puede) motivo = `Dentro de horario (${config.entrada}–${config.salida}).`;
    else {
      const prox = proximaApertura();
      motivo = prox ? `Fuera de horario: vuelve a trabajar ${prox}.` : 'Fuera de horario: no hay días de trabajo marcados.';
    }
    return { ...config, puedeTrabajar: puede, motivo };
  }

  function actualizar(cambios = {}) {
    const permitidos = {};
    ['respetarHorario', 'dias', 'entrada', 'salida'].forEach((k) => {
      if (cambios[k] !== undefined) permitidos[k] = cambios[k];
    });
    if (permitidos.entrada !== undefined && !HORA.test(permitidos.entrada)) throw new Error('Hora de entrada inválida (usa HH:MM)');
    if (permitidos.salida !== undefined && !HORA.test(permitidos.salida)) throw new Error('Hora de salida inválida (usa HH:MM)');
    config = normalizar({ ...config, ...permitidos });
    guardar();
    registrar(`🕘 Horario actualizado: ${config.respetarHorario ? `${config.dias.map((d) => NOMBRES[d].slice(0, 3)).join(', ')} de ${config.entrada} a ${config.salida}` : 'sin horario'}`);
    return estado();
  }

  function abrir() {
    config = { ...config, abierta: true };
    guardar();
    registrar('🟢 Abriste la oficina: los ciclos automáticos vuelven a correr.');
    return estado();
  }

  function cerrar() {
    config = { ...config, abierta: false };
    guardar();
    registrar('🔴 Cerraste la oficina: no se inician ciclos automáticos.');
    return estado();
  }

  return { estado, actualizar, abrir, cerrar, puedeTrabajar, dentroDeHorario };
}

module.exports = { createHorario };
