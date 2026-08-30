const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function withEnv(values, fn) {
  const old = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

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

const plans = require('../lib/plans');

test('Free tem limite 5', () => {
  const ent = plans.entitlement({ Plano: 'Free', 'Depoimentos Usados': 4 });
  assert.equal(ent.planKey, 'free');
  assert.equal(ent.limit, 5);
  assert.equal(ent.remaining, 1);
  assert.equal(ent.canAccept, true);
});

test('Starter ativo usa limite provisório de 50', () => {
  const ent = plans.entitlement({
    Plano: 'Starter',
    'Stripe Subscription ID': 'sub_test',
    'Subscription Status': 'active',
    'Depoimentos Usados': 49,
  });
  assert.equal(ent.planKey, 'starter');
  assert.equal(ent.limit, 50);
  assert.equal(ent.remaining, 1);
});

test('Pro ativo é ilimitado', () => {
  const ent = plans.entitlement({
    Plano: 'Pro',
    'Stripe Subscription ID': 'sub_test',
    'Subscription Status': 'trialing',
    'Depoimentos Usados': 9999,
  });
  assert.equal(ent.planKey, 'pro');
  assert.equal(ent.limit, null);
  assert.equal(ent.remaining, null);
  assert.equal(ent.canAccept, true);
});

test('past_due mantém plano somente dentro do grace period', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(plans.effectivePlan({ Plano: 'Starter', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'past_due', 'Billing Grace Until': future }), 'starter');
  assert.equal(plans.effectivePlan({ Plano: 'Starter', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'past_due', 'Billing Grace Until': past }), 'free');
});

test('assinatura cancelada volta ao Free', () => {
  assert.equal(plans.effectivePlan({ Plano: 'Pro', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'canceled' }), 'free');
});

test('price IDs só são mapeados pelo backend', async () => {
  await withEnv({ STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_PRO: 'price_pro' }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    assert.equal(stripe.priceForPlan('starter'), 'price_starter');
    assert.equal(stripe.priceForPlan('pro'), 'price_pro');
    assert.equal(stripe.planForPrice('price_starter'), 'starter');
    assert.equal(stripe.planForPrice('price_hacker'), null);
  });
});

test('chave live fica bloqueada sem habilitação explícita', async () => {
  await withEnv({ STRIPE_SECRET_KEY: 'sk_live_example', STRIPE_PRICE_STARTER: 'price_starter', BILLING_LIVE_ENABLED: undefined }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    assert.throws(() => stripe.requireCheckoutConfig('starter'), /bloqueada/i);
  });
});

test('assinatura de webhook válida é aceita e adulteração é rejeitada', async () => {
  const secret = 'whsec_' + 'x'.repeat(32);
  await withEnv({ STRIPE_WEBHOOK_SECRET: secret }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    const raw = Buffer.from('{"id":"evt_1","type":"invoice.paid"}');
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), raw])).digest('hex');
    assert.equal(stripe.verifyWebhookSignature(raw, `t=${t},v1=${sig}`), true);
    assert.equal(stripe.verifyWebhookSignature(Buffer.from(raw.toString().replace('evt_1', 'evt_2')), `t=${t},v1=${sig}`), false);
  });
});

test('webhook antigo é rejeitado', async () => {
  const secret = 'whsec_' + 'y'.repeat(32);
  await withEnv({ STRIPE_WEBHOOK_SECRET: secret }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    const raw = Buffer.from('{}');
    const t = Math.floor(Date.now() / 1000) - 1000;
    const sig = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), raw])).digest('hex');
    assert.equal(stripe.verifyWebhookSignature(raw, `t=${t},v1=${sig}`), false);
  });
});

