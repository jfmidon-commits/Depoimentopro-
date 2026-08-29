const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method } = require('../lib/http');
const { hashPassword, setSession } = require('../lib/auth');
const { findUserByEmail, publicUser } = require('../lib/user');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const b = await bodyJson(req);
    const nome = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (nome.length < 2) return json(res, 400, { error: 'Informe seu nome.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'E-mail inválido.' });
    if (password.length < 8) return json(res, 400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (await findUserByEmail(email)) return json(res, 409, { error: 'Já existe uma conta com este e-mail.' });
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
