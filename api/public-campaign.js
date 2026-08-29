const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { json, method } = require('../lib/http');

async function findActive(token) {
  const t = air.escapeFormula(token);
  return air.findOne(TABLES.campaigns, `AND({Public Token}='${t}',{Status}='Ativa')`);
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  try {
    const token = String(req.query?.token || '').trim();
    if (!token || token.length < 20) return json(res, 400, { error:'Link inválido.' });
    const campaign = await findActive(token);
    if (!campaign) return json(res, 404, { error:'Campanha não encontrada ou pausada.' });
    const userId = campaign.fields?.['User']?.[0];
    if (!userId) return json(res, 404, { error:'Campanha inválida.' });
    const user = await air.get(TABLES.users, userId);
    const f = user.fields || {};
    const plan = f['Plano'] || 'Free';
    const used = Number(f['Depoimentos Usados'] || 0);
    const limit = Number(f['Limite Depoimentos'] || 0);
    if (plan !== 'Pro' && used >= limit) return json(res, 403, { error:'Esta campanha atingiu o limite de depoimentos do plano atual.' });
    return json(res, 200, { campaign: { nome:campaign.fields?.['Nome'] || 'Enviar depoimento', mensagem:'Conte de forma sincera como foi sua experiência.' } });
  } catch (e) {
    console.error('public-campaign', e);
    return json(res, 500, { error:'Não foi possível carregar esta campanha.' });
  }
};