test('checkout rejeita priceId arbitrário do frontend', async () => {
  const USER = 'rec' + 'A'.repeat(14);
  let checkoutCalled = false;
  const air = { get: async () => ({ id: USER, fields: { Email: 'teste@example.com', Nome: 'Teste', 'Stripe Customer ID': 'cus_1' } }) };
  const auth = { readSession: () => ({ userId: USER }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requireCheckoutConfig: () => { throw new Error('não deveria chegar aqui'); },
    createCheckoutSession: async () => { checkoutCalled = true; },
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': auth,
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler({ method: 'POST', url: '/api/billing?action=checkout', headers: { host: 'app.test', origin: 'https://app.test' }, body: { plan: 'starter', priceId: 'price_hacker' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(checkoutCalled, false);
  } finally { restore(); }
});

test('portal sem Stripe Customer retorna conflito controlado', async () => {
  const USER = 'rec' + 'B'.repeat(14);
  const air = { get: async () => ({ id: USER, fields: {} }) };
  const auth = { readSession: () => ({ userId: USER }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requirePortalConfig: () => ({}),
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': auth,
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler({ method: 'POST', url: '/api/billing?action=portal', headers: { host: 'app.test', origin: 'https://app.test' }, body: {} }, res);
    assert.equal(res.statusCode, 409);
  } finally { restore(); }
});

test('webhook com assinatura inválida não processa evento', async () => {
  let processed = false;
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requireWebhookConfig: () => ({}),
    verifyWebhookSignature: () => false,
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': {},
    '../lib/auth': { readSession: () => null },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => { processed = true; } },
  });
  try {
    const res = mockRes();
    await handler({ method: 'POST', url: '/api/billing?action=webhook', headers: { host: 'app.test', 'x-forwarded-for': '203.0.113.5', 'stripe-signature': 'bad' }, body: '{"id":"evt_1"}' }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(processed, false);
  } finally { restore(); }
});

test('webhook idempotente ignora o mesmo event.id na segunda vez', async () => {
  const records = new Map();
  const air = {
    escapeFormula: value => String(value),
    findOne: async (table, formula) => {
      if (String(formula).includes('Event ID')) return [...records.values()][0] || null;
      return null;
    },
    create: async (_table, fields) => {
      const record = { id: 'rec' + 'E'.repeat(14), fields: { ...fields } };
      records.set(fields['Event ID'], record);
      return record;
    },
    update: async (_table, id, fields) => ({ id, fields }),
  };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': air,
    '../lib/stripe': { planForPrice: () => null },
  });
  try {
    webhook.resetProcessedMemory();
    const event = { id: 'evt_repeat', type: 'unknown.event', data: { object: {} } };
    const first = await webhook.processStripeEvent(event);
    const second = await webhook.processStripeEvent(event);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
  } finally { restore(); }
});

test('subscription active atualiza plano somente a partir do price conhecido', async () => {
  const USER = 'rec' + 'U'.repeat(14);
  const updates = [];
  const air = {
    escapeFormula: value => String(value),
    findOne: async (table, formula) => {
      if (String(formula).includes('Event ID')) return null;
      if (String(formula).includes('Stripe Subscription ID') || String(formula).includes('Stripe Customer ID')) {
        return { id: USER, fields: { Plano: 'Free', 'Stripe Customer ID': 'cus_1' } };
      }
      return null;
    },
    create: async (_table, fields) => ({ id: 'rec' + 'E'.repeat(14), fields }),
    update: async (_table, id, fields) => { updates.push({ id, fields }); return { id, fields }; },
  };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': air,
    '../lib/stripe': { planForPrice: id => id === 'price_starter' ? 'starter' : null },
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({
      id: 'evt_sub_active',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: Math.floor(Date.now()/1000)+3600, items: { data: [{ price: { id: 'price_starter' } }] } } },
    });
    const userUpdate = updates.find(x => x.id === USER);
    assert.equal(userUpdate.fields.Plano, 'Starter');
    assert.equal(userUpdate.fields['Limite Depoimentos'], 50);
    assert.equal(userUpdate.fields['Subscription Status'], 'active');
  } finally { restore(); }
});
