/**
 * Estado público para la pantalla (TV) de la oficina: SOLO datos limpios, sin roles, memorias,
 * conversaciones con el fundador ni datos personales (correos, teléfonos, URLs, nombres de negocios).
 * Cada fuente se lee por separado: si una falla, su parte queda en ceros/vacía y lo demás sigue.
 */
const MAX_ACTIVIDAD = 30;
const MAX_TEXTO = 120;
const DIA_MS = 24 * 60 * 60 * 1000;
// Conversaciones privadas del fundador con cada agente: nunca salen en la TV.
// La TV la ve cualquiera que pase: solo se muestran inicios, fines y errores de ciclo (y avisos de la
// propia oficina). Los pasos intermedios (herramientas, resultados, notas, chat) pueden traer nombres,
// comentarios de clientes o filas de la base de datos.
const TIPOS_PUBLICOS = ['inicio', 'fin', 'error'];
const esPublico = (e) => TIPOS_PUBLICOS.includes(e.tipo) || (e.agentId === 'oficina' && e.tipo === 'nota');
const ESTADOS_PENDIENTES = ['por_aprobar', 'error'];
const VEREDICTOS_APROBADOS = ['aprobado_mergeado', 'aprobado_sin_merge'];
const ETIQUETAS_EXTRA = { oficina: 'Oficina', whatsapp: 'WhatsApp' };

