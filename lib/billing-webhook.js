const { TABLES } = require('./config');
const air = require('./airtable');
const { planForPrice } = require('./stripe');
const { airtablePlanFields, graceUntilFrom } = require('./plans');
const { log, logError } = require('./logger');

const processedMemory = new Set();

function customerId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

function subscriptionIdFromInvoice(invoice = {}) {
  const direct = invoice.subscription;
  if (typeof direct === 'string') return direct;
  if (direct?.id) return direct.id;
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === 'string') return parent;
  if (parent?.id) return parent.id;
  return '';
}

function currentPeriodEndIso(subscription = {}) {
  const direct = Number(subscription.current_period_end || 0);
  const itemEnd = Number(subscription.items?.data?.[0]?.current_period_end || 0);
  const seconds = direct || itemEnd;
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
}

function firstPriceId(subscription = {}) {
  return String(subscription.items?.data?.[0]?.price?.id || '');
}

async function findUserByCustomer(customer) {
  const id = customerId(customer);
  if (!id) return null;
  const escaped = air.escapeFormula(id);
  return air.findOne(TABLES.users, `{Stripe Customer ID}='${escaped}'`);
}

async function findUserBySubscription(subscriptionId) {
  const id = String(subscriptionId || '').trim();
  if (!id) return null;
  const escaped = air.escapeFormula(id);
  return air.findOne(TABLES.users, `{Stripe Subscription ID}='${escaped}'`);
}

async function findEventRecord(eventId) {
  const escaped = air.escapeFormula(String(eventId || ''));
  return air.findOne(TABLES.stripeEvents, `{Event ID}='${escaped}'`);
}

async function isProcessed(eventId) {
  if (processedMemory.has(eventId)) return true;
  const record = await findEventRecord(eventId);
  if (record?.fields?.['Status'] === 'processed') {
    processedMemory.add(eventId);
    return true;
  }
  return false;
}

async function writeEvent(event, status, errorMessage = '') {
  const existing = await findEventRecord(event.id);
  const fields = {
    'Event ID': event.id,
    Type: String(event.type || ''),
    'Processed At': new Date().toISOString(),
    Status: status,
    Error: String(errorMessage || '').slice(0, 1000),
  };
  if (existing) return air.update(TABLES.stripeEvents, existing.id, fields);
  return air.create(TABLES.stripeEvents, fields);
}

function effectivePlanForStatus(planKey, status, graceUntil) {
  if (!planKey) return 'free';
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'trialing') return planKey;
  if (normalized === 'past_due') {
    const graceMs = Date.parse(String(graceUntil || ''));
    if (Number.isFinite(graceMs) && graceMs > Date.now()) return planKey;
  }
  return 'free';
}

async function updateSubscription(subscription, eventType) {
  const subId = String(subscription?.id || '');
  const customer = customerId(subscription?.customer);
  const priceId = firstPriceId(subscription);
  const planKey = planForPrice(priceId);
  const status = String(subscription?.status || '').toLowerCase();
  let user = await findUserBySubscription(subId);
  if (!user) user = await findUserByCustomer(customer);
  if (!user) {
    log('warn', 'billing.subscription_user_not_found', { eventType, hasCustomer: Boolean(customer), hasSubscription: Boolean(subId) });
    return { action: 'ignored', reason: 'user-not-found' };
  }

  const existingGrace = String(user.fields?.['Billing Grace Until'] || '');
  const graceUntil = status === 'past_due'
    ? (Date.parse(existingGrace) > Date.now() ? existingGrace : graceUntilFrom())
    : '';
  const effectivePlanKey = effectivePlanForStatus(planKey, status, graceUntil);
  const planFields = airtablePlanFields(effectivePlanKey);

  const fields = {
    'Stripe Customer ID': customer || user.fields?.['Stripe Customer ID'] || '',
    'Stripe Subscription ID': subId,
    'Subscription Status': status,
    'Current Period End': currentPeriodEndIso(subscription),
    'Billing Grace Until': graceUntil,
    ...planFields,
  };
  await air.update(TABLES.users, user.id, fields);
  log('info', 'billing.subscription_updated', {
    eventType,
    userId: user.id,
    plan: planFields.Plano,
    status,
  });
  return { action: 'subscription-updated', userId: user.id, plan: effectivePlanKey, status };
}

async function checkoutCompleted(session) {
  const userId = String(session?.client_reference_id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) return { action: 'ignored', reason: 'invalid-client-reference' };
  const user = await air.get(TABLES.users, userId).catch(() => null);
  if (!user) return { action: 'ignored', reason: 'user-not-found' };
  const fields = {};
  const customer = customerId(session?.customer);
  const subscription = typeof session?.subscription === 'string' ? session.subscription : session?.subscription?.id;
  if (customer) fields['Stripe Customer ID'] = customer;
  if (subscription) fields['Stripe Subscription ID'] = subscription;
  if (Object.keys(fields).length) await air.update(TABLES.users, userId, fields);
  return { action: 'checkout-linked', userId };
}

async function invoiceEvent(invoice, type) {
  const customer = customerId(invoice?.customer);
  const subId = subscriptionIdFromInvoice(invoice);
  let user = await findUserBySubscription(subId);
  if (!user) user = await findUserByCustomer(customer);
  if (!user) return { action: 'ignored', reason: 'user-not-found' };

  if (type === 'invoice.payment_failed') {
    const grace = Date.parse(String(user.fields?.['Billing Grace Until'] || '')) > Date.now()
      ? String(user.fields['Billing Grace Until'])
      : graceUntilFrom();
    await air.update(TABLES.users, user.id, {
      'Subscription Status': 'past_due',
      'Billing Grace Until': grace,
    });
    log('warn', 'billing.invoice_failed', { userId: user.id, hasSubscription: Boolean(subId) });
    return { action: 'invoice-failed', userId: user.id };
  }

  log('info', 'billing.invoice_paid', { userId: user.id, hasSubscription: Boolean(subId) });
  return { action: 'invoice-paid-observed', userId: user.id };
}

async function processStripeEvent(event) {
  if (!event || !event.id || !event.type) throw new Error('Evento Stripe inválido.');
  if (await isProcessed(event.id)) return { duplicate: true, action: 'duplicate' };

  try {
    let result = { action: 'ignored' };
    const object = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
        result = await checkoutCompleted(object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        result = await updateSubscription(object, event.type);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed':
        result = await invoiceEvent(object, event.type);
        break;
      default:
        result = { action: 'ignored', reason: 'unsupported-event' };
    }
    await writeEvent(event, 'processed');
    processedMemory.add(event.id);
    return { duplicate: false, ...result };
  } catch (error) {
    await writeEvent(event, 'error', error?.message || 'processing failed').catch(() => {});
    logError('billing.webhook_processing_failed', error, { eventId: event.id, eventType: event.type });
    throw error;
  }
}

function resetProcessedMemory() {
  processedMemory.clear();
}

module.exports = {
  processStripeEvent,
  currentPeriodEndIso,
  firstPriceId,
  effectivePlanForStatus,
  resetProcessedMemory,
};
