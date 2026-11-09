/**
 * Flujo de tickets atrasados (se ejecuta al iniciar cada ciclo de Seguimiento de Proyectos):
 *
 *   1. Seguimiento obtiene de la base los tickets atrasados agrupados por responsable, con su
 *      correo (consulta FIJA en código: la IA no la escribe ni puede inventar tickets).
 *   2. Se los entrega al PM (queda registrado como conversación entre ambos).
 *   3. El PM envía un correo a cada responsable con sus tickets atrasados.
 *
 * Respeta la configuración del fundador: Seguimiento necesita la base de datos activa, permiso
 * para hablar con el PM, y el PM necesita el correo activo. Cada persona recibe máximo un aviso
 * por día; los destinatarios fuera de la lista permitida quedan "por aprobar".
 */
const TIME_ZONE = 'America/Monterrey'; // Durango

const SQL_ATRASADOS = `
SELECT t.id, p.name AS proyecto, t.title AS titulo, bc.name AS estado,
       DATE_FORMAT(t.dueDate, '%d/%m/%Y') AS vence,
       DATEDIFF(DATE(NOW() - INTERVAL 6 HOUR), DATE(t.dueDate)) AS dias,
       u.id AS userId, u.name AS responsable, u.email AS email
FROM Tasks t
JOIN BoardColumns bc ON bc.id = t.columnId
LEFT JOIN Projects p ON p.id = t.projectId
LEFT JOIN Users u ON u.id = t.assigneeId
WHERE bc.name <> 'Entregadas'
  -- dueDate es una fecha de calendario (se guarda a las 00:00): está atrasada cuando ese día
  -- ya pasó en Durango (UTC-6); un ticket que vence hoy todavía no cuenta como atrasado.
  AND DATE(t.dueDate) < DATE(NOW() - INTERVAL 6 HOUR)
  AND (p.id IS NULL OR p.status IN ('trabajando', 'parado'))
ORDER BY u.name, t.dueDate
LIMIT 500`;

