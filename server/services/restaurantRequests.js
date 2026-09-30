const db = require('../db');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');

// Restaurant requests (migration 088) — taken by front desk on the reservation,
// shown in the hotel POS (GET /api/pos/requests), done there.
//   breakfast_box: the included breakfast packed for a morning (guest leaves
//     before the restaurant opens). Up to the room's breakfasts that morning;
//     the rest of the room may still eat at the restaurant.
//   other: a note for the restaurant (extra paid boxes, a cake…). Anything
//     paid is rung up at the POS till like any bill.
// Every new / changed / cancelled request goes out on Telegram
// (alert_restaurant_request, Reports & Alerts).

const KINDS = ['breakfast_box', 'other'];
const ACTIVE_STAY = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ymd = d => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d || '').slice(0, 10));
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const hhmm = t => (t ? String(t).slice(0, 5) : null);

async function loadBooking(propertyId, bookingId, pg = db) {
  const { rows: [b] } = await pg.query(`
    SELECT b.id, b.status, b.check_in_date, b.check_out_date, b.num_guests,
           COALESCE(rp.includes_breakfast, false) AS includes_breakfast,
           g.name AS guest_name, u.name AS unit_name
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.id = $1 AND b.property_id = $2`, [bookingId, propertyId]);
  return b || null;
}

// Breakfasts the room has on each morning of the stay (morning after each
// night): rate-plan guests + extra-bed breakfasts of the night before — the
// same rule as the Kitchen list (bookings.loadKitchen / extraBreakfasts).
async function breakfastMornings(propertyId, b) {
  const { rows } = await db.query(`
    SELECT service_date, SUM(breakfasts)::int AS qty FROM booking_addons
    WHERE property_id = $1 AND booking_id = $2 AND status = 'active' AND breakfasts > 0
      AND service_date >= $3::date AND service_date < $4::date
    GROUP BY service_date`, [propertyId, b.id, b.check_in_date, b.check_out_date]);
  const extra = new Map(rows.map(r => [ymd(r.service_date), r.qty]));
  const out = [];
  const last = ymd(b.check_out_date);
  for (let night = ymd(b.check_in_date); night < last; night = addDays(night, 1)) {
    const morning = addDays(night, 1);
    const pax = (b.includes_breakfast ? (parseInt(b.num_guests, 10) || 0) : 0) + (extra.get(night) || 0);
    out.push({ date: morning, breakfast_pax: pax });
  }
  return out;
}

function shape(r) {
  return {
    id: r.id, booking_id: r.booking_id, kind: r.kind, service_date: ymd(r.service_date),
    ready_time: hhmm(r.ready_time), quantity: r.quantity, note: r.note || '',
    status: r.status, done_by: r.done_by, done_at: r.done_at,
    created_by_name: r.created_by_name || null, created_at: r.created_at,
    updated_by_name: r.updated_by_name || null, updated_at: r.updated_at,
    ...(r.unit_name !== undefined ? { room: r.unit_name, guest_name: r.guest_name, booking_status: r.booking_status } : {}),
  };
}

const SELECT = `
  SELECT r.*, cu.name AS created_by_name, uu.name AS updated_by_name,
         u.name AS unit_name, g.name AS guest_name, b.status AS booking_status
  FROM restaurant_requests r
  JOIN bookings b ON b.id = r.booking_id
  JOIN units u ON u.id = b.unit_id
  JOIN guests g ON g.id = b.guest_id
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users uu ON uu.id = r.updated_by`;

async function listForBooking(propertyId, bookingId) {
  const b = await loadBooking(propertyId, bookingId);
  if (!b) throw new RequestError(404, 'Booking not found');
  const { rows } = await db.query(
    `${SELECT} WHERE r.property_id = $1 AND r.booking_id = $2 ORDER BY r.service_date, r.ready_time NULLS LAST, r.created_at`,
    [propertyId, bookingId]);
  return { requests: rows.map(shape), mornings: await breakfastMornings(propertyId, b), today: todayWITA() };
}

// For the POS: every request for the dates (not cancelled).
async function listForDates(propertyId, from, to) {
  const { rows } = await db.query(
    `${SELECT} WHERE r.property_id = $1 AND r.service_date BETWEEN $2::date AND $3::date AND r.status <> 'cancelled'
     ORDER BY r.service_date, r.ready_time NULLS LAST, u.name, r.created_at`, [propertyId, from, to]);
  return rows.map(shape);
}

