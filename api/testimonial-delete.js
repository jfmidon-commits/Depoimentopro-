const { TABLES } = require('../lib/config');
const air = require('../lib/airtable');
const { bodyJson, json, method, requireSameOrigin } = require('../lib/http');
const { readSession } = require('../lib/auth');
const validate = require('../lib/validate');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
  if (!method(req, res, ['POST']) || !requireSameOrigin(req, res)) return;

  try {
    const session = readSession(req);
    if (!session) return json(res, 401, { error: 'Sessão inválida.' });

    const body = await bodyJson(req);
    let testimonialId;
    try {
      testimonialId = validate.recordId(body.testimonialId, 'Depoimento');
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    const record = await air.get(TABLES.testimonials, testimonialId);
    const owners = record.fields?.['User'] || [];
    if (!owners.includes(session.userId)) {
      return json(res, 403, { error: 'Sem permissão para excluir este depoimento.' });
    }

    const campaignId = record.fields?.['Campaign']?.[0] || null;
    await air.remove(TABLES.testimonials, testimonialId);

    // Linked records do Airtable podem levar alguns instantes para refletir a remoção.
    await sleep(200);

    const user = await air.get(TABLES.users, session.userId);
    const userTestimonials = Array.isArray(user.fields?.['Testimonials'])
      ? user.fields['Testimonials']
      : [];

    const updates = [
      air.update(TABLES.users, session.userId, {
        'Depoimentos Usados': userTestimonials.length,
      }),
    ];

    if (campaignId && /^rec[A-Za-z0-9]{14}$/.test(campaignId)) {
      const campaign = await air.get(TABLES.campaigns, campaignId).catch(() => null);
      if (campaign && (campaign.fields?.['User'] || []).includes(session.userId)) {
        const campaignTestimonials = Array.isArray(campaign.fields?.['Testimonials'])
          ? campaign.fields['Testimonials']
          : [];
        updates.push(
          air.update(TABLES.campaigns, campaignId, {
            'Total Respostas': campaignTestimonials.length,
          })
        );
      }
    }

    await Promise.all(updates);
    return json(res, 200, { ok: true });
  } catch (error) {
    if (error?.statusCode === 404) {
      return json(res, 404, { error: 'Depoimento não encontrado.' });
    }
    console.error('testimonial-delete', error);
    return json(res, 500, { error: 'Não foi possível excluir o depoimento.' });
  }
};
