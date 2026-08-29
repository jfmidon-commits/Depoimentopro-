const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { json, method } = require('../lib/http');
const { readSession } = require('../lib/auth');
const { publicUser } = require('../lib/user');
module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  try {
    const s = readSession(req);
    if (!s) return json(res, 401, { error: 'Sessão inválida.' });
    const user = await air.get(TABLES.users, s.userId);
    return json(res, 200, { user: publicUser(user) });
  } catch (e) {
    console.error('me', e);
    return json(res, 401, { error: 'Sessão inválida.' });
  }
};
