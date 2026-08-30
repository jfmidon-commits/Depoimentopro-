const SECRET_KEY_RE = /(password|senha|secret|token|cookie|authorization|airtable|email|nome|texto|mensagem)/i;

function secretValues() {
  return [
    process.env.AIRTABLE_TOKEN,
    process.env.SESSION_SECRET,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.TURNSTILE_SECRET_KEY,
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_WEBHOOK_SECRET,
  ].filter(value => typeof value === 'string' && value.length >= 8);
}

function redactString(value) {
  let output = String(value || '');
  for (const secret of secretValues()) output = output.split(secret).join('[REDACTED]');
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
  output = output.replace(/\b(?:pat|sk|whsec)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  return output.length > 600 ? `${output.slice(0, 600)}…` : output;
}

function sanitize(value, key = '', depth = 0) {
  if (SECRET_KEY_RE.test(String(key))) return '[REDACTED]';
  if (depth > 4) return '[TRUNCATED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, '', depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 30)) {
      result[childKey] = sanitize(childValue, childKey, depth + 1);
    }
    return result;
  }
  return redactString(value);
}

function log(level, event, metadata = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event: String(event || 'event'),
    ...sanitize(metadata),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function logError(event, error, metadata = {}) {
  log('error', event, {
    ...metadata,
    error: {
      name: error?.name || 'Error',
      message: redactString(error?.message || 'Erro desconhecido'),
    },
  });
}

module.exports = { log, logError, sanitize, redactString };
