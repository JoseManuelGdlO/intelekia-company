const test = require('node:test');
const assert = require('node:assert/strict');
const { createTvEstado, limpiarTexto } = require('../lib/tvEstado');
const { createActividadStore } = require('../lib/actividad');

// 2026-11-11 10:00 en Monterrey (UTC-6).
const AHORA = new Date('2026-11-11T16:00:00Z');
const hace = (horas) => new Date(AHORA.getTime() - horas * 3600 * 1000).toISOString();

function actividadCon(eventos) {
  let i = 0;
  const store = createActividadStore({ now: () => new Date(eventos[i].fecha) });
  for (; i < eventos.length; i += 1) store.log(eventos[i].agentId, eventos[i].tipo, eventos[i].texto, eventos[i].detalle);
  return store;
}

function deps(extra = {}) {
  return {
    now: () => AHORA,
    timeZone: 'America/Monterrey',
    estadoOficina: () => ({
      abierta: true,
      puedeTrabajar: true,
      motivo: 'Dentro de horario (09:00–18:00).',
      entrada: '09:00',
      salida: '18:00',
      dias: [1, 2, 3, 4, 5],
      respetarHorario: true,
      gasto: { fecha: '2026-11-11', usd: 1.2, limiteUsd: 5, excedido: false, llamadas: 9, tokensEntrada: 100 },
    }),
    departamentos: () => [
      { id: 'marketing', label: 'Marketing', agents: [{ id: 'publicador', label: 'Publicador', deps: { apiKey: 'sk-secreto' } }] },
      { id: 'comercial', label: 'Comercial', agents: [{ id: 'cotizador', label: 'Cotizador' }] },
    ],
    estatus: () => ({ publicador: { estatus: 'trabajando', ultimaAccion: 'Escribió a ana@cliente.com' } }),
    actividad: actividadCon([
      { agentId: 'publicador', tipo: 'inicio', fecha: hace(20), texto: 'Ayer (local) inicia' }, // 2026-11-10 14:00 local
      { agentId: 'publicador', tipo: 'inicio', fecha: hace(1), texto: '▶️ Inicia ciclo autónomo' },
      { agentId: 'cotizador', tipo: 'inicio', fecha: hace(0.5), texto: '▶️ Inicia ciclo autónomo' },
      { agentId: 'cotizador', tipo: 'chat', fecha: hace(0.4), texto: 'El fundador: mi secreto' },
      { agentId: 'cotizador', tipo: 'respuesta', fecha: hace(0.3), texto: 'Respuesta privada' },
      { agentId: 'cotizador', tipo: 'nota', fecha: hace(0.2), texto: 'Envió cotización a ana@cliente.com, tel +52 (81) 1234-5678, ver https://x.com/a', detalle: 'detalle secreto' },
    ]),
    conversaciones: {
      list: () => [
        { id: 'c1', de: 'pm', para: 'cotizador', pregunta: 'x', inicio: hace(2), actualizado: hace(2) },
        { id: 'c2', de: 'pm', para: 'cotizador', pregunta: 'y', inicio: hace(17), actualizado: hace(17) }, // ayer local
      ],
    },
    leerIdeas: () => [{ id: 'i1', creadaEn: hace(3) }, { id: 'i2', creadaEn: hace(30) }],
    leerProspectos: () => [
      { id: 'p1', negocio: 'Café Aromas de Ana', giro: 'Cafetería', creadoEn: hace(2) },
      { id: 'p2', negocio: 'Viejo', giro: 'Taller', creadoEn: hace(48) },
    ],
    revisiones: () => [
      { clave: 'dueno/intelekia-web#3', owner: 'dueno', repo: 'intelekia-web', sha: 'abc', veredicto: 'aprobado_mergeado', autor: 'Fulano', titulo: 'feat x', revisadoEn: hace(1) },
      { clave: 'dueno/otro#4', owner: 'dueno', repo: 'otro', sha: 'def', veredicto: 'cambios_pedidos', revisadoEn: hace(2) },
      { clave: 'dueno/viejo#1', owner: 'dueno', repo: 'viejo', sha: 'zzz', veredicto: 'aprobado_mergeado', revisadoEn: hace(40) },
    ],
    aprobaciones: {
      list: () => [
        { id: 'a1', agentId: 'respuestas-redes', tipo: 'responder_comentario', titulo: 'Responder a Juan Pérez', estado: 'aprobado', creadoEn: hace(5), resueltoEn: hace(1) },
        { id: 'a2', agentId: 'respuestas-redes', tipo: 'responder_comentario', titulo: 'x', estado: 'por_aprobar', creadoEn: hace(1), resueltoEn: null },
        { id: 'a3', agentId: 'publicador', tipo: 'publicar_post', titulo: 'y', estado: 'aprobado', creadoEn: hace(40), resueltoEn: hace(30) },
        { id: 'a4', agentId: 'x', tipo: 'otro', titulo: 'z', estado: 'error', creadoEn: hace(1), resueltoEn: null },
      ],
    },
    ...extra,
  };
}

