const { bodyJson, json, method } = require('../lib/http');
const { verifyPassword, setSession } = require('../lib/auth');
const { findUserByEmail, publicUser } = require('../lib/user');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const b = await bodyJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.fields?.['Password Hash'])) return json(res, 401, { error: 'E-mail ou senha inválidos.' });
    setSession(res, user.id);
    return json(res, 200, { user: publicUser(user) });
  } catch (e) {
    console.error('login', e);
    return json(res, 500, { error: 'Não foi possível entrar agora.' });
  }
};
