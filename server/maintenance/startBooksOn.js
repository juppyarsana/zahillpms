// Moves a property's first day of the books: opens every closed day again and
// sets the new first day. For the switch from the old system, where days were
// closed from an earlier start. Dry run by default.
//
//   node maintenance/startBooksOn.js --property zahill --date 2026-11-01 [--apply]
//
// What was closed is rebuilt from today's data once opened, so an exported
// day may change. Stops if opening balances or journal entries sit before the
// new first day: void or move those first.
require('dotenv').config();
const db = require('../db');
const { setBooksStart } = require('../services/glEntryService');
const { todayWITA } = require('../services/roomChargeService');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');

(async () => {
  const slug = arg('property'), date = arg('date');
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Usage: --property <slug> --date YYYY-MM-DD [--apply]');
  const { rows: [property] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!property) throw new Error(`No property ${slug}`);
  const [{ rows: [closed] }, { rows: [settings] }, { rows: entries }] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS n, to_char(MIN(business_date), 'YYYY-MM-DD') AS first, to_char(MAX(business_date), 'YYYY-MM-DD') AS last
              FROM gl_closed_days WHERE property_id = $1`, [property.id]),
    db.query(`SELECT to_char(books_start, 'YYYY-MM-DD') AS books_start FROM gl_settings WHERE property_id = $1`, [property.id]),
    db.query(`SELECT entry_no, kind, to_char(entry_date, 'YYYY-MM-DD') AS date, memo FROM gl_entries
              WHERE property_id = $1 AND is_voided = false AND (entry_date < $2 OR kind = 'opening') ORDER BY entry_no`, [property.id, date]),
  ]);
  console.log(`${property.name}: first day of the books ${settings?.books_start || 'not set'} → ${date}`);
  console.log(`Closed days to open again: ${closed.n}${closed.n ? ` (${closed.first} … ${closed.last})` : ''}`);
  if (entries.length) {
    console.log('In the way (void these first):');
    for (const e of entries) console.log(`  JE-${String(e.entry_no).padStart(4, '0')} ${e.date} ${e.kind}: ${e.memo}`);
    throw new Error('Nothing changed.');
  }
  if (!APPLY) { console.log('Dry run: nothing changed. Run again with --apply.'); return db.pool.end(); }
  const { rowCount } = await db.query('DELETE FROM gl_closed_days WHERE property_id = $1', [property.id]);
  const r = await setBooksStart(property.id, null, date, todayWITA());
  if (r.error) throw new Error(r.error);
  console.log(`Done: ${rowCount} days opened, the books start on ${date}.`);
  await db.pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
