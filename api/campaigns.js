const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method } = require('../lib/http');
const { readSession } = require('../lib/auth');
const { randomToken } = require('../lib/security');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const s = readSession(req); if (!s) return json(res, 401, { error:'Sessão inválida.' });
    await air.get(TABLES.users, s.userId);
    const b = await bodyJson(req);
    const nome = String(b.nome || '').trim();
    if (nome.length < 2) return json(res, 400, { error:'Informe um nome para a campanha.' });
    const token = randomToken(24);
    const base = String(process.env.APP_URL || '').replace(/\/$/, '');
    const link = base ? `${base}/form?token=${encodeURIComponent(token)}` : `/form?token=${encodeURIComponent(token)}`;
    const record = await air.create(TABLES.campaigns, {
      'Nome': nome,
      'Mensagem Email': String(b.mensagemEmail || '').trim(),
      'Mensagem WhatsApp': String(b.mensagemWhatsApp || '').trim(),
      'Link Formulario': link,
      'Status': 'Ativa',
      'Criada Em': new Date().toISOString(),
      'Total Enviados': 0,
      'Total Respostas': 0,
      'User': [s.userId],
      'Public Token': token,
    });
    return json(res, 201, { campaign: { id:record.id, nome, status:'Ativa', link, totalRespostas:0 } });
  } catch (e) {
    console.error('campaigns', e);
    return json(res, 500, { error:'Não foi possível criar a campanha.' });
  }
};
