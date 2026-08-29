const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method } = require('../lib/http');
const { readSession } = require('../lib/auth');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const s = readSession(req); if (!s) return json(res, 401, { error:'Sessão inválida.' });
    const b = await bodyJson(req);
    const id = String(b.testimonialId || '').trim();
    const status = String(b.status || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return json(res, 400, { error:'Depoimento inválido.' });
    if (!['Aprovado','Rejeitado'].includes(status)) return json(res, 400, { error:'Status inválido.' });
    const record = await air.get(TABLES.testimonials, id);
    const owners = record.fields?.['User'] || [];
    if (!owners.includes(s.userId)) return json(res, 403, { error:'Sem permissão para este depoimento.' });
    const fields = { 'Status': status, 'Aprovado Em': status === 'Aprovado' ? new Date().toISOString() : null };
    await air.update(TABLES.testimonials, id, fields);
    return json(res, 200, { ok:true, status });
  } catch (e) {
    console.error('moderate', e);
    return json(res, 500, { error:'Não foi possível moderar o depoimento.' });
  }
};
