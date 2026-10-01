const crypto = require('crypto');
const db = require('../db');
const telegram = require('./telegramService');
const salesService = require('./salesService');

// Room check / minibar (migration 091). Front desk asks housekeeping what was
// taken from a room's minibar (usually at check-out); housekeeping answers on
// the room tablet (behind the property's housekeeping PIN) or from the link in
// the Telegram message; front desk adds it to the guest's bill — one ordinary
// Sales sale charged to the room. Housekeeping can also send a check without
// being asked. Nothing reaches the bill until front desk accepts it.
// Alerts: alert_room_check (Reports & Alerts, free).

class CheckError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const h = s => telegram.escapeHtml(String(s ?? ''));
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

// Minibar items on sale, with the price as the guest sees it on the menu.
async function minibarItems(propertyId, pg = db) {
  const { rows } = await pg.query(
    `SELECT id, name, price::float AS price, description FROM products
      WHERE property_id = $1 AND category = 'minibar' AND is_available = true AND NOT per_night AND NOT open_price
      ORDER BY name`, [propertyId]);
  return rows;
}

// The stay a room check belongs to: the guest in the room now, else the guest
// who checked out of it today (front desk checked them out before the answer).
async function stayForUnit(propertyId, unitId, pg = db) {
  const { rows: [b] } = await pg.query(
    `SELECT b.id, b.status, g.name AS guest_name FROM bookings b JOIN guests g ON g.id = b.guest_id
      WHERE b.property_id = $1 AND b.unit_id = $2
        AND (b.status = 'checked_in'
             OR (b.status = 'checked_out' AND b.updated_at > NOW() - INTERVAL '18 hours'))
      ORDER BY (b.status = 'checked_in') DESC, b.updated_at DESC LIMIT 1`, [propertyId, unitId]);
  return b || null;
}

const SELECT = `
  SELECT rc.*, u.name AS room, g.name AS guest_name, b.status AS booking_status,
         ru.name AS requested_by_name, cu.name AS closed_by_name
    FROM room_checks rc
    JOIN units u ON u.id = rc.unit_id
    LEFT JOIN bookings b ON b.id = rc.booking_id
    LEFT JOIN guests g ON g.id = b.guest_id
    LEFT JOIN users ru ON ru.id = rc.requested_by
    LEFT JOIN users cu ON cu.id = rc.closed_by`;

function shape(r) {
  if (!r) return null;
  const items = r.items || [];
  return {
    id: r.id, status: r.status, booking_id: r.booking_id, unit_id: r.unit_id, room: r.room, guest_name: r.guest_name,
    booking_status: r.booking_status,
    requested_at: r.requested_at, requested_by: r.requested_by_name,
    submitted_at: r.submitted_at, submitted_via: r.submitted_via,
    items, note: r.note,
    total: items.reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (parseInt(i.quantity, 10) || 0), 0),
    sale_id: r.sale_id, closed_at: r.closed_at, closed_by: r.closed_by_name,
  };
}

async function getOne(propertyId, id, pg = db) {
  const { rows: [r] } = await pg.query(`${SELECT} WHERE rc.id = $1 AND rc.property_id = $2`, [id, propertyId]);
  return shape(r);
}

// Every check of a booking, newest first.
async function listForBooking(propertyId, bookingId) {
  const { rows } = await db.query(`${SELECT} WHERE rc.booking_id = $1 AND rc.property_id = $2 ORDER BY rc.created_at DESC`, [bookingId, propertyId]);
  return rows.map(shape);
}

// The check front desk is waiting for in a room (asked, not answered yet).
async function openRequestForUnit(propertyId, unitId, pg = db) {
  const { rows: [r] } = await pg.query(
    `SELECT id, booking_id FROM room_checks WHERE property_id = $1 AND unit_id = $2 AND status = 'requested'
      ORDER BY created_at DESC LIMIT 1`, [propertyId, unitId]);
  return r || null;
}

