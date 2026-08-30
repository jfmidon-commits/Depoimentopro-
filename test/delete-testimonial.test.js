const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); },
    end(v = '') { this.body = String(v); return this; },
  };
}

function loadHandler(handlerRelative, mocks) {
  const saved = [];
  for (const [moduleRelative, exports] of Object.entries(mocks)) {
    const p = require.resolve(moduleRelative);
    saved.push([p, require.cache[p]]);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  const hp = require.resolve(handlerRelative);
  const oldHandler = require.cache[hp];
  delete require.cache[hp];
  const handler = require(handlerRelative);
  return {
    handler,
    restore() {
      delete require.cache[hp];
      if (oldHandler) require.cache[hp] = oldHandler;
      for (const [p, old] of saved) {
        if (old) require.cache[p] = old;
        else delete require.cache[p];
      }
    },
  };
}

const USER = 'rec' + 'A'.repeat(14);
const OTHER = 'rec' + 'B'.repeat(14);
const TESTIMONIAL = 'rec' + 'T'.repeat(14);
const CAMPAIGN = 'rec' + 'C'.repeat(14);

function request(body) {
  return {
    method: 'POST',
    url: '/api/moderate?action=delete',
    headers: {
      host: 'depoimentopro-app.vercel.app',
      origin: 'https://depoimentopro-app.vercel.app',
    },
    body,
  };
}

test('usuário não pode excluir depoimento de outro proprietário', async () => {
  let removed = false;
  const air = {
    get: async () => ({ fields: { User: [OTHER] } }),
    remove: async () => { removed = true; },
  };
  const auth = { readSession: () => ({ userId: USER }) };
  const { handler, restore } = loadHandler('../api/moderate', {
    '../lib/airtable': air,
    '../lib/auth': auth,
  });

  try {
    const res = mockRes();
    await handler(request({ testimonialId: TESTIMONIAL }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(removed, false);
  } finally {
    restore();
  }
});

test('exclusão própria remove registro e reconcilia usuário e campanha', async () => {
  let removedId = null;
  const updates = [];
  const air = {
    get: async (_table, id) => {
      if (id === TESTIMONIAL) return { fields: { User: [USER], Campaign: [CAMPAIGN] } };
      if (id === USER) return { fields: { Testimonials: [] } };
      if (id === CAMPAIGN) return { fields: { User: [USER], Testimonials: [] } };
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    },
    remove: async (_table, id) => { removedId = id; },
    update: async (table, id, fields) => { updates.push({ table, id, fields }); },
  };
  const auth = { readSession: () => ({ userId: USER }) };
  const { handler, restore } = loadHandler('../api/moderate', {
    '../lib/airtable': air,
    '../lib/auth': auth,
  });

  try {
    const res = mockRes();
    await handler(request({ testimonialId: TESTIMONIAL }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(removedId, TESTIMONIAL);
    assert.equal(JSON.parse(res.body).ok, true);
    assert.ok(updates.some(u => u.id === USER && u.fields['Depoimentos Usados'] === 0));
    assert.ok(updates.some(u => u.id === CAMPAIGN && u.fields['Total Respostas'] === 0));
  } finally {
    restore();
  }
});
