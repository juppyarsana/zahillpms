// Read-only: bookings whose deposit / balance lines don't add up to the
// booking's price (total − discount). Before 2026-10-01 the ✏ on a pending
// line in Payment Tracking changed that one line on its own, so the lines
// could disagree with the price (and every document printed the price).
// Fix each one on the booking: Edit Price if the price is wrong, or change a
// pending line (the rest now moves to the other line).
//
//   node maintenance/checkPaymentLines.js [--property <slug>]
require('dotenv').config();
const db = require('../db');

(async () => {
  const i = process.argv.indexOf('--property');
  const slug = i > -1 ? process.argv[i + 1] : null;
  const { rows } = await db.query(
    `SELECT p.slug, b.id, to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in, b.status, g.name AS guest, u.name AS room,
            (b.total_amount - COALESCE(b.discount_amount, 0))::float AS price,
            l.received::float, l.pending::float
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       JOIN guests g ON g.id = b.guest_id
       JOIN units u ON u.id = b.unit_id
       JOIN LATERAL (
         SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'received'), 0) AS received,
                COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending
           FROM payments WHERE booking_id = b.id AND type IN ('deposit', 'balance')) l ON true
      WHERE b.status NOT IN ('cancelled', 'no_show') AND b.complimentary_scope IS NULL
        AND ($1::text IS NULL OR p.slug = $1)
        AND l.pending > 0
        AND ABS(l.received + l.pending - (b.total_amount - COALESCE(b.discount_amount, 0))) > 1
      ORDER BY p.slug, b.check_in_date`, [slug]);
  const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  if (!rows.length) console.log('All bookings with unpaid lines add up to their price.');
  for (const r of rows) {
    console.log(`${r.slug} · ${r.check_in} · room ${r.room} · ${r.guest} · ${r.status}\n   price ${rp(r.price)} — received ${rp(r.received)} + pending ${rp(r.pending)} = ${rp(r.received + r.pending)} (${rp(r.received + r.pending - r.price)})\n   /reservations/${r.id}`);
  }
  console.log(`\n${rows.length} booking(s).`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
