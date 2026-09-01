const db = require('../db');
const { round2 } = require('./folioService');

// Per-night folio posting for the room + F&B (meal-plan) revenue split.
// One `folio_charges` row of type='room' and (if the plan includes a meal)
// one of type='fnb' per stay night, carrying the NET nightly amount.
// `folio_charges.service_date` + the partial unique index
// `uq_folio_charges_night` (migration 044) make every write idempotent —
// voided rows drop out of the index so a re-post after a void still works.
//
// Transaction-participant: every function takes the caller's `client`; none
// opens its own BEGIN/COMMIT. Mirrors activityBookingService.postFolioCharge.

function ymd(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Today's calendar date in WITA (UTC+8).
function todayWITA() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// Every stay night: check_in .. check_out-1 (you don't pay for the day you leave).
function stayNights(checkIn, checkOut) {
  const start = new Date(ymd(checkIn) + 'T00:00:00Z');
  const end = new Date(ymd(checkOut) + 'T00:00:00Z');
  const out = [];
  for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

// Split a whole-stay NET total across `nights`; the last night absorbs the
// rounding remainder so the sum is exact and independent of post order.
function nightlyAmount(totalNet, nights, nightIndex) {
  const total = round2(parseFloat(totalNet) || 0);
  const n = Math.max(1, nights);
  if (total === 0) return 0;
  const per = round2(total / n);
  return nightIndex >= n - 1 ? round2(total - per * (n - 1)) : per;
}

async function ratePlanCodeFor(client, ratePlanId) {
  if (!ratePlanId) return 'RO';
  const { rows: [r] } = await client.query('SELECT code FROM rate_plans WHERE id = $1', [ratePlanId]);
  return r?.code || 'RO';
}

// Post one night's room + fnb charge. Idempotent per (booking, type, date).
async function postNight(client, { bookingId, serviceDate, roomNet, mealNet, ratePlanCode = 'RO', actorUserId = null }) {
  const result = { roomPosted: false, fnbPosted: false };
  const lines = [
    { type: 'room', amount: round2(roomNet), desc: `Room — ${serviceDate}` },
    { type: 'fnb', amount: round2(mealNet), desc: `Meal plan (${ratePlanCode}) — ${serviceDate}` },
  ];
  for (const line of lines) {
    if (line.amount <= 0) continue;
    const { rows: existing } = await client.query(
      `SELECT 1 FROM folio_charges
       WHERE booking_id = $1 AND type = $2 AND service_date = $3 AND is_voided = false LIMIT 1`,
      [bookingId, line.type, serviceDate]
    );
    if (existing.length) continue;
    try {
      await client.query(
        `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, service_date)
         VALUES ($1, $2, $3, 1, $4, $4, $5, $6)`,
        [bookingId, line.type, line.desc, line.amount, actorUserId, serviceDate]
      );
      if (line.type === 'room') result.roomPosted = true; else result.fnbPosted = true;
    } catch (err) {
      if (err.code !== '23505') throw err; // race — another writer beat us; treat as posted
    }
  }
  return result;
}

// Post every night of the stay (up to `upToDate` exclusive if given).
async function postStay(client, booking, { upToDate = null, actorUserId = null } = {}) {
  const end = upToDate && ymd(upToDate) < ymd(booking.check_out_date) ? upToDate : booking.check_out_date;
  const nights = stayNights(booking.check_in_date, end);
  const totalNights = stayNights(booking.check_in_date, booking.check_out_date).length;
  const code = await ratePlanCodeFor(client, booking.rate_plan_id);
  let roomPosted = 0, fnbPosted = 0;
  for (let i = 0; i < nights.length; i++) {
    const r = await postNight(client, {
      bookingId: booking.id,
      serviceDate: nights[i],
      roomNet: nightlyAmount(booking.room_revenue ?? booking.total_amount, totalNights, i),
      mealNet: nightlyAmount(booking.fnb_revenue, totalNights, i),
      ratePlanCode: code,
      actorUserId,
    });
    if (r.roomPosted) roomPosted++;
    if (r.fnbPosted) fnbPosted++;
  }
  return { roomPosted, fnbPosted, nights: nights.length };
}

// Void auto-posted room/fnb charges with service_date >= fromDate (early departure / shorten).
async function voidFrom(client, bookingId, fromDate, actorUserId = null) {
  const { rowCount } = await client.query(
    `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
     WHERE booking_id = $2 AND type IN ('room','fnb')
       AND service_date IS NOT NULL AND service_date >= $3 AND is_voided = false`,
    [actorUserId, bookingId, ymd(fromDate)]
  );
  return rowCount;
}

async function voidAll(client, bookingId, actorUserId = null) {
  const { rowCount } = await client.query(
    `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
     WHERE booking_id = $2 AND type IN ('room','fnb')
       AND service_date IS NOT NULL AND is_voided = false`,
    [actorUserId, bookingId]
  );
  return rowCount;
}

// Void everything auto-posted, then re-post from the current booking row
// (used after a date or rate-plan change). Only posts nights for a booking
// that is actually in-house or departed — a still-`confirmed` future booking
// gets its nights accrued by the night audit once it checks in.
async function repostStay(client, booking, actorUserId = null) {
  await voidAll(client, booking.id, actorUserId);
  if (booking.status === 'checked_out') {
    return postStay(client, booking, { actorUserId });
  }
  if (booking.status === 'checked_in') {
    return postStay(client, booking, { upToDate: todayWITA(), actorUserId });
  }
  return { roomPosted: 0, fnbPosted: 0, nights: 0 };
}

module.exports = { stayNights, nightlyAmount, todayWITA, postNight, postStay, voidFrom, voidAll, repostStay };
