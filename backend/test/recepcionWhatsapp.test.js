const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre } = require('../lib/recepcionWhatsapp');
const { createAprobaciones } = require('../lib/aprobaciones');

const YO = '5218710000000';
const YO_N = '528710000000'; // como se le contesta (sin el 1 de los celulares de México)
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
  assert.ok(enviados.every((e) => e.to === YO_N));
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
  assert.equal(textos(enviados).at(-1), '✅ #1 aprobado y ejecutado (Instagram · carla).');
  await r.procesar(msg('m3', 'Descartar #2'));
  assert.equal(aprob.list({ estado: 'descartado' })[0].id, a2.id);
  assert.equal(textos(enviados).at(-1), '🗑️ #2 descartado (Facebook · ana).');
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
  assert.deepEqual(plantillas[0], { to: YO_N, tipo: 'plantilla', nombre: 'aviso_pendientes', idioma: 'es_MX', params: ['1'] });
});

test('los números cortos nunca se reutilizan, aunque ya no haya pendientes', async () => {
  const { r, enviados, aprob, deps } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  await r.procesar(msg('m2', 'descartar 1'));
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.match(textos(enviados).at(-1), /✋ #2 /);
  await r.procesar(msg('m3', 'aprobar 1'));
  assert.match(textos(enviados).at(-1), /No encuentro el pendiente #1/);
  // también tras reiniciar (el contador se guarda)
  const r2 = createRecepcionWhatsapp(deps);
  await r2.avisarAprobacion(aprob.proponer(ITEM));
  assert.match(textos(enviados).at(-1), /✋ #3 /);
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

test('normaliza los números de México: llega 521…, se compara y se contesta como 52…', async () => {
  const { r, enviados, chats } = setup({ permitidos: [YO_N] });
  await r.procesar(msg('m1', 'PM hola'));
  assert.equal(chats.length, 1);
  assert.ok(enviados.length > 0 && enviados.every((e) => e.to === YO_N));
  assert.deepEqual(r.estadoCanal().ventanas, { '…0000': true });
});

test('mensajes viejos (reintentos de Meta) no ejecutan nada y se avisa', async () => {
  const { r, enviados, chats, ciclos, aprob } = setup();
  aprob.proponer(ITEM);
  const largo = 'PM, revisa todo ahora por favor y dime qué pasó con los proyectos de esta semana y la anterior';
  await r.procesar(msg('m1', largo, { fecha: '2026-11-10T11:45:00Z' }));
  await r.procesar(msg('m2', 'aprobar 1', { fecha: '2026-11-10T11:40:00Z' }));
  assert.equal(chats.length, 0);
  assert.equal(ciclos.length, 0);
  assert.equal(aprob.list({ estado: 'aprobado' }).length, 0);
  const t = textos(enviados);
  assert.equal(t.length, 2);
  assert.match(t[0], /^⏰ Me llegó tarde tu mensaje del .*5:45/);
  assert.ok(t[0].endsWith(`(«${largo.slice(0, 80)}»). Si aún lo necesitas, mándamelo de nuevo.`));
  assert.ok(t[1].includes('(«aprobar 1»)'));
  await r.procesar(msg('m3', 'PM hola', { fecha: '2026-11-10T11:55:00Z' }));
  assert.equal(chats.length, 1);
});

test('la ventana de 24 h se cuenta desde la hora del mensaje, no desde que llegó', async () => {
  const { r, enviados, aprob, reloj } = setup();
  await r.procesar(msg('m1', 'pendientes', { fecha: '2026-11-10T11:51:00Z' }));
  reloj.avanzar(24 * 3600 * 1000 - 5 * 60 * 1000);
  const antes = enviados.length;
  await r.avisarAprobacion(aprob.proponer(ITEM));
  assert.equal(enviados.length, antes);
});

test('plantilla: dos avisos simultáneos mandan una sola; si falla se puede reintentar', async () => {
  const lento = setup({ plantilla: { nombre: 'aviso', idioma: 'es_MX' } });
  lento.deps.whatsapp.enviarPlantilla = async (to) => {
    await new Promise((res) => setTimeout(res, 10));
    lento.enviados.push({ to, tipo: 'plantilla' });
  };
  await Promise.all([lento.r.avisarAprobacion(lento.aprob.proponer(ITEM)), lento.r.avisarAprobacion(lento.aprob.proponer(ITEM))]);
  assert.equal(lento.enviados.filter((e) => e.tipo === 'plantilla').length, 1);

  const intentos = [];
  const falla = setup({ plantilla: { nombre: 'aviso', idioma: 'es_MX' } });
  falla.deps.whatsapp.enviarPlantilla = async () => {
    intentos.push(1);
    if (intentos.length === 1) throw new Error('caído');
  };
  await falla.r.avisarAprobacion(falla.aprob.proponer(ITEM));
  await falla.r.avisarAprobacion(falla.aprob.proponer(ITEM));
  await falla.r.avisarAprobacion(falla.aprob.proponer(ITEM));
  assert.equal(intentos.length, 2);
});

test('los mensajes del mismo número se atienden en orden, uno tras otro', async () => {
  const { r, enviados } = setup({
    chatDe: async (id, texto) => {
      await new Promise((res) => setTimeout(res, texto === 'primero' ? 30 : 1));
      return `re: ${texto}`;
    },
  });
  await Promise.all([r.procesar(msg('m1', 'PM primero')), r.procesar(msg('m2', 'PM segundo'))]);
  assert.deepEqual(textos(enviados), ['⏳ Se lo paso a PM…', '*PM:* re: primero', '⏳ Se lo paso a PM…', '*PM:* re: segundo']);
});

test('comandos con puntuación y números en palabras (dictados por voz)', async () => {
  const { r, enviados, aprob } = setup();
  const items = [1, 2, 3].map((i) => aprob.proponer({ ...ITEM, titulo: `Item ${i}` }));
  await r.procesar(msg('m1', 'Pendientes.'));
  assert.match(textos(enviados).at(-1), /Tienes 3 pendiente/);
  await r.procesar(msg('m2', '¿pendientes?'));
  assert.match(textos(enviados).at(-1), /Tienes 3 pendiente/);
  await r.procesar(msg('m3', 'Aprobar tres.'));
  assert.equal(textos(enviados).at(-1), '✅ #3 aprobado y ejecutado (Item 3).');
  assert.equal(aprob.list({ estado: 'aprobado' })[0].id, items[2].id);
  await r.procesar(msg('m4', 'descarta #2!'));
  assert.equal(textos(enviados).at(-1), '🗑️ #2 descartado (Item 2).');
  await r.procesar(msg('m5', 'Aprueba uno'));
  assert.equal(textos(enviados).at(-1), '✅ #1 aprobado y ejecutado (Item 1).');
  await r.procesar(msg('m6', '?'));
  assert.match(textos(enviados).at(-1), /Trabajadores:/);
});

test('detectarPorNombre: nombre sin la última palabra y palabras distintivas al inicio', () => {
  assert.deepEqual(detectarPorNombre('Revisor de PR, revisa lo nuevo', AGENTES), { agente: AGENTES[5], resto: 'revisa lo nuevo' });
  assert.deepEqual(detectarPorNombre('Tendencias: ideas para hoy', AGENTES), { agente: AGENTES[3], resto: 'ideas para hoy' });
  assert.equal(detectarPorNombre('prospectos dame 5', AGENTES).agente.id, 'buscador-prospectos');
  assert.equal(detectarPorNombre('Buscador de algo', AGENTES), null);
  assert.equal(detectarPorNombre('hoy tendencias', AGENTES), null);
  assert.equal(detectarPorNombre('de nada', AGENTES), null);
});

test('al contestar a "¿a quién se lo paso?" con el nombre (o casi) usa el mensaje pendiente', async () => {
  const duda = async () => ({ agentId: null, accion: 'chat', duda: ['buscador-tendencias', 'buscador-prospectos'] });
  const casos = [
    ['Prospectos', 'Búscame algo nuevo'],
    ['Buscador de Prospectos, va', 'Búscame algo nuevo'],
    ['Prospectos porfa', 'porfa'],
  ];
  for (const [respuesta, esperado] of casos) {
    const { r, chats } = setup({ enrutarConIA: duda });
    await r.procesar(msg('m1', 'Búscame algo nuevo'));
    await r.procesar(msg('m2', respuesta));
    assert.deepEqual(chats, [{ id: 'buscador-prospectos', texto: esperado }], respuesta);
  }
  const { r, chats } = setup({ enrutarConIA: duda });
  await r.procesar(msg('m1', 'Búscame algo nuevo'));
  await r.procesar(msg('m2', 'Seguimiento proyectos'));
  assert.deepEqual(chats, [{ id: 'seguimiento-crm', texto: 'Búscame algo nuevo' }]);
});

test('solo se pregunta a la IA por el ciclo si el texto lo sugiere (por nombre y en seguimiento)', async () => {
  const rutas = [];
  const { r, chats, ciclos } = setup({
    enrutarConIA: async (texto, lista) => {
      rutas.push({ texto, ids: lista.map((a) => a.id) });
      return { agentId: lista[0].id, accion: /ciclo/.test(texto) ? 'forzar_ciclo' : 'chat', duda: [] };
    },
  });
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  assert.equal(rutas.length, 0);
  await r.procesar(msg('m2', '¿y ayer?'));
  assert.equal(rutas.length, 0);
  assert.deepEqual(chats.map((c) => c.id), ['pm', 'pm']);
  await r.procesar(msg('m3', 'Corre tu ciclo ahora.'));
  assert.deepEqual(rutas, [{ texto: 'Corre tu ciclo ahora.', ids: ['pm'] }]);
  assert.deepEqual(ciclos, ['pm']);
});

test('el seguimiento de 15 min cuenta desde que llegó la respuesta', async () => {
  const chats = [];
  const { r, rutas, reloj } = setup({
    chatDe: async (id, texto) => {
      chats.push({ id, texto });
      reloj.avanzar(14 * 60 * 1000); // el trabajador tardó en contestar
      return 'ok';
    },
  });
  await r.procesar(msg('m1', 'PM, ¿cómo va el equipo?'));
  reloj.avanzar(10 * 60 * 1000);
  await r.procesar(msg('m2', '¿y ayer?'));
  assert.deepEqual(chats.map((c) => c.id), ['pm', 'pm']);
  assert.equal(rutas.length, 0);
});

test('si el comando es "pendientes" no repite los avisos acumulados', async () => {
  const { r, enviados, aprob, reloj } = setup();
  await r.procesar(msg('m1', 'pendientes'));
  reloj.avanzar(25 * 3600 * 1000);
  await r.avisarAprobacion(aprob.proponer(ITEM));
  const antes = enviados.length;
  await r.procesar(msg('m2', 'pendientes'));
  const nuevos = textos(enviados.slice(antes));
  assert.equal(nuevos.length, 1);
  assert.match(nuevos[0], /Tienes 1 pendiente/);
  await r.procesar(msg('m3', 'PM hola'));
  assert.ok(!textos(enviados.slice(antes)).some((t) => /Mientras no estabas/.test(t)));
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
