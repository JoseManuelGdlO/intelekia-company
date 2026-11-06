const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeItemId } = require('../lib/validateItemId');

test('does not throw for a valid itemId', () => {
  assert.doesNotThrow(() => assertSafeItemId('idea-123-0', 'no debería lanzarse'));
});

test('throws the given message when itemId is undefined', () => {
  assert.throws(() => assertSafeItemId(undefined, 'itemId inválido o faltante'), /itemId inválido o faltante/);
});

test('throws the given message when itemId contains path-traversal characters', () => {
  assert.throws(() => assertSafeItemId('../../etc/passwd', 'itemId inválido o faltante'), /itemId inválido o faltante/);
});
