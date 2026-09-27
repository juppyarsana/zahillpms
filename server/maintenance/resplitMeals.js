// One-off: give bookings made BEFORE a rate plan had a meal price their
// room / meal split. Until the meal price was set (e.g. BB), those bookings
// were saved with all their revenue as room (fnb_revenue = 0). This splits the
// SAME amount again with the rate plan's current meal price — exactly what
// booking creation does today (bookingPriceService.splitRevenue):
//   meals = meal price × guests × nights,   room = what it was − meals
// The guest's price, discount, payments and balance DO NOT change: only how
// the net amount is divided between room and meals (reports, invoice lines).
//
// NOTHING IS DELETED:
//   - bookings: only room_revenue / fnb_revenue are updated; the old values
//     are saved to a backup file first and written to the booking's Edit History
//   - folio: already-posted room lines are VOIDED (kept, marked voided — the
//     same as every price/date change does) and re-posted as room + meal
//     lines with the same total, via roomChargeService.repostStay
//
// Skipped: cancelled / no-show, complimentary stays (they carry their own
// split), stays already on an agent invoice (invoiced / paid), and any
// booking whose meals would be more than its whole net amount (reported).
//
// --extras: the same for items SOLD before the item got a breakfast part
// (e.g. Extra Bed, migration 074): sale lines with meal_amount 0 get
// one breakfast × breakfasts per unit × units (never more than the line). Only the report split
// changes (extras vs F&B) — the sale, its total, the folio and payments stay
// as they are. Old per-night sales have no dates, so the kitchen count can't
// be fixed for them.
//
// Usage (from server/):
//   node maintenance/resplitMeals.js                  dry run — shows what would change, changes nothing
//   node maintenance/resplitMeals.js --apply          does it (writes a backup file first)
//   ... --property zahill                             one property only (slug)
//   ... --extras                                      sold items (extra bed) instead of room bookings
// Safe to run more than once: a booking / sale line that already has a meal split is skipped.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const ratePlanService = require('../services/ratePlanService');
const roomCharge = require('../services/roomChargeService');
const { round2 } = require('../services/folioService');

const APPLY = process.argv.includes('--apply');
const propIdx = process.argv.indexOf('--property');
const PROPERTY = propIdx > -1 ? process.argv[propIdx + 1] : null;
const fmt = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

