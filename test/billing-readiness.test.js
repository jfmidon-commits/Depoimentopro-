const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); },
    end(v = '') { this.body = String(v); return this; },
  };
}

function loadWithMocks(target, mocks) {
  const saved = [];
  for (const [moduleRelative, exports] of Object.entries(mocks)) {
    const p = require.resolve(moduleRelative);
    saved.push([p, require.cache[p]]);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  const targetPath = require.resolve(target);
  const oldTarget = require.cache[targetPath];
  delete require.cache[targetPath];
  const loaded = require(target);
  return {
    loaded,
    restore() {
      delete require.cache[targetPath];
      if (oldTarget) require.cache[targetPath] = oldTarget;
      for (const [p, old] of saved) {
        if (old) require.cache[p] = old;
        else delete require.cache[p];
      }
    },
  };
}

const USER = 'rec' + 'R'.repeat(14);

function post(url, body) {
  return {
    method: 'POST',
    url,
    headers: { host: 'app.test', origin: 'https://app.test' },
    body,
  };
}

test('checkout não cria recurso Stripe quando webhook ainda não está configurado', async () => {
  class BillingConfigError extends Error {
    constructor(message, statusCode = 503) { super(message); this.statusCode = statusCode; }
  }
  let checkoutCalled = false;
  let customerCreated = false;
  const stripe = {
    BillingConfigError,
    requireCheckoutConfig: () => ({}),
    requireWebhookConfig: () => { throw new BillingConfigError('Webhook Stripe ainda não configurado.'); },
    retrieveCustomer: async () => ({ id: 'cus_1', metadata: { dpro_user_id: USER } }),
    customerOwnedByUser: () => true,
    createCustomer: async () => { customerCreated = true; return { id: 'cus_new' }; },
    createCheckoutSession: async () => { checkoutCalled = true; return { url: 'https://checkout.stripe.test/session' }; },
  };
  const air = {
    get: async () => ({ id: USER, fields: { 'Stripe Customer ID': 'cus_1' } }),
    update: async () => { throw new Error('não deveria atualizar Airtable'); },
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler(post('/api/billing?action=checkout', { plan: 'starter' }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(checkoutCalled, false);
    assert.equal(customerCreated, false);
    assert.match(JSON.parse(res.body).error, /Webhook Stripe/i);
  } finally {
    restore();
  }
});

test('dashboard não anuncia billing disponível sem webhook configurado', async () => {
  const user = {
    id: USER,
    email: 'teste@example.com',
    nome: 'Teste',
    campaigns: [],
    testimonials: [],
    widgets: [],
  };
  const air = {
    get: async () => ({ id: USER, fields: {} }),
    getMany: async () => [],
  };
  const { loaded: handler, restore } = loadWithMocks('../api/dashboard', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/user': { publicUser: () => user },
    '../lib/stripe': { billingState: () => ({ checkoutConfigured: true, webhookConfigured: false, mode: 'test', liveEnabled: false }) },
  });
  try {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.billing.available, false);
    assert.equal(body.billing.mode, 'test');
    assert.equal(body.billing.webhookConfigured, false);
  } finally {
    restore();
  }
});

test('webhook também respeita bloqueio de chave live sem gate manual', () => {
  const oldKey = process.env.STRIPE_SECRET_KEY;
  const oldWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  const oldFlag = process.env.BILLING_LIVE_ENABLED;
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_live_example';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
    delete process.env.BILLING_LIVE_ENABLED;
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    assert.throws(() => stripe.requireWebhookConfig(), /bloqueada/i);
  } finally {
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldKey;
    if (oldWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldWebhook;
    if (oldFlag === undefined) delete process.env.BILLING_LIVE_ENABLED; else process.env.BILLING_LIVE_ENABLED = oldFlag;
    delete require.cache[require.resolve('../lib/stripe')];
  }
});
