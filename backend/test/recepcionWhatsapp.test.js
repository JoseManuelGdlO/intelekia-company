const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre } = require('../lib/recepcionWhatsapp');
const { createAprobaciones } = require('../lib/aprobaciones');

const YO = '5218710000000';
const AGENTES = [
  { id: 'pm', label: 'PM', rol: 'Da seguimiento al equipo' },
  { id: 'cotizador', label: 'Cotizador', rol: 'Cotiza proyectos' },
  { id: 'seguimiento-crm', label: 'Seguimiento de Proyectos', rol: 'Proyectos y tickets' },
  { id: 'buscador-tendencias', label: 'Buscador de Tendencias', rol: 'Ideas de contenido' },
  { id: 'buscador-prospectos', label: 'Buscador de Prospectos', rol: 'Prospectos' },
  { id: 'revisor-prs', label: 'Revisor de PRs', rol: 'Revisa PRs' },
];
const msg = (id, texto, extra = {}) => ({ id, de: YO, tipo: 'texto', texto, mediaId: null, fecha: null, ...extra });

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const enviados = [];
  const whatsapp = {
    enviarTexto: async (to, texto) => enviados.push({ to, tipo: 'texto', texto }),
    enviarAudio: async (to, buffer) => enviados.push({ to, tipo: 'audio', audio: buffer.toString() }),
    enviarPlantilla: async (to, nombre, idioma, params) => enviados.push({ to, tipo: 'plantilla', nombre, idioma, params }),
    descargarMedia: async () => ({ buffer: Buffer.from('ogg'), mime: 'audio/ogg' }),
  };
  const voz = { transcribir: async () => 'PM, cómo va el equipo', sintetizar: async (t) => Buffer.from(`voz:${t}`) };
  const chats = [];
  const ciclos = [];
  const rutas = [];
  const aprob = createAprobaciones({ filePath: path.join(dir, 'aprob.json') });
  aprob.registrarEjecutor('responder_comentario', async () => {});
  let t = Date.parse('2026-11-10T12:00:00Z');
  const reloj = { now: () => new Date(t), avanzar: (ms) => { t += ms; } };
  const deps = {
    whatsapp,
    voz,
    estadoPath: path.join(dir, 'whatsapp.json'),
    permitidos: [YO],
    agentes: () => AGENTES,
    chatDe: async (id, texto) => {
      chats.push({ id, texto });
      return `respuesta de ${id}`;
    },
    forzarCiclo: async (id) => {
      ciclos.push(id);
      return `ciclo de ${id} listo`;
    },
    aprobaciones: aprob,
    enrutarConIA: async (texto, lista) => {
      rutas.push({ texto, ids: lista.map((a) => a.id) });
      return { agentId: null, accion: 'chat', duda: [] };
    },
    labelOf: (id) => AGENTES.find((a) => a.id === id)?.label || id,
    registrar: () => {},
    plantilla: null,
    now: reloj.now,
    ...extra,
  };
  return { r: createRecepcionWhatsapp(deps), deps, enviados, chats, ciclos, rutas, aprob, reloj, dir };
}
const textos = (enviados) => enviados.filter((e) => e.tipo === 'texto').map((e) => e.texto);
const ITEM = { agentId: 'respuestas-redes', tipo: 'responder_comentario', titulo: 'Instagram · carla', propuesta: '¡Gracias!', contexto: { comentario: 'Me interesa' } };

test('detectarPorNombre: nombre completo, primera palabra única, y deja el resto del texto', () => {
  assert.deepEqual(detectarPorNombre('PM, ¿cómo va el equipo?', AGENTES), { agente: AGENTES[0], resto: '¿cómo va el equipo?' });
  assert.equal(detectarPorNombre('revisor: revisa lo nuevo', AGENTES).agente.id, 'revisor-prs');
  assert.equal(detectarPorNombre('Buscador de Prospectos dame 5', AGENTES).agente.id, 'buscador-prospectos');
  assert.equal(detectarPorNombre('Buscador dame ideas', AGENTES), null);
  assert.equal(detectarPorNombre('pmo del proyecto', AGENTES), null);
  assert.equal(detectarPorNombre('Cotizador', AGENTES).resto, '');
});

test('ignora números no permitidos y mensajes repetidos', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar({ ...msg('x1', 'PM hola'), de: '5210000000000' });
  await r.procesar(msg('m1', 'PM hola'));
  await r.procesar(msg('m1', 'PM hola'));
  assert.equal(chats.length, 1);
  assert.ok(enviados.every((e) => e.to === YO));
});

test('por nombre: avisa, conversa con el trabajador y le contesta', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  assert.deepEqual(chats, [{ id: 'pm', texto: '¿cómo va el equipo?' }]);
  assert.deepEqual(textos(enviados), ['⏳ Se lo paso a PM…', '*PM:* respuesta de pm']);
});

