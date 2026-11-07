const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createColleagues, knowledgeOf, TOOL_NAME } = require('../lib/colleagues');
const { createComunicacionStore } = require('../lib/comunicacionStore');
const { createConversacionesStore } = require('../lib/conversacionesStore');

function tmp(name, content) {
  const p = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
}

function setup({ createChatCompletion, createChatCompletionMessage }) {
  const prospectosPath = tmp('prospectos.json', JSON.stringify([{ negocio: 'Café Aromas' }]));
  const departments = [
    { id: 'marketing', agents: [{ id: 'publicador', label: 'Publicador', deps: {} }] },
    {
      id: 'comercial',
      agents: [{ id: 'prospectos', label: 'Buscador de Prospectos', roleText: 'Eres el buscador de prospectos.', deps: { prospectosPath } }],
    },
  ];
  const comunicacion = createComunicacionStore({ configPath: tmp('com.json'), departments });
  const conversaciones = createConversacionesStore({ filePath: tmp('conv.json') });
  const colleagues = createColleagues({
    comunicacion,
    conversaciones,
    createChatCompletion,
    createChatCompletionMessage,
    contextPath: tmp('ctx.md', '# Intelekia'),
  });
  return { comunicacion, conversaciones, colleagues, departments };
}

const base = { apiKey: 'k', model: 'm', messages: [{ role: 'system', content: 'rol' }, { role: 'user', content: 'tarea' }] };

test('sin compañeros permitidos usa la llamada normal, sin herramientas', async () => {
  let plainCalls = 0;
  const { comunicacion, colleagues } = setup({
    createChatCompletion: async () => {
      plainCalls += 1;
      return 'respuesta normal';
    },
    createChatCompletionMessage: async () => assert.fail('no debe usar herramientas'),
  });
  comunicacion.setRule('publicador', { alcance: 'nadie' });
  const result = await colleagues.completionFor('publicador')(base);
  assert.equal(result, 'respuesta normal');
  assert.equal(plainCalls, 1);
});

test('consulta a un compañero permitido y usa su respuesta para terminar', async () => {
  const seen = [];
  const { comunicacion, conversaciones, colleagues } = setup({
    createChatCompletion: async ({ messages }) => {
      // El compañero consultado recibe su rol, el contexto y sus datos de trabajo.
      assert.equal(messages[0].content, 'Eres el buscador de prospectos.');
      assert.match(messages[2].content, /Café Aromas/);
      assert.match(messages.at(-1).content, /Publicador/);
      return 'Café Aromas es el mejor prospecto';
    },
    createChatCompletionMessage: async ({ messages, tools }) => {
      seen.push(messages);
      assert.deepEqual(tools[0].function.parameters.properties.agente_id.enum, ['prospectos']);
      if (seen.length === 1) {
        return {
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: TOOL_NAME, arguments: JSON.stringify({ agente_id: 'prospectos', pregunta: '¿A quién le escribo?' }) } }],
        };
      }
      assert.equal(messages.at(-1).role, 'tool');
      assert.equal(messages.at(-1).content, 'Café Aromas es el mejor prospecto');
      return { content: 'Post dirigido a cafeterías' };
    },
  });
  comunicacion.setRule('publicador', { alcance: 'personalizado', permitidos: ['prospectos'] });

  const result = await colleagues.completionFor('publicador')(base);
  assert.equal(result, 'Post dirigido a cafeterías');
  assert.match(seen[0][1].content, /prospectos: Buscador de Prospectos/);
  const [conv] = conversaciones.list();
  assert.equal(conv.de, 'publicador');
  assert.equal(conv.para, 'prospectos');
  assert.equal(conv.estado, 'completada');
});