async function postedTotal(client, bookingId) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM folio_charges
     WHERE booking_id = $1 AND type IN ('room', 'fnb') AND is_voided = false`, [bookingId]);
  return parseFloat(r.total);
}

async function resplitExtras() {
  const { rows } = await db.query(`
    SELECT si.id, si.sale_id, si.quantity, si.unit_price, si.subtotal, si.meal_amount,
           pr.name AS item, pr.meal_price, pr.meal_pax, p.slug, s.created_at, s.payment_method, g.name AS guest_name, u.name AS unit_name
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products pr ON pr.id = si.product_id
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN bookings b ON b.id = s.booking_id
    LEFT JOIN guests g ON g.id = b.guest_id
    LEFT JOIN units u ON u.id = b.unit_id
    WHERE COALESCE(si.meal_amount, 0) = 0 AND si.per_night = false AND pr.meal_price > 0 AND si.quantity > 0
      AND s.confirmation_status IS DISTINCT FROM 'rejected'
      ${PROPERTY ? 'AND p.slug = $1' : ''}
    ORDER BY s.created_at`, PROPERTY ? [PROPERTY] : []);
  const plan = rows.map(r => ({ r, meal: round2(Math.min(parseFloat(r.subtotal), parseFloat(r.meal_price) * (parseInt(r.meal_pax) || 0) * r.quantity)) }))
    .filter(x => x.meal > 0);
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (nothing changes — add --apply to do it)'} · sold items${PROPERTY ? ` · property ${PROPERTY}` : ''}\n`);
  for (const { r, meal } of plan) {
    console.log(`${r.slug} · ${new Date(r.created_at).toISOString().slice(0, 10)} · ${r.unit_name || 'walk-in'} · ${r.guest_name || ''} · ${r.quantity}× ${r.item} · ${r.payment_method}`);
    console.log(`    extras ${fmt(r.subtotal)} → ${fmt(r.subtotal - meal)}   breakfast Rp 0 → ${fmt(meal)}   (total unchanged: ${fmt(r.subtotal)})`);
  }
  console.log(`\n${plan.length} sold line(s) to split · ${fmt(plan.reduce((s2, x) => s2 + x.meal, 0))} moves from extras to breakfast (net)`);
  if (!APPLY || !plan.length) return 0;
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backupFile = path.join(dir, `resplitExtras-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows.map(r => ({ sale_item_id: r.id, sale_id: r.sale_id, meal_amount: r.meal_amount })), null, 2));
  console.log(`Backup of the old values: ${backupFile}`);
  for (const { r, meal } of plan) {
    await db.query('UPDATE sale_items SET meal_amount = $1 WHERE id = $2 AND COALESCE(meal_amount, 0) = 0', [meal, r.id]);
  }
  console.log(`Done: ${plan.length} split.`);
  return 0;
}

(async () => {
  if (process.argv.includes('--extras')) process.exit(await resplitExtras());
  const { rows } = await db.query(`
    SELECT b.id, b.property_id, b.status, b.check_in_date, b.check_out_date, b.nights, b.num_guests,
           b.total_amount, b.discount_amount, b.room_revenue, b.fnb_revenue, b.rate_plan_id, b.folio_status,
           p.slug, p.name AS property_name, g.name AS guest_name, u.name AS unit_name,
           rp.code AS plan_code, rp.meal_price, rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner,
           ps.tax_rate, ps.service_charge_rate
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
    JOIN property_settings ps ON ps.property_id = b.property_id
    JOIN rate_plans rp ON rp.id = b.rate_plan_id
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    WHERE COALESCE(b.fnb_revenue, 0) = 0
      AND rp.meal_price > 0
      AND (rp.includes_breakfast OR rp.includes_lunch OR rp.includes_dinner)
      AND b.status NOT IN ('cancelled', 'no_show')
      AND b.complimentary_scope IS NULL
      AND COALESCE(b.folio_status, '') NOT IN ('invoiced', 'paid')
      ${PROPERTY ? 'AND p.slug = $1' : ''}
    ORDER BY p.slug, b.check_in_date, u.name`, PROPERTY ? [PROPERTY] : []);

  const plan = [];
  const skipped = [];
  for (const b of rows) {
    const F = (1 + parseFloat(b.service_charge_rate || 0) / 100) * (1 + parseFloat(b.tax_rate || 0) / 100);
    // The net amount the booking carries now (all of it as room).
    const net = b.room_revenue != null
      ? parseFloat(b.room_revenue)
      : round2((parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0)) / F);
    const meals = round2(ratePlanService.mealNetPerNight(b, b.num_guests) * b.nights);
    const room = round2(net - meals);
    if (room < 0) { skipped.push({ b, why: `meals ${fmt(meals)} are more than the whole net amount ${fmt(net)}` }); continue; }
    plan.push({ b, net, meals, room });
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (nothing changes — add --apply to do it)'}${PROPERTY ? ` · property ${PROPERTY}` : ''}\n`);
  for (const { b, net, meals, room } of plan) {
    console.log(`${b.slug} · ${String(b.check_in_date).slice(0, 10)}→${String(b.check_out_date).slice(0, 10)} · ${b.unit_name} · ${b.guest_name} · ${b.plan_code} · ${b.num_guests} guests × ${b.nights} nights · ${b.status}`);
    console.log(`    room ${fmt(net)} → ${fmt(room)}   meals Rp 0 → ${fmt(meals)}   (total unchanged: ${fmt(net)})`);
  }
  for (const { b, why } of skipped) console.log(`SKIPPED ${b.slug} · ${b.unit_name} · ${b.guest_name}: ${why}`);
  const moved = plan.reduce((s, x) => s + x.meals, 0);
  console.log(`\n${plan.length} booking(s) to split · ${fmt(moved)} moves from room to meals (net) · ${skipped.length} skipped`);

  if (!APPLY || plan.length === 0) { process.exit(0); }

  // Backup of every old value, before anything changes.
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backupFile = path.join(dir, `resplitMeals-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const backup = [];
  for (const { b } of plan) {
    const { rows: lines } = await db.query(
      `SELECT id, type, description, amount, service_date, is_voided FROM folio_charges
       WHERE booking_id = $1 AND type IN ('room', 'fnb')`, [b.id]);
    backup.push({ booking_id: b.id, room_revenue: b.room_revenue, fnb_revenue: b.fnb_revenue, folio_lines: lines });
  }
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup of the old values: ${backupFile}\n`);

  let done = 0, failed = 0;
  for (const { b, meals, room } of plan) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const before = await postedTotal(client, b.id);
      await client.query('UPDATE bookings SET room_revenue = $1, fnb_revenue = $2 WHERE id = $3', [room, meals, b.id]);
      // Only stays already posted to the folio (in house / checked out) have
      // lines to redo; an upcoming stay gets its lines from the night audit.
      if (b.status === 'checked_in' || b.status === 'checked_out') {
        const updated = { ...b, room_revenue: room, fnb_revenue: meals };
        if (b.status === 'checked_out') {
          await roomCharge.repostStay(client, updated, null);   // the whole stay, as at checkout
        } else {
          // In house: redo exactly the nights already on the folio (the
          // night audit posts the rest, now with the meal line).
          const { rows: [last] } = await client.query(
            `SELECT MAX(service_date) AS d FROM folio_charges
             WHERE booking_id = $1 AND type = 'room' AND is_voided = false AND service_date IS NOT NULL`, [b.id]);
          if (last.d) {
            const lastNight = String(last.d).slice(0, 10);
            const upTo = new Date(lastNight + 'T00:00:00Z');
            upTo.setUTCDate(upTo.getUTCDate() + 1);
            await roomCharge.voidAll(client, b.id, null);
            await roomCharge.postStay(client, updated, { upToDate: upTo.toISOString().slice(0, 10) });
          }
        }
        const after = await postedTotal(client, b.id);
        const nightsPosted = Math.max(1, b.nights);
        if (before > 0 && Math.abs(after - before) > nightsPosted) {
          throw new Error(`folio total would change ${fmt(before)} → ${fmt(after)} — left as it was`);
        }
      }
      await client.query(
        'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, NULL)',
        [b.id, `Room / meal split added (${b.plan_code} meal price now set): room ${fmt(room + meals)} → ${fmt(room)}, meals Rp 0 → ${fmt(meals)}. Total unchanged.`]
      );
      await client.query('COMMIT');
      done++;
    } catch (err) {
      await client.query('ROLLBACK');
      failed++;
      console.log(`FAILED ${b.unit_name} · ${b.guest_name}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  console.log(`Done: ${done} split, ${failed} failed (failed ones are unchanged).`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
