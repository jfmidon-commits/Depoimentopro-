const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { TABLES } = require('../lib/config');

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
const USER = 'rec' + 'U'.repeat(14);

function subscription(overrides = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    current_period_end: Math.floor(Date.now() / 1000) + 3600,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_starter' } }] },
    ...overrides,
  };
}

function request(url, body = {}) {
  return {
    method: 'POST',
    url,
    headers: { host: 'app.test', origin: 'https://app.test' },
    body,
  };
}

test('Free tem limite 5', () => {
  const ent = plans.entitlement({ Plano: 'Free', 'Depoimentos Usados': 4 });
  assert.equal(ent.planKey, 'free');
  assert.equal(ent.limit, 5);
  assert.equal(ent.remaining, 1);
  assert.equal(ent.canAccept, true);
});

test('Plano pago armazenado sem assinatura confirmada não concede entitlement', () => {
  assert.equal(plans.effectivePlan({ Plano: 'Starter', 'Depoimentos Usados': 0 }), 'free');
  assert.equal(plans.effectivePlan({ Plano: 'Pro', 'Subscription Status': 'active' }), 'free');
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

test('cancel_at_period_end não derruba assinatura active antes do fim', () => {
  assert.equal(plans.effectivePlan({ Plano: 'Starter', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'active', 'Cancel At Period End': true }), 'starter');
});

test('paused, incomplete e cancelada não concedem acesso pago', () => {
  for (const status of ['paused', 'incomplete', 'canceled', 'unpaid', 'incomplete_expired']) {
    assert.equal(plans.effectivePlan({ Plano: 'Pro', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': status }), 'free');
  }
});

test('checkout novo é bloqueado enquanto assinatura não terminal existe', () => {
  assert.equal(plans.canStartCheckout({ 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'active' }), false);
  assert.equal(plans.canStartCheckout({ 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'past_due' }), false);
  assert.equal(plans.canStartCheckout({ 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'paused' }), false);
  assert.equal(plans.canStartCheckout({ 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'canceled' }), true);
  assert.equal(plans.canStartCheckout({}), true);
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

test('chave live fica bloqueada sem habilitação explícita em qualquer chamada Stripe', async () => {
  await withEnv({ STRIPE_SECRET_KEY: 'sk_live_example', STRIPE_PRICE_STARTER: 'price_starter', BILLING_LIVE_ENABLED: undefined }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    assert.throws(() => stripe.requireCheckoutConfig('starter'), /bloqueada/i);
    assert.throws(() => stripe.requirePortalConfig(), /bloqueada/i);
  });
});

test('assinatura de webhook válida é aceita e adulteração é rejeitada', async () => {
  const secret = 'whsec_' + 'x'.repeat(32);
  await withEnv({ STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: secret }, () => {
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
  await withEnv({ STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: secret }, () => {
    delete require.cache[require.resolve('../lib/stripe')];
    const stripe = require('../lib/stripe');
    const raw = Buffer.from('{}');
    const t = Math.floor(Date.now() / 1000) - 1000;
    const sig = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), raw])).digest('hex');
    assert.equal(stripe.verifyWebhookSignature(raw, `t=${t},v1=${sig}`), false);
  });
});

test('checkout rejeita priceId arbitrário do frontend', async () => {
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
    await handler(request('/api/billing?action=checkout', { plan: 'starter', priceId: 'price_hacker' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(checkoutCalled, false);
  } finally { restore(); }
});

test('checkout bloqueia segunda assinatura ativa e direciona ao portal', async () => {
  let stripeCustomerRead = false;
  const air = { get: async () => ({ id: USER, fields: { Plano: 'Starter', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'active', 'Stripe Customer ID': 'cus_1' } }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requireCheckoutConfig: () => ({}),
    retrieveCustomer: async () => { stripeCustomerRead = true; },
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler(request('/api/billing?action=checkout', { plan: 'pro' }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(stripeCustomerRead, false);
    assert.match(JSON.parse(res.body).error, /Gerenciar assinatura/i);
  } finally { restore(); }
});

test('checkout rejeita Stripe Customer que não pertence ao usuário', async () => {
  let checkoutCalled = false;
  const air = { get: async () => ({ id: USER, fields: { 'Stripe Customer ID': 'cus_other' } }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requireCheckoutConfig: () => ({}),
    retrieveCustomer: async () => ({ id: 'cus_other', metadata: { dpro_user_id: 'rec' + 'X'.repeat(14) } }),
    customerOwnedByUser: () => false,
    createCheckoutSession: async () => { checkoutCalled = true; },
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler(request('/api/billing?action=checkout', { plan: 'starter' }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(checkoutCalled, false);
  } finally { restore(); }
});

test('portal sem Stripe Customer retorna conflito controlado', async () => {
  const air = { get: async () => ({ id: USER, fields: {} }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requirePortalConfig: () => ({}),
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler(request('/api/billing?action=portal', {}), res);
    assert.equal(res.statusCode, 409);
  } finally { restore(); }
});

test('portal rejeita Customer de outro usuário', async () => {
  let portalCalled = false;
  const air = { get: async () => ({ id: USER, fields: { 'Stripe Customer ID': 'cus_other' } }) };
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requirePortalConfig: () => ({}),
    retrieveCustomer: async () => ({ id: 'cus_other', metadata: { dpro_user_id: 'other' } }),
    customerOwnedByUser: () => false,
    createPortalSession: async () => { portalCalled = true; },
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': air,
    '../lib/auth': { readSession: () => ({ userId: USER }) },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => ({}) },
  });
  try {
    const res = mockRes();
    await handler(request('/api/billing?action=portal', {}), res);
    assert.equal(res.statusCode, 409);
    assert.equal(portalCalled, false);
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

test('webhook rejeita evento test/live incompatível com a chave configurada', async () => {
  let processed = false;
  const stripe = {
    BillingConfigError: class BillingConfigError extends Error {},
    requireWebhookConfig: () => ({}),
    verifyWebhookSignature: () => true,
    eventMatchesConfiguredMode: () => false,
  };
  const { loaded: handler, restore } = loadWithMocks('../api/billing', {
    '../lib/airtable': {},
    '../lib/auth': { readSession: () => null },
    '../lib/stripe': stripe,
    '../lib/billing-webhook': { processStripeEvent: async () => { processed = true; } },
  });
  try {
    const res = mockRes();
    await handler({ method: 'POST', url: '/api/billing?action=webhook', headers: { host: 'app.test', 'x-forwarded-for': '203.0.113.6', 'stripe-signature': 'ok' }, body: JSON.stringify({ id: 'evt_mode', type: 'invoice.paid', livemode: true }) }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(processed, false);
  } finally { restore(); }
});

function webhookAir(userFields, hooks = {}) {
  let eventRecord = null;
  const updates = [];
  const air = {
    escapeFormula: value => String(value),
    findOne: async (table, formula) => {
      const text = String(formula);
      if (table === TABLES.stripeEvents || text.includes('Event ID')) return eventRecord;
      if (text.includes('Stripe Subscription ID')) return hooks.findBySubscription ? hooks.findBySubscription(text) : { id: USER, fields: userFields };
      if (text.includes('Stripe Customer ID')) return hooks.findByCustomer ? hooks.findByCustomer(text) : { id: USER, fields: userFields };
      return null;
    },
    get: async (_table, id) => id === USER ? { id: USER, fields: userFields } : null,
    create: async (table, fields) => {
      if (table === TABLES.stripeEvents) {
        eventRecord = { id: 'rec' + 'E'.repeat(14), fields: { ...fields } };
        return eventRecord;
      }
      return { id: 'rec' + 'N'.repeat(14), fields };
    },
    update: async (table, id, fields) => {
      if (table === TABLES.stripeEvents) {
        eventRecord = { id, fields: { ...(eventRecord?.fields || {}), ...fields } };
      } else {
        updates.push({ table, id, fields: { ...fields } });
        Object.assign(userFields, fields);
      }
      return { id, fields };
    },
  };
  return { air, updates, getEvent: () => eventRecord };
}

test('webhook idempotente ignora o mesmo event.id na segunda vez', async () => {
  const state = webhookAir({});
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': { planForPrice: () => null },
  });
  try {
    webhook.resetProcessedMemory();
    const event = { id: 'evt_repeat', type: 'unknown.event', data: { object: {} } };
    const first = await webhook.processStripeEvent(event);
    const second = await webhook.processStripeEvent(event);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(state.getEvent().fields.Status, 'processed');
  } finally { restore(); }
});

test('falha de processamento fica como error e o mesmo evento pode ser tentado novamente', async () => {
  const fields = { Plano: 'Free', 'Stripe Customer ID': 'cus_1' };
  const state = webhookAir(fields);
  let calls = 0;
  const latest = subscription();
  const stripe = {
    planForPrice: id => id === 'price_starter' ? 'starter' : null,
    retrieveSubscription: async () => {
      calls += 1;
      if (calls === 1) throw new Error('falha transitória');
      return latest;
    },
  };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    const event = { id: 'evt_retry', type: 'customer.subscription.updated', data: { object: latest } };
    await assert.rejects(() => webhook.processStripeEvent(event), /falha transitória/);
    assert.equal(state.getEvent().fields.Status, 'error');
    const second = await webhook.processStripeEvent(event);
    assert.equal(second.duplicate, false);
    assert.equal(state.getEvent().fields.Status, 'processed');
    assert.equal(fields['Subscription Status'], 'active');
  } finally { restore(); }
});

test('subscription active usa snapshot atual do Stripe e atualiza plano pelo price conhecido', async () => {
  const fields = { Plano: 'Free', 'Stripe Customer ID': 'cus_1' };
  const state = webhookAir(fields);
  const latest = subscription();
  const stripe = {
    planForPrice: id => id === 'price_starter' ? 'starter' : null,
    retrieveSubscription: async () => latest,
  };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({ id: 'evt_sub_active', type: 'customer.subscription.updated', data: { object: { ...latest, status: 'past_due' } } });
    assert.equal(fields.Plano, 'Starter');
    assert.equal(fields['Limite Depoimentos'], 50);
    assert.equal(fields['Subscription Status'], 'active');
  } finally { restore(); }
});

test('subscription.deleted antigo não derruba assinatura nova ativa do mesmo customer', async () => {
  const fields = { Plano: 'Pro', 'Stripe Customer ID': 'cus_1', 'Stripe Subscription ID': 'sub_new', 'Subscription Status': 'active', 'Limite Depoimentos': 999999 };
  const state = webhookAir(fields, {
    findBySubscription: () => null,
    findByCustomer: () => ({ id: USER, fields }),
  });
  const stripe = { planForPrice: () => 'starter' };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    const result = await webhook.processStripeEvent({
      id: 'evt_old_deleted', type: 'customer.subscription.deleted',
      data: { object: subscription({ id: 'sub_old', status: 'canceled' }) },
    });
    assert.equal(result.reason, 'stale-deleted-subscription');
    assert.equal(fields['Stripe Subscription ID'], 'sub_new');
    assert.equal(fields.Plano, 'Pro');
  } finally { restore(); }
});

test('evento atrasado de assinatura antiga não substitui assinatura nova ativa', async () => {
  const fields = { Plano: 'Pro', 'Stripe Customer ID': 'cus_1', 'Stripe Subscription ID': 'sub_new', 'Subscription Status': 'active' };
  const state = webhookAir(fields, {
    findBySubscription: () => null,
    findByCustomer: () => ({ id: USER, fields }),
  });
  const oldLatest = subscription({ id: 'sub_old', status: 'past_due' });
  const stripe = { planForPrice: () => 'starter', retrieveSubscription: async () => oldLatest };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    const result = await webhook.processStripeEvent({ id: 'evt_old_update', type: 'customer.subscription.updated', data: { object: oldLatest } });
    assert.equal(result.reason, 'different-active-subscription');
    assert.equal(fields['Stripe Subscription ID'], 'sub_new');
    assert.equal(fields.Plano, 'Pro');
  } finally { restore(); }
});

test('nova assinatura pode substituir assinatura terminal anterior', async () => {
  const fields = { Plano: 'Free', 'Stripe Customer ID': 'cus_1', 'Stripe Subscription ID': 'sub_old', 'Subscription Status': 'canceled' };
  const state = webhookAir(fields, {
    findBySubscription: () => null,
    findByCustomer: () => ({ id: USER, fields }),
  });
  const latest = subscription({ id: 'sub_new', status: 'active' });
  const stripe = { planForPrice: () => 'starter', retrieveSubscription: async () => latest };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({ id: 'evt_new_sub', type: 'customer.subscription.created', data: { object: latest } });
    assert.equal(fields['Stripe Subscription ID'], 'sub_new');
    assert.equal(fields['Subscription Status'], 'active');
    assert.equal(fields.Plano, 'Starter');
  } finally { restore(); }
});

test('invoice.payment_failed reconcilia subscription atual em vez de forçar past_due', async () => {
  const fields = { Plano: 'Starter', 'Stripe Customer ID': 'cus_1', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'active' };
  const state = webhookAir(fields);
  const latest = subscription({ status: 'active' });
  const stripe = { planForPrice: () => 'starter', retrieveSubscription: async () => latest };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({ id: 'evt_invoice_failed_stale', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1', subscription: 'sub_1' } } });
    assert.equal(fields['Subscription Status'], 'active');
    assert.equal(fields.Plano, 'Starter');
  } finally { restore(); }
});

test('cancel_at_period_end é persistido sem revogar acesso active', async () => {
  const fields = { Plano: 'Starter', 'Stripe Customer ID': 'cus_1', 'Stripe Subscription ID': 'sub_1', 'Subscription Status': 'active' };
  const state = webhookAir(fields);
  const latest = subscription({ cancel_at_period_end: true });
  const stripe = { planForPrice: () => 'starter', retrieveSubscription: async () => latest };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({ id: 'evt_cancel_at_end', type: 'customer.subscription.updated', data: { object: latest } });
    assert.equal(fields['Cancel At Period End'], true);
    assert.equal(fields['Subscription Status'], 'active');
    assert.equal(fields.Plano, 'Starter');
  } finally { restore(); }
});

test('checkout.session.completed faz linkage de customer, mas não concede nem troca subscription', async () => {
  const fields = { Plano: 'Free', 'Stripe Subscription ID': 'sub_old', 'Subscription Status': 'canceled' };
  const state = webhookAir(fields);
  const stripe = { planForPrice: () => null };
  const { loaded: webhook, restore } = loadWithMocks('../lib/billing-webhook', {
    '../lib/airtable': state.air,
    '../lib/stripe': stripe,
  });
  try {
    webhook.resetProcessedMemory();
    await webhook.processStripeEvent({
      id: 'evt_checkout_link', type: 'checkout.session.completed',
      data: { object: { client_reference_id: USER, customer: 'cus_1', subscription: 'sub_new', metadata: { dpro_user_id: USER } } },
    });
    assert.equal(fields['Stripe Customer ID'], 'cus_1');
    assert.equal(fields['Stripe Subscription ID'], 'sub_old');
    assert.equal(fields.Plano, 'Free');
  } finally { restore(); }
});
