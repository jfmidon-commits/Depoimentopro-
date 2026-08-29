const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method, clientIp } = require('../lib/http');
const { hashPassword, setSession } = require('../lib/auth');
const { findUserByEmail, publicUser } = require('../lib/user');
const { allowRate, rateKey } = require('../lib/security');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const ip = clientIp(req);
    if (!allowRate(rateKey('signup-ip', ip), { limit: 5, windowMs: 15 * 60_000 })) {
      res.setHeader('Retry-After', '900');
      return json(res, 429, { error: 'Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.' });
    }

    const b = await bodyJson(req);
    const nome = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');

    if (nome.length < 2 || nome.length > 120) return json(res, 400, { error: 'Informe seu nome.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'E-mail inválido.' });
    if (password.length < 10 || password.length > 128) return json(res, 400, { error: 'A senha precisa ter entre 10 e 128 caracteres.' });
    if (await findUserByEmail(email)) return json(res, 409, { error: 'Não foi possível criar a conta com este e-mail.' });

    const record = await air.create(TABLES.users, {
      'Nome': nome,
      'Email': email,
      'Plano': 'Free',
      'Limite Depoimentos': 5,
      'Depoimentos Usados': 0,
      'Widgets Criados': 0,
      'Data Criacao': new Date().toISOString(),
      'Onboarding Completo': false,
      'Password Hash': hashPassword(password),
    });
    setSession(res, record.id);
    return json(res, 201, { user: publicUser(record) });
  } catch (e) {
    console.error('signup', e);
    return json(res, 500, { error: 'Não foi possível criar a conta agora.' });
  }
};
