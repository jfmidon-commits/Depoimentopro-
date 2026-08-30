const { requireAirtable, requireSessionSecret } = require('../lib/config');
const { json, method } = require('../lib/http');

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;

  const missing = [];
  try { requireAirtable(); } catch { missing.push('AIRTABLE_TOKEN'); }
  try { requireSessionSecret(); } catch { missing.push('SESSION_SECRET'); }

  const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();

  if (missing.length) {
    return json(res, 503, {
      ok: false,
      service: 'depoimentopro',
      missing,
      version: commit ? commit.slice(0, 12) : 'unknown',
    });
  }

  return json(res, 200, {
    ok: true,
    service: 'depoimentopro',
    version: commit ? commit.slice(0, 12) : 'unknown',
  });
};
