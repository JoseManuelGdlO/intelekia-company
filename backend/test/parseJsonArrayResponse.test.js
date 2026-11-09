const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

test('parses a plain JSON array with no fences', () => {
  const result = parseJsonArrayResponse('["a", "b"]');
  assert.deepEqual(result, ['a', 'b']);
});

test('strips a ```json fenced array before parsing', () => {
  const result = parseJsonArrayResponse('```json\n["a", "b"]\n```');
  assert.deepEqual(result, ['a', 'b']);
});

test('strips a plain ``` fenced array (no language tag) before parsing', () => {
  const result = parseJsonArrayResponse('```\n["a", "b"]\n```');
  assert.deepEqual(result, ['a', 'b']);
});

test('rescata el arreglo cuando el modelo agrega texto antes o después', () => {
  const raw = 'No tengo acceso a datos. Aquí hay ideas: [\n "[Reel] Idea A",\n "[Carrusel] Idea B"\n] Espero que sirvan.';
  assert.deepEqual(parseJsonArrayResponse(raw), ['[Reel] Idea A', '[Carrusel] Idea B']);
});

test('throws wrapping the original error when the response is not valid JSON', () => {
  assert.throws(() => parseJsonArrayResponse('esto no es json'), /La respuesta del modelo no es JSON válido/);
});

test('throws with the given message when valid JSON is not an array', () => {
  assert.throws(
    () => parseJsonArrayResponse('{}', { emptyArrayErrorMessage: 'mensaje personalizado' }),
    /mensaje personalizado/
  );
});

test('throws with a default message when valid JSON is not an array and no custom message is given', () => {
  assert.throws(() => parseJsonArrayResponse('{}'), /La respuesta del modelo no es un arreglo/);
});
