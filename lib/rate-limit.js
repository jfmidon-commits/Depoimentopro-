const crypto = require('node:crypto');
const { json } = require('./http');
const { log } = require('./logger');

const memoryBuckets = new Map();
let lastFallbackWarningAt = 0;

const LIMITS = Object.freeze({
  signupIp: { scope: 'signup-ip', limit: 5, windowMs: 15 * 60_000 },
  loginIp: { scope: 'login-ip', limit: 12, windowMs: 15 * 60_000 },
  loginAccount: { scope: 'login-account', limit: 6, windowMs: 15 * 60_000 },
  testimonialIp: { scope: 'testimonial-ip', limit: 6, windowMs: 60_000 },
  campaignUser: { scope: 'campaign-user', limit: 20, windowMs: 10 * 60_000 },
  moderationUser: { scope: 'moderation-user', limit: 60, windowMs: 5 * 60_000 },
  widgetUser: { scope: 'widget-user', limit: 10, windowMs: 10 * 60_000 },
  billingCheckoutUser: { scope: 'billing-checkout-user', limit: 8, windowMs: 10 * 60_000 },
  billingPortalUser: { scope: 'billing-portal-user', limit: 12, windowMs: 10 * 60_000 },
  billingWebhookIp: { scope: 'billing-webhook-ip', limit: 120, windowMs: 60_000 },
});

function normalizeIdentity(identity) {
  const raw = Array.isArray(identity) ? identity.join('|') : String(identity || 'unknown');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function makeKey(scope, identity) {
  return `dpro:rl:${scope}:${normalizeIdentity(identity)}`;
}

function redisConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token, enabled: Boolean(url && token) };
}

function rateLimitBackend() {
  return redisConfig().enabled ? 'redis' : 'memory';
}

function cleanupMemory(now) {
  if (memoryBuckets.size < 500) return;
  for (const [key, bucket] of memoryBuckets.entries()) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
}

function memoryCheck(key, limit, windowMs, backend = 'memory') {
  const now = Date.now();
  cleanupMemory(now);
  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    backend,
  };
}

async function upstashCommand(command) {
  const config = redisConfig();
  if (!config.enabled) throw new Error('Upstash não configurado');
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  if (data.error) throw new Error(`Upstash: ${String(data.error).slice(0, 120)}`);
  return data.result;
}

async function redisCheck(key, limit, windowMs) {
  const count = Number(await upstashCommand(['INCR', key]));
  if (count === 1) await upstashCommand(['PEXPIRE', key, String(windowMs)]);
  let ttl = Number(await upstashCommand(['PTTL', key]));
  if (!Number.isFinite(ttl) || ttl < 0) {
    await upstashCommand(['PEXPIRE', key, String(windowMs)]);
    ttl = windowMs;
  }
  const now = Date.now();
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAt: now + ttl,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil(ttl / 1000)),
    backend: 'redis',
  };
}

async function checkRateLimit({ scope, identity, limit, windowMs }) {
  const key = makeKey(scope, identity);
  const config = redisConfig();
  if (!config.enabled) return memoryCheck(key, limit, windowMs);
  try {
    return await redisCheck(key, limit, windowMs);
  } catch (error) {
    const now = Date.now();
    if (now - lastFallbackWarningAt > 60_000) {
      lastFallbackWarningAt = now;
      log('warn', 'rate_limit.redis_fallback', { reason: error?.message || 'redis unavailable' });
    }
    return memoryCheck(key, limit, windowMs, 'memory-fallback');
  }
}

function setRateLimitHeaders(res, result) {
  if (!result) return;
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining || 0)));
  if (result.resetAt) res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
}

function rejectRateLimit(res, result, message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') {
  setRateLimitHeaders(res, result);
  res.setHeader('Retry-After', String(Math.max(1, result?.retryAfterSec || 1)));
  return json(res, 429, { error: message });
}

function resetMemoryRateLimits() {
  memoryBuckets.clear();
}

module.exports = {
  LIMITS,
  checkRateLimit,
  rejectRateLimit,
  setRateLimitHeaders,
  rateLimitBackend,
  makeKey,
  resetMemoryRateLimits,
};
