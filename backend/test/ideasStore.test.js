const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');

function tempIdeasPath() {
  return path.join(os.tmpdir(), `ideas-${Date.now()}-${Math.random()}.json`);
}

test('readIdeas returns an empty array when the file does not exist', () => {
  const filePath = tempIdeasPath();
  assert.deepEqual(readIdeas(filePath), []);
});

test('writeIdeas then readIdeas returns the same array', () => {
  const filePath = tempIdeasPath();
  const ideas = [{ id: 'idea-1', texto: 'una idea', estatus: 'pendiente', creadaEn: '2026-01-01T00:00:00.000Z' }];

  writeIdeas(filePath, ideas);

  assert.deepEqual(readIdeas(filePath), ideas);
  fs.unlinkSync(filePath);
});
