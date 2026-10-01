// Read-only: why does a room have N breakfasts on a morning?
//
//   node maintenance/checkBreakfast.js --property zahill --room 104 [--date 2026-10-02]
//
// Prints the room's stay on that morning (default: today, WITA): rate plan,
// guests, the per-night extras of the night before with their breakfasts,
// and the breakfast count the Kitchen list / POS / breakfast-box limit use.
// Also lists the per-night items (e.g. Extra Bed) with their breakfast
// setting. Changes nothing.
require('dotenv').config();
const db = require('../db');
const { todayWITA } = require('../services/roomChargeService');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

(async () => {
  const slug = arg('property'), room = arg('room'), date = arg('date') || todayWITA();
  if (!slug || !room) { console.log('Usage: node maintenance/checkBreakfast.js --property <slug> --room <room> [--date YYYY-MM-DD]'); process.exit(1); }
  const { rows: [p] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!p) { console.log('No property', slug); process.exit(1); }

  console.log(`\n${p.name} — room ${room} — breakfast on the morning of ${date}\n`);
  const { rows: items } = await db.query(
    `SELECT name, price, meal_price, meal_pax, is_available FROM products WHERE property_id = $1 AND per_night ORDER BY name`, [p.id]);
  console.log('Per-night items:');
  for (const i of items) {
    console.log(`  ${i.name}: price ${Math.round(i.price)}, breakfasts per unit ${i.meal_pax}, one breakfast ${Math.round(i.meal_price || 0)}`
      + (parseFloat(i.meal_price) > 0 ? '' : '   ← no breakfast price: new sales of it get 0 breakfasts'));
  }

  const { rows: stays } = await db.query(`
    SELECT b.id, b.status, b.check_in_date, b.check_out_date, b.num_guests, g.name AS guest,
           rp.code AS plan, COALESCE(rp.includes_breakfast, false) AS includes_breakfast
    FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.property_id = $1 AND (u.name = $2 OR u.controller_id = $2)
      AND b.status NOT IN ('cancelled', 'no_show')
      AND b.check_in_date < $3::date AND b.check_out_date >= $3::date
    ORDER BY b.check_in_date`, [p.id, room, date]);
  if (!stays.length) console.log('\nNo stay slept in this room the night before that morning.');

  for (const b of stays) {
    console.log(`\nBooking ${b.id.slice(0, 8)} · ${b.guest} · ${ymd(b.check_in_date)} → ${ymd(b.check_out_date)} · ${b.status}`);
    console.log(`  Rate plan ${b.plan || '—'} (${b.includes_breakfast ? 'breakfast included' : 'no breakfast'}) · ${b.num_guests} guest(s)`);
    const { rows: addons } = await db.query(`
      SELECT a.service_date, a.description, a.quantity, a.breakfasts, a.meal_price, a.status
      FROM booking_addons a WHERE a.booking_id = $1 ORDER BY a.service_date`, [b.id]);
    if (!addons.length) console.log('  No per-night extras on this stay.');
    for (const a of addons) {
      const night = ymd(a.service_date);
      const mark = night === ymd(new Date(Date.parse(date) - 864e5)) ? '  ← the night before this morning' : '';
      console.log(`  ${night} ${a.description} × ${a.quantity} · ${a.breakfasts} breakfast(s) · ${a.status}${mark}`);
    }
    const prev = ymd(new Date(Date.parse(date) - 864e5));
    const extra = addons.filter(a => a.status === 'active' && ymd(a.service_date) === prev).reduce((s, a) => s + (a.breakfasts || 0), 0);
    const planPax = b.includes_breakfast ? b.num_guests : 0;
    console.log(`  → breakfasts that morning: ${planPax} (rate plan) + ${extra} (extras) = ${planPax + extra}`);
    const { rows: boxes } = await db.query(
      `SELECT quantity, ready_time, status FROM restaurant_requests
       WHERE booking_id = $1 AND kind = 'breakfast_box' AND service_date = $2::date AND status <> 'cancelled'`, [b.id, date]);
    for (const x of boxes) console.log(`  Breakfast box: ${x.quantity} · ready ${String(x.ready_time || '').slice(0, 5)} · ${x.status}`);
  }
  console.log('');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
