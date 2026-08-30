const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { json, method, requireSameOrigin } = require('../lib/http');
const { readSession } = require('../lib/auth');
const { randomToken } = require('../lib/security');

function widgetPayload(record, token, existing) {
  return {
    ok: true,
    widgetId: record.id,
    existing,
    widget: {
      id: record.id,
      token,
      existing,
    },
  };
}

module.exports = async (req, res) => {
  if (!method(req, res, ['POST']) || !requireSameOrigin(req, res)) return;

  try {
    const session = readSession(req);
    if (!session) return json(res, 401, { error: 'Sessão inválida.' });

    const user = await air.get(TABLES.users, session.userId);
    const existingIds = user.fields?.['Widgets'] || [];
    const existingWidgets = await air.getMany(TABLES.widgets, existingIds, 10);
    const active = existingWidgets.find(
      widget => widget.fields?.['Ativo'] === true && widget.fields?.['Public Token']
    );

    if (active) {
      return json(
        res,
        200,
        widgetPayload(active, active.fields['Public Token'], true)
      );
    }

    const token = randomToken(24);
    const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '';
    const base = String(process.env.APP_URL || productionUrl).replace(/\/$/, '');
    const src = `${base || ''}/widget?token=${encodeURIComponent(token)}`;
    const embed = `<iframe src="${src}" style="width:100%;min-height:280px;border:0" loading="lazy" title="Depoimentos"></iframe>`;

    const widget = await air.create(TABLES.widgets, {
      Nome: 'Widget Principal',
      Estilo: 'Cards',
      Limite: 5,
      'Codigo Embed': embed,
      Ativo: true,
      'Criado Em': new Date().toISOString(),
      User: [session.userId],
      'Public Token': token,
    });

    await air.update(TABLES.users, session.userId, {
      'Widgets Criados': existingWidgets.length + 1,
    });

    return json(res, 201, widgetPayload(widget, token, false));
  } catch (error) {
    console.error('widgets', error);
    return json(res, 500, { error: 'Não foi possível criar o widget.' });
  }
};
