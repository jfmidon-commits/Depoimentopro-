const { TABLES } = require('./config');
const air = require('./airtable');
const { entitlement } = require('./plans');

function publicUser(record){
  const f=record.fields||{};
  const ent=entitlement(f);
  return{
    id:record.id,
    nome:f['Nome']||'',
    email:f['Email']||'',
    plano:ent.plan.label,
    planoKey:ent.planKey,
    limite:ent.limit,
    usados:ent.used,
    restantes:ent.remaining,
    campaigns:f['Campaigns']||[],
    testimonials:f['Testimonials']||[],
    widgets:f['Widgets']||[],
    billing:{
      managed:ent.billingManaged,
      status:ent.subscriptionStatus,
      currentPeriodEnd:ent.currentPeriodEnd,
      graceUntil:ent.graceUntil,
      hasStripeCustomer:Boolean(ent.customerId),
    },
  };
}
async function findUserByEmail(email){const v=air.escapeFormula(String(email||'').trim().toLowerCase());return air.findOne(TABLES.users,`LOWER({Email})='${v}'`);}
module.exports={publicUser,findUserByEmail};