test('por nombre también puede forzar el ciclo si la IA lo indica', async () => {
  const { r, enviados, ciclos } = setup({ enrutarConIA: async () => ({ agentId: 'revisor-prs', accion: 'forzar_ciclo', duda: [] }) });
  await r.procesar(msg('m1', 'Revisor, revisa los PRs ahora'));
  assert.deepEqual(ciclos, ['revisor-prs']);
  assert.deepEqual(textos(enviados), ['⏳ Le pido a Revisor de PRs que corra su ciclo ahora…', '*Revisor de PRs:* ✅ Ciclo terminado: ciclo de revisor-prs listo']);
});

test('sin nombre: la IA elige al trabajador', async () => {
  const { r, chats, rutas } = setup({ enrutarConIA: async (texto, lista) => ({ agentId: 'cotizador', accion: 'chat', duda: [], _n: lista.length }) });
  await r.procesar(msg('m1', 'Cotiza una app de citas'));
  assert.deepEqual(chats, [{ id: 'cotizador', texto: 'Cotiza una app de citas' }]);
  assert.equal(rutas.length, 0);
});

test('con duda pregunta, y al contestar con el nombre usa el mensaje anterior', async () => {
  const { r, enviados, chats } = setup({ enrutarConIA: async () => ({ agentId: null, accion: 'chat', duda: ['buscador-tendencias', 'buscador-prospectos'] }) });
  await r.procesar(msg('m1', 'Búscame algo nuevo'));
  assert.match(textos(enviados)[0], /\*Buscador de Tendencias\*.*\*Buscador de Prospectos\*/s);
  await r.procesar(msg('m2', 'Buscador de Prospectos'));
  assert.deepEqual(chats, [{ id: 'buscador-prospectos', texto: 'Búscame algo nuevo' }]);
});

test('sin nombre ni duda: explica cómo dirigir el mensaje', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', 'algo'));
  assert.equal(chats.length, 0);
  assert.match(textos(enviados)[0], /Empieza tu mensaje con el nombre/);
  assert.match(textos(enviados)[0], /Revisor de PRs/);
});

test('seguimiento: en 15 min sigue con el mismo trabajador sin preguntar a la IA', async () => {
  const { r, chats, rutas, reloj } = setup();
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  const rutasTrasNombre = rutas.length;
  reloj.avanzar(10 * 60 * 1000);
  await r.procesar(msg('m2', '¿y ayer?'));
  assert.deepEqual(chats[1], { id: 'pm', texto: '¿y ayer?' });
  assert.equal(rutas.length, rutasTrasNombre);
  reloj.avanzar(16 * 60 * 1000);
  await r.procesar(msg('m3', '¿y hoy?'));
  assert.equal(rutas.length, rutasTrasNombre + 1);
});

test('audio: transcribe, confirma lo entendido y responde también con nota de voz', async () => {
  const { r, enviados, chats } = setup();
  await r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'MED1' }));
  assert.deepEqual(chats, [{ id: 'pm', texto: 'cómo va el equipo' }]);
  assert.deepEqual(enviados.map((e) => e.tipo), ['texto', 'texto', 'texto', 'audio']);
  assert.equal(enviados[0].texto, '🎙️ Entendí: "PM, cómo va el equipo"');
  assert.equal(enviados[3].audio, 'voz:respuesta de pm');
});

test('audio: si falla la voz manda solo texto; si falla la transcripción lo dice', async () => {
  const sinVoz = setup({ voz: { transcribir: async () => 'PM hola', sintetizar: async () => { throw new Error('tts caído'); } } });
  await sinVoz.r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'X' }));
  assert.ok(sinVoz.enviados.every((e) => e.tipo === 'texto'));
  assert.equal(textos(sinVoz.enviados).at(-1), '*PM:* respuesta de pm');
  const sinOido = setup({ voz: { transcribir: async () => { throw new Error('ruido'); }, sintetizar: async () => Buffer.from('') } });
  await sinOido.r.procesar(msg('m1', '', { tipo: 'audio', mediaId: 'X' }));
  assert.deepEqual(textos(sinOido.enviados), ['⚠️ No pude entender el audio: ruido']);
});

test('otros tipos y errores del trabajador se explican', async () => {
  const { r, enviados } = setup({ chatDe: async () => { throw new Error('boom'); } });
  await r.procesar(msg('m1', '', { tipo: 'otro' }));
  await r.procesar(msg('m2', 'PM hola'));
  assert.equal(textos(enviados)[0], 'Por ahora solo entiendo texto y audios 🙂');
  assert.equal(textos(enviados).at(-1), '⚠️ No pude completar tu pedido con PM: boom');
});

