const PLAN_DEFS = Object.freeze({
  free: Object.freeze({ key: 'free', label: 'Free', priceBrl: 0, limit: 5 }),
  starter: Object.freeze({ key: 'starter', label: 'Starter', priceBrl: 47, limit: 50, provisionalLimit: true }),
  pro: Object.freeze({ key: 'pro', label: 'Pro', priceBrl: 97, limit: null }),
});

const GRACE_DAYS = 3;
const PRO_STORED_LIMIT = 999999;

function normalizePlan(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'starter') return 'starter';
  if (key === 'pro') return 'pro';
  return 'free';
}

function planFromStored(value) {
  return PLAN_DEFS[normalizePlan(value)];
}

function parseIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function hasActivePaidEntitlement(fields = {}, now = Date.now()) {
  const subscriptionId = String(fields['Stripe Subscription ID'] || '').trim();
  if (!subscriptionId) return false;
  const status = String(fields['Subscription Status'] || '').trim().toLowerCase();
  if (status === 'active' || status === 'trialing') return true;
  if (status === 'past_due') {
    const graceUntil = parseIso(fields['Billing Grace Until']);
    return Boolean(graceUntil && graceUntil > now);
  }
  return false;
}

function effectivePlan(fields = {}, now = Date.now()) {
  const stored = normalizePlan(fields['Plano']);
  const subscriptionId = String(fields['Stripe Subscription ID'] || '').trim();
  if (!subscriptionId) return stored;
  if (stored === 'free') return 'free';
  return hasActivePaidEntitlement(fields, now) ? stored : 'free';
}

function entitlement(fields = {}, now = Date.now()) {
  const planKey = effectivePlan(fields, now);
  const plan = PLAN_DEFS[planKey];
  const used = Math.max(0, Number(fields['Depoimentos Usados'] || 0));
  const limit = plan.limit;
  return {
    planKey,
    plan,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    canAccept: limit === null || used < limit,
    subscriptionStatus: String(fields['Subscription Status'] || '').trim(),
    subscriptionId: String(fields['Stripe Subscription ID'] || '').trim(),
    customerId: String(fields['Stripe Customer ID'] || '').trim(),
    currentPeriodEnd: String(fields['Current Period End'] || '').trim(),
    graceUntil: String(fields['Billing Grace Until'] || '').trim(),
    billingManaged: Boolean(String(fields['Stripe Subscription ID'] || '').trim()),
  };
}

function canAcceptTestimonial(fields = {}, now = Date.now()) {
  return entitlement(fields, now);
}

function storedLimitForPlan(planKey) {
  const key = normalizePlan(planKey);
  if (key === 'pro') return PRO_STORED_LIMIT;
  return PLAN_DEFS[key].limit;
}

function airtablePlanFields(planKey) {
  const key = normalizePlan(planKey);
  return {
    Plano: PLAN_DEFS[key].label,
    'Limite Depoimentos': storedLimitForPlan(key),
  };
}

function paidPlanKey(value) {
  const key = normalizePlan(value);
  return key === 'starter' || key === 'pro' ? key : null;
}

function graceUntilFrom(now = Date.now(), days = GRACE_DAYS) {
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  PLAN_DEFS,
  GRACE_DAYS,
  normalizePlan,
  paidPlanKey,
  planFromStored,
  effectivePlan,
  entitlement,
  canAcceptTestimonial,
  airtablePlanFields,
  storedLimitForPlan,
  graceUntilFrom,
};
