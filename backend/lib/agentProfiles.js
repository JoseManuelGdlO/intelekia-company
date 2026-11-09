const fs = require('fs');
const path = require('path');

const TIPOS = ['skill', 'plugin', 'documento'];
// Herramientas que se pueden activar por agente.
const HERRAMIENTAS = ['baseDatos', 'correo'];

// Switch por trabajador: actúa solo o manda sus acciones a la bandeja de aprobaciones.
const AUTONOMIAS = ['autonomo', 'supervisado'];
const MAX_CONTENIDO = 20000;
const MAX_MEMORIA_INYECTADA = 4000;
const MAX_ENTRADA_MEMORIA = 2000;
const MAX_CICLO_HORAS = 720; // 30 días

function tail(text, max) {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Perfil editable de cualquier agente (base o a la medida):
 *   - rol / contexto: base -> su archivo de rol (.md); a la medida -> su `context`
 *   - skills, plugins y documentos: bloques de texto que se le inyectan como referencia
 *   - memoria: texto plano que se va llenando con chats, ciclos y consultas a compañeros
 *
 * `decorate(agentId, messages)` agrega skills (y memoria, para los agentes base) a cualquier
 * llamada al modelo, por eso funciona sin modificar el código de cada agente.
 * Los trabajadores a la medida ya inyectan su propia memoria en el chat, así que aquí no se duplica.
 */
function createAgentProfiles({
  profilesPath,
  memoriasDir,
  departments,
  createChatCompletion,
  config,
  updateCustomAgent,
  now = () => new Date(),
}) {
  function readAll() {
    if (!fs.existsSync(profilesPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeAll(data) {
    fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
    fs.writeFileSync(profilesPath, JSON.stringify(data, null, 2));
  }

  function find(agentId) {
    for (const department of departments) {
      const agent = department.agents.find((a) => a.id === agentId);
      if (agent) return { agent, department };
    }
    return null;
  }

  function requireAgent(agentId) {
    const found = find(agentId);
    if (!found) throw new Error(`Agente desconocido: ${agentId}`);
    return found;
  }

  function memoryPathOf(agent) {
    return agent.deps?.memoryPath || path.join(memoriasDir, `${agent.id}-memoria.md`);
  }

  function rolOf(agent) {
    if (agent.isCustom) return agent.roleText || '';
    const rolePath = agent.deps?.rolePath;
    return rolePath && fs.existsSync(rolePath) ? fs.readFileSync(rolePath, 'utf-8') : '';
  }

  function skillsOf(agentId) {
    return readAll()[agentId]?.skills || [];
  }

  function herramientasOf(agentId) {
    const saved = readAll()[agentId]?.herramientas || {};
    return Object.fromEntries(HERRAMIENTAS.map((h) => [h, saved[h] === true]));
  }

  /**
   * Cada cuántas horas corre el ciclo autónomo de un agente:
   * su valor propio (editado en la app) o, si no tiene, el de `departments.js` (`cicloHoras`)
   * o el general de .env (AGENT_INTERVAL_HOURS). 0 = no corre solo.
   */
  function cicloOf(agentId) {
    const found = find(agentId);
    const porDefecto = found?.agent.cicloHoras ?? config.agentIntervalHours ?? 6;
    const propio = readAll()[agentId]?.cicloHoras;
    return {
      cadaHoras: typeof propio === 'number' ? propio : porDefecto,
      porDefecto,
      personalizado: typeof propio === 'number',
    };
  }

  /** 'autonomo' = ejecuta sus acciones solo; 'supervisado' (por defecto) = las manda a aprobación. */
  function autonomiaOf(agentId) {
    requireAgent(agentId);
    const valor = readAll()[agentId]?.autonomia;
    return AUTONOMIAS.includes(valor) ? valor : 'supervisado';
  }

  /** Skills y plugins instalados (de internet) que este agente usa: { skills: [ids], plugins: [ids] }. */
  function instaladosOf(agentId) {
    const saved = readAll()[agentId]?.instalados || {};
    return {
      skills: Array.isArray(saved.skills) ? saved.skills : [],
      plugins: Array.isArray(saved.plugins) ? saved.plugins : [],
    };
  }

  function normalizeInstalados(instalados) {
    if (!instalados || typeof instalados !== 'object' || Array.isArray(instalados)) {
      throw new Error('instalados debe ser un objeto, ej. { "skills": ["internal-comms"], "plugins": [] }');
    }
    const lista = (v, campo) => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw new Error(`instalados.${campo} debe ser una lista de ids`);
      return [...new Set(v)];
    };
    return { skills: lista(instalados.skills, 'skills'), plugins: lista(instalados.plugins, 'plugins') };
  }

  function hasTool(agentId, herramienta) {
    return herramientasOf(agentId)[herramienta] === true;
  }

  function normalizeHerramientas(herramientas) {
    if (!herramientas || typeof herramientas !== 'object' || Array.isArray(herramientas)) {
      throw new Error('herramientas debe ser un objeto, ej. { "baseDatos": true }');
    }
    const desconocida = Object.keys(herramientas).find((h) => !HERRAMIENTAS.includes(h));
    if (desconocida) throw new Error(`Herramienta desconocida: ${desconocida}`);
    return Object.fromEntries(HERRAMIENTAS.map((h) => [h, herramientas[h] === true]));
  }

  function normalizeSkills(skills) {
    if (!Array.isArray(skills)) throw new Error('skills debe ser una lista');
    return skills.map((skill, index) => {
      if (!skill || typeof skill !== 'object') throw new Error(`La skill #${index + 1} no es válida`);
      const tipo = skill.tipo || 'skill';
      if (!TIPOS.includes(tipo)) throw new Error(`Tipo inválido "${tipo}". Usa: ${TIPOS.join(', ')}`);
      const nombre = typeof skill.nombre === 'string' ? skill.nombre.trim() : '';
      if (!nombre) throw new Error(`La ${tipo} #${index + 1} necesita un nombre`);
      if (typeof skill.contenido !== 'string' || !skill.contenido.trim()) {
        throw new Error(`"${nombre}" necesita contenido`);
      }
      if (skill.contenido.length > MAX_CONTENIDO) {
        throw new Error(`"${nombre}" es muy largo (${skill.contenido.length} caracteres, máximo ${MAX_CONTENIDO})`);
      }
      return {
        id: typeof skill.id === 'string' && skill.id ? skill.id : `skill-${Date.now()}-${index}`,
        tipo,
        nombre,
        contenido: skill.contenido,
        activo: skill.activo !== false,
      };
    });
  }

  function getMemory(agentId) {
    const { agent } = requireAgent(agentId);
    const memoryPath = memoryPathOf(agent);
    return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';
  }

  function setMemory(agentId, content) {
    if (typeof content !== 'string') throw new Error('content es requerido');
    const { agent } = requireAgent(agentId);
    const memoryPath = memoryPathOf(agent);
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, content);
    return content;
  }

  /** Agrega una entrada fechada a la memoria. Nunca lanza: la memoria no debe romper el trabajo. */
  function remember(agentId, texto) {
    try {
      const fecha = now().toISOString().slice(0, 16).replace('T', ' ');
      setMemory(agentId, `${getMemory(agentId)}\n\n[${fecha}] ${truncate(String(texto), MAX_ENTRADA_MEMORIA)}`);
    } catch (err) {
      console.error(`No se pudo guardar memoria de ${agentId}:`, err.message);
    }
  }

  async function compressMemory(agentId) {
    const current = getMemory(agentId);
    if (!current.trim()) return current;
    const resumen = await createChatCompletion({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      messages: [
        {
          role: 'system',
          content: 'Resume esta memoria de trabajo de forma breve, conservando los puntos importantes para futuras conversaciones y tareas.',
        },
        { role: 'user', content: current },
      ],
    });
    return setMemory(agentId, resumen);
  }

  function getProfile(agentId) {
    const { agent, department } = requireAgent(agentId);
    const memoria = getMemory(agentId);
    return {
      id: agent.id,
      label: agent.label,
      departmentId: department.id,
      departmentLabel: department.label,
      tipo: agent.isCustom ? 'custom' : 'base',
      rol: rolOf(agent),
      autonomous: agent.isCustom ? Boolean(agent.autonomous) : null,
      skills: skillsOf(agentId),
      herramientas: herramientasOf(agentId),
      instalados: instaladosOf(agentId),
      ciclo: agent.isCustom && !agent.autonomous ? null : cicloOf(agentId),
      autonomia: autonomiaOf(agentId),
      memoria: { caracteres: memoria.length },
      limites: { contenido: MAX_CONTENIDO },
    };
  }

  function updateProfile(agentId, { rol, label, autonomous, skills, herramientas, cicloHoras, instalados, autonomia } = {}) {
    const { agent } = requireAgent(agentId);
    // Validar todo antes de escribir nada.
    if (rol !== undefined && (typeof rol !== 'string' || !rol.trim())) throw new Error('El rol no puede quedar vacío');
    if (label !== undefined && (typeof label !== 'string' || !label.trim())) throw new Error('El nombre no puede quedar vacío');
    if (!agent.isCustom && label !== undefined && label.trim() !== agent.label) {
      throw new Error('El nombre de los agentes base se define en el código; solo se puede cambiar en trabajadores a la medida');
    }
    if (!agent.isCustom && autonomous !== undefined && autonomous !== null) {
      throw new Error('Los agentes base siempre son autónomos');
    }
    const normalizedSkills = skills !== undefined ? normalizeSkills(skills) : undefined;
    const normalizedHerramientas = herramientas !== undefined ? normalizeHerramientas(herramientas) : undefined;
    const normalizedInstalados = instalados !== undefined ? normalizeInstalados(instalados) : undefined;
    if (autonomia !== undefined && !AUTONOMIAS.includes(autonomia)) {
      throw new Error('autonomia debe ser "autonomo" o "supervisado"');
    }
    if (cicloHoras !== undefined && cicloHoras !== null) {
      const n = Number(cicloHoras);
      if (!Number.isFinite(n) || n < 0 || n > MAX_CICLO_HORAS) {
        throw new Error(`El ciclo debe ser un número de horas entre 0 y ${MAX_CICLO_HORAS} (0 = no corre solo)`);
      }
    }

    if (agent.isCustom) {
      const patch = {};
      if (rol !== undefined) patch.context = rol;
      if (label !== undefined) patch.label = label.trim();
      if (autonomous !== undefined && autonomous !== null) patch.autonomous = Boolean(autonomous);
      if (Object.keys(patch).length) updateCustomAgent(agentId, patch);
    } else if (rol !== undefined) {
      fs.writeFileSync(agent.deps.rolePath, rol);
    }

    if (normalizedSkills !== undefined || normalizedHerramientas !== undefined || normalizedInstalados !== undefined || cicloHoras !== undefined || autonomia !== undefined) {
      const all = readAll();
      all[agentId] = { ...all[agentId] };
      if (normalizedSkills !== undefined) all[agentId].skills = normalizedSkills;
      if (normalizedHerramientas !== undefined) all[agentId].herramientas = normalizedHerramientas;
      if (normalizedInstalados !== undefined) all[agentId].instalados = normalizedInstalados;
      if (cicloHoras === null) delete all[agentId].cicloHoras; // volver al valor por defecto
      else if (cicloHoras !== undefined) all[agentId].cicloHoras = Math.round(Number(cicloHoras) * 100) / 100;
      if (autonomia !== undefined) all[agentId].autonomia = autonomia;
      writeAll(all);
    }
    return getProfile(agentId);
  }

  function decorate(agentId, messages) {
    const found = find(agentId);
    if (!found) return messages;
    const extra = [];
    const activos = skillsOf(agentId).filter((s) => s.activo !== false);
    if (activos.length) {
      extra.push({
        role: 'system',
        content:
          'Tienes estas skills, plugins y documentos de referencia. Aplícalos cuando sean relevantes para la tarea:\n\n' +
          activos.map((s) => `### ${s.nombre} (${s.tipo})\n${s.contenido}`).join('\n\n'),
      });
    }
    if (!found.agent.isCustom) {
      const memoria = getMemory(agentId);
      if (memoria.trim()) {
        extra.push({
          role: 'system',
          content: `Memoria de tu trabajo y conversaciones previas (lo más reciente al final):\n${tail(memoria, MAX_MEMORIA_INYECTADA)}`,
        });
      }
    }
    return extra.length ? [...messages.slice(0, 1), ...extra, ...messages.slice(1)] : messages;
  }

  return { getProfile, updateProfile, hasTool, instaladosOf, cicloOf, autonomiaOf, getMemory, setMemory, remember, compressMemory, decorate, TIPOS, HERRAMIENTAS };
}

module.exports = { createAgentProfiles, TIPOS, HERRAMIENTAS, MAX_CONTENIDO, AUTONOMIAS };