// Checks a request body against the stay. Returns the clean values.
async function validate(propertyId, b, body, { ignoreId = null } = {}) {
  if (!ACTIVE_STAY.includes(b.status)) throw new RequestError(409, 'This booking is not active (cancelled, no-show or checked out)');
  const kind = body.kind;
  if (!KINDS.includes(kind)) throw new RequestError(400, 'kind must be breakfast_box or other');
  const date = String(body.service_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RequestError(400, 'Choose the date');
  if (date < todayWITA()) throw new RequestError(400, 'That date has passed');
  const note = String(body.note || '').trim().slice(0, 500);
  const inDate = ymd(b.check_in_date), outDate = ymd(b.check_out_date);

  if (kind === 'other') {
    if (date < inDate || date > outDate) throw new RequestError(400, `Choose a date within the stay (${fmtDay(inDate)} – ${fmtDay(outDate)})`);
    if (!note) throw new RequestError(400, 'Write what the guest asks for');
    let time = null;
    if (body.ready_time) {
      if (!/^\d{2}:\d{2}$/.test(body.ready_time)) throw new RequestError(400, 'Time must be HH:MM');
      time = body.ready_time;
    }
    return { kind, date, time, quantity: null, note };
  }

  // breakfast_box
  const morning = (await breakfastMornings(propertyId, b)).find(m => m.date === date);
  if (!morning) throw new RequestError(400, `A breakfast box is for a morning of the stay (${fmtDay(addDays(inDate, 1))} – ${fmtDay(outDate)})`);
  if (!morning.breakfast_pax) {
    throw new RequestError(400, `Room ${b.unit_name} has no breakfast included on ${fmtDay(date)} — add it as an "Other request" instead; the restaurant charges it at its till`);
  }
  if (!/^\d{2}:\d{2}$/.test(String(body.ready_time || ''))) throw new RequestError(400, 'When should the boxes be ready? (e.g. 05:00)');
  const quantity = parseInt(body.quantity, 10);
  if (!(quantity >= 1)) throw new RequestError(400, 'How many boxes?');
  if (quantity > morning.breakfast_pax) {
    throw new RequestError(400, `The room has ${morning.breakfast_pax} breakfast${morning.breakfast_pax === 1 ? '' : 's'} included that morning — for more boxes, add an "Other request" (the restaurant charges the extra ones)`);
  }
  const { rows: [dup] } = await db.query(
    `SELECT id FROM restaurant_requests WHERE booking_id = $1 AND kind = 'breakfast_box' AND service_date = $2
       AND status <> 'cancelled' AND ($3::uuid IS NULL OR id <> $3)`, [b.id, date, ignoreId]);
  if (dup) throw new RequestError(409, `There is already a breakfast box for ${fmtDay(date)} — change that one`);
  return { kind, date, time: body.ready_time, quantity, note, breakfastPax: morning.breakfast_pax };
}

async function create(propertyId, bookingId, body, user) {
  const b = await loadBooking(propertyId, bookingId);
  if (!b) throw new RequestError(404, 'Booking not found');
  const v = await validate(propertyId, b, body || {});
  const { rows: [r] } = await db.query(
    `INSERT INTO restaurant_requests (property_id, booking_id, kind, service_date, ready_time, quantity, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [propertyId, b.id, v.kind, v.date, v.time, v.quantity, v.note || null, user.id]);
  const saved = await getOne(propertyId, r.id);
  alert(propertyId, 'new', saved, user, v.breakfastPax);
  return saved;
}

async function getOne(propertyId, id) {
  const { rows: [r] } = await db.query(`${SELECT} WHERE r.property_id = $1 AND r.id = $2`, [propertyId, id]);
  return r ? shape(r) : null;
}

async function openRequest(propertyId, bookingId, id) {
  const r = await getOne(propertyId, id);
  if (!r || r.booking_id !== bookingId) throw new RequestError(404, 'Request not found');
  if (r.status === 'cancelled') throw new RequestError(409, 'This request was cancelled');
  if (r.status === 'done') {
    throw new RequestError(409, r.kind === 'breakfast_box'
      ? `The restaurant already sent it to the kitchen (${r.done_by || 'POS'}) — ask them before changing it`
      : `The restaurant already marked it done (${r.done_by || 'POS'})`);
  }
  return r;
}

async function update(propertyId, bookingId, id, body, user) {
  const before = await openRequest(propertyId, bookingId, id);
  const b = await loadBooking(propertyId, bookingId);
  const v = await validate(propertyId, b, { ...body, kind: before.kind }, { ignoreId: id });
  await db.query(
    `UPDATE restaurant_requests SET service_date = $3, ready_time = $4, quantity = $5, note = $6,
       updated_by = $7, updated_at = NOW()
     WHERE id = $1 AND property_id = $2`, [id, propertyId, v.date, v.time, v.quantity, v.note || null, user.id]);
  const saved = await getOne(propertyId, id);
  alert(propertyId, 'changed', saved, user, v.breakfastPax, before);
  return saved;
}

async function cancel(propertyId, bookingId, id, user) {
  const before = await openRequest(propertyId, bookingId, id);
  await db.query(
    `UPDATE restaurant_requests SET status = 'cancelled', cancelled_by = $3, cancelled_at = NOW()
     WHERE id = $1 AND property_id = $2`, [id, propertyId, user.id]);
  alert(propertyId, 'cancelled', before, user);
  return { ok: true };
}

// From the POS: 'done' (box sent to the kitchen / request handled) or back to
// 'open' (undone in the POS). A cancelled request can't be marked.
async function setStatusFromPos(propertyId, id, status, by) {
  if (!['done', 'open'].includes(status)) throw new RequestError(400, 'status must be done or open');
  const { rows: [r] } = await db.query(
    'SELECT id, status FROM restaurant_requests WHERE id = $1 AND property_id = $2', [id, propertyId]);
  if (!r) throw new RequestError(404, 'Request not found');
  if (r.status === 'cancelled') throw new RequestError(409, 'Front desk cancelled this request');
  if (r.status !== status) {
    await db.query(
      `UPDATE restaurant_requests SET status = $3::varchar,
         done_by = CASE WHEN $3::varchar = 'done' THEN $4::varchar ELSE NULL END,
         done_at = CASE WHEN $3::varchar = 'done' THEN NOW() ELSE NULL END
       WHERE id = $1 AND property_id = $2`, [id, propertyId, status, String(by || 'POS').slice(0, 100)]);
  }
  return getOne(propertyId, id);
}

// ─── Telegram ─────────────────────────────────────────────────
async function alert(propertyId, action, r, user, breakfastPax, before) {
  try {
    const h = telegram.escapeHtml;
    const { rows: [u] } = await db.query('SELECT name, role FROM users WHERE id = $1', [user.id]);
    const role = u?.role ? ` <i>(${h(u.role.replace(/-[0-9a-f-]{36}$/, '').replace(/_/g, ' '))})</i>` : '';
    const box = r.kind === 'breakfast_box';
    const title = box ? 'Breakfast box' : 'Restaurant request';
    const head = { new: box ? '🥡' : '🍽', changed: '✏️', cancelled: '❌' }[action];
    const verb = { new: '', changed: ' — changed', cancelled: ' — cancelled' }[action];
    const when = box
      ? `📅 ${fmtDay(r.service_date)} · ready by <b>${h(r.ready_time)}</b>`
      : `📅 ${fmtDay(r.service_date)}${r.ready_time ? ` · ${h(r.ready_time)}` : ''}`;
    const was = action === 'changed' && before
      ? [before.service_date !== r.service_date || before.ready_time !== r.ready_time || before.quantity !== r.quantity
        ? `<i>was: ${fmtDay(before.service_date)}${before.ready_time ? ` ${h(before.ready_time)}` : ''}${box ? ` · ${before.quantity} box${before.quantity === 1 ? '' : 'es'}` : ''}</i>` : '']
      : [];
    const msg = [
      [`${head} <b>${title}${verb} — Room ${h(r.room)}</b>`, `👤 ${h(r.guest_name)}`],
      [when,
       box ? `🥡 <b>${r.quantity}</b> box${r.quantity === 1 ? '' : 'es'}${breakfastPax ? ` (of ${breakfastPax} breakfast${breakfastPax === 1 ? '' : 's'} included)` : ''}` : '',
       ...was],
      r.note ? [`📝 ${h(r.note)}`] : [],
      [`By ${h(u?.name || 'front desk')}${role}`],
    ].map(s => s.filter(Boolean)).filter(s => s.length).map(s => s.join('\n')).join('\n\n');
    await telegram.sendAlert(propertyId, 'alert_restaurant_request', msg, { html: true });
  } catch (err) {
    console.error('[restaurant request alert]', err.message);
  }
}

// booking_id → open/done breakfast box for a morning (Kitchen list / POS).
async function boxesForDate(propertyId, date) {
  const { rows } = await db.query(
    `SELECT id, booking_id, quantity, ready_time, note, status, done_by, done_at FROM restaurant_requests
     WHERE property_id = $1 AND service_date = $2::date AND kind = 'breakfast_box' AND status <> 'cancelled'`,
    [propertyId, date]);
  return new Map(rows.map(r => [r.booking_id, {
    id: r.id, quantity: r.quantity, ready_time: hhmm(r.ready_time), note: r.note || '',
    status: r.status, done_by: r.done_by, done_at: r.done_at,
  }]));
}

module.exports = {
  RequestError, KINDS, listForBooking, listForDates, create, update, cancel, setStatusFromPos, boxesForDate,
};