test('una consulta a un agente no permitido se rechaza y se le informa al modelo', async () => {
  let round = 0;
  const { conversaciones, colleagues, departments } = setup({
    createChatCompletion: async () => assert.fail('no debe consultar a nadie'),
    createChatCompletionMessage: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        // El modelo intenta consultar a alguien de otra área sin permiso.
        return { tool_calls: [{ id: 'c1', function: { name: TOOL_NAME, arguments: JSON.stringify({ agente_id: 'publicador', pregunta: 'hola' }) } }] };
      }
      assert.match(messages.at(-1).content, /no tiene permiso para consultar a Publicador/);
      return { content: 'sigo sin ayuda' };
    },
  });
  departments[1].agents.push({ id: 'cotizador', label: 'Cotizador', deps: {} });

  const result = await colleagues.completionFor('prospectos')(base);
  assert.equal(result, 'sigo sin ayuda');
  assert.equal(conversaciones.list().length, 0);
});

test('tras agotar las rondas pide la respuesta final sin más herramientas', async () => {
  const choices = [];
  const { comunicacion, colleagues } = setup({
    createChatCompletion: async () => 'dato',
    createChatCompletionMessage: async ({ toolChoice }) => {
      choices.push(toolChoice);
      if (toolChoice === 'none') return { content: 'final' };
      return { tool_calls: [{ id: `c${choices.length}`, function: { name: TOOL_NAME, arguments: JSON.stringify({ agente_id: 'prospectos', pregunta: 'x' }) } }] };
    },
  });
  comunicacion.setRule('publicador', { alcance: 'todos' });
  const result = await colleagues.completionFor('publicador')(base);
  assert.equal(result, 'final');
  assert.deepEqual(choices, [undefined, undefined, undefined, 'none']);
});

test('knowledgeOf incluye archivos de datos y entregables, nunca rol ni memoria', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-'));
  fs.writeFileSync(path.join(dir, 'draft-1.md'), 'Borrador sobre bots');
  const knowledge = knowledgeOf({
    ideasPath: tmp('ideas.json', '[{"texto":"idea uno"}]'),
    draftsDir: dir,
    rolePath: tmp('rol.md', 'SECRETO DEL ROL'),
    memoryPath: tmp('mem.md', 'MEMORIA PRIVADA'),
    apiKey: 'sk-123',
  });
  assert.match(knowledge, /idea uno/);
  assert.match(knowledge, /Borrador sobre bots/);
  assert.doesNotMatch(knowledge, /SECRETO|MEMORIA|sk-123/);
});

test('con perfiles, decora los mensajes y guarda la consulta en la memoria de ambos', async () => {
  const remembered = [];
  const decorated = [];
  const profiles = {
    decorate: (id, messages) => {
      decorated.push(id);
      return messages;
    },
    remember: (id, texto) => remembered.push({ id, texto }),
  };
  const prospectosPath = tmp('prospectos.json', '[]');
  const departments = [
    { id: 'marketing', agents: [{ id: 'publicador', label: 'Publicador', deps: {} }] },
    { id: 'comercial', agents: [{ id: 'prospectos', label: 'Buscador de Prospectos', deps: { prospectosPath } }] },
  ];
  const comunicacion = createComunicacionStore({ configPath: tmp('com.json'), departments });
  comunicacion.setRule('publicador', { alcance: 'todos' });
  const colleagues = createColleagues({
    comunicacion,
    conversaciones: createConversacionesStore({ filePath: tmp('conv.json') }),
    createChatCompletion: async () => 'cafeterías',
    createChatCompletionMessage: async () => ({ content: 'ok' }),
    contextPath: tmp('ctx.md', '# Intelekia'),
    profiles,
  });
  await colleagues.consult({ fromId: 'publicador', toId: 'prospectos', pregunta: '¿giros?', apiKey: 'k', model: 'm' });
  await colleagues.completionFor('publicador')(base);
  assert.deepEqual(decorated, ['prospectos', 'publicador']);
  assert.match(remembered[0].texto, /Consulté a Buscador de Prospectos: ¿giros\?\nMe respondió: cafeterías/);
  assert.match(remembered[1].texto, /Publicador me consultó/);
});
