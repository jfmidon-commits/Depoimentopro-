const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method, clientIp } = require('../lib/http');
const { allowRate } = require('../lib/security');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const ip = clientIp(req);
    if (!allowRate(`testimonial:${ip}`, { limit: 6, windowMs: 60_000 })) return json(res, 429, { error:'Muitas tentativas. Tente novamente em instantes.' });
    const b = await bodyJson(req);
    if (String(b.website || '').trim()) return json(res, 200, { ok:true });
    const token = String(b.token || '').trim();
    const nome = String(b.nomeCliente || '').trim();
    const texto = String(b.texto || '').trim();
    const nota = Number(b.nota);
    const consent = b.consentimento === true;
    if (!token || token.length < 20) return json(res, 400, { error:'Link inválido.' });
    if (nome.length < 2 || nome.length > 120) return json(res, 400, { error:'Informe seu nome.' });
    if (texto.length < 10 || texto.length > 2000) return json(res, 400, { error:'O depoimento deve ter entre 10 e 2000 caracteres.' });
    if (![1,2,3,4,5].includes(nota)) return json(res, 400, { error:'Selecione uma nota de 1 a 5.' });
    if (!consent) return json(res, 400, { error:'É necessário autorizar a revisão e eventual publicação.' });
    const t = air.escapeFormula(token);
    const campaign = await air.findOne(TABLES.campaigns, `AND({Public Token}='${t}',{Status}='Ativa')`);
    if (!campaign) return json(res, 404, { error:'Campanha não encontrada ou pausada.' });
    const userId = campaign.fields?.['User']?.[0];
    if (!userId) return json(res, 400, { error:'Campanha inválida.' });
    const user = await air.get(TABLES.users, userId);
    const uf = user.fields || {};
    const plan = uf['Plano'] || 'Free';
    const used = Number(uf['Depoimentos Usados'] || 0);
    const limit = Number(uf['Limite Depoimentos'] || 0);
    if (plan !== 'Pro' && used >= limit) return json(res, 403, { error:'Esta campanha atingiu o limite do plano atual.' });
    const record = await air.create(TABLES.testimonials, {
      'Nome Cliente': nome,
      'Texto': texto,
      'Nota': nota,
      'Status': 'Pendente',
      'Origem': 'Form',
      'Data Criacao': new Date().toISOString(),
      'User': [userId],
      'Campaign': [campaign.id],
      'Consentimento Publicacao': true,
    });
    await Promise.all([
      air.update(TABLES.users, userId, { 'Depoimentos Usados': used + 1 }),
      air.update(TABLES.campaigns, campaign.id, { 'Total Respostas': Number(campaign.fields?.['Total Respostas'] || 0) + 1 }),
    ]);
    return json(res, 201, { ok:true, id:record.id });
  } catch (e) {
    console.error('testimonials', e);
    return json(res, 500, { error:'Não foi possível enviar o depoimento.' });
  }
};
