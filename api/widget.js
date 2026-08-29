const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { method } = require('../lib/http');

function esc(v = '') {
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const userId = String(req.query?.user || '').trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<p>Widget inválido.</p>');
  }
  try {
    const user = await air.get(TABLES.users, userId);
    const ids = user.fields?.['Testimonials'] || [];
    const records = await air.getMany(TABLES.testimonials, ids, 100);
    const approved = records
      .filter(r => r.fields?.['Status'] === 'Aprovado' && r.fields?.['Consentimento Publicacao'] === true)
      .sort((a,b) => String(b.fields?.['Aprovado Em'] || b.createdTime || '').localeCompare(String(a.fields?.['Aprovado Em'] || a.createdTime || '')))
      .slice(0, 5);
    const cards = approved.length ? approved.map(r => {
      const f = r.fields || {};
      const stars = '★'.repeat(Math.max(0, Math.min(5, Number(f['Nota'] || 0))));
      return `<article class="card"><div class="stars">${stars}</div><blockquote>“${esc(f['Texto'] || '')}”</blockquote><strong>${esc(f['Nome Cliente'] || 'Cliente')}</strong></article>`;
    }).join('') : '<p class="empty">Ainda não há depoimentos publicados.</p>';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *");
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;background:transparent}.wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;padding:4px}.card{border:1px solid #e5e7eb;border-radius:14px;background:#fff;padding:18px;box-shadow:0 6px 18px rgba(15,23,42,.05)}.stars{color:#f59e0b;letter-spacing:2px}.card blockquote{margin:10px 0 14px;font-size:1rem;line-height:1.55}.card strong{font-size:.95rem}.empty{color:#6b7280;padding:12px}</style></head><body><section class="wrap">${cards}</section></body></html>`);
  } catch (e) {
    console.error('widget', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<p>Não foi possível carregar os depoimentos.</p>');
  }
};
