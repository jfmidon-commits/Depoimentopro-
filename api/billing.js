const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const {
  bodyRaw,
  bodyJson,
  json,
  method,
  clientIp,
  requireSameOrigin,
  ensureRequestId,
} = require('../lib/http');
const { readSession } = require('../lib/auth');
const { paidPlanKey, canStartCheckout } = require('../lib/plans');
const stripe = require('../lib/stripe');
const { processStripeEvent } = require('../lib/billing-webhook');
const { LIMITS, checkRateLimit, rejectRateLimit, setRateLimitHeaders } = require('../lib/rate-limit');
const { log, logError } = require('../lib/logger');

function actionFromRequest(req) {
  const raw = String(req.url || '/api/billing');
  try {
    const url = new URL(raw, 'https://depoimentopro.invalid');
    const queryAction = String(url.searchParams.get('action') || '').toLowerCase();
    if (queryAction) return queryAction;
    if (url.pathname.endsWith('/billing-checkout')) return 'checkout';
    if (url.pathname.endsWith('/billing-portal')) return 'portal';
    if (url.pathname.endsWith('/billing-webhook')) return 'webhook';
  } catch {}
  return '';
}

async function sessionUser(req, res) {
  const session = readSession(req);
  if (!session) {
    json(res, 401, { error: 'Sessão inválida.' });
    return null;
  }
  const user = await air.get(TABLES.users, session.userId);
  return { session, user };
}

async function verifiedCustomer(customerId, userId) {
  const customer = await stripe.retrieveCustomer(customerId);
  return stripe.customerOwnedByUser(customer, userId) ? customer : null;
}

async function checkout(req, res, requestId) {
  if (!method(req, res, ['POST']) || !requireSameOrigin(req, res)) return;
  const current = await sessionUser(req, res);
  if (!current) return;

  const rate = await checkRateLimit({ ...LIMITS.billingCheckoutUser, identity: current.session.userId });
  setRateLimitHeaders(res, rate);
  if (!rate.allowed) return rejectRateLimit(res, rate, 'Muitas tentativas de checkout. Aguarde alguns minutos.');

  const body = await bodyJson(req);
  if (Object.prototype.hasOwnProperty.call(body, 'priceId')) {
    return json(res, 400, { error: 'O preço do plano é definido pelo servidor.' });
  }
  const planKey = paidPlanKey(body.plan);
  if (!planKey) return json(res, 400, { error: 'Plano inválido.' });

  stripe.requireCheckoutConfig(planKey);
  const fields = current.user.fields || {};
  if (!canStartCheckout(fields)) {
    return json(res, 409, {
      error: 'Já existe uma assinatura Stripe vinculada. Use “Gerenciar assinatura” para alterar o plano ou a forma de pagamento.',
    });
  }

  let customerId = String(fields['Stripe Customer ID'] || '').trim();
  if (customerId) {
    const customer = await verifiedCustomer(customerId, current.user.id);
    if (!customer) {
      log('warn', 'billing.customer_ownership_mismatch', { requestId, userId: current.user.id });
      return json(res, 409, { error: 'A conta de cobrança vinculada precisa ser revisada antes de iniciar um novo checkout.' });
    }
  }

  // Não criamos Customer nem Checkout sem um webhook capaz de confirmar entitlement.
  stripe.requireWebhookConfig();

  if (!customerId) {
    const customer = await stripe.createCustomer({
      userId: current.user.id,
      email: fields.Email || '',
      name: fields.Nome || '',
    });
    customerId = String(customer.id || '');
    if (!customerId) throw new Error('Stripe não retornou Customer ID.');
    await air.update(TABLES.users, current.user.id, { 'Stripe Customer ID': customerId });
  }

  const session = await stripe.createCheckoutSession({
    userId: current.user.id,
    customerId,
    planKey,
  });
  if (!session?.url) throw new Error('Stripe não retornou URL de checkout.');
  log('info', 'billing.checkout_created', { requestId, userId: current.user.id, plan: planKey });
  return json(res, 200, { url: session.url });
}

async function portal(req, res, requestId) {
  if (!method(req, res, ['POST']) || !requireSameOrigin(req, res)) return;
  const current = await sessionUser(req, res);
  if (!current) return;

  const rate = await checkRateLimit({ ...LIMITS.billingPortalUser, identity: current.session.userId });
  setRateLimitHeaders(res, rate);
  if (!rate.allowed) return rejectRateLimit(res, rate, 'Muitas tentativas de abrir o portal. Aguarde alguns minutos.');

  stripe.requirePortalConfig();
  const customerId = String(current.user.fields?.['Stripe Customer ID'] || '').trim();
  if (!customerId) return json(res, 409, { error: 'Nenhuma conta de cobrança foi vinculada a este usuário.' });
  const customer = await verifiedCustomer(customerId, current.user.id);
  if (!customer) {
    log('warn', 'billing.portal_customer_ownership_mismatch', { requestId, userId: current.user.id });
    return json(res, 409, { error: 'A conta de cobrança vinculada não corresponde a este usuário.' });
  }
  const session = await stripe.createPortalSession(customerId);
  if (!session?.url) throw new Error('Stripe não retornou URL do portal.');
  log('info', 'billing.portal_created', { requestId, userId: current.user.id });
  return json(res, 200, { url: session.url });
}

async function webhook(req, res, requestId) {
  if (!method(req, res, ['POST'])) return;
  const ip = clientIp(req);
  const rate = await checkRateLimit({ ...LIMITS.billingWebhookIp, identity: ip });
  setRateLimitHeaders(res, rate);
  if (!rate.allowed) return rejectRateLimit(res, rate, 'Muitas requisições de webhook.');

  stripe.requireWebhookConfig();
  const raw = await bodyRaw(req);
  const signature = req.headers['stripe-signature'];
  if (!stripe.verifyWebhookSignature(raw, signature)) {
    log('warn', 'billing.webhook_invalid_signature', { requestId });
    return json(res, 400, { error: 'Assinatura do webhook inválida.' });
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return json(res, 400, { error: 'Payload do webhook inválido.' }); }
  if (!stripe.eventMatchesConfiguredMode(event)) {
    log('warn', 'billing.webhook_mode_mismatch', { requestId, eventType: event?.type || '' });
    return json(res, 400, { error: 'Modo do evento Stripe incompatível com a configuração atual.' });
  }
  log('info', 'billing.webhook_received', { requestId, eventId: event.id, eventType: event.type });
  const result = await processStripeEvent(event);
  return json(res, 200, { received: true, duplicate: Boolean(result.duplicate) });
}

module.exports = async (req, res) => {
  const requestId = ensureRequestId(req, res);
  const action = actionFromRequest(req);
  try {
    if (action === 'checkout') return await checkout(req, res, requestId);
    if (action === 'portal') return await portal(req, res, requestId);
    if (action === 'webhook') return await webhook(req, res, requestId);
    return json(res, 404, { error: 'Ação de billing não encontrada.' });
  } catch (error) {
    if (error instanceof stripe.BillingConfigError) {
      return json(res, error.statusCode || 503, { error: error.message });
    }
    if (error?.statusCode === 413) return json(res, 413, { error: 'Payload muito grande.' });
    logError('billing.request_failed', error, { requestId, action: action || 'unknown' });
    return json(res, 500, { error: 'Não foi possível processar a operação de cobrança.' });
  }
};
