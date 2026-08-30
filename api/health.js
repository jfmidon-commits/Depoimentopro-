const { requireAirtable, requireSessionSecret } = require('../lib/config');
const { json, method } = require('../lib/http');

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  try {
    requireAirtable();
    requireSessionSecret();
    const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
    return json(res, 200, {
      ok: true,
      service: 'depoimentopro',
      version: commit ? commit.slice(0, 12) : 'unknown',
    });
  } catch (error) {
    console.error('health', error?.message || error);
    return json(res, 503, { ok: false });
  }
};