function clientBase() {
  return String(process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
}

// Front desk asks. One open request per room: asking again re-sends the alert.
async function request(propertyId, bookingId, user) {
  const { rows: [b] } = await db.query(
    `SELECT b.id, b.unit_id, b.status, u.name AS room, g.name AS guest_name
       FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
      WHERE b.id = $1 AND b.property_id = $2`, [bookingId, propertyId]);
  if (!b) throw new CheckError(404, 'Booking not found');
  if (!['checked_in', 'checked_out'].includes(b.status)) throw new CheckError(409, 'A room check is for a guest who is checked in', 'NOT_IN_HOUSE');
  let open = await openRequestForUnit(propertyId, b.unit_id);
  if (!open) {
    const token = crypto.randomBytes(24).toString('hex');
    const { rows: [r] } = await db.query(
      `INSERT INTO room_checks (property_id, unit_id, booking_id, status, requested_by, requested_at, link_token)
       VALUES ($1, $2, $3, 'requested', $4, NOW(), $5) RETURNING id`, [propertyId, b.unit_id, b.id, user.id, token]);
    open = r;
  }
  const { rows: [row] } = await db.query('SELECT link_token FROM room_checks WHERE id = $1', [open.id]);
  const base = clientBase();
  const msg = [
    [`🧺 <b>Room check — Room ${h(b.room)}</b>`, `👤 ${h(b.guest_name)}${b.status === 'checked_in' ? ' · checking out' : ''}`],
    ['Check the minibar and send what was taken — on the room tablet (Housekeeping), or here:',
     base && row.link_token ? `${base}/room-check/${row.link_token}` : ''],
    [`Asked by ${h(user.name || 'front desk')}`],
  ].map(s => s.filter(Boolean).join('\n')).join('\n\n');
  telegram.sendAlert(propertyId, 'alert_room_check', msg, { html: true }).catch(() => {});
  return getOne(propertyId, open.id);
}

// Housekeeping's answer. items: [{ product_id, quantity }] — names and prices
// always come from the product rows. With no request open for the room, the
// check is recorded for the guest in the room (or just checked out).
async function submit(propertyId, { unitId, checkId = null, items, note, via }) {
  const menu = new Map((await minibarItems(propertyId)).map(p => [p.id, p]));
  const clean = [];
  for (const i of Array.isArray(items) ? items : []) {
    const q = parseInt(i?.quantity, 10);
    if (!q) continue;
    const p = menu.get(i.product_id);
    if (!p) throw new CheckError(400, 'An item is no longer on the minibar list — reload and try again', 'ITEM_GONE');
    if (!(q >= 1 && q <= 99)) throw new CheckError(400, 'Quantities must be between 1 and 99');
    clean.push({ product_id: p.id, name: p.name, quantity: q, unit_price: p.price });
  }
  const cleanNote = String(note || '').trim().slice(0, 500) || null;

  let id = checkId;
  if (!id) {
    const open = await openRequestForUnit(propertyId, unitId);
    if (open) id = open.id;
  }
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE room_checks SET status = 'submitted', items = $1, note = $2, submitted_at = NOW(), submitted_via = $3, link_token = NULL
        WHERE id = $4 AND property_id = $5 AND status IN ('requested', 'submitted')`,
      [JSON.stringify(clean), cleanNote, via, id, propertyId]);
    if (!rowCount) throw new CheckError(409, 'Front desk has already closed this room check', 'CLOSED');
  } else {
    const stay = await stayForUnit(propertyId, unitId);
    if (!stay) throw new CheckError(409, 'No guest is staying in this room — nothing to charge', 'NO_STAY');
    const { rows: [r] } = await db.query(
      `INSERT INTO room_checks (property_id, unit_id, booking_id, status, items, note, submitted_at, submitted_via)
       VALUES ($1, $2, $3, 'submitted', $4, $5, NOW(), $6) RETURNING id`,
      [propertyId, unitId, stay.id, JSON.stringify(clean), cleanNote, via]);
    id = r.id;
  }
  const check = await getOne(propertyId, id);
  const msg = [
    [`🧺 <b>Room ${h(check.room)} checked</b>`, check.guest_name ? `👤 ${h(check.guest_name)}` : ''],
    clean.length ? [...clean.map(i => `${i.quantity} × ${h(i.name)}`), `<b>${rp(check.total)}</b>`] : ['✅ Nothing taken from the minibar'],
    cleanNote ? [`📝 ${h(cleanNote)}`] : [],
    [clean.length ? 'Front desk: add it to the bill on the reservation.' : ''],
  ].map(s => s.filter(Boolean)).filter(s => s.length).map(s => s.join('\n')).join('\n\n');
  telegram.sendAlert(propertyId, 'alert_room_check', msg, { html: true }).catch(() => {});
  return check;
}

// Front desk accepts the answer: the items become one Sales sale charged to
// the room. `items` (optional) = front desk's corrected quantities.
async function charge(propertyId, id, user, items) {
  const check = await getOne(propertyId, id);
  if (!check) throw new CheckError(404, 'Room check not found');
  if (check.status !== 'submitted') throw new CheckError(409, check.status === 'requested' ? 'Housekeeping has not answered yet' : 'This room check is already closed', 'NOT_SUBMITTED');
  const list = (Array.isArray(items) ? items : check.items)
    .map(i => ({ product_id: i.product_id, quantity: parseInt(i.quantity, 10) || 0 })).filter(i => i.quantity > 0);
  let saleId = null;
  if (list.length) {
    if (!check.booking_id) throw new CheckError(409, 'This room check has no reservation to charge', 'NO_STAY');
    const sale = await salesService.createSale(propertyId, {
      bookingId: check.booking_id, paymentMethod: 'room_charge', items: list, servedBy: user.id, orderSource: 'pos',
    });
    if (sale.error) throw new CheckError(400, sale.error, sale.code);
    saleId = sale.sale.id;
  }
  const { rowCount } = await db.query(
    `UPDATE room_checks SET status = 'charged', sale_id = $1, closed_by = $2, closed_at = NOW()
      WHERE id = $3 AND property_id = $4 AND status = 'submitted'`, [saleId, user.id, id, propertyId]);
  if (!rowCount) throw new CheckError(409, 'This room check is already closed', 'NOT_SUBMITTED');
  if (check.booking_id) {
    const what = list.length ? `${check.items.length ? 'Minibar' : 'Room check'} added to the bill (${list.length} item${list.length === 1 ? '' : 's'})` : 'Room check: nothing taken from the minibar';
    await db.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [check.booking_id, `${what}${check.note ? ` — housekeeping: ${check.note}` : ''}`.slice(0, 1000), user.id]);
  }
  return getOne(propertyId, id);
}

// Front desk sets a request or an answer aside (asked by mistake, guest disputes it).
async function dismiss(propertyId, id, user) {
  const { rowCount } = await db.query(
    `UPDATE room_checks SET status = 'dismissed', link_token = NULL, closed_by = $1, closed_at = NOW()
      WHERE id = $2 AND property_id = $3 AND status IN ('requested', 'submitted')`, [user.id, id, propertyId]);
  if (!rowCount) throw new CheckError(409, 'This room check is already closed', 'NOT_OPEN');
  return getOne(propertyId, id);
}

// The phone link: the open request behind a token.
async function byToken(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return null;
  const { rows: [r] } = await db.query(
    `SELECT rc.id, rc.property_id, rc.unit_id, u.name AS room, ps.property_name
       FROM room_checks rc JOIN units u ON u.id = rc.unit_id
       LEFT JOIN property_settings ps ON ps.property_id = rc.property_id
      WHERE rc.link_token = $1 AND rc.status = 'requested'`, [token]);
  return r || null;
}

async function pinFor(propertyId) {
  const { rows: [r] } = await db.query('SELECT housekeeping_pin FROM property_settings WHERE property_id = $1', [propertyId]);
  return r?.housekeeping_pin || null;
}

module.exports = { CheckError, minibarItems, stayForUnit, listForBooking, openRequestForUnit, request, submit, charge, dismiss, byToken, pinFor, getOne };
