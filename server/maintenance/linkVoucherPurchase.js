// Makes vouchers that were sold one by one share ONE receipt, as if sold together
// (migration 170 purchase id). For vouchers that already exist: same buyer, same payment
// method and same day are required, since the receipt prints them once. Free vouchers and
// vouchers charged to a room have no receipt and are refused. Dry run by default.
//
//   node maintenance/linkVoucherPurchase.js --property zahill --voucher V-0003 --voucher V-0004 --voucher V-0005 [--apply]
require('dotenv').config();
const crypto = require('crypto');
const db = require('../db');

const args = process.argv.slice(2);
const slug = (() => { const i = args.indexOf('--property'); return i >= 0 ? args[i + 1] : null; })();
const APPLY = args.includes('--apply');
const nos = args.map((a, i) => (args[i - 1] === '--voucher' ? parseInt(String(a).replace(/\D/g, ''), 10) : null)).filter(Number.isFinite);

(async () => {
  if (!slug || nos.length < 2) throw new Error('Usage: --property <slug> --voucher V-0003 --voucher V-0004 [...] [--apply]   (at least two)');
  const { rows: [property] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!property) throw new Error(`No property ${slug}`);
  const { rows } = await db.query(
    `SELECT id, voucher_no, buyer_name, payment_method, sold_on::text AS sold_on, is_free, charged_booking_id, status, purchase_id, sold_total
     FROM vouchers WHERE property_id = $1 AND voucher_no = ANY($2::int[]) ORDER BY voucher_no`, [property.id, nos]);
  const label = r => `V-${String(r.voucher_no).padStart(4, '0')}`;
  for (const n of nos) if (!rows.some(r => r.voucher_no === n)) throw new Error(`V-${String(n).padStart(4, '0')} not found`);
  for (const r of rows) {
    if (r.is_free) throw new Error(`${label(r)} is a free voucher — no receipt`);
    if (r.charged_booking_id) throw new Error(`${label(r)} is charged to a room — it is on the guest's invoice`);
    if (r.status === 'voided') throw new Error(`${label(r)} is cancelled`);
  }
  const f = rows[0];
  const diff = rows.filter(r => r.buyer_name !== f.buyer_name || r.payment_method !== f.payment_method || r.sold_on !== f.sold_on);
  if (diff.length) throw new Error(`Not the same buyer / payment method / day as ${label(f)}: ${diff.map(label).join(', ')} — a receipt prints them once`);
  const ids = new Set(rows.map(r => r.purchase_id).filter(Boolean));
  const shared = ids.size === 1 && rows.every(r => r.purchase_id);
  if (shared) { console.log('Already share one receipt.'); process.exit(0); }
  const total = rows.reduce((s, r) => s + Number(r.sold_total), 0);
  console.log(`${property.name}: ${rows.map(label).join(', ')} — ${f.buyer_name}, ${f.payment_method}, ${f.sold_on}, total Rp ${total.toLocaleString('id-ID')}`);
  if (rows.some(r => r.purchase_id)) console.log('Note: some of them already belong to another purchase; they move to this one.');
  if (APPLY) {
    const pid = crypto.randomUUID();
    await db.query('UPDATE vouchers SET purchase_id = $2 WHERE id = ANY($1::uuid[])', [rows.map(r => r.id), pid]);
    console.log('Done — one receipt now covers them (Vouchers → the voucher → 🖨 Receipt).');
  } else console.log('Dry run. Add --apply to do it.');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
