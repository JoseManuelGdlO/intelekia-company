const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../lib/slugify');

test('slugify normalizes accents and spaces into a url-safe fragment', () => {
  assert.equal(slugify('Bot de WhatsApp con IA'), 'bot-de-whatsapp-con-ia');
  assert.equal(slugify('Automatización de Procesos'), 'automatizacion-de-procesos');
});

test('slugify produces a url-safe id fragment for a short label', () => {
  assert.equal(slugify('Objection Handling'), 'objection-handling');
});
