// Bookings labelled "Deposit Paid" that have paid nothing. Before 2026-10-07 a
// booking with no deposit asked became "Deposit Paid" whenever its status was
// re-worked (a payment marked, Edit Price, Undo No-Show…), although nothing
// was received. The rule now keeps it Pending; this lists the ones already
// labelled wrong and, with --apply, re-works their status (pending). Nothing
// else changes — no amounts, lines or payments. Rooms of a group billed as a
// whole follow the group's payments and are left out.
//
//   node maintenance/checkDepositPaidLabels.js [--property <slug>] [--apply]
require('dotenv').config();
const db = require('../db');
const { recomputeBookingStatus } = require('../services/paymentStatusService');

(async () => {
  const i = process.argv.indexOf('--property');
  const slug = i > -1 ? process.argv[i + 1] : null;
  const apply = process.argv.includes('--apply');
  const { rows } = await db.query(
    `SELECT p.slug, b.id, to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in, g.name AS guest, u.name AS room,
            (b.total_amount - COALESCE(b.discount_amount, 0))::float AS price
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       JOIN guests g ON g.id = b.guest_id
       JOIN units u ON u.id = b.unit_id
      WHERE b.status = 'deposit_paid' AND COALESCE(b.deposit_amount, 0) = 0
        AND ($1::text IS NULL OR p.slug = $1)
        AND NOT EXISTS (SELECT 1 FROM reservation_groups rg WHERE rg.id = b.reservation_group_id AND rg.group_billing)
        AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.booking_id = b.id AND x.type IN ('deposit', 'balance')
                         AND x.amount > 0 AND x.status = 'received')
        AND EXISTS (SELECT 1 FROM payments x WHERE x.booking_id = b.id AND x.type IN ('deposit', 'balance')
                     AND x.amount > 0 AND x.status = 'pending')
      ORDER BY p.slug, b.check_in_date`, [slug]);
  const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  if (!rows.length) console.log('No booking is labelled Deposit Paid with nothing paid.');
  for (const r of rows) {
    let now = '';
    if (apply) now = ` → ${await recomputeBookingStatus(db, r.id)}`;
    console.log(`${r.slug} · ${r.check_in} · room ${r.room} · ${r.guest} · price ${rp(r.price)}, nothing received${now}\n   /reservations/${r.id}`);
  }
  console.log(`\n${rows.length} booking(s)${apply ? ' set back to pending.' : rows.length ? ' — run again with --apply to set them back to pending.' : '.'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