function fechaCorta(date) {
  return date.toLocaleDateString('es-MX', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
}

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function numeroEnLetra(n) {
  return ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'][n] || String(n);
}

/** Agrupa las filas por responsable; las tareas sin responsable se cuentan aparte. */
function agrupar(rows) {
  const responsables = new Map();
  let sinResponsable = 0;
  rows.forEach((r) => {
    if (r.userId === null || r.userId === undefined) {
      sinResponsable += 1;
      return;
    }
    if (!responsables.has(r.userId)) {
      responsables.set(r.userId, { userId: r.userId, nombre: String(r.responsable || '').trim(), email: r.email ? String(r.email).trim() : null, tickets: [] });
    }
    responsables.get(r.userId).tickets.push({
      id: r.id,
      proyecto: String(r.proyecto || 'Sin proyecto').trim(),
      titulo: String(r.titulo || '').trim(),
      estado: r.estado,
      vence: r.vence,
      dias: Number(r.dias) || 0,
    });
  });
  return { responsables: [...responsables.values()], sinResponsable, total: rows.length };
}

function asuntoDelDia(fecha) {
  return `Tickets atrasados al ${fechaCorta(fecha)}`;
}

function redactarCorreo(responsable, fecha) {
  const n = responsable.tickets.length;
  const lineas = responsable.tickets.map((t, i) => {
    const atraso = t.dias === 0 ? 'venció hoy' : `${plural(t.dias, 'día', 'días')} de atraso`;
    return `${i + 1}. [${t.proyecto}] ${t.titulo} — ${t.estado} — venció el ${t.vence} (${atraso})`;
  });
  const cuerpo =
    `Hola ${responsable.nombre},\n\n` +
    `Tienes ${numeroEnLetra(n)} ${n === 1 ? 'ticket atrasado' : 'tickets atrasados'}:\n\n` +
    `${lineas.join('\n')}\n\n` +
    '¿Nos ayudas a ponerlos al día o a compartir una nueva fecha de entrega? ' +
    'Si alguno ya está terminado, muévelo a "Entregadas" en el tablero.\n\n' +
    'Gracias.';
  return { asunto: `${asuntoDelDia(fecha)} — ${plural(n, 'pendiente', 'pendientes')}`, cuerpo };
}

function createAtrasadosFlow({
  database,
  mailer,
  comunicacion,
  conversaciones,
  profiles,
  origenId = 'seguimiento-crm',
  pmId = 'pm',
  onPmAction = () => {},
  actividad = null,
  now = () => new Date(),
}) {
  function label(id) {
    return comunicacion.findAgent(id)?.agent.label || id;
  }

  function omitido(motivo) {
    return { estado: 'omitido', motivo, envios: [] };
  }

  /** Ya se le avisó hoy a este correo (enviado o esperando aprobación)? */
  function yaNotificadoHoy(email, fecha) {
    const prefijo = asuntoDelDia(fecha);
    return mailer
      .list({ limite: 300 })
      .some((c) => ['enviado', 'por_aprobar'].includes(c.estado) && c.para.includes(email) && c.asunto.startsWith(prefijo));
  }

  async function ejecutar() {
    const fecha = now();
    if (!comunicacion.findAgent(pmId)) return omitido('No existe el agente PM');
    if (!database?.isConfigured()) return omitido('La base de datos no está configurada');
    if (!profiles.hasTool(origenId, 'baseDatos')) {
      return omitido(`${label(origenId)} no tiene activada la Base de datos (Editar → Herramientas)`);
    }
    if (!comunicacion.canTalk(origenId, pmId)) {
      return omitido(`${label(origenId)} no tiene permiso para hablar con ${label(pmId)} (actívalo en 🔗 Comunicación)`);
    }

    const act = (id, tipo, texto) => actividad?.log(id, tipo, texto);
    act(origenId, 'herramienta', '🗄️ Busca en la base los tickets atrasados y a sus responsables');
    let filas;
    try {
      filas = await database.queryInterna(SQL_ATRASADOS, [], { etiqueta: 'tickets atrasados por responsable', agentId: origenId });
    } catch (err) {
      act(origenId, 'error', `⚠️ No pudo leer los tickets atrasados: ${err.message}`);
      throw err;
    }
    const datos = agrupar(filas);
    if (!datos.total) {
      act(origenId, 'resultado', 'No hay tickets atrasados: no hay nada que avisar');
      return { estado: 'sin_atrasados', motivo: 'No hay tickets atrasados', envios: [], ...datos };
    }
    act(origenId, 'resultado', `Encontró ${plural(datos.total, 'ticket atrasado', 'tickets atrasados')} de ${plural(datos.responsables.length, 'responsable', 'responsables')}; se los entrega al ${label(pmId)}`);
    act(pmId, 'chat', `🤝 ${label(origenId)} le entregó ${plural(datos.total, 'ticket atrasado', 'tickets atrasados')} para avisar por correo`);

    const resumenEntrega =
      `Tickets atrasados para notificar: ${plural(datos.total, 'ticket', 'tickets')} de ${plural(datos.responsables.length, 'responsable', 'responsables')}` +
      (datos.sinResponsable ? ` (${datos.sinResponsable} sin responsable asignado)` : '') +
      ':\n' +
      datos.responsables.map((r) => `- ${r.nombre}: ${r.tickets.length}`).join('\n');
    const conversacion = conversaciones.start({ de: origenId, para: pmId, pregunta: resumenEntrega });

    const envios = [];
    const correoActivo = mailer?.isConfigured() && profiles.hasTool(pmId, 'correo');
    if (!correoActivo) {
      const motivo = mailer?.isConfigured()
        ? `${label(pmId)} no tiene activado el Correo (Editar → Herramientas)`
        : 'El correo no está configurado en backend/.env';
      conversaciones.finish(conversacion.id, { respuesta: `Recibido, pero no puedo enviar correos: ${motivo}.` });
      return { estado: 'sin_correo', motivo, envios, ...datos };
    }

    for (const responsable of datos.responsables) {
      const base = { nombre: responsable.nombre, email: responsable.email, tickets: responsable.tickets.length };
      if (!responsable.email) {
        envios.push({ ...base, estado: 'sin_correo', motivo: 'No tiene correo registrado' });
        continue;
      }
      if (yaNotificadoHoy(responsable.email, fecha)) {
        envios.push({ ...base, estado: 'ya_notificado', motivo: 'Ya se le avisó hoy' });
        continue;
      }
      try {
        const { asunto, cuerpo } = redactarCorreo(responsable, fecha);
        act(pmId, 'herramienta', `✉️ Envía a ${responsable.nombre} sus ${plural(responsable.tickets.length, 'ticket atrasado', 'tickets atrasados')}`);
        const item = await mailer.enviar({ agentId: pmId, para: [responsable.email], asunto, cuerpo });
        envios.push({ ...base, estado: item.estado, motivo: item.motivo || item.error || null });
        const textos = { enviado: 'Correo enviado ✓', por_aprobar: `Quedó por aprobar: ${item.motivo}`, error: `Falló el envío: ${item.error}` };
        act(pmId, item.estado === 'error' ? 'error' : 'resultado', textos[item.estado] || item.estado);
      } catch (err) {
        envios.push({ ...base, estado: 'error', motivo: err.message });
        act(pmId, 'error', `⚠️ No se envió a ${responsable.nombre}: ${err.message}`);
      }
    }

    const cuenta = (estado) => envios.filter((e) => e.estado === estado).length;
    const partes = [
      cuenta('enviado') && `${plural(cuenta('enviado'), 'correo enviado', 'correos enviados')}`,
      cuenta('por_aprobar') && `${cuenta('por_aprobar')} por aprobar`,
      cuenta('ya_notificado') && `${cuenta('ya_notificado')} ya avisados hoy`,
      cuenta('sin_correo') && `${cuenta('sin_correo')} sin correo`,
      cuenta('error') && `${cuenta('error')} con error`,
    ].filter(Boolean);
    const resumen = partes.join(', ') || 'sin envíos';
    const detalle = envios.map((e) => `- ${e.nombre}: ${e.estado}${e.motivo ? ` (${e.motivo})` : ''}`).join('\n');

    conversaciones.finish(conversacion.id, { respuesta: `Listo: ${resumen}.\n${detalle}` });
    profiles.remember(origenId, `Entregué al PM ${plural(datos.total, 'ticket atrasado', 'tickets atrasados')} para notificar.`);
    profiles.remember(pmId, `Notifiqué tickets atrasados recibidos de ${label(origenId)}: ${resumen}.\n${detalle}`);
    onPmAction(pmId, { ultimaAccion: `Tickets atrasados: ${resumen}` });
    act(pmId, 'fin', `🏁 Avisos de tickets atrasados: ${resumen}`);

    return { estado: 'ok', resumen, envios, ...datos };
  }

  return { ejecutar };
}

module.exports = { createAtrasadosFlow, agrupar, redactarCorreo, asuntoDelDia, SQL_ATRASADOS };
