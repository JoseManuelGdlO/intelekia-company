/**
 * Panorama del equipo virtual para el PM: datos reales (no lo que el modelo suponga) sobre
 * cada agente: estatus, última acción, errores, cuánto lleva sin actividad, conversaciones
 * con compañeros, herramientas y consultas a la base de datos.
 */
const HORA_MS = 60 * 60 * 1000;

function horasDesde(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.round(((now - t) / HORA_MS) * 10) / 10;
}

function createTeamSnapshot({ departments, statusPath, readStatus, conversaciones, comunicacion, profiles, database = null, now = () => new Date() }) {
  function build({ excluir = [], ventanaHoras = 24 } = {}) {
    const fecha = now();
    const desde = new Date(fecha.getTime() - ventanaHoras * HORA_MS).toISOString();
    const status = readStatus(statusPath);
    const convs = conversaciones.list({ desde, limite: 1000 });
    const consultas = database ? database.consultas({ limite: 100 }).filter((c) => c.fecha > desde) : [];

    const agentes = [];
    departments.forEach((dept) => {
      dept.agents.forEach((agent) => {
        if (excluir.includes(agent.id)) return;
        const s = status[agent.id] || {};
        let perfil = null;
        try {
          perfil = profiles ? profiles.getProfile(agent.id) : null;
        } catch {
          perfil = null;
        }
        const mias = consultas.filter((c) => c.agentId === agent.id);
        agentes.push({
          id: agent.id,
          nombre: agent.label,
          area: dept.label,
          tipo: agent.isCustom ? 'a la medida' : 'base',
          autonomo: agent.isCustom ? Boolean(agent.autonomous) : true,
          estatus: s.estatus || 'sin registro',
          ultimaAccion: s.ultimaAccion || null,
          error: s.error || null,
          horasSinActualizar: horasDesde(s.updatedAt, fecha),
          conversaciones: {
            pregunto: convs.filter((c) => c.de === agent.id).length,
            respondio: convs.filter((c) => c.para === agent.id).length,
            fallidas: convs.filter((c) => (c.de === agent.id || c.para === agent.id) && c.estado === 'error').length,
          },
          puedeConsultarA: comunicacion.allowedTargetIds(agent.id).length,
          skillsActivas: perfil ? perfil.skills.filter((sk) => sk.activo !== false).length : 0,
          baseDatos: perfil ? Boolean(perfil.herramientas?.baseDatos) : false,
          consultasBD: { total: mias.length, conError: mias.filter((c) => c.error).length },
        });
      });
    });
    return { generadoEn: fecha.toISOString(), ventanaHoras, agentes };
  }

  /** Versión compacta en texto para dárselo al modelo. */
  function toText(snapshot) {
    const lines = snapshot.agentes.map((a) => {
      const partes = [
        `- ${a.nombre} [${a.id}] · área ${a.area} · ${a.tipo}${a.autonomo ? ' · autónomo' : ' · solo responde en chat'}`,
        `  estatus: ${a.estatus}` +
          (a.horasSinActualizar !== null ? ` (hace ${a.horasSinActualizar} h)` : ' (nunca ha registrado actividad)'),
      ];
      if (a.ultimaAccion) partes.push(`  última acción: ${a.ultimaAccion}`);
      if (a.error) partes.push(`  ERROR: ${a.error}`);
      partes.push(
        `  conversaciones (${snapshot.ventanaHoras} h): preguntó ${a.conversaciones.pregunto}, respondió ${a.conversaciones.respondio}, fallidas ${a.conversaciones.fallidas}`,
        `  puede consultar a ${a.puedeConsultarA} compañero(s) · skills activas: ${a.skillsActivas} · base de datos: ${a.baseDatos ? 'sí' : 'no'}` +
          (a.consultasBD.total ? ` (${a.consultasBD.total} consultas, ${a.consultasBD.conError} con error)` : '')
      );
      return partes.join('\n');
    });
    return `Panorama del equipo (generado ${snapshot.generadoEn}, ${snapshot.agentes.length} agentes):\n${lines.join('\n')}`;
  }

  return { build, toText };
}

module.exports = { createTeamSnapshot };
