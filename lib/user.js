const { TABLES } = require('./config');
const air = require('./airtable');
function publicUser(record){const f=record.fields||{};const plan=f['Plano']||'Free';const used=Number(f['Depoimentos Usados']||0);const limit=Number(f['Limite Depoimentos']||0);const remaining=plan==='Pro'?null:Math.max(0,limit-used);return{id:record.id,nome:f['Nome']||'',email:f['Email']||'',plano:plan,limite:limit,usados:used,restantes:remaining,campaigns:f['Campaigns']||[],testimonials:f['Testimonials']||[],widgets:f['Widgets']||[]};}
async function findUserByEmail(email){const v=air.escapeFormula(String(email||'').trim().toLowerCase());return air.findOne(TABLES.users,`LOWER({Email})='${v}'`);}
module.exports={publicUser,findUserByEmail};