/** Quita correos, URLs y teléfonos (8+ dígitos), colapsa espacios y recorta a 120 caracteres. */
function limpiarTexto(texto) {
  let t = String(texto ?? '');
  t = t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '');
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '');
  t = t.replace(/\+?\(?\d[\d\s\-()]{6,}\d\)?/g, (m) => ((m.match(/\d/g) || []).length >= 8 ? '' : m));
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO - 1)}…` : t;
}

/** Ejecuta `fn`; si lanza, devuelve `porDefecto` (una fuente rota no debe tumbar la TV). */
function seguro(fn, porDefecto) {
  try {
    const valor = fn();
    return valor ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

const lista = (valor) => (Array.isArray(valor) ? valor : []);

/** Texto genérico de una aprobación según su tipo (nunca el título: puede llevar nombres). */
function textoAprobacion(tipo) {
  const t = String(tipo || '');
  if (/publica/i.test(t)) return 'Publicación aprobada';
  if (/respond|respuesta/i.test(t)) return 'Respuesta aprobada';
  if (/correo/i.test(t)) return 'Correo aprobado';
  return 'Acción aprobada';
}

/** "owner/repo#12" → "repo" */
function repoDe(revision) {
  if (revision.repo) return String(revision.repo);
  const m = String(revision.clave || '').match(/^[^/]+\/([^#]+)#/);
  return m ? m[1] : '';
}

function createTvEstado({
  estadoOficina,
  departamentos,
  estatus,
  actividad,
  conversaciones,
  leerIdeas,
  leerProspectos,
  revisiones = null,
  aprobaciones,
  now = () => new Date(),
  timeZone = 'America/Monterrey',
}) {
  const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const diaLocal = (fecha) => {
    const d = new Date(fecha);
    return Number.isNaN(d.getTime()) ? null : formatoDia.format(d);
  };

  function estado() {
    const ahora = now();
    const hoy = diaLocal(ahora);
    const esHoy = (fecha) => Boolean(fecha) && diaLocal(fecha) === hoy;
    const reciente = (fecha) => {
      const t = new Date(fecha).getTime();
      return Number.isFinite(t) && ahora.getTime() - t <= DIA_MS && t <= ahora.getTime() + 60000;
    };
    // Basta mirar ~26 h atrás para contar "hoy" en cualquier zona horaria.
    const desdeHoy = new Date(ahora.getTime() - 26 * 60 * 60 * 1000).toISOString();

    const ofi = seguro(estadoOficina, {});
    const oficina = {
      abierta: ofi.abierta !== false,
      puedeTrabajar: ofi.puedeTrabajar !== false,
      motivo: limpiarTexto(ofi.motivo || ''),
      entrada: ofi.entrada || null,
      salida: ofi.salida || null,
    };
    const g = ofi.gasto || {};
    const gasto = {
      usd: Number(g.usd) || 0,
      limiteUsd: Number(g.limiteUsd) > 0 ? Number(g.limiteUsd) : null,
      excedido: Boolean(g.excedido),
    };

    const deptos = lista(seguro(departamentos, []));
    const estatusPorAgente = seguro(estatus, {}) || {};
    const etiquetas = { ...ETIQUETAS_EXTRA };
    const departamentosPublicos = deptos.map((d) => ({
      id: String(d.id || ''),
      label: String(d.label || d.name || d.id || ''),
      agentes: lista(d.agents).map((a) => {
        etiquetas[a.id] = String(a.label || a.id);
        return { id: String(a.id), label: String(a.label || a.id), estatus: String(estatusPorAgente[a.id]?.estatus || 'idle') };
      }),
    }));

    const eventosHoy = lista(seguro(() => actividad.recientes({ desde: desdeHoy, limite: Infinity }), []));
    const ultimos = lista(seguro(() => actividad.recientes({ limite: 1000 }), []));
    const actividadPublica = ultimos
      .filter(esPublico)
      .slice(0, MAX_ACTIVIDAD)
      .map((e) => ({ fecha: e.fecha, agente: etiquetas[e.agentId] || String(e.agentId || ''), tipo: e.tipo, texto: limpiarTexto(e.texto) }));

    const ideas = lista(seguro(leerIdeas, []));
    const prospectos = lista(seguro(leerProspectos, []));
    const prs = revisiones ? lista(seguro(revisiones, [])) : [];
    const aprob = lista(seguro(() => aprobaciones.list({ limite: 1000 }), []));
    const convs = lista(seguro(() => conversaciones.list({ desde: desdeHoy, limite: 10000 }), []));

    const dia = {
      ciclos: eventosHoy.filter((e) => e.tipo === 'inicio' && esHoy(e.fecha)).length,
      ideas: ideas.filter((i) => esHoy(i?.creadaEn)).length,
      prospectos: prospectos.filter((p) => esHoy(p?.creadoEn)).length,
      prsRevisados: prs.filter((r) => esHoy(r?.revisadoEn)).length,
      aprobacionesPendientes: aprob.filter((a) => ESTADOS_PENDIENTES.includes(a?.estado)).length,
      aprobadasHoy: aprob.filter((a) => a?.estado === 'aprobado' && esHoy(a.resueltoEn)).length,
      conversaciones: convs.filter((c) => esHoy(c?.inicio)).length,
    };

    // Ids estables entre llamadas: la TV celebra solo los que no ha visto.
    // En PRs se usa el sha (no revisadoEn): al reintentar el merge el registro se reescribe y no debe volver a celebrarse.
    const celebraciones = [
      ...prs
        .filter((r) => VEREDICTOS_APROBADOS.includes(r?.veredicto) && reciente(r.revisadoEn))
        .map((r) => {
          const repo = limpiarTexto(repoDe(r));
          return { fecha: r.revisadoEn, id: `pr:${r.clave}:${r.sha || r.revisadoEn}`, tipo: 'pr', texto: repo ? `PR aprobado en ${repo}` : 'PR aprobado' };
        }),
      ...prospectos
        .filter((p) => p?.id && reciente(p.creadoEn))
        .map((p) => {
          const giro = limpiarTexto(p.giro || '');
          return { fecha: p.creadoEn, id: `prospecto:${p.id}`, tipo: 'prospecto', texto: giro ? `Nuevo prospecto: ${giro}` : 'Nuevo prospecto' };
        }),
      ...aprob
        .filter((a) => a?.id && a.estado === 'aprobado' && reciente(a.resueltoEn))
        .map((a) => ({ fecha: a.resueltoEn, id: `aprobacion:${a.id}`, tipo: 'aprobacion', texto: textoAprobacion(a.tipo) })),
    ]
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .map(({ id, tipo, texto }) => ({ id, tipo, texto }));

    return { oficina, gasto, departamentos: departamentosPublicos, dia, actividad: actividadPublica, celebraciones };
  }

  return { estado };
}

module.exports = { createTvEstado, limpiarTexto };
