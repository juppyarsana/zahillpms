// Read-only: bookings whose net room + meals, with service + tax added at the
// booking's own bill rates, don't come to the booking's price (total −
// discount). Before 2026-10-11 Edit Price / Amend Dates / Change Room split a
// price at the property's CURRENT rates even when the booking's bill was
// fixed at other rates (migration 081: stamped at checkout or when the rates
// changed) — e.g. a stay checked out at 0% and re-priced after the switch to
// 10% + 10% got a bill 1,21× too low, showing as a credit on its folio.
// Fix each one on the booking: Edit Price with the same price again.
//
//   node maintenance/checkBillSplit.js [--property <slug>]
require('dotenv').config();
const db = require('../db');
const { computeFolioTotals } = require('../services/folioService');

(async () => {
  const i = process.argv.indexOf('--property');
  const slug = i > -1 ? process.argv[i + 1] : null;
  const { rows } = await db.query(
    `SELECT p.slug, b.id, to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in, b.status, g.name AS guest, u.name AS room,
            (b.total_amount - COALESCE(b.discount_amount, 0))::float AS price,
            (COALESCE(b.room_revenue, 0) + COALESCE(b.fnb_revenue, 0))::float AS net,
            b.bill_tax_rate::float AS tax_rate, COALESCE(b.bill_service_charge_rate, 0)::float AS sc_rate
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       JOIN guests g ON g.id = b.guest_id
       JOIN units u ON u.id = b.unit_id
      WHERE b.status NOT IN ('cancelled', 'no_show') AND b.complimentary_scope IS NULL
        AND b.bill_tax_rate IS NOT NULL AND b.room_revenue IS NOT NULL
        AND ($1::text IS NULL OR p.slug = $1)
      ORDER BY p.slug, b.check_in_date`, [slug]);
  const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  let n = 0;
  for (const r of rows) {
    const bill = computeFolioTotals(r.net, r.tax_rate, r.sc_rate).total;
    if (Math.abs(bill - r.price) <= 1) continue;
    n++;
    console.log(`${r.slug} · ${r.check_in} · room ${r.room} · ${r.guest} · ${r.status}\n   price ${rp(r.price)} — bill at its own rates (service ${r.sc_rate}% + tax ${r.tax_rate}%) ${rp(bill)} (${rp(bill - r.price)})\n   /reservations/${r.id}`);
  }
  if (!n) console.log('Every booking with its own bill rates comes to its price.');
  console.log(`\n${n} booking(s).`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
