const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appwQKVc3E9fyqJT8';
const TOKEN = String(process.env.AIRTABLE_TOKEN || '').trim();
if (!TOKEN) {
  console.error('AIRTABLE_TOKEN é obrigatório para executar o backup administrativo.');
  process.exit(1);
}

const TABLES = {
  Users: 'tbl6EreK59psOOyBp',
  Campaigns: 'tblmKuWcaNbiEVvFF',
  Testimonials: 'tblq3ErvkUpp5HWd2',
  Widgets: 'tbll5UVDxflslX3t8',
};

async function listAll(tableId) {
  const records = [];
  let offset = '';
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Airtable HTTP ${response.status}`);
    records.push(...(data.records || []));
    offset = String(data.offset || '');
  } while (offset);
  return records;
}

function sanitize(tableName, record) {
  const fields = { ...(record.fields || {}) };
  if (tableName === 'Users') delete fields['Password Hash'];
  return { id: record.id, createdTime: record.createdTime, fields };
}

(async () => {
  const backup = {
    generatedAt: new Date().toISOString(),
    baseId: BASE_ID,
    tables: {},
  };

  for (const [name, tableId] of Object.entries(TABLES)) {
    const records = await listAll(tableId);
    backup.tables[name] = records.map(record => sanitize(name, record));
    console.log(`${name}: ${records.length} registro(s)`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.env.BACKUP_DIR || 'backups');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `depoimentopro-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log(`Backup salvo em: ${outFile}`);
})().catch(error => {
  console.error(`Backup falhou: ${error.message}`);
  process.exit(1);
});
