const { requireAirtable, requireSessionSecret } = require('../lib/config');
const { json, method } = require('../lib/http');

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;

  const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  const version = commit ? commit.slice(0, 12) : 'unknown';

  try {
    requireAirtable();
    requireSessionSecret();
  } catch (error) {
    console.error('health-config', error?.message || error);
    return json(res, 503, {
      ok: false,
      service: 'depoimentopro',
      version,
    });
  }

  return json(res, 200, {
    ok: true,
    service: 'depoimentopro',
    version,
  });
};
