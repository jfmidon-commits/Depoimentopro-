const { BASE_ID, requireAirtable } = require('./config');

function apiUrl(tableId, recordId = '') {
  return `https://api.airtable.com/v0/${BASE_ID}/${tableId}${recordId ? `/${recordId}` : ''}`;
}

async function request(tableId, { method = 'GET', recordId = '', query, body } = {}) {
  const token = requireAirtable();
  const url = new URL(apiUrl(tableId, recordId));
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, String(v)));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.error?.type || `Airtable HTTP ${res.status}`;
    const err = new Error(message);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

function escapeFormula(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function list(tableId, opts = {}) {
  return request(tableId, { query: opts });
}
async function get(tableId, recordId) { return request(tableId, { recordId }); }
async function create(tableId, fields) { return request(tableId, { method: 'POST', body: { fields } }); }
async function update(tableId, recordId, fields) { return request(tableId, { method: 'PATCH', recordId, body: { fields } }); }
async function remove(tableId, recordId) { return request(tableId, { method: 'DELETE', recordId }); }

async function findOne(tableId, formula) {
  const data = await list(tableId, { filterByFormula: formula, maxRecords: 1, pageSize: 1 });
  return data.records?.[0] || null;
}

async function getMany(tableId, ids, limit = 50) {
  const safe = [...new Set((ids || []).filter(Boolean))].slice(0, limit);
  return Promise.all(safe.map((id) => get(tableId, id)));
}

module.exports = { list, get, create, update, remove, findOne, getMany, escapeFormula };
