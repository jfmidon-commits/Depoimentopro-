const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-session-secret-'.repeat(4);

const { hashPassword, verifyPassword } = require('../lib/auth');

test('hashPassword não armazena senha em texto puro', () => {
  const password = 'SenhaMuitoForte123!';
  const stored = hashPassword(password);
  assert.match(stored, /^scrypt\$/);
  assert.equal(stored.includes(password), false);
});

test('verifyPassword aceita senha correta e rejeita incorreta', () => {
  const stored = hashPassword('SenhaMuitoForte123!');
  assert.equal(verifyPassword('SenhaMuitoForte123!', stored), true);
  assert.equal(verifyPassword('senha-errada', stored), false);
});

test('verifyPassword rejeita hash inválido sem lançar erro', () => {
  assert.equal(verifyPassword('qualquer', 'hash-invalido'), false);
});
