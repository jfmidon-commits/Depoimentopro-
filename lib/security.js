const crypto = require('node:crypto');
const buckets = new Map();

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }

function allowRate(key, { limit = 8, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

module.exports = { randomToken, allowRate };
