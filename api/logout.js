const { json, method } = require('../lib/http');
const { clearSession } = require('../lib/auth');
module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  clearSession(res);
  return json(res, 200, { ok: true });
};