test('comandos: pendientes, aprobar y descartar por número corto', async () => {
  const { r, enviados, aprob } = setup();
  const a1 = aprob.proponer(ITEM);
  const a2 = aprob.proponer({ ...ITEM, titulo: 'Facebook · ana' });
  await r.procesar(msg('m1', 'pendientes'));
  assert.match(textos(enviados).at(-1), /Tienes 2 pendiente\(s\)/);
  assert.match(textos(enviados).at(-1), /#1.*Instagram · carla.*#2.*Facebook · ana/s);
  await r.procesar(msg('m2', 'aprobar 1'));
  assert.equal(aprob.list({ estado: 'aprobado' })[0].id, a1.id);
  assert.equal(textos(enviados).at(-1), '✅ #1 aprobado y ejecutado.');
  await r.procesar(msg('m3', 'Descartar #2'));
  assert.equal(aprob.list({ estado: 'descartado' })[0].id, a2.id);
  assert.equal(textos(enviados).at(-1), '🗑️ #2 descartado.');
  await r.procesar(msg('m4', 'aprobar 9'));
  assert.match(textos(enviados).at(-1), /No encuentro el pendiente #9/);
  await r.procesar(msg('m5', 'pendientes'));
  assert.equal(textos(enviados).at(-1), 'No hay pendientes ✨');
});

test('avisos dentro de la ventana de 24 h se mandan al momento con número corto', async () => {
  const { r, enviados, aprob } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  const item = aprob.proponer(ITEM);
  await r.avisarAprobacion(item);
  assert.match(textos(enviados).at(-1), /✋ #1 · respuestas-redes — Instagram · carla/);
  assert.match(textos(enviados).at(-1), /aprobar 1/);
});

test('fuera de la ventana sin plantilla: se acumulan y llegan al volver a escribir', async () => {
  const { r, enviados, aprob, reloj } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  reloj.avanzar(25 * 3600 * 1000);
  const antes = enviados.length;
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.equal(enviados.length, antes);
  await r.procesar(msg('m2', 'PM hola'));
  assert.match(enviados[antes].texto, /Mientras no estabas llegaron 1 pendiente/);
});

test('fuera de la ventana con plantilla: una sola plantilla por periodo', async () => {
  const { r, enviados, aprob, reloj } = setup({ plantilla: { nombre: 'aviso_pendientes', idioma: 'es_MX' } });
  await r.procesar(msg('m1', 'pendientes'));
  reloj.avanzar(25 * 3600 * 1000);
  await r.avisarAprobacion(aprob.proponer(ITEM));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  const plantillas = enviados.filter((e) => e.tipo === 'plantilla');
  assert.equal(plantillas.length, 1);
  assert.deepEqual(plantillas[0], { to: YO, tipo: 'plantilla', nombre: 'aviso_pendientes', idioma: 'es_MX', params: ['1'] });
});

test('los números cortos vuelven a 1 cuando ya no hay pendientes', async () => {
  const { r, enviados, aprob } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  await r.procesar(msg('m2', 'descartar 1'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.match(textos(enviados).at(-1), /✋ #1 /);
});

test('estado dañado se respalda y el canal sigue funcionando', async () => {
  const { r, deps, chats } = setup();
  fs.writeFileSync(deps.estadoPath, '{roto');
  const r2 = createRecepcionWhatsapp(deps);
  await r2.procesar(msg('m1', 'PM hola'));
  assert.equal(chats.length, 1);
  assert.ok(fs.readdirSync(path.dirname(deps.estadoPath)).some((f) => f.includes('.corrupto-')));
  assert.ok(r);
});

test('estadoCanal enmascara números e indica la ventana', async () => {
  const { r } = setup();
  assert.deepEqual(r.estadoCanal(), { permitidos: ['…0000'], ventanas: { '…0000': false } });
  await r.procesar(msg('m1', 'pendientes'));
  assert.deepEqual(r.estadoCanal().ventanas, { '…0000': true });
});

test('crearEnrutadorIA valida la respuesta del modelo', async () => {
  const conRespuesta = (raw) => crearEnrutadorIA({ createChatCompletion: async ({ messages }) => {
    assert.match(messages[1].content, /cotizador/);
    return raw;
  }, apiKey: 'k', model: 'm' });
  assert.deepEqual(await conRespuesta('{"agentId":"cotizador","accion":"chat","duda":[]}')('cotiza', AGENTES), { agentId: 'cotizador', accion: 'chat', duda: [] });
  assert.deepEqual(await conRespuesta('ok {"agentId":"revisor-prs","accion":"forzar_ciclo"}')('x', AGENTES), { agentId: 'revisor-prs', accion: 'forzar_ciclo', duda: [] });
  assert.deepEqual(await conRespuesta('{"agentId":"nadie","accion":"chat","duda":["pm","fantasma"]}')('x', AGENTES), { agentId: null, accion: 'chat', duda: ['pm'] });
  assert.deepEqual(await conRespuesta('no sé')('x', AGENTES), { agentId: null, accion: 'chat', duda: [] });
});
