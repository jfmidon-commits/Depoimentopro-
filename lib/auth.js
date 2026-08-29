const crypto = require('node:crypto');
const { requireSessionSecret } = require('./config');

const COOKIE = 'dpro_session';
const MAX_AGE = 60 * 60 * 24 * 14;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function sign(value) {
  return crypto.createHmac('sha256', requireSessionSecret()).update(value).digest('base64url');
}

function makeSession(userId) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [decodeURIComponent(i >= 0 ? p.slice(0, i) : p), decodeURIComponent(i >= 0 ? p.slice(i + 1) : '')];
  }));
}

function readSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const payload = `${userId}.${exp}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) return null;
  return { userId, exp: Number(exp) };
}

function setSession(res, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeSession(userId))}; HttpOnly; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`);
}

function clearSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

module.exports = { hashPassword, verifyPassword, readSession, setSession, clearSession };