test('limpiarTexto quita correos, URLs y teléfonos, colapsa espacios y recorta a 120', () => {
  const t = limpiarTexto('Escribe  a ana.lopez@cliente.com.mx o www.cliente.com y https://x.io/a?b=1 al +52 (81) 1234-5678 o 8112345678.');
  assert.doesNotMatch(t, /@|cliente\.com|https|www|1234|8112345678/);
  assert.match(t, /^Escribe a/);
  assert.doesNotMatch(t, / {2}/);
  assert.equal(limpiarTexto('Ciclo 5 de 7, ticket 1234'), 'Ciclo 5 de 7, ticket 1234');
  const largo = limpiarTexto('a'.repeat(300));
  assert.equal(largo.length, 120);
  assert.ok(largo.endsWith('…'));
  assert.equal(limpiarTexto(null), '');
});

test('estado devuelve exactamente la forma pública', () => {
  const e = createTvEstado(deps()).estado();
  assert.deepEqual(Object.keys(e).sort(), ['actividad', 'celebraciones', 'departamentos', 'dia', 'gasto', 'oficina']);
  assert.deepEqual(e.oficina, { abierta: true, puedeTrabajar: true, motivo: 'Dentro de horario (09:00–18:00).', entrada: '09:00', salida: '18:00' });
  assert.deepEqual(e.gasto, { usd: 1.2, limiteUsd: 5, excedido: false });
  assert.deepEqual(e.departamentos, [
    { id: 'marketing', label: 'Marketing', agentes: [{ id: 'publicador', label: 'Publicador', estatus: 'trabajando' }] },
    { id: 'comercial', label: 'Comercial', agentes: [{ id: 'cotizador', label: 'Cotizador', estatus: 'idle' }] },
  ]);
  for (const ev of e.actividad) assert.deepEqual(Object.keys(ev).sort(), ['agente', 'fecha', 'texto', 'tipo']);
  for (const c of e.celebraciones) assert.deepEqual(Object.keys(c).sort(), ['id', 'texto', 'tipo']);
  const json = JSON.stringify(e);
  assert.doesNotMatch(json, /sk-secreto|ana@|detalle secreto|Juan Pérez|Fulano|Aromas/);
});

test('contadores del día usan el día local (no UTC)', () => {
  const { dia } = createTvEstado(deps()).estado();
  assert.deepEqual(dia, {
    ciclos: 2,
    ideas: 1,
    prospectos: 1,
    prsRevisados: 2,
    aprobacionesPendientes: 2,
    aprobadasHoy: 1,
    conversaciones: 1,
  });
});

test('cruce de medianoche: a las 00:30 locales lo de las 23:30 de ayer ya no cuenta', () => {
  const ahora = new Date('2026-11-12T06:30:00Z'); // 00:30 del 12 en Monterrey; en UTC ya era el 12 desde hace 6.5 h
  const tv = createTvEstado(
    deps({
      now: () => ahora,
      leerIdeas: () => [
        { id: 'antes', creadaEn: '2026-11-12T05:30:00Z' }, // 23:30 del 11 local (pero 12 en UTC)
        { id: 'despues', creadaEn: '2026-11-12T06:10:00Z' }, // 00:10 del 12 local
      ],
    })
  );
  assert.equal(tv.estado().dia.ideas, 1);
});

test('actividad: solo inicios/fines/errores, sanitiza, usa el nombre del agente y es la más reciente primero', () => {
  const { actividad } = createTvEstado(deps()).estado();
  assert.ok(actividad.every((a) => ['inicio', 'fin', 'error'].includes(a.tipo)));
  assert.doesNotMatch(JSON.stringify(actividad), /secreto|privada|ana@|1234-5678|https|cotización/);
  assert.equal(actividad[0].agente, 'Cotizador');
  assert.equal(actividad[0].tipo, 'inicio');
  assert.equal(actividad.length, 3);
});

