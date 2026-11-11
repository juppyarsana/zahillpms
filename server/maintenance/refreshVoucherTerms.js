// Puts the CURRENT terms & conditions of a voucher's type onto vouchers already sold.
// A voucher keeps a copy of its type as sold, so editing the type never changes a voucher
// already out (on purpose). This script is the one exception, for a wording fix: it changes
// the terms text only, never the price, rules, validity or what it covers. Only vouchers
// that are active or booked. Dry run by default; each change is written to the voucher's history.
//
//   node maintenance/refreshVoucherTerms.js --property zahill --voucher V-0001 [--voucher V-0002 ...] [--apply]
//   node maintenance/refreshVoucherTerms.js --property zahill --all [--apply]        (every active / booked voucher)
require('dotenv').config();
const db = require('../db');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const labels = args.map((a, i) => (args[i - 1] === '--voucher' ? a : null)).filter(Boolean);

(async () => {
  const slug = arg('property');
  if (!slug || (!labels.length && !args.includes('--all'))) throw new Error('Usage: --property <slug> (--voucher V-0001 [...] | --all) [--apply]');
  const { rows: [property] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!property) throw new Error(`No property ${slug}`);
  const nos = labels.map(l => parseInt(String(l).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  const { rows } = await db.query(
    `SELECT v.id, v.voucher_no, v.status, v.snapshot->>'terms' AS old_terms, t.terms AS new_terms, t.name AS type_name
     FROM vouchers v JOIN voucher_templates t ON t.id = v.template_id
     WHERE v.property_id = $1 AND v.status IN ('active', 'reserved') AND ($2::int[] IS NULL OR v.voucher_no = ANY($2::int[]))
     ORDER BY v.voucher_no`, [property.id, nos.length ? nos : null]);
  if (nos.length) for (const n of nos) if (!rows.some(r => r.voucher_no === n)) console.log(`V-${String(n).padStart(4, '0')}: not found, or not active / booked — skipped`);
  let changed = 0;
  for (const r of rows) {
    const label = `V-${String(r.voucher_no).padStart(4, '0')}`;
    const a = String(r.old_terms || '').replace(/\r\n?/g, '\n').trim(), b = String(r.new_terms || '').replace(/\r\n?/g, '\n').trim();
    if (a === b) { console.log(`${label} (${r.type_name}): terms already current`); continue; }
    console.log(`${label} (${r.type_name}, ${r.status}): terms ${APPLY ? 'updated' : 'would be updated'}`);
    console.log('  was: ' + a.split('\n').join(' | ').slice(0, 300));
    console.log('  now: ' + b.split('\n').join(' | ').slice(0, 300));
    changed++;
    if (APPLY) {
      await db.query(`UPDATE vouchers SET snapshot = jsonb_set(snapshot, '{terms}', to_jsonb($2::text)), updated_at = NOW() WHERE id = $1`, [r.id, r.new_terms || '']);
      await db.query(`INSERT INTO voucher_events (voucher_id, kind, note) VALUES ($1, 'terms', $2)`, [r.id, 'Terms & conditions refreshed to the voucher type\'s current wording (maintenance script)']);
    }
  }
  console.log(`${APPLY ? 'Done' : 'Dry run'}: ${changed} voucher(s) ${APPLY ? 'changed' : 'would change'}.${!APPLY && changed ? ' Add --apply to do it.' : ''}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
