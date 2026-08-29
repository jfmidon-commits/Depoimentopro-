const test = require('node:test');
const assert = require('node:assert/strict');

const { requireSessionSecret } = require('../lib/config');

test('requireSessionSecret rejeita segredo ausente ou curto', () => {
  const previous = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.throws(() => requireSessionSecret(), /SESSION_SECRET/);
  process.env.SESSION_SECRET = 'curto';
  assert.throws(() => requireSessionSecret(), /SESSION_SECRET/);
  if (previous === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previous;
});

test('requireSessionSecret aceita segredo com 32+ caracteres', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'x'.repeat(64);
  assert.equal(requireSessionSecret(), 'x'.repeat(64));
  if (previous === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previous;
});
