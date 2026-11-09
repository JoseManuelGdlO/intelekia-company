const fs = require('fs');
const path = require('path');

/**
 * Reglas de comunicación entre agentes.
 *
 * Cada regla es DIRIGIDA: dice a quién puede consultar un agente (no quién le puede consultar a él).
 *   - nadie:         no consulta a nadie
 *   - area:          a sus compañeros del mismo departamento
 *   - todos:         a cualquier agente de cualquier departamento
 *   - personalizado: solo a los ids de `permitidos` (de su área o de otras)
 *
 * Los agentes sin regla propia usan su `comunicacionPorDefecto` (si lo declaran, p. ej. el PM)
 * o, si no, el `porDefecto` general.
 */
const ALCANCES = ['nadie', 'area', 'todos', 'personalizado'];
const DEFAULT_CONFIG = { porDefecto: 'area', reglas: {} };

function createComunicacionStore({ configPath, departments }) {
  function read() {
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG, reglas: {} };
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      porDefecto: ALCANCES.includes(raw.porDefecto) && raw.porDefecto !== 'personalizado' ? raw.porDefecto : 'area',
      reglas: raw.reglas && typeof raw.reglas === 'object' ? raw.reglas : {},
    };
  }

  function write(config) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  function allAgents() {
    return departments.flatMap((dept) => dept.agents.map((agent) => ({ agent, departmentId: dept.id })));
  }

  function findAgent(agentId) {
    return allAgents().find(({ agent }) => agent.id === agentId) || null;
  }

  function ruleFor(agentId, config = read()) {
    const rule = config.reglas[agentId];
    if (rule && ALCANCES.includes(rule.alcance)) {
      return { alcance: rule.alcance, permitidos: Array.isArray(rule.permitidos) ? rule.permitidos : [] };
    }
    const own = findAgent(agentId)?.agent.comunicacionPorDefecto;
    return { alcance: own && own !== 'personalizado' && ALCANCES.includes(own) ? own : config.porDefecto, permitidos: [], heredada: true };
  }

  /** Ids de los agentes que `agentId` puede consultar ahora mismo. */
  function allowedTargetIds(agentId, config = read()) {
    const origin = findAgent(agentId);
    if (!origin) return [];
    const { alcance, permitidos } = ruleFor(agentId, config);
    return allAgents()
      .filter(({ agent, departmentId }) => {
        if (agent.id === agentId) return false;
        if (alcance === 'todos') return true;
        if (alcance === 'area') return departmentId === origin.departmentId;
        if (alcance === 'personalizado') return permitidos.includes(agent.id);
        return false;
      })
      .map(({ agent }) => agent.id);
  }

  function canTalk(fromId, toId) {
    return allowedTargetIds(fromId).includes(toId);
  }

  function setRule(agentId, { alcance, permitidos }) {
    if (!findAgent(agentId)) {
      throw new Error(`Agente desconocido: ${agentId}`);
    }
    if (alcance === null || alcance === 'heredar') {
      const config = read();
      delete config.reglas[agentId];
      write(config);
      return ruleFor(agentId, config);
    }
    if (!ALCANCES.includes(alcance)) {
      throw new Error(`alcance inválido: ${alcance}. Usa uno de: ${ALCANCES.join(', ')}`);
    }
    let lista = [];
    if (alcance === 'personalizado') {
      if (!Array.isArray(permitidos)) {
        throw new Error('permitidos debe ser una lista de ids de agentes');
      }
      const desconocido = permitidos.find((id) => !findAgent(id));
      if (desconocido) {
        throw new Error(`Agente desconocido en permitidos: ${desconocido}`);
      }
      lista = [...new Set(permitidos.filter((id) => id !== agentId))];
    }
    const config = read();
    config.reglas[agentId] = { alcance, permitidos: lista };
    write(config);
    return ruleFor(agentId, config);
  }

  function setDefault(alcance) {
    if (!['nadie', 'area', 'todos'].includes(alcance)) {
      throw new Error('porDefecto debe ser nadie, area o todos');
    }
    const config = read();
    config.porDefecto = alcance;
    write(config);
    return config;
  }

  /** Aplica la misma regla a todos los agentes (borra las reglas individuales). */
  function setAll(alcance) {
    const config = setDefault(alcance);
    config.reglas = {};
    // Los agentes con su propio valor por defecto (p. ej. el PM) también reciben la regla elegida.
    allAgents().forEach(({ agent }) => {
      if (agent.comunicacionPorDefecto) config.reglas[agent.id] = { alcance, permitidos: [] };
    });
    write(config);
    return config;
  }

  /** Vista completa para el editor: reglas efectivas y a quién puede consultar cada agente. */
  function snapshot() {
    const config = read();
    const reglas = {};
    const permitidos = {};
    allAgents().forEach(({ agent }) => {
      reglas[agent.id] = ruleFor(agent.id, config);
      permitidos[agent.id] = allowedTargetIds(agent.id, config);
    });
    return { porDefecto: config.porDefecto, reglas, permitidos };
  }

  return { read, ruleFor, allowedTargetIds, canTalk, setRule, setDefault, setAll, snapshot, findAgent, ALCANCES };
}

module.exports = { createComunicacionStore, ALCANCES };
