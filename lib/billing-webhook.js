const { TABLES } = require('./config');
const air = require('./airtable');
const stripe = require('./stripe');
const { airtablePlanFields, graceUntilFrom, isTerminalSubscriptionStatus } = require('./plans');
const { acquireLock, releaseLock } = require('./rate-limit');
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

function currentSubscriptionConflict(userFields, incomingSubId, eventType) {
  const currentSubId = String(userFields?.['Stripe Subscription ID'] || '').trim();
  if (!currentSubId || currentSubId === incomingSubId) return null;
  const currentStatus = String(userFields?.['Subscription Status'] || '').trim().toLowerCase();
  if (eventType === 'customer.subscription.deleted') return 'stale-deleted-subscription';
  if (!isTerminalSubscriptionStatus(currentStatus)) return 'different-active-subscription';
  return null;
}

async function updateSubscription(subscription, eventType) {
  const subId = String(subscription?.id || '').trim();
  const customer = customerId(subscription?.customer);
  if (!subId || !customer) return { action: 'ignored', reason: 'invalid-subscription-object' };

  const priceId = firstPriceId(subscription);
  const planKey = stripe.planForPrice(priceId);
  const status = String(subscription?.status || '').toLowerCase();
  let user = await findUserBySubscription(subId);
  if (!user) user = await findUserByCustomer(customer);
  if (!user) {
    log('warn', 'billing.subscription_user_not_found', { eventType, hasCustomer: true, hasSubscription: true });
    return { action: 'ignored', reason: 'user-not-found' };
  }

  const userFields = user.fields || {};
  const storedCustomer = String(userFields['Stripe Customer ID'] || '').trim();
  if (storedCustomer && storedCustomer !== customer) {
    log('warn', 'billing.subscription_customer_conflict', { eventType, userId: user.id });
    return { action: 'ignored', reason: 'customer-conflict' };
  }

  const conflict = currentSubscriptionConflict(userFields, subId, eventType);
  if (conflict) {
    log('warn', 'billing.subscription_stale_or_conflicting', { eventType, userId: user.id, reason: conflict });
    return { action: 'ignored', reason: conflict };
  }

  if (!planKey && (status === 'active' || status === 'trialing' || status === 'past_due')) {
    log('warn', 'billing.subscription_unknown_price', { eventType, userId: user.id });
  }

  const sameSubscription = String(userFields['Stripe Subscription ID'] || '').trim() === subId;
  const existingGrace = sameSubscription ? String(userFields['Billing Grace Until'] || '') : '';
  const graceUntil = status === 'past_due'
    ? (Date.parse(existingGrace) > Date.now() ? existingGrace : graceUntilFrom())
    : '';
  const effectivePlanKey = effectivePlanForStatus(planKey, status, graceUntil);
  const planFields = airtablePlanFields(effectivePlanKey);

  const fields = {
    'Stripe Customer ID': customer,
    'Stripe Subscription ID': subId,
    'Subscription Status': status,
    'Current Period End': currentPeriodEndIso(subscription),
    'Billing Grace Until': graceUntil,
    'Cancel At Period End': subscription?.cancel_at_period_end === true,
    ...planFields,
  };
  await air.update(TABLES.users, user.id, fields);
  log('info', 'billing.subscription_updated', {
    eventType,
    userId: user.id,
    plan: planFields.Plano,
    status,
    cancelAtPeriodEnd: fields['Cancel At Period End'],
  });
  return { action: 'subscription-updated', userId: user.id, plan: effectivePlanKey, status };
}

async function latestSubscriptionSnapshot(subscription, eventType) {
  const subId = String(subscription?.id || '').trim();
  if (!subId) return subscription;
  if (eventType === 'customer.subscription.deleted') return subscription;
  return stripe.retrieveSubscription(subId);
}

async function checkoutCompleted(session) {
  const userId = String(session?.client_reference_id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) return { action: 'ignored', reason: 'invalid-client-reference' };
  const user = await air.get(TABLES.users, userId).catch(() => null);
  if (!user) return { action: 'ignored', reason: 'user-not-found' };
  const metadataUser = String(session?.metadata?.dpro_user_id || '');
  if (metadataUser && metadataUser !== userId) return { action: 'ignored', reason: 'metadata-user-mismatch' };

  const customer = customerId(session?.customer);
  if (!customer) return { action: 'ignored', reason: 'missing-customer' };
  const storedCustomer = String(user.fields?.['Stripe Customer ID'] || '').trim();
  if (storedCustomer && storedCustomer !== customer) {
    log('warn', 'billing.checkout_customer_conflict', { userId });
    return { action: 'ignored', reason: 'customer-conflict' };
  }
  if (!storedCustomer) await air.update(TABLES.users, userId, { 'Stripe Customer ID': customer });
  return { action: 'checkout-linked', userId };
}

async function reconcileSubscriptionId(subscriptionId, eventType) {
  const subId = String(subscriptionId || '').trim();
  if (!subId) return { action: 'ignored', reason: 'missing-subscription' };
  try {
    const latest = await stripe.retrieveSubscription(subId);
    return updateSubscription(latest, eventType);
  } catch (error) {
    if (error?.statusCode === 404) {
      log('warn', 'billing.subscription_snapshot_not_found', { eventType });
      return { action: 'ignored', reason: 'subscription-not-found' };
    }
    throw error;
  }
}

async function invoiceEvent(invoice, type) {
  const subId = subscriptionIdFromInvoice(invoice);
  if (!subId) {
    log(type === 'invoice.payment_failed' ? 'warn' : 'info', `billing.${type === 'invoice.payment_failed' ? 'invoice_failed' : 'invoice_paid'}`, { hasSubscription: false });
    return { action: 'ignored', reason: 'invoice-without-subscription' };
  }
  const result = await reconcileSubscriptionId(subId, type);
  log(type === 'invoice.payment_failed' ? 'warn' : 'info', `billing.${type === 'invoice.payment_failed' ? 'invoice_failed' : 'invoice_paid'}`, { hasSubscription: true, reconciled: result.action });
  return result;
}

async function processStripeEvent(event) {
  if (!event || !event.id || !event.type) throw new Error('Evento Stripe inválido.');
  if (await isProcessed(event.id)) return { duplicate: true, action: 'duplicate' };

  const lock = await acquireLock({ scope: 'stripe-event', identity: event.id, ttlMs: 60_000 });
  if (!lock.acquired) {
    if (await isProcessed(event.id)) return { duplicate: true, action: 'duplicate' };
    const busy = new Error('Evento Stripe já está em processamento.');
    busy.code = 'STRIPE_EVENT_BUSY';
    throw busy;
  }

  try {
    if (await isProcessed(event.id)) return { duplicate: true, action: 'duplicate' };
    await writeEvent(event, 'processing');

    let result = { action: 'ignored' };
    const object = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
        result = await checkoutCompleted(object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const latest = await latestSubscriptionSnapshot(object, event.type);
        result = await updateSubscription(latest, event.type);
        break;
      }
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
  } finally {
    await releaseLock(lock).catch(() => {});
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
  currentSubscriptionConflict,
  updateSubscription,
  resetProcessedMemory,
};