test('actividad: oculta herramientas/resultados (nombres y comentarios) y muestra avisos de la oficina', () => {
  const eventos = [
    { agentId: 'respuestas-redes', tipo: 'herramienta', fecha: hace(0.5), texto: '💬 Instagram · Juan Pérez: "mi pedido"' },
    { agentId: 'cotizador', tipo: 'resultado', fecha: hace(0.4), texto: 'Fila: Clínica X, deuda 5000' },
    { agentId: 'pm', tipo: 'pensando', fecha: hace(0.3), texto: 'pensando en Juan' },
    { agentId: 'oficina', tipo: 'nota', fecha: hace(0.2), texto: '🔴 Cerraste la oficina' },
    { agentId: 'cotizador', tipo: 'error', fecha: hace(0.1), texto: '❌ El ciclo falló' },
  ];
  const { actividad } = createTvEstado(deps({ actividad: actividadCon(eventos) })).estado();
  assert.doesNotMatch(JSON.stringify(actividad), /Juan|Clínica|deuda/);
  assert.deepEqual(actividad.map((a) => a.tipo), ['error', 'nota']);
});

test('actividad: como máximo 30 eventos', () => {
  const eventos = Array.from({ length: 50 }, (_, i) => ({ agentId: 'pm', tipo: 'inicio', fecha: hace(50 - i), texto: `paso ${i}` }));
  const { actividad } = createTvEstado(deps({ actividad: actividadCon(eventos) })).estado();
  assert.equal(actividad.length, 30);
  assert.equal(actividad[0].texto, 'paso 49');
  assert.equal(actividad[0].agente, 'pm');
});

test('celebraciones de las últimas 24 h con texto genérico e ids estables', () => {
  const tv = createTvEstado(deps());
  const { celebraciones } = tv.estado();
  const ids = celebraciones.map((c) => c.id).sort();
  assert.deepEqual(ids, ['aprobacion:a1', 'pr:dueno/intelekia-web#3:abc', 'prospecto:p1']);
  const porId = Object.fromEntries(celebraciones.map((c) => [c.id, c]));
  assert.deepEqual(porId['pr:dueno/intelekia-web#3:abc'], { id: 'pr:dueno/intelekia-web#3:abc', tipo: 'pr', texto: 'PR aprobado en intelekia-web' });
  assert.deepEqual(porId['prospecto:p1'], { id: 'prospecto:p1', tipo: 'prospecto', texto: 'Nuevo prospecto: Cafetería' });
  assert.deepEqual(porId['aprobacion:a1'], { id: 'aprobacion:a1', tipo: 'aprobacion', texto: 'Respuesta aprobada' });
  assert.deepEqual(tv.estado().celebraciones, celebraciones);
});

test('celebración de aprobación de una publicación', () => {
  const tv = createTvEstado(
    deps({ aprobaciones: { list: () => [{ id: 'b1', tipo: 'publicar_post', titulo: 'Post para Ana', estado: 'aprobado', resueltoEn: hace(1) }] } })
  );
  assert.deepEqual(tv.estado().celebraciones.filter((c) => c.tipo === 'aprobacion'), [{ id: 'aprobacion:b1', tipo: 'aprobacion', texto: 'Publicación aprobada' }]);
});

test('una fuente que falla deja ceros o vacío, nunca rompe', () => {
  const falla = () => {
    throw new Error('archivo dañado');
  };
  const e = createTvEstado({
    now: () => AHORA,
    estadoOficina: falla,
    departamentos: falla,
    estatus: falla,
    actividad: { recientes: falla },
    conversaciones: { list: falla },
    leerIdeas: falla,
    leerProspectos: falla,
    revisiones: falla,
    aprobaciones: { list: falla },
  }).estado();
  assert.deepEqual(e.dia, { ciclos: 0, ideas: 0, prospectos: 0, prsRevisados: 0, aprobacionesPendientes: 0, aprobadasHoy: 0, conversaciones: 0 });
  assert.deepEqual(e.actividad, []);
  assert.deepEqual(e.celebraciones, []);
  assert.deepEqual(e.departamentos, []);
  assert.deepEqual(e.gasto, { usd: 0, limiteUsd: null, excedido: false });
  assert.equal(typeof e.oficina.puedeTrabajar, 'boolean');
});

test('sin revisor de PRs (revisiones null) cuenta cero', () => {
  const e = createTvEstado(deps({ revisiones: null })).estado();
  assert.equal(e.dia.prsRevisados, 0);
  assert.ok(e.celebraciones.every((c) => c.tipo !== 'pr'));
});

test('un estatus de agente con datos sucios no se filtra: solo pasa el campo estatus', () => {
  const e = createTvEstado(deps({ estatus: () => ({ cotizador: { estatus: 'error', error: 'Falló con ana@cliente.com' } }) })).estado();
  assert.equal(e.departamentos[1].agentes[0].estatus, 'error');
  assert.doesNotMatch(JSON.stringify(e.departamentos), /ana@/);
});
