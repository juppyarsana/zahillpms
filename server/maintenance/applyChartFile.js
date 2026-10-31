// Adds a property's own accounts to the standard chart from a JSON file kept
// out of git (bank account numbers don't belong in the repo). Dry run by default.
//
//   node maintenance/applyChartFile.js --property zahill --file <chart.json> [--apply]
//
// File: { "accounts": [{ "code", "name", "type" }], "use": ["290-00-001"], "stop": ["110-00-001"] }
// accounts: added, or renamed and switched on when the code exists.
// use: switched on. stop: switched off, unless an item or a journal entry uses it.
const fs = require('fs');
require('dotenv').config();
const db = require('../db');
const { loadMapping, TYPES } = require('../services/accountingService');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');

(async () => {
  const slug = arg('property'), file = arg('file');
  if (!slug || !file) throw new Error('Usage: --property <slug> --file <chart.json> [--apply]');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const { rows: [property] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!property) throw new Error(`No property ${slug}`);
  for (const a of spec.accounts || []) {
    if (!a.code || !a.name || !TYPES.includes(a.type)) throw new Error(`Bad account: ${JSON.stringify(a)}`);
  }

  const before = await loadMapping(property.id);
  const byCode = new Map(before.accounts.map(a => [a.code, a]));
  console.log(`${property.name}: ${APPLY ? 'APPLYING' : 'dry run'}`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of spec.accounts || []) {
      const cur = byCode.get(a.code);
      if (cur && cur.type !== a.type) throw new Error(`${a.code} is a ${cur.type} account, the file says ${a.type}`);
      if (!cur) console.log(`  add     ${a.code} ${a.name}`);
      else if (cur.name !== a.name || !cur.is_active) console.log(`  rename  ${a.code} ${cur.name} → ${a.name}`);
      await client.query(
        `INSERT INTO gl_accounts (property_id, code, name, type) VALUES ($1, $2, $3, $4)
         ON CONFLICT (property_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = NOW()`,
        [property.id, a.code, a.name, a.type]);
    }
    for (const code of spec.use || []) {
      const cur = byCode.get(code);
      if (!cur) { console.log(`  ?       ${code} is not in the chart`); continue; }
      if (!cur.is_active) console.log(`  use     ${code} ${cur.name}`);
      await client.query('UPDATE gl_accounts SET is_active = true, updated_at = NOW() WHERE property_id = $1 AND code = $2', [property.id, code]);
    }
    for (const code of spec.stop || []) {
      const cur = byCode.get(code);
      if (!cur) continue;
      const used = before.keys.filter(k => k.account_id === cur.id).map(k => k.label);
      const { rows: [{ n }] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM gl_entry_lines l JOIN gl_entries e ON e.id = l.entry_id
         WHERE l.account_id = $1 AND e.is_voided = false`, [cur.id]);
      if (used.length || n) {
        console.log(`  keep    ${code} ${cur.name} — used by ${[...used, ...(n ? [`${n} journal lines`] : [])].join('; ')}`);
        continue;
      }
      if (cur.is_active) console.log(`  stop    ${code} ${cur.name}`);
      await client.query('UPDATE gl_accounts SET is_active = false, updated_at = NOW() WHERE id = $1', [cur.id]);
    }
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (APPLY) {
    const after = await loadMapping(property.id);
    console.log('\nWhere each payment method now goes:');
    for (const k of after.keys.filter(x => x.key.startsWith('pay.'))) {
      console.log(`  ${k.label}: ${k.account ? `${k.account.code} ${k.account.name}` : 'no account'}${k.is_default ? '' : ' (chosen by hand)'}`);
    }
  } else {
    console.log('\nNothing changed. Run again with --apply.');
  }
  await db.pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
