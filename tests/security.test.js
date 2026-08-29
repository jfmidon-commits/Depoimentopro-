const test = require('node:test');
const assert = require('node:assert/strict');

const { allowRate, rateKey, randomToken } = require('../lib/security');

test('randomToken gera tokens diferentes', () => {
  const a = randomToken(24);
  const b = randomToken(24);
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test('rateKey não expõe o valor original', () => {
  const key = rateKey('login-account', 'cliente@example.com');
  assert.equal(key.includes('cliente@example.com'), false);
  assert.match(key, /^login-account:[a-f0-9]{24}$/);
});

test('allowRate bloqueia acima do limite local', () => {
  const key = rateKey('test', `${Date.now()}-${Math.random()}`);
  assert.equal(allowRate(key, { limit: 2, windowMs: 60_000 }), true);
  assert.equal(allowRate(key, { limit: 2, windowMs: 60_000 }), true);
  assert.equal(allowRate(key, { limit: 2, windowMs: 60_000 }), false);
});
