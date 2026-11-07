const fs = require('fs');
const path = require('path');

const TOOL_NAME = 'consultar_companero';
const MAX_TOOL_ROUNDS = 3;
const MAX_FILE_CHARS = 3000;
const MAX_DIR_FILES = 3;
const MAX_DIR_FILE_CHARS = 1200;
// Archivos de deps que NO son "conocimiento de trabajo" de un agente.
const PRIVATE_DEPS = new Set(['contextPath', 'rolePath', 'memoryPath']);

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n…(recortado)` : text;
}

/** Lo que un agente "sabe" de su propio trabajo: sus archivos de datos y sus últimos entregables. */
function knowledgeOf(deps = {}) {
  const parts = [];
  Object.entries(deps).forEach(([key, value]) => {
    if (typeof value !== 'string' || PRIVATE_DEPS.has(key)) return;
    if (key.endsWith('Path') && fs.existsSync(value) && fs.statSync(value).isFile()) {
      parts.push(`### ${path.basename(value)}\n${truncate(fs.readFileSync(value, 'utf-8'), MAX_FILE_CHARS)}`);
    } else if (key.endsWith('Dir') && fs.existsSync(value)) {
      const files = fs
        .readdirSync(value)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(value, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, MAX_DIR_FILES);
      files.forEach(({ f }) => {
        parts.push(`### ${f}\n${truncate(fs.readFileSync(path.join(value, f), 'utf-8'), MAX_DIR_FILE_CHARS)}`);
      });
    }
  });
  return parts.join('\n\n');
}

function roleOf(agent) {
  if (agent.roleText) return agent.roleText;
  if (agent.deps?.rolePath && fs.existsSync(agent.deps.rolePath)) {
    return fs.readFileSync(agent.deps.rolePath, 'utf-8');
  }
  return `Eres ${agent.label}, un agente de Intelekia.`;
}

/**
 * Permite que los agentes se consulten entre sí respetando las reglas de comunicación.
 *
 * `completionFor(agentId)` devuelve una función con la MISMA firma que `createChatCompletion`
 * ({ apiKey, model, messages } -> string), así cualquier agente existente gana la capacidad
 * de consultar compañeros sin cambiar su código. Las respuestas de un compañero consultado no
 * pueden a su vez consultar a otros (profundidad 1), lo que evita ciclos y costos desbocados.
 */
function createColleagues({
  comunicacion,
  conversaciones,
  createChatCompletion,
  createChatCompletionMessage,
  contextPath,
  profiles = null,
  maxRounds = MAX_TOOL_ROUNDS,
}) {
  function departmentLabelOf(agentId) {
    const found = comunicacion.findAgent(agentId);
    return found ? found.departmentId : '';
  }

  async function consult({ fromId, toId, pregunta, apiKey, model }) {
    const from = comunicacion.findAgent(fromId);
    const to = comunicacion.findAgent(toId);
    if (!to) throw new Error(`No existe el agente ${toId}`);
    if (!comunicacion.canTalk(fromId, toId)) {
      throw new Error(`${from ? from.agent.label : fromId} no tiene permiso para consultar a ${to.agent.label}`);
    }
    if (!pregunta || !String(pregunta).trim()) throw new Error('La pregunta está vacía');

    const conversacion = conversaciones.start({ de: fromId, para: toId, pregunta: String(pregunta) });
    try {
      const context = contextPath && fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf-8') : '';
      const knowledge = knowledgeOf(to.agent.deps);
      const messages = [
        { role: 'system', content: roleOf(to.agent) },
        { role: 'system', content: `Contexto de negocio:\n${context}` },
      ];
      if (knowledge) {
        messages.push({ role: 'system', content: `Información actual de tu trabajo:\n${knowledge}` });
      }
      messages.push({
        role: 'user',
        content:
          `Tu compañero ${from.agent.label} (área ${from.departmentId}) te consulta:\n${pregunta}\n\n` +
          'Respóndele de forma breve, concreta y útil, como colega de trabajo. Si no sabes algo, dilo.',
      });
      const respuesta = await createChatCompletion({ apiKey, model, messages: profiles ? profiles.decorate(toId, messages) : messages });
      conversaciones.finish(conversacion.id, { respuesta });
      if (profiles) {
        profiles.remember(fromId, `Consulté a ${to.agent.label}: ${pregunta}\nMe respondió: ${respuesta}`);
        profiles.remember(toId, `${from.agent.label} me consultó: ${pregunta}\nLe respondí: ${respuesta}`);
      }
      return respuesta;
    } catch (err) {
      conversaciones.finish(conversacion.id, { error: err.message });
      throw err;
    }
  }

  function toolFor(targetIds) {
    return {
      type: 'function',
      function: {
        name: TOOL_NAME,
        description:
          'Consulta a un compañero de Intelekia (de tu área o de otra) para obtener información o ayuda que necesitas para tu tarea.',
        parameters: {
          type: 'object',
          properties: {
            agente_id: { type: 'string', enum: targetIds, description: 'Id del compañero a consultar' },
            pregunta: { type: 'string', description: 'Pregunta concreta para tu compañero' },
          },
          required: ['agente_id', 'pregunta'],
        },
      },
    };
  }

  function completionFor(agentId) {
    return async function completionWithColleagues({ apiKey, model, messages: original }) {
      // Skills, plugins y memoria del perfil del agente.
      const messages = profiles ? profiles.decorate(agentId, original) : original;
      const targetIds = comunicacion.allowedTargetIds(agentId);
      if (!targetIds.length) {
        return createChatCompletion({ apiKey, model, messages });
      }

      const directorio = targetIds
        .map((id) => `- ${id}: ${comunicacion.findAgent(id).agent.label} (área ${departmentLabelOf(id)})`)
        .join('\n');
      const convo = [
        ...messages.slice(0, 1),
        {
          role: 'system',
          content:
            `Trabajas en equipo. Si te falta información que un compañero podría tener, puedes consultarlo con la herramienta ${TOOL_NAME}. ` +
            `Úsala solo cuando realmente ayude y no repitas la misma pregunta.\nCompañeros disponibles:\n${directorio}\n` +
            'Al terminar, entrega tu respuesta final exactamente en el formato que se te pidió.',
        },
        ...messages.slice(1),
      ];
      const tools = [toolFor(targetIds)];

      for (let round = 0; round < maxRounds; round += 1) {
        const reply = await createChatCompletionMessage({ apiKey, model, messages: convo, tools });
        if (!reply.tool_calls || !reply.tool_calls.length) {
          return reply.content ?? '';
        }
        convo.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
        for (const call of reply.tool_calls) {
          let result;
          try {
            if (call.function?.name !== TOOL_NAME) throw new Error(`Herramienta desconocida: ${call.function?.name}`);
            const args = JSON.parse(call.function.arguments || '{}');
            result = await consult({ fromId: agentId, toId: args.agente_id, pregunta: args.pregunta, apiKey, model });
          } catch (err) {
            result = `No se pudo consultar: ${err.message}`;
          }
          convo.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }

      // Se acabaron las rondas: pedir la respuesta final sin más consultas.
      const final = await createChatCompletionMessage({ apiKey, model, messages: convo, tools, toolChoice: 'none' });
      return final.content ?? '';
    };
  }

  return { completionFor, consult };
}

module.exports = { createColleagues, knowledgeOf, TOOL_NAME };
