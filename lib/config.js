const crypto = require('node:crypto');
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
  if (secret && secret.length >= 32) return secret;
  return crypto.createHash('sha256').update('dpro-session:' + requireAirtable()).digest('hex');
}

module.exports = { BASE_ID, TABLES, requireAirtable, requireSessionSecret };
