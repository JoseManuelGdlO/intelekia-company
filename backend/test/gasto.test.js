const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGasto, segundosDeAudio } = require('../lib/gasto');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gasto-')), 'gasto.json');
// Fechas en UTC; la oficina usa America/Monterrey (UTC-6 todo el año).
const martes10 = new Date('2026-11-10T16:00:00Z'); // martes 10 de nov, 10:00 local
const casiMedianoche = new Date('2026-11-11T05:59:00Z'); // martes 10, 23:59 local
const miercoles = new Date('2026-11-11T06:01:00Z'); // miércoles 11, 00:01 local

const millon = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

test('precio por prefijo más largo del modelo', () => {
  const g = createGasto({ filePath: tmpFile(), now: () => martes10 });
  g.registrarTokens('gpt-4o-mini-2024-07-18', millon);
  assert.equal(g.hoy().usd, 0.75);
  g.registrarTokens('gpt-4.1-nano', millon);
  assert.equal(g.hoy().usd, 1.25);
  g.registrarTokens('gpt-4.1-mini-2025-04-14', millon);
  assert.equal(g.hoy().usd, 3.25);
  g.registrarTokens('gpt-4.1', millon);
  assert.equal(g.hoy().usd, 13.25);
  const h = g.hoy();
  assert.equal(h.llamadas, 4);
  assert.equal(h.tokensEntrada, 4_000_000);
  assert.equal(h.tokensSalida, 4_000_000);
});

test('modelo desconocido usa los precios de gpt-4o', () => {
  const g = createGasto({ filePath: tmpFile(), now: () => martes10 });
  g.registrarTokens('modelo-raro', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(g.hoy().usd, 2.5);
  g.registrarTokens(undefined, { prompt_tokens: 0, completion_tokens: 100_000 });
  assert.equal(g.hoy().usd, 3.5);
});

test('se pueden reemplazar los precios', () => {
  const g = createGasto({ filePath: tmpFile(), now: () => martes10, precios: { tokens: { 'gpt-4o-mini': { entrada: 1, salida: 1 } }, audio: { transcripcionPorMinuto: 1 } } });
  g.registrarTokens('gpt-4o-mini', millon);
  assert.equal(g.hoy().usd, 2);
  g.registrarAudio({ tipo: 'transcripcion', segundos: 30 });
  assert.equal(g.hoy().usd, 2.5);
});

test('audio: transcripción por minuto y voz por mil caracteres', () => {
  const g = createGasto({ filePath: tmpFile(), now: () => martes10 });
  g.registrarAudio({ tipo: 'transcripcion', segundos: 120 });
  assert.equal(g.hoy().usd, 0.006);
  g.registrarAudio({ tipo: 'voz', caracteres: 2000 });
  assert.equal(g.hoy().usd, 0.036);
  assert.equal(g.hoy().llamadas, 2);
  assert.equal(segundosDeAudio(20000), 10);
});

test('acumula por día local de Monterrey (cruza la medianoche local, no la UTC)', () => {
  let ahora = martes10;
  const g = createGasto({ filePath: tmpFile(), now: () => ahora });
  g.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  ahora = casiMedianoche; // ya es miércoles en UTC, pero sigue siendo martes en Monterrey
  g.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(g.hoy().fecha, '2026-11-10');
  assert.equal(g.hoy().usd, 5);
  ahora = miercoles;
  assert.deepEqual(g.hoy(), { fecha: '2026-11-11', usd: 0, llamadas: 0, tokensEntrada: 0, tokensSalida: 0, limiteUsd: null, excedido: false });
});

test('límite: excedido al llegar, 0/null lo quitan, valida negativos', () => {
  const avisos = [];
  const g = createGasto({ filePath: tmpFile(), now: () => martes10, alExceder: (a) => avisos.push(a) });
  assert.equal(g.setLimite(5).limiteUsd, 5);
  g.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(g.hoy().excedido, false);
  g.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(g.hoy().excedido, true);
  g.registrarTokens('gpt-4o', { prompt_tokens: 10, completion_tokens: 0 });
  assert.equal(avisos.length, 1, 'avisa una sola vez por día');
  assert.deepEqual(avisos[0], { fecha: '2026-11-10', usd: 5, limiteUsd: 5 });
  assert.equal(g.setLimite(0).limiteUsd, null);
  assert.equal(g.hoy().excedido, false);
  assert.equal(g.setLimite(null).limiteUsd, null);
  assert.throws(() => g.setLimite(-1), /inválido/);
  assert.throws(() => g.setLimite('abc'), /inválido/);
  // Al volver a poner un límite ya rebasado, avisa de nuevo.
  g.setLimite(1);
  assert.equal(avisos.length, 2);
});

test('persiste y se recarga desde el archivo', () => {
  const filePath = tmpFile();
  const g = createGasto({ filePath, now: () => martes10 });
  g.setLimite(3);
  g.registrarTokens('gpt-4o-mini', millon);
  const otro = createGasto({ filePath, now: () => martes10 });
  assert.equal(otro.hoy().usd, 0.75);
  assert.equal(otro.hoy().limiteUsd, 3);
  assert.equal(otro.hoy().llamadas, 1);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
});

test('archivo dañado: empieza vacío', () => {
  const filePath = tmpFile();
  fs.writeFileSync(filePath, '{ esto no es json');
  const g = createGasto({ filePath, now: () => martes10 });
  assert.equal(g.hoy().usd, 0);
  assert.equal(g.hoy().limiteUsd, null);
  g.registrarTokens('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(g.hoy().usd, 2.5);
});

test('conserva solo los últimos 31 días', () => {
  const filePath = tmpFile();
  let ahora = new Date('2026-10-01T18:00:00Z');
  const g = createGasto({ filePath, now: () => ahora });
  for (let i = 0; i < 40; i += 1) {
    ahora = new Date(Date.UTC(2026, 9, 1 + i, 18));
    g.registrarTokens('gpt-4o', { prompt_tokens: 1000, completion_tokens: 0 });
  }
  const dias = Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf-8')).dias).sort();
  assert.equal(dias.length, 31);
  assert.equal(dias[30], '2026-11-09');
  assert.equal(dias[0], '2026-10-10');
});

test('registrar nunca lanza con datos basura', () => {
  const g = createGasto({ filePath: tmpFile(), now: () => martes10 });
  assert.doesNotThrow(() => {
    g.registrarTokens('gpt-4o', null);
    g.registrarTokens('gpt-4o', 'x');
    g.registrarTokens(null, { prompt_tokens: 'mucho', completion_tokens: -5 });
    g.registrarTokens({}, { prompt_tokens: NaN });
    g.registrarAudio(null);
    g.registrarAudio({ tipo: 'otro' });
    g.registrarAudio({ tipo: 'voz', caracteres: 'x' });
    g.registrarAudio({ tipo: 'transcripcion', segundos: -10 });
  });
  assert.equal(g.hoy().usd, 0);
  // Aun si no se puede escribir el archivo, no lanza.
  const roto = createGasto({ filePath: path.join(tmpFile(), 'no', '\0invalido'), now: () => martes10 });
  assert.doesNotThrow(() => roto.registrarTokens('gpt-4o', millon));
});
