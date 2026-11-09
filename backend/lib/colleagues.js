const fs = require('fs');
const path = require('path');

const TOOL_NAME = 'consultar_companero';
const DB_TOOL_NAME = 'consultar_base_datos';
const EMAIL_TOOL_NAME = 'enviar_correo';
const MAX_DB_ROUNDS = 6;
const MAX_TOOL_ROUNDS = 3;
const MAX_FILE_CHARS = 3000;
const MAX_DIR_FILES = 3;
const MAX_DIR_FILE_CHARS = 1200;
// Archivos de deps que NO son "conocimiento de trabajo" de un agente.
const PRIVATE_DEPS = new Set(['contextPath', 'rolePath', 'memoryPath']);

function corto(text, max = 220) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Cómo se ve cada herramienta en la bitácora de actividad (qué hace y qué obtuvo). */
function describirLlamada(nombre, args, labelOf) {
  if (nombre === TOOL_NAME) return { texto: `🤝 Le pregunta a ${labelOf(args.agente_id)}: ${corto(args.pregunta)}` };
  if (nombre === DB_TOOL_NAME) return { texto: `🗄️ Consulta la base de datos${args.motivo ? `: ${corto(args.motivo)}` : ''}`, detalle: args.sql };
  if (nombre === EMAIL_TOOL_NAME) {
    return { texto: `✉️ Envía correo a ${(args.para || []).join(', ')}: "${corto(args.asunto, 120)}"`, detalle: args.cuerpo };
  }
  return { texto: `🔧 Usa ${nombre}` };
}

