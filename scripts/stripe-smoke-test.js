#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const stripe = require('../lib/stripe');

function requireTestConfig() {
  const c = stripe.config();
  assert.ok(c.secretKey, 'STRIPE_SECRET_KEY não configurada');
  assert.match(c.secretKey, /^sk_test_/, 'O smoke aceita somente sk_test_');
  assert.equal(c.live, false, 'Stripe Live não é permitido neste smoke');
  assert.notEqual(String(process.env.BILLING_LIVE_ENABLED || '').toLowerCase(), 'true', 'BILLING_LIVE_ENABLED deve permanecer false');
  assert.ok(c.webhookSecret, 'STRIPE_WEBHOOK_SECRET não configurado');
  assert.ok(c.priceStarter, 'STRIPE_PRICE_STARTER não configurado');
  assert.ok(c.pricePro, 'STRIPE_PRICE_PRO não configurado');
  return c;
}

async function verifyPrice(priceId, expectedAmount, label) {
  const price = await stripe.stripeRequest(`/prices/${encodeURIComponent(priceId)}`, {}, { method: 'GET' });
  assert.equal(price.id, priceId, `${label}: Price ID inesperado`);
  assert.equal(price.active, true, `${label}: preço precisa estar ativo`);
  assert.equal(String(price.currency || '').toLowerCase(), 'brl', `${label}: moeda precisa ser BRL`);
  assert.equal(Number(price.unit_amount), expectedAmount, `${label}: valor mensal incorreto`);
  assert.equal(price.type, 'recurring', `${label}: preço precisa ser recorrente`);
  assert.equal(price.recurring?.interval, 'month', `${label}: recorrência precisa ser mensal`);
  assert.equal(Number(price.recurring?.interval_count || 1), 1, `${label}: recorrência precisa ser mensal simples`);
  return { id: price.id, amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval };
}

async function verifyAppHealth() {
  const base = stripe.appBaseUrl();
  const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
  assert.equal(response.ok, true, `Health retornou HTTP ${response.status}`);
  const health = await response.json();
  assert.equal(health.ok, true, 'Health do DepoimentoPro não está OK');
  assert.equal(health.billing?.mode, 'test', 'Produção/preview não está expondo billing em modo test');
  assert.equal(health.billing?.checkoutConfigured, true, 'Checkout Stripe ainda não está configurado no ambiente');
  assert.equal(health.billing?.webhookConfigured, true, 'Webhook Stripe ainda não está configurado no ambiente');
  return health.billing;
}

async function main() {
  const useApi = process.argv.includes('--api');
  if (!useApi) {
    const state = stripe.billingState();
    console.log(JSON.stringify({
      ok: true,
      mode: state.mode,
      checkoutConfigured: state.checkoutConfigured,
      webhookConfigured: state.webhookConfigured,
      note: 'Use --api somente depois de configurar credenciais Stripe TEST. Nenhuma cobrança é criada por este script.',
    }, null, 2));
    return;
  }

  const c = requireTestConfig();
  const starter = await verifyPrice(c.priceStarter, 4700, 'Starter');
  const pro = await verifyPrice(c.pricePro, 9700, 'Pro');
  const health = await verifyAppHealth();

  console.log(JSON.stringify({
    ok: true,
    mode: 'test',
    prices: { starter, pro },
    health,
    chargeCreated: false,
    subscriptionCreated: false,
    note: 'Configuração Stripe Test validada. Este smoke não cria Customer, Checkout, assinatura ou cobrança.',
  }, null, 2));
}

main().catch(error => {
  console.error(`Stripe smoke falhou: ${error.message}`);
  process.exitCode = 1;
});
