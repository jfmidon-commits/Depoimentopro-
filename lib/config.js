const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appwQKVc3E9fyqJT8';

const TABLES = {
  users: 'tbl6EreK59psOOyBp',
  campaigns: 'tblmKuWcaNbiEVvFF',
  testimonials: 'tblq3ErvkUpp5HWd2',
  widgets: 'tbll5UVDxflslX3t8',
};

function requireAirtable() {
  if (!process.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN não configurado');
  return process.env.AIRTABLE_TOKEN;
}

function requireSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres');
  }
  return secret;
}

module.exports = { BASE_ID, TABLES, requireAirtable, requireSessionSecret };
