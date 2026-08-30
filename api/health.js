const { requireAirtable, requireSessionSecret } = require('../lib/config');
const { json, method, ensureRequestId } = require('../lib/http');
const { rateLimitBackend } = require('../lib/rate-limit');
const { isEnabled: turnstileEnabled } = require('../lib/turnstile');
const { billingState } = require('../lib/stripe');
const { logError } = require('../lib/logger');

module.exports = async (req, res) => {
  const requestId = ensureRequestId(req, res);
  if (!method(req, res, ['GET'])) return;

  const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  const version = commit ? commit.slice(0, 12) : 'unknown';

  try {
    requireAirtable();
    requireSessionSecret();
  } catch (error) {
    logError('health.config_invalid', error, { requestId, route: '/api/health' });
    return json(res, 503, { ok: false, service: 'depoimentopro', version });
  }

  const billing = billingState();
  return json(res, 200, {
    ok: true,
    service: 'depoimentopro',
    version,
    protections: {
      rateLimit: rateLimitBackend(),
      turnstile: turnstileEnabled(),
    },
    billing: {
      mode: billing.mode,
      checkoutConfigured: billing.checkoutConfigured,
      webhookConfigured: billing.webhookConfigured,
      liveEnabled: billing.mode === 'live' ? billing.liveEnabled : false,
    },
  });
};
