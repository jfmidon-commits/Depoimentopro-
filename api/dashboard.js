const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { json, method } = require('../lib/http');
const { readSession } = require('../lib/auth');
const { publicUser } = require('../lib/user');

function campaignView(r) { const f = r.fields || {}; return { id:r.id, nome:f['Nome']||'', status:f['Status']||'', link:f['Link Formulario']||'', totalRespostas:Number(f['Total Respostas']||0), criadaEm:f['Criada Em']||'' }; }
function testimonialView(r) { const f=r.fields||{}; return { id:r.id, nomeCliente:f['Nome Cliente']||'', texto:f['Texto']||'', nota:Number(f['Nota']||0), status:f['Status']||'', origem:f['Origem']||'', criadaEm:f['Data Criacao']||'', consentimento:Boolean(f['Consentimento Publicacao']) }; }

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  try {
    const s = readSession(req); if (!s) return json(res, 401, { error:'Sessão inválida.' });
    const userRecord = await air.get(TABLES.users, s.userId);
    const user = publicUser(userRecord);
    const [campaigns, testimonials] = await Promise.all([
      air.getMany(TABLES.campaigns, user.campaigns, 50),
      air.getMany(TABLES.testimonials, user.testimonials, 100),
    ]);
    campaigns.sort((a,b)=>String(b.fields?.['Criada Em']||'').localeCompare(String(a.fields?.['Criada Em']||'')));
    testimonials.sort((a,b)=>String(b.fields?.['Data Criacao']||'').localeCompare(String(a.fields?.['Data Criacao']||'')));
    return json(res, 200, { user, campaigns: campaigns.map(campaignView), testimonials: testimonials.map(testimonialView) });
  } catch (e) {
    console.error('dashboard', e);
    return json(res, 500, { error:'Não foi possível carregar o dashboard.' });
  }
};
