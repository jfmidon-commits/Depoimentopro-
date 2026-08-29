const crypto = require('node:crypto');
const buckets = new Map();

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeRatePart(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function rateKey(scope, value) {
  return `${scope}:${normalizeRatePart(value)}`;
}

function cleanupExpired(now) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function allowRate(key, { limit = 8, windowMs = 60_000 } = {}) {
  const now = Date.now();
  cleanupExpired(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

module.exports = { randomToken, allowRate, rateKey };
