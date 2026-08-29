const { bodyJson, json, method, clientIp } = require('../lib/http');
const { verifyPassword, setSession } = require('../lib/auth');
const { findUserByEmail, publicUser } = require('../lib/user');
const { allowRate, rateKey } = require('../lib/security');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  try {
    const b = await bodyJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const ip = clientIp(req);

    const ipAllowed = allowRate(rateKey('login-ip', ip), { limit: 12, windowMs: 15 * 60_000 });
    const accountAllowed = allowRate(rateKey('login-account', email), { limit: 6, windowMs: 15 * 60_000 });
    if (!ipAllowed || !accountAllowed) {
      res.setHeader('Retry-After', '900');
      return json(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.fields?.['Password Hash'])) {
      return json(res, 401, { error: 'E-mail ou senha inválidos.' });
    }

    setSession(res, user.id);
    return json(res, 200, { user: publicUser(user) });
  } catch (e) {
    console.error('login', e);
    return json(res, 500, { error: 'Não foi possível entrar agora.' });
  }
};
