const crypto = require('node:crypto');
const { paidPlanKey } = require('./plans');

class BillingConfigError extends Error {
  constructor(message, statusCode = 503) {
    super(message);
    this.name = 'BillingConfigError';
    this.statusCode = statusCode;
  }
}

function config() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const priceStarter = String(process.env.STRIPE_PRICE_STARTER || '').trim();
  const pricePro = String(process.env.STRIPE_PRICE_PRO || '').trim();
  const live = secretKey.startsWith('sk_live_');
  const liveEnabled = String(process.env.BILLING_LIVE_ENABLED || '').toLowerCase() === 'true';
  return { secretKey, webhookSecret, priceStarter, pricePro, live, liveEnabled };
}

function appBaseUrl() {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : '';
  const raw = String(process.env.APP_URL || production).trim().replace(/\/$/, '');
  if (!raw) throw new BillingConfigError('APP_URL não configurada para billing.');
  let url;
  try { url = new URL(raw); } catch { throw new BillingConfigError('APP_URL inválida para billing.'); }
  const allowHttp = process.env.NODE_ENV !== 'production' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !allowHttp) throw new BillingConfigError('APP_URL precisa usar HTTPS em produção.');
  return url.origin;
}

function priceForPlan(planKey) {
  const key = paidPlanKey(planKey);
  const c = config();
  if (key === 'starter') return c.priceStarter || null;
  if (key === 'pro') return c.pricePro || null;
  return null;
}

function planForPrice(priceId) {
  const id = String(priceId || '').trim();
  const c = config();
  if (id && c.priceStarter && id === c.priceStarter) return 'starter';
  if (id && c.pricePro && id === c.pricePro) return 'pro';
  return null;
}

function requireCheckoutConfig(planKey) {
  const key = paidPlanKey(planKey);
  if (!key) throw new BillingConfigError('Plano pago inválido.', 400);
  const c = config();
  if (!c.secretKey) throw new BillingConfigError('Cobrança ainda não configurada.');
  if (c.live && !c.liveEnabled) throw new BillingConfigError('Cobrança real está bloqueada até habilitação explícita.');
  const priceId = priceForPlan(key);
  if (!priceId) throw new BillingConfigError(`Preço Stripe do plano ${key} não configurado.`);
  return { ...c, planKey: key, priceId };
}

function requirePortalConfig() {
  const c = config();
  if (!c.secretKey) throw new BillingConfigError('Cobrança ainda não configurada.');
  if (c.live && !c.liveEnabled) throw new BillingConfigError('Cobrança real está bloqueada até habilitação explícita.');
  return c;
}

function requireWebhookConfig() {
  const c = config();
  if (!c.webhookSecret) throw new BillingConfigError('Webhook Stripe ainda não configurado.');
  return c;
}

async function stripeRequest(path, params = {}, { method = 'POST' } = {}) {
  const c = config();
  if (!c.secretKey) throw new BillingConfigError('Stripe não configurado.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Stripe HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.stripeType = data?.error?.type || '';
    throw error;
  }
  return data;
}

async function createCustomer({ userId, email, name }) {
  return stripeRequest('/customers', {
    email,
    name,
    'metadata[dpro_user_id]': userId,
  });
}

async function createCheckoutSession({ userId, customerId, planKey }) {
  const { priceId } = requireCheckoutConfig(planKey);
  const base = appBaseUrl();
  return stripeRequest('/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    success_url: `${base}/dashboard?billing=success`,
    cancel_url: `${base}/dashboard?billing=cancel`,
    client_reference_id: userId,
    'metadata[dpro_plan]': planKey,
    'subscription_data[metadata][dpro_plan]': planKey,
    allow_promotion_codes: 'true',
  });
}

async function createPortalSession(customerId) {
  requirePortalConfig();
  return stripeRequest('/billing_portal/sessions', {
    customer: customerId,
    return_url: `${appBaseUrl()}/dashboard`,
  });
}

function parseStripeSignature(header) {
  const values = String(header || '').split(',').map(x => x.trim()).filter(Boolean);
  let timestamp = null;
  const signatures = [];
  for (const part of values) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === 't') timestamp = Number(value);
    if (key === 'v1') signatures.push(value);
  }
  return { timestamp, signatures };
}

function safeHexEqual(a, b) {
  try {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifyWebhookSignature(rawBody, signatureHeader, { nowMs = Date.now(), toleranceSec = 300 } = {}) {
  const { webhookSecret } = requireWebhookConfig();
  const parsed = parseStripeSignature(signatureHeader);
  if (!Number.isFinite(parsed.timestamp) || !parsed.signatures.length) return false;
  const ageSec = Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp);
  if (ageSec > toleranceSec) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const signedPayload = Buffer.concat([Buffer.from(`${parsed.timestamp}.`, 'utf8'), raw]);
  const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  return parsed.signatures.some(signature => safeHexEqual(expected, signature));
}

function billingState() {
  const c = config();
  return {
    checkoutConfigured: Boolean(c.secretKey && c.priceStarter && c.pricePro),
    webhookConfigured: Boolean(c.webhookSecret),
    mode: c.secretKey ? (c.live ? 'live' : 'test') : 'disabled',
    liveEnabled: c.liveEnabled,
  };
}

module.exports = {
  BillingConfigError,
  config,
  appBaseUrl,
  priceForPlan,
  planForPrice,
  requireCheckoutConfig,
  requirePortalConfig,
  requireWebhookConfig,
  stripeRequest,
  createCustomer,
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  billingState,
};
