// Marks vouchers that were sold by mistake (no money was ever received) as "entered by
// mistake": the sale leaves the books (journal, Daily Close, Cashier Closing, voucher report)
// as if it never happened. The voucher is NOT deleted: it stays in the Vouchers list as
// cancelled, with its reason, so the missing number can be explained later.
//
// For vouchers already cancelled with nothing given back (that cancellation booked the money as
// breakage income), and for active ones (they are cancelled by this script). Not for free vouchers,
// vouchers charged to a room, vouchers booked or used, or ones that had a refund. Dry run by default.
//
//   node maintenance/markVouchersMistake.js --property zahill --voucher V-0001 --voucher V-0002 ... [--reason "Test sales"] [--apply]
require('dotenv').config();
const db = require('../db');

const args = process.argv.slice(2);
const val = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const nos = args.map((a, i) => (args[i - 1] === '--voucher' ? parseInt(String(a).replace(/\D/g, ''), 10) : null)).filter(Number.isFinite);

(async () => {
  const slug = val('property');
  if (!slug || !nos.length) throw new Error('Usage: --property <slug> --voucher V-0001 [--voucher V-0002 ...] [--reason "text"] [--apply]');
  const { rows: [property] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!property) throw new Error(`No property ${slug}`);
  const { rows } = await db.query(
    `SELECT id, voucher_no, status, is_free, charged_booking_id, booking_id, refunded_amount, void_kind, sold_total, sold_on::text AS sold_on, payment_method, void_reason
     FROM vouchers WHERE property_id = $1 AND voucher_no = ANY($2::int[]) ORDER BY voucher_no`, [property.id, nos]);
  const label = r => `V-${String(r.voucher_no).padStart(4, '0')}`;
  for (const n of nos) if (!rows.some(r => r.voucher_no === n)) throw new Error(`V-${String(n).padStart(4, '0')} not found`);
  const reason = val('reason') || 'Entered by mistake — nothing was paid';
  let total = 0;
  for (const r of rows) {
    if (r.void_kind === 'mistake') { console.log(`${label(r)}: already marked`); continue; }
    if (r.is_free || r.charged_booking_id) throw new Error(`${label(r)} is free or charged to a room — cancel it on the Vouchers page`);
    if (['reserved', 'redeemed', 'expired'].includes(r.status) || r.booking_id) throw new Error(`${label(r)} is ${r.status} — not touched`);
    if (Number(r.refunded_amount) > 0) throw new Error(`${label(r)} had a refund — not a mistaken sale`);
    total += Number(r.sold_total);
    console.log(`${label(r)}: ${r.status}, sold ${r.sold_on} (${r.payment_method}), Rp ${Number(r.sold_total).toLocaleString('id-ID')} → ${APPLY ? 'marked' : 'would be marked'} as entered by mistake`);
  }
  if (APPLY) {
    const todo = rows.filter(r => r.void_kind !== 'mistake');
    for (const r of todo) {
      if (r.status === 'active') {
        await db.query(`UPDATE vouchers SET status = 'voided', void_reason = $2, voided_at = NOW(), refunded_amount = 0, void_kind = 'mistake', updated_at = NOW() WHERE id = $1`, [r.id, reason]);
      } else {
        await db.query(`UPDATE vouchers SET void_kind = 'mistake', void_reason = COALESCE(NULLIF($2, ''), void_reason), updated_at = NOW() WHERE id = $1`, [r.id, val('reason') || r.void_reason || reason]);
      }
      await db.query(`INSERT INTO voucher_events (voucher_id, kind, note) VALUES ($1, 'voided', $2)`, [r.id, `${val('reason') || reason} — entered by mistake, nothing was paid: taken out of the books (maintenance script)`]);
    }
    console.log(`Done: ${todo.length} voucher(s) taken out of the books (Rp ${total.toLocaleString('id-ID')}); they stay listed as cancelled.`);
  } else console.log(`Dry run: Rp ${total.toLocaleString('id-ID')} would leave the books. Add --apply to do it.`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