function resumirResultado(nombre, result, labelOf, args) {
  if (/^Error:/.test(result)) return { tipo: 'error', texto: `⚠️ ${corto(result, 300)}` };
  if (nombre === DB_TOOL_NAME) {
    try {
      const data = JSON.parse(result);
      return { tipo: 'resultado', texto: `Recibió ${data.filas} fila(s)${data.truncado ? ' (recortado)' : ''}`, detalle: JSON.stringify(data.datos?.slice(0, 5), null, 1) };
    } catch {
      return { tipo: 'resultado', texto: 'Recibió datos de la base' };
    }
  }
  if (nombre === TOOL_NAME) return { tipo: 'resultado', texto: `${labelOf(args.agente_id)} respondió: ${corto(result, 400)}` };
  return { tipo: 'resultado', texto: corto(result, 400) };
}

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
  database = null,
  mailer = null,
  actividad = null,
  instalables = null,
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
      actividad?.log(toId, 'chat', `🤝 ${from ? from.agent.label : fromId} le consultó: ${corto(pregunta)}`);
      const respuesta = await createChatCompletion({ apiKey, model, messages: profiles ? profiles.decorate(toId, messages) : messages });
      actividad?.log(toId, 'respuesta', `Le respondió a ${from ? from.agent.label : fromId}: ${corto(respuesta, 400)}`);
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

  function dbToolFor(schemaText) {
    const status = database.status();
    return {
      type: 'function',
      function: {
        name: DB_TOOL_NAME,
        description:
          `Ejecuta UNA consulta SQL de SOLO LECTURA (SELECT) en la base MySQL "${status.baseDatos}". ` +
          `Sin SELECT *, sin comentarios, máximo ${database.MAX_ROWS} filas. Tablas y columnas disponibles:\n${schemaText}`,
        parameters: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'Una sola consulta SELECT' },
            motivo: { type: 'string', description: 'Para qué necesitas estos datos, en una frase' },
          },
          required: ['sql'],
        },
      },
    };
  }

  function completionFor(agentId) {
    return async function completionWithColleagues({ apiKey, model, messages: original, ajustarHerramientas, maxRondas }) {
      // Skills, plugins y memoria del perfil del agente.
      const messages = profiles ? profiles.decorate(agentId, original) : original;

      const tools = [];
      const handlers = {};
      const instrucciones = [];

      const targetIds = comunicacion.allowedTargetIds(agentId);
      if (targetIds.length) {
        const directorio = targetIds
          .map((id) => `- ${id}: ${comunicacion.findAgent(id).agent.label} (área ${departmentLabelOf(id)})`)
          .join('\n');
        tools.push(toolFor(targetIds));
        handlers[TOOL_NAME] = (args) => consult({ fromId: agentId, toId: args.agente_id, pregunta: args.pregunta, apiKey, model });
        instrucciones.push(
          `Trabajas en equipo. Si te falta información que un compañero podría tener, puedes consultarlo con la herramienta ${TOOL_NAME}. ` +
            `Úsala solo cuando realmente ayude y no repitas la misma pregunta.\nCompañeros disponibles:\n${directorio}`
        );
      }

      const dbEnabled = database && database.isConfigured() && profiles?.hasTool(agentId, 'baseDatos');
      if (dbEnabled) {
        try {
          tools.push(dbToolFor(await database.schema()));
          handlers[DB_TOOL_NAME] = async (args) =>
            database.formatForModel(await database.query(args.sql, { agentId, motivo: args.motivo || '' }));
          instrucciones.push(
            `Tienes acceso de solo lectura a la base de datos "${database.status().baseDatos}" con la herramienta ${DB_TOOL_NAME}. ` +
              'Consulta los datos reales antes de afirmar algo sobre ellos; nunca inventes registros. ' +
              'Si una consulta falla, corrígela con el mensaje de error.'
          );
        } catch (err) {
          instrucciones.push(`La base de datos no está disponible en este momento (${err.message}). Dilo si la necesitas.`);
        }
      }

      const emailEnabled = mailer && mailer.isConfigured() && profiles?.hasTool(agentId, 'correo');
      if (emailEnabled) {
        const estado = mailer.status();
        const permitidos = estado.permitidos.length ? estado.permitidos.join(', ') : '(ninguno: todo quedará por aprobar)';
        tools.push({
          type: 'function',
          function: {
            name: EMAIL_TOOL_NAME,
            description:
              `Envía un correo desde ${estado.remitente}. Se envía directo solo si todos los destinatarios están en la lista permitida ` +
              `(${permitidos}); si no, queda en la bandeja "por aprobar" del fundador. Texto plano, en español, breve y profesional.`,
            parameters: {
              type: 'object',
              properties: {
                para: { type: 'array', items: { type: 'string' }, description: 'Correos de los destinatarios' },
                cc: { type: 'array', items: { type: 'string' }, description: 'Correos en copia (opcional)' },
                asunto: { type: 'string' },
                cuerpo: { type: 'string', description: 'Cuerpo en texto plano; la firma se agrega sola' },
              },
              required: ['para', 'asunto', 'cuerpo'],
            },
          },
        });
        handlers[EMAIL_TOOL_NAME] = async (args) => {
          const item = await mailer.enviar({ agentId, para: args.para, cc: args.cc, asunto: args.asunto, cuerpo: args.cuerpo });
          if (item.estado === 'enviado') return `Correo enviado a ${item.para.join(', ')} (asunto: "${item.asunto}").`;
          if (item.estado === 'por_aprobar') return `El correo NO se envió todavía: quedó por aprobar del fundador. Motivo: ${item.motivo}.`;
          return `No se pudo enviar el correo: ${item.error}`;
        };
        instrucciones.push(
          `Puedes enviar correos con la herramienta ${EMAIL_TOOL_NAME}. Envía solo cuando aporte algo concreto, nunca repitas el mismo correo ` +
            'y nunca inventes direcciones: usa solo correos que conozcas con certeza. Al terminar, di claramente si el correo se envió o quedó por aprobar.'
        );
      }

      // Skills y plugins instalados desde internet (GitHub / servidores MCP).
      const describirExtra = {};
      if (instalables && profiles?.instaladosOf) {
        const extra = instalables.paraAgente(profiles.instaladosOf(agentId));
        tools.push(...extra.tools);
        Object.assign(handlers, extra.handlers);
        Object.assign(describirExtra, extra.describir);
        instrucciones.push(...extra.instrucciones);
      }

      // El agente puede restringir o envolver sus herramientas para esta llamada (p. ej. el revisor de PRs).
      if (typeof ajustarHerramientas === 'function') {
        const ajustado = ajustarHerramientas({ tools: [...tools], handlers: { ...handlers }, instrucciones: [...instrucciones] });
        tools.splice(0, tools.length, ...ajustado.tools);
        Object.keys(handlers).forEach((k) => delete handlers[k]);
        Object.assign(handlers, ajustado.handlers);
        if (Array.isArray(ajustado.instrucciones)) instrucciones.splice(0, instrucciones.length, ...ajustado.instrucciones);
      }

      const act =(tipo, texto, detalle) => actividad?.log(agentId, tipo, texto, detalle);
      const labelOf = (id) => comunicacion.findAgent(id)?.agent.label || id;

      if (!tools.length) {
        act('pensando', '💭 Pensando la respuesta…');
        const plain = instrucciones.length
          ? [...messages.slice(0, 1), { role: 'system', content: instrucciones.join('\n\n') }, ...messages.slice(1)]
          : messages;
        try {
          const respuesta = await createChatCompletion({ apiKey, model, messages: plain });
          act('respuesta', `💬 ${corto(respuesta, 500)}`);
          return respuesta;
        } catch (err) {
          act('error', `❌ Falló la llamada al modelo: ${err.message}`);
          throw err;
        }
      }

      const convo = [
        ...messages.slice(0, 1),
        {
          role: 'system',
          content:
            `${instrucciones.join('\n\n')}\n` +
            'Antes de usar una herramienta, escribe en una sola frase qué vas a hacer y por qué (el fundador lo ve en vivo). ' +
            'Al terminar, entrega tu respuesta final exactamente en el formato que se te pidió.',
        },
        ...messages.slice(1),
      ];
      // Explorar una base de datos suele requerir varias consultas.
      const rounds = Number.isInteger(maxRondas) && maxRondas > 0 ? maxRondas : handlers[DB_TOOL_NAME] ? Math.max(maxRounds, MAX_DB_ROUNDS) : maxRounds;

      try {
        for (let round = 0; round < rounds; round += 1) {
          act('pensando', round === 0 ? '💭 Pensando qué hacer…' : `💭 Analizando lo que obtuvo (paso ${round + 1})…`);
          const reply = await createChatCompletionMessage({ apiKey, model, messages: convo, tools });
          if (!reply.tool_calls || !reply.tool_calls.length) {
            act('respuesta', `💬 ${corto(reply.content, 500)}`);
            return reply.content ?? '';
          }
          if (reply.content && reply.content.trim()) act('nota', `🗒️ ${corto(reply.content, 500)}`);
          convo.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
          for (const call of reply.tool_calls) {
            const nombre = call.function?.name;
            let args = {};
            let result;
            try {
              const handler = handlers[nombre];
              if (!handler) throw new Error(`Herramienta desconocida: ${nombre}`);
              args = JSON.parse(call.function.arguments || '{}');
              const d = describirExtra[nombre] ? { texto: describirExtra[nombre](args) } : describirLlamada(nombre, args, labelOf);
              act('herramienta', d.texto, d.detalle);
              result = await handler(args);
            } catch (err) {
              result = `Error: ${err.message}`;
            }
            const r = resumirResultado(nombre, result, labelOf, args);
            act(r.tipo, r.texto, r.detalle);
            convo.push({ role: 'tool', tool_call_id: call.id, content: result });
          }
        }

        // Se acabaron las rondas: pedir la respuesta final sin más herramientas.
        act('pensando', '💭 Redactando la respuesta final…');
        const final = await createChatCompletionMessage({ apiKey, model, messages: convo, tools, toolChoice: 'none' });
        act('respuesta', `💬 ${corto(final.content, 500)}`);
        return final.content ?? '';
      } catch (err) {
        act('error', `❌ Falló la llamada al modelo: ${err.message}`);
        throw err;
      }
    };
  }

  return { completionFor, consult };
}

module.exports = { createColleagues, knowledgeOf, TOOL_NAME, DB_TOOL_NAME, EMAIL_TOOL_NAME };
