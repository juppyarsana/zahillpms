// Vouchers (migration 167, VOUCHERS_PLAN.md): a fixed stay (nights, room type,
// meal plan) sold at a set price and redeemed once at New Booking.
//
//   sold      active    money received, a liability (250-00-005), no revenue
//   booked    reserved  on a booking: a received payment of method 'voucher' for
//                       what the voucher covers (a payment, not money — the cash
//                       came at the sale); revenue comes from the normal nightly
//                       folio posting, room and meal lines tax_mode 'none'
//   used      redeemed  the guest checked out (or no-show and the type says it is used up)
//   lapsed    expired   not used by its last day: breakage income
//   voided    voided    sold by mistake / exception, with a reason
//
// A voucher carries no service charge or tax (the accountant, 2026-11-11), so
// only service none / tax none / "at redemption" is accepted for now.
const crypto = require('crypto');
const db = require('../db');
const { round2 } = require('./folioService');
const { todayWITA } = require('./roomChargeService');
const { recomputeBookingStatus } = require('./paymentStatusService');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0 O 1 I: a code is read out and typed
const CODE_LEN = 12;
const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const prettyCode = c => String(c || '').match(/.{1,4}/g)?.join('-') || '';
const cleanCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const voucherNo = n => `V-${String(n).padStart(4, '0')}`;
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const num = v => parseFloat(v) || 0;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = d => (d instanceof Date ? new Date(d.getTime() + 8 * 3600 * 1000) : new Date(d)).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
function addMonths(day, m) {
  const d = new Date(`${day}T00:00:00Z`);
  const target = d.getUTCMonth() + m;
  const out = new Date(Date.UTC(d.getUTCFullYear(), target, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d.getUTCDate(), last));
  return out.toISOString().slice(0, 10);
}
const rp = v => `Rp ${Math.round(num(v)).toLocaleString('id-ID')}`;

async function tx(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    if (r && r.error) await client.query('ROLLBACK'); else await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function logEvent(client, voucherId, kind, note, userId) {
  await client.query('INSERT INTO voucher_events (voucher_id, kind, note, created_by) VALUES ($1, $2, $3, $4)',
    [voucherId, kind, note ? String(note).slice(0, 500) : null, userId || null]);
}

// ── Voucher types ──

const TEMPLATE_COLS = `t.*, rt.name AS room_type_name, rp.name AS rate_plan_name, rp.code AS rate_plan_code`;
async function listTemplates(propertyId, { all = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${TEMPLATE_COLS} FROM voucher_templates t
     JOIN room_types rt ON rt.id = t.room_type_id
     LEFT JOIN rate_plans rp ON rp.id = t.rate_plan_id
     WHERE t.property_id = $1 ${all ? '' : 'AND t.is_active'}
     ORDER BY t.sort_order, t.name`, [propertyId]);
  return rows.map(r => ({ ...r, price: num(r.price) }));
}

// The fields of a voucher type from a request body → { value } or { error }.
async function cleanTemplate(propertyId, b, current = null) {
  const pick = (k, d) => (b[k] !== undefined ? b[k] : (current ? current[k] : d));
  const name = String(pick('name', '') || '').trim();
  if (!name) return fail('Give the voucher a name');
  const nights = parseInt(pick('nights', 0), 10);
  if (!(nights >= 1 && nights <= 60)) return fail('Nights must be between 1 and 60');
  const roomTypeId = pick('room_type_id', null);
  const { rows: [rt] } = await db.query('SELECT id FROM room_types WHERE id = $1 AND property_id = $2', [roomTypeId, propertyId]);
  if (!rt) return fail('Choose the room type');
  const ratePlanId = pick('rate_plan_id', null) || null;
  const { rows: [rp0] } = ratePlanId ? await db.query('SELECT id FROM rate_plans WHERE id = $1 AND property_id = $2', [ratePlanId, propertyId]) : { rows: [] };
  if (!rp0) return fail('Choose the meal plan');
  const maxGuests = parseInt(pick('max_guests', 2), 10);
  if (!(maxGuests >= 1 && maxGuests <= 30)) return fail('Maximum guests must be between 1 and 30');
  const price = round2(parseFloat(pick('price', NaN)));
  if (!(price >= 0) || price > 1e10) return fail('Type the price');
  const validity = parseInt(pick('validity_months', 12), 10);
  if (!(validity >= 1 && validity <= 60)) return fail('Valid for 1 to 60 months');
  const minNotice = parseInt(pick('min_notice_days', 0), 10);
  if (!(minNotice >= 0 && minNotice <= 365)) return fail('Minimum notice must be 0 to 365 days');
  // A voucher carries no service charge or tax for now.
  if ((pick('service_mode', 'none') || 'none') !== 'none' || (pick('tax_mode', 'none') || 'none') !== 'none' || (pick('tax_timing', 'redemption') || 'redemption') !== 'redemption') {
    return fail('Service charge and tax on a voucher are not switched on yet — a voucher is sold with none', 400, { code: 'TAX_NOT_ON' });
  }
  const blackout = [];
  for (const x of Array.isArray(pick('blackout', [])) ? pick('blackout', []) : []) {
    if (!x || !YMD.test(String(x.from)) || !YMD.test(String(x.to)) || x.to < x.from) return fail('A blackout period needs a first and last day (last day not before the first)');
    blackout.push({ from: String(x.from), to: String(x.to), label: String(x.label || '').slice(0, 80) });
  }
  let weekdays = pick('allowed_weekdays', null);
  if (Array.isArray(weekdays)) {
    weekdays = [...new Set(weekdays.map(Number))].filter(d => d >= 0 && d <= 6).sort();
    if (!weekdays.length || weekdays.length === 7) weekdays = null;
  } else weekdays = null;
  const feePct = pick('fee_pct', null) === '' || pick('fee_pct', null) == null ? null : parseFloat(pick('fee_pct', null));
  if (feePct != null && !(feePct > 0 && feePct <= 20)) return fail('The extra fee is a percentage from 0 to 20');
  const feePayer = feePct != null ? (pick('fee_payer', 'guest') === 'hotel' ? 'hotel' : 'guest') : null;
  return { value: {
    name: name.slice(0, 160), description: String(pick('description', '') || '').trim() || null,
    nights, room_type_id: roomTypeId, rate_plan_id: ratePlanId, max_guests: maxGuests, price,
    fee_label: feePct != null ? (String(pick('fee_label', '') || '').trim().slice(0, 60) || 'Fee') : null, fee_pct: feePct, fee_payer: feePayer,
    validity_months: validity, terms: String(pick('terms', '') || '').trim() || null,
    blackout, allowed_weekdays: weekdays, min_notice_days: minNotice,
    no_show_consumes: !!pick('no_show_consumes', true), transferable: !!pick('transferable', true),
    is_active: pick('is_active', true) !== false,
    sort_order: parseInt(pick('sort_order', 0), 10) || 0,
  } };
}

async function saveTemplate(propertyId, body, id = null) {
  let current = null;
  if (id) {
    ({ rows: [current] } = await db.query('SELECT * FROM voucher_templates WHERE id = $1 AND property_id = $2', [id, propertyId]));
    if (!current) return fail('Voucher type not found', 404);
  }
  const c = await cleanTemplate(propertyId, body, current);
  if (c.error) return c;
  const v = c.value;
  const cols = ['name', 'description', 'nights', 'room_type_id', 'rate_plan_id', 'max_guests', 'price', 'fee_label', 'fee_pct', 'fee_payer',
    'validity_months', 'terms', 'blackout', 'allowed_weekdays', 'min_notice_days', 'no_show_consumes', 'transferable', 'is_active', 'sort_order'];
  const vals = cols.map(k => (k === 'blackout' ? JSON.stringify(v[k]) : v[k]));
  if (id) {
    const { rows: [row] } = await db.query(
      `UPDATE voucher_templates SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${cols.length + 1} AND property_id = $${cols.length + 2} RETURNING id`, [...vals, id, propertyId]);
    return { id: row.id };
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO voucher_templates (property_id, ${cols.join(', ')})
     VALUES ($${cols.length + 1}, ${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, [...vals, propertyId]);
  return { id: row.id };
}

// ── Selling ──

const FREE_SCOPES = {
  room:       'Room only (meals and extras are paid)',
  room_meals: 'Room + meals (extras are paid)',
  all:        'Everything (room, meals and extras)',
};

// What the guest pays on the sale and what the voucher holds. A voucher carries
// no service charge or tax, so the price is all of it. A free voucher holds nothing.
function saleAmounts(template, free = false) {
  if (free) return { price: 0, covers: 0, liability: 0, service: 0, tax: 0, fee: 0, sold_total: 0 };
  const price = round2(num(template.price));
  const fee = template.fee_pct != null && template.fee_payer === 'guest' ? round2(price * num(template.fee_pct) / 100) : 0;
  return { price, covers: price, liability: price, service: 0, tax: 0, fee, sold_total: price };
}

async function nextVoucherNo(client, propertyId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voucher:${propertyId}`]);
  const { rows: [{ n }] } = await client.query('SELECT COALESCE(MAX(voucher_no), 0) + 1 AS n FROM vouchers WHERE property_id = $1', [propertyId]);
  return n;
}

async function loadSellableTemplate(client, propertyId, id) {
  const { rows: [t] } = await client.query(
    `SELECT ${TEMPLATE_COLS} FROM voucher_templates t JOIN room_types rt ON rt.id = t.room_type_id
     LEFT JOIN rate_plans rp ON rp.id = t.rate_plan_id
     WHERE t.id = $1 AND t.property_id = $2 AND t.is_active`, [id, propertyId]);
  return t || null;
}

// Who the voucher is bought by / given to: a guest profile or a typed name.
async function resolveBuyer(client, propertyId, body) {
  let guest = null;
  let name = String(body.buyer_name || '').trim();
  if (body.buyer_guest_id) {
    const { rows: [g] } = await client.query('SELECT id, name, email, whatsapp FROM guests WHERE id = $1 AND property_id = $2', [body.buyer_guest_id, propertyId]);
    if (!g) return fail('Guest not found', 404);
    guest = g; name = g.name;
  }
  if (!name) return fail('Who is it for? Pick a guest or type the name');
  return {
    guest_id: guest?.id || null, name: name.slice(0, 160),
    email: (body.buyer_email || guest?.email || '').trim().slice(0, 160) || null,
    phone: (body.buyer_phone || guest?.whatsapp || '').trim().slice(0, 40) || null,
    recipient: String(body.recipient_name || '').trim().slice(0, 160) || null,
  };
}

// Inserts the voucher row (a new number and a new code), inside the caller's transaction.
async function insertVoucher(client, propertyId, t, { buyer, amounts: a, paymentMethod = null, receivedOn, reference = null, userId, free = null }) {
  const snapshot = {
    name: t.name, description: t.description, nights: t.nights,
    room_type_id: t.room_type_id, room_type_name: t.room_type_name,
    rate_plan_id: t.rate_plan_id, rate_plan_name: t.rate_plan_name || null,
    max_guests: t.max_guests, terms: t.terms, blackout: t.blackout || [], allowed_weekdays: t.allowed_weekdays,
    min_notice_days: t.min_notice_days, no_show_consumes: t.no_show_consumes, transferable: t.transferable,
    validity_months: t.validity_months, price: a.price, list_price: round2(num(t.price)),
  };
  const no = await nextVoucherNo(client, propertyId);
  let row = null;
  for (let i = 0; i < 5 && !row; i++) {
    await client.query('SAVEPOINT code_try');
    try {
      ({ rows: [row] } = await client.query(
        `INSERT INTO vouchers (property_id, voucher_no, code, template_id, snapshot, price, covers_amount, liability_amount,
           service_amount, tax_amount, fee_amount, sold_total, buyer_guest_id, buyer_name, buyer_email, buyer_phone, recipient_name,
           sold_on, sold_by, payment_method, received_at, reference, expires_on, is_free, free_scope, free_reason, free_approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 CASE WHEN $16::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date THEN NOW() ELSE ($16::date + time '12:00') AT TIME ZONE 'Asia/Makassar' END,
                 $19,$20,$21,$22,$23,$24) RETURNING *`,
        [propertyId, no, newCode(), t.id, JSON.stringify(snapshot), a.price, a.covers, a.liability, a.fee, a.sold_total,
          buyer.guest_id, buyer.name, buyer.email, buyer.phone, buyer.recipient, receivedOn, userId || null, paymentMethod,
          String(reference || '').trim().slice(0, 120) || null, addMonths(receivedOn, t.validity_months),
          !!free, free?.scope || null, free?.reason || null, free?.approvedBy || null]));
    } catch (err) {
      if (err.code !== '23505' || !/code/.test(String(err.constraint || err.detail || ''))) throw err;   // a code clash: try another
      await client.query('ROLLBACK TO SAVEPOINT code_try');
    }
    if (row) await client.query('RELEASE SAVEPOINT code_try');
  }
  return row;
}
const issued = row => ({ id: row.id, voucher_no: voucherNo(row.voucher_no), code: row.code, pretty_code: prettyCode(row.code) });

// { template_id, buyer_guest_id | buyer_name (+ email, phone), recipient_name, payment_method, received_on?, reference }
// Optional: `quantity` (1-20, several vouchers of the type at once) and `charge_booking_id`
// (migration 169: charge them to that reservation's folio instead of taking payment now).
async function sell(propertyId, body, userId) {
  return tx(async client => {
    const t = await loadSellableTemplate(client, propertyId, body.template_id);
    if (!t) return fail('Choose a voucher type');
    const buyer = await resolveBuyer(client, propertyId, body);
    if (buyer.error) return buyer;
    const qty = body.quantity == null || body.quantity === '' ? 1 : Number(body.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail('How many vouchers? Choose 1 to 20');
    if (body.charge_booking_id) return chargeToRoom(client, propertyId, t, buyer, body, qty, userId);
    const methodId = String(body.payment_method || '');
    const { rows: [pm] } = await client.query(
      `SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active AND id NOT IN ('ota_managed', 'voucher')`, [methodId, propertyId]);
    if (!pm) return fail('Choose how it was paid', 400, { code: 'INVALID_PAYMENT_METHOD' });
    const today = todayWITA();
    const receivedOn = body.received_on ? String(body.received_on) : today;
    if (!YMD.test(receivedOn) || receivedOn > today) return fail('The day it was paid can\'t be in the future');
    const a = saleAmounts(t);
    const rows = [];
    for (let i = 0; i < qty; i++) {
      const row = await insertVoucher(client, propertyId, t, { buyer, amounts: a, paymentMethod: pm.id, receivedOn, reference: body.reference, userId });
      if (!row) return fail('Could not make a code — try again', 500);
      await logEvent(client, row.id, 'sold', `Sold ${rp(a.price)} (${t.name}) paid by ${pm.id}${a.fee ? `, plus ${t.fee_label || 'fee'} ${rp(a.fee)}` : ''}`, userId);
      rows.push(row);
    }
    return { ...issued(rows[0]), vouchers: rows.map(issued) };
  });
}

// Charged to a reservation's folio (migration 169): the voucher is issued at once, the folio gets one
// line per voucher (type 'voucher', no service charge or tax) that the guest pays with the bill.
// In the books it is a liability, not revenue; no money is recorded until the guest pays.
async function chargeToRoom(client, propertyId, t, buyer, body, qty, userId) {
  const { rows: [b] } = await client.query(
    `SELECT b.id, b.status, b.complimentary_scope, b.folio_status, b.agent_id, ag.agent_type, ag.payment_status,
            rg.group_billing, rg.billing_mode, g.name AS guest, u.name AS room
     FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
     LEFT JOIN agents ag ON ag.id = b.agent_id LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
     WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`, [body.charge_booking_id, propertyId]);
  if (!b) return fail('Reservation not found', 404);
  if (!['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(b.status)) return fail(`Can't charge to room ${b.room} — the booking is ${String(b.status).replace('_', ' ')}`, 409, { code: 'BOOKING_CLOSED' });
  if (b.folio_status || (b.agent_id && b.agent_type !== 'ota' && String(b.payment_status || '').startsWith('city_ledger'))) return fail("This stay is billed to an agent — a voucher can't be added to the agent's bill. Take the payment now instead.", 409, { code: 'AGENT_BILLED' });
  if (b.complimentary_scope === 'all') return fail('This stay is complimentary for everything — a voucher charged to it would be free. Take the payment now instead.', 409, { code: 'COMPLIMENTARY' });
  if (b.group_billing && b.billing_mode === 'everything') return fail("This room is on a group bill that covers everything — a voucher would go on the group's bill. Take the payment now instead.", 409, { code: 'GROUP_BILL' });
  const today = todayWITA();
  const a = { ...saleAmounts(t), fee: 0 };       // a card / QRIS fee is for money paid now, not a room charge
  const rows = [];
  for (let i = 0; i < qty; i++) {
    const row = await insertVoucher(client, propertyId, t, { buyer, amounts: a, paymentMethod: null, receivedOn: today, reference: null, userId });
    if (!row) return fail('Could not make a code — try again', 500);
    const label = voucherNo(row.voucher_no);
    const { rows: [line] } = await client.query(
      `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, service_date, tax_mode, posted_by)
       VALUES ($1, 'voucher', $2, 1, $3, $3, $4, 'none', $5) RETURNING id`,
      [b.id, `Voucher ${label} — ${t.name}`.slice(0, 200), a.price, today, userId || null]);
    await client.query('UPDATE vouchers SET charged_booking_id = $2, charge_id = $3 WHERE id = $1', [row.id, b.id, line.id]);
    await logEvent(client, row.id, 'sold', `Sold ${rp(a.price)} (${t.name}) — charged to room ${b.room} (${b.guest}), paid with the bill`, userId);
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [b.id, `Voucher ${label} (${t.name}, ${rp(a.price)}) charged to the room — no service charge or tax.`, userId || null]);
    rows.push(row);
  }
  return { ...issued(rows[0]), vouchers: rows.map(issued), charged_to: { booking_id: b.id, room: b.room, guest: b.guest, total: round2(a.price * qty) } };
}

// ── Free (complimentary) vouchers (migration 168) ──

// Gives a voucher away: no money, no liability. `scope` = what it covers when used
// (room / room_meals / all). Inside the caller's transaction. `approvedBy` = the approver's
// name when it was approved on Telegram, null when issued by someone with the permission.
async function issueFree(client, propertyId, t, { buyer, scope, reason, userId, approvedBy = null }) {
  const row = await insertVoucher(client, propertyId, t, {
    buyer, amounts: saleAmounts(t, true), receivedOn: todayWITA(), userId, free: { scope, reason, approvedBy } });
  if (!row) return fail('Could not make a code — try again', 500);
  await logEvent(client, row.id, 'sold', `Given free (${FREE_SCOPES[scope].split(' (')[0]}) — ${t.name}. Reason: ${reason}${approvedBy ? `. Approved by ${approvedBy}` : ''}`, userId);
  return { row, ...issued(row) };
}

// Checks what a free voucher request says; { value } or an error.
async function cleanFreeRequest(client, propertyId, body) {
  const scope = String(body.free_scope || '');
  if (!FREE_SCOPES[scope]) return fail('Choose what the free voucher covers');
  const reason = String(body.free_reason || '').trim();
  if (reason.length < 3) return fail('Give a reason for the free voucher', 400, { code: 'REASON_REQUIRED' });
  const t = await loadSellableTemplate(client, propertyId, body.template_id);
  if (!t) return fail('Choose a voucher type');
  const buyer = await resolveBuyer(client, propertyId, body);
  if (buyer.error) return buyer;
  return { value: { t, buyer, scope, reason: reason.slice(0, 500) } };
}

// The owner or a role with the `grant_complimentary` permission gives it away at once;
// anyone else asks, and an approver presses Approve on Telegram (voucherFreeApproval.js).
const canGrantFree = user => user?.role === 'owner' || (Array.isArray(user?.allowed_menus) && user.allowed_menus.includes('grant_complimentary'));

async function sellFree(propertyId, body, user) {
  if (canGrantFree(user)) {
    const out = await tx(async client => {
      const c = await cleanFreeRequest(client, propertyId, body);
      if (c.error) return c;
      const { t, buyer, scope, reason } = c.value;
      const r = await issueFree(client, propertyId, t, { buyer, scope, reason, userId: user.id });
      if (r.error) return r;
      return { ...issued(r.row), issued: true, _alert: { t, scope, reason, voucher: r.row } };
    });
    if (out.error) return out;
    const { _alert, ...result } = out;
    require('./voucherFreeApproval').notifyOwner(propertyId, _alert.voucher, { by: user, template: _alert.t, scope: _alert.scope, reason: _alert.reason });
    return result;
  }
  const c = await cleanFreeRequest(db, propertyId, body);
  if (c.error) return c;
  return require('./voucherFreeApproval').request(propertyId, c.value, user);
}

// ── Reading ──

const LIST_SQL = `
  SELECT v.*, t.name AS template_name,
         COALESCE(v.snapshot->>'name', t.name) AS name, v.snapshot->>'room_type_name' AS room_type_name,
         pm.label AS payment_label,
         cu.name AS charged_room, cg.name AS charged_guest,
         bg.name AS booking_guest, bu.name AS booking_unit, b.check_in_date, b.check_out_date, b.status AS booking_status,
         us.name AS sold_by_name
  FROM vouchers v
  LEFT JOIN voucher_templates t ON t.id = v.template_id
  LEFT JOIN payment_methods pm ON pm.id = v.payment_method AND pm.property_id = v.property_id
  LEFT JOIN bookings b ON b.id = v.booking_id
  LEFT JOIN bookings cb ON cb.id = v.charged_booking_id
  LEFT JOIN units cu ON cu.id = cb.unit_id
  LEFT JOIN guests cg ON cg.id = cb.guest_id
  LEFT JOIN guests bg ON bg.id = b.guest_id
  LEFT JOIN units bu ON bu.id = b.unit_id
  LEFT JOIN users us ON us.id = v.sold_by`;
const shape = r => ({
  ...r, voucher_label: voucherNo(r.voucher_no), pretty_code: prettyCode(r.code),
  price: num(r.price), covers_amount: num(r.covers_amount), liability_amount: num(r.liability_amount),
  fee_amount: num(r.fee_amount), sold_total: num(r.sold_total), refunded_amount: num(r.refunded_amount),
  sold_on: r.sold_on && ymd(r.sold_on), expires_on: r.expires_on && ymd(r.expires_on),
});

// ?q=&status=active|reserved|redeemed|expired|voided|all
async function list(propertyId, q = {}) {
  const params = [propertyId];
  let where = 'v.property_id = $1';
  if (q.status && q.status !== 'all') { params.push(q.status); where += ` AND v.status = $${params.length}`; }
  const text = String(q.q || '').trim();
  if (text) {
    params.push(`%${text}%`); const i = params.length;
    params.push(`%${cleanCode(text)}%`); const j = params.length;
    where += ` AND (v.buyer_name ILIKE $${i} OR v.recipient_name ILIKE $${i} OR bg.name ILIKE $${i} OR v.reference ILIKE $${i}
               OR ('V-' || lpad(v.voucher_no::text, 4, '0')) ILIKE $${i} OR (length($${j}) > 1 AND v.code LIKE $${j}))`;
  }
  const { rows } = await db.query(`${LIST_SQL} WHERE ${where} ORDER BY v.voucher_no DESC LIMIT 500`, params);
  return rows.map(shape);
}

async function detail(propertyId, id) {
  const { rows: [v] } = await db.query(`${LIST_SQL} WHERE v.id = $1 AND v.property_id = $2`, [id, propertyId]);
  if (!v) return null;
  const { rows: events } = await db.query(
    `SELECT e.kind, e.note, e.created_at, u.name AS by_name FROM voucher_events e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.voucher_id = $1 ORDER BY e.created_at, e.id`, [id]);
  return { ...shape(v), events };
}

// ── The rules at booking time ──

// Why a voucher can't be used for these dates. { code, message, overridable }.
// A manager (owner or the corrections permission) can override the soft rules.
function problemsFor(voucher, { check_in_date, check_out_date, num_guests, room_type_id }) {
  const s = voucher.snapshot || {};
  const out = [];
  const add = (code, message, overridable = false) => out.push({ code, message, overridable });
  if (voucher.status === 'reserved') add('IN_USE', 'This voucher is already booked — it can be used once. Cancel that booking first to free it.');
  else if (voucher.status === 'redeemed') add('USED', 'This voucher has already been used.');
  else if (voucher.status === 'expired') add('EXPIRED_STATUS', `This voucher expired on ${ymd(voucher.expires_on)} and can't be used any more.`);
  else if (voucher.status === 'voided') add('VOIDED', 'This voucher was cancelled and can\'t be used.');
  if (!YMD.test(String(check_in_date)) || !YMD.test(String(check_out_date)) || check_out_date <= check_in_date) {
    add('DATES', 'Choose the check-in and check-out dates first.');
    return out;
  }
  const nights = nightsBetween(check_in_date, check_out_date);
  if (nights !== s.nights) add('NIGHTS', `This voucher is for exactly ${s.nights} night${s.nights === 1 ? '' : 's'} — these dates are ${nights}.`);
  if (room_type_id && room_type_id !== s.room_type_id) add('ROOM_TYPE', `This voucher is for ${s.room_type_name || 'another room type'}.`);
  const guests = parseInt(num_guests, 10) || 1;
  if (guests > s.max_guests) add('GUESTS', `This voucher is for up to ${s.max_guests} guest${s.max_guests === 1 ? '' : 's'} — ${guests} were entered.`);
  if (voucher.status === 'active' && check_in_date > ymd(voucher.expires_on)) {
    add('EXPIRES', `This voucher is valid until ${ymd(voucher.expires_on)} — check-in is after that.`, true);
  }
  // every night against the blackout periods
  const hit = new Set();
  for (let i = 0; i < nights; i++) {
    const night = addDays(check_in_date, i);
    for (const b of s.blackout || []) if (night >= b.from && night <= b.to) hit.add(`${b.label || 'Blackout'} (${b.from} to ${b.to})`);
  }
  if (hit.size) add('BLACKOUT', `A night of this stay falls in a blackout period: ${[...hit].join('; ')}.`, true);
  if (Array.isArray(s.allowed_weekdays) && s.allowed_weekdays.length) {
    const dow = new Date(`${check_in_date}T00:00:00Z`).getUTCDay();
    if (!s.allowed_weekdays.includes(dow)) {
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      add('WEEKDAY', `Check-in is only allowed on ${s.allowed_weekdays.map(d => names[d]).join(', ')}.`, true);
    }
  }
  if (s.min_notice_days > 0 && nightsBetween(todayWITA(), check_in_date) < s.min_notice_days) {
    add('MIN_NOTICE', `This voucher needs at least ${s.min_notice_days} day${s.min_notice_days === 1 ? '' : 's'} notice before check-in.`, true);
  }
  return out;
}

// For the New Booking "Check" button: the rules, no changes.
async function check(propertyId, code, stay) {
  const c = cleanCode(code);
  if (c.length !== CODE_LEN) return { found: false, problems: [{ code: 'NOT_FOUND', message: 'No voucher has this code — check it and try again.', overridable: false }] };
  const { rows: [v] } = await db.query(`${LIST_SQL} WHERE v.code = $1 AND v.property_id = $2`, [c, propertyId]);
  if (!v) return { found: false, problems: [{ code: 'NOT_FOUND', message: 'No voucher has this code — check it and try again.', overridable: false }] };
  let room_type_id = stay.room_type_id || null;
  if (!room_type_id && stay.unit_id) {
    const { rows: [u] } = await db.query('SELECT room_type_id FROM units WHERE id = $1 AND property_id = $2', [stay.unit_id, propertyId]);
    room_type_id = u?.room_type_id || null;
  }
  const problems = problemsFor(v, { ...stay, room_type_id });
  const s = v.snapshot;
  return {
    found: true, ok: problems.length === 0, problems,
    voucher: {
      id: v.id, voucher_label: voucherNo(v.voucher_no), pretty_code: prettyCode(v.code), name: s.name,
      nights: s.nights, room_type_id: s.room_type_id, room_type_name: s.room_type_name, rate_plan_id: s.rate_plan_id,
      rate_plan_name: s.rate_plan_name, max_guests: s.max_guests, covers_amount: num(v.covers_amount),
      expires_on: ymd(v.expires_on), recipient_name: v.recipient_name, status: v.status,
      is_free: !!v.is_free, free_scope: v.free_scope || null,
    },
  };
}

// ── Redeeming at New Booking (inside the booking's transaction) ──

// Locks the voucher by its code and checks the rules for this stay. With
// `override` (a manager + a reason) the soft rules are let through. Returns
// { voucher } or { error, status, code, problems }.
async function lockForBooking(client, propertyId, code, stay, { override = null, canOverride = false } = {}) {
  const c = cleanCode(code);
  const { rows: [v] } = c.length === CODE_LEN
    ? await client.query('SELECT * FROM vouchers WHERE code = $1 AND property_id = $2 FOR UPDATE', [c, propertyId])
    : { rows: [] };
  if (!v) return fail('No voucher has this code — check it and try again.', 404, { code: 'VOUCHER_NOT_FOUND' });
  const problems = problemsFor(v, stay);
  if (problems.length) {
    const hard = problems.filter(p => !p.overridable);
    const reason = String(override || '').trim();
    if (hard.length || !canOverride || !reason) {
      const first = (hard[0] || problems[0]);
      return fail(first.message, 409, { code: 'VOUCHER_RULE', problems, rule: first.code, needs_manager: !hard.length && !canOverride });
    }
    v.overridden = { reason, problems };
  }
  return { voucher: v };
}

// After the booking row exists: the voucher is reserved, the booking carries it,
// and what the voucher covers is a received payment of method 'voucher'.
async function attachToBooking(client, voucher, booking, userId) {
  const { rowCount } = await client.query(
    `UPDATE vouchers SET status = 'reserved', booking_id = $1, reserved_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND status = 'active'`, [booking.id, voucher.id]);
  if (!rowCount) return fail('This voucher was just taken by another booking.', 409, { code: 'VOUCHER_RULE' });
  await client.query('UPDATE bookings SET voucher_id = $1 WHERE id = $2', [voucher.id, booking.id]);
  if (voucher.is_free) {
    // nothing was paid for it: the stay was made complimentary (bookingCreateService)
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [booking.id, `Booked with the FREE voucher ${voucherNo(voucher.voucher_no)} (${voucher.snapshot?.name || 'voucher'}) — ${FREE_SCOPES[voucher.free_scope].split(' (')[0].toLowerCase()} covered.`, userId || null]);
  } else {
    await client.query(
      `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, voucher_id, recorded_at)
       VALUES ($1, 'deposit', $2, 'received', 'voucher', NOW(), $3, $4, $5, NOW())`,
      [booking.id, num(voucher.covers_amount), userId || null, `Voucher ${voucherNo(voucher.voucher_no)}`, voucher.id]);
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [booking.id, `Booked with voucher ${voucherNo(voucher.voucher_no)} (${voucher.snapshot?.name || 'voucher'}) — the voucher pays ${rp(voucher.covers_amount)}.`, userId || null]);
  }
  await logEvent(client, voucher.id, 'reserved', `Booked (booking ${String(booking.id).slice(0, 8).toUpperCase()})`, userId);
  if (voucher.overridden) {
    const notes = voucher.overridden.problems.filter(p => p.overridable).map(p => p.message).join(' ');
    await logEvent(client, voucher.id, 'override', `Rule overridden: ${voucher.overridden.reason}. ${notes}`, userId);
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [booking.id, `Voucher rule overridden. Reason: ${voucher.overridden.reason}. ${notes}`.slice(0, 1000), userId || null]);
  }
  await recomputeBookingStatus(client, booking.id);
  return { ok: true };
}

// The voucher follows its booking's status. Called after a booking is cancelled,
// marked no-show, checked out, or put back (undo). Safe on any booking.
async function onBookingStatus(client, bookingId, userId = null) {
  const { rows: [b] } = await client.query('SELECT id, status, voucher_id FROM bookings WHERE id = $1', [bookingId]);
  if (!b || !b.voucher_id) return null;
  const { rows: [v] } = await client.query('SELECT * FROM vouchers WHERE id = $1 FOR UPDATE', [b.voucher_id]);
  if (!v) return null;
  const label = voucherNo(v.voucher_no);
  const release = async why => {
    await client.query(`UPDATE vouchers SET status = 'active', booking_id = NULL, reserved_at = NULL, redeemed_at = NULL, updated_at = NOW() WHERE id = $1`, [v.id]);
    await client.query(
      `UPDATE payments SET status = 'voided', voided_at = NOW(), voided_by = $2, void_reason = $3
       WHERE booking_id = $1 AND voucher_id = $4 AND status = 'received'`, [b.id, userId, `Voucher released: ${why}`, v.id]);
    await client.query('UPDATE bookings SET voucher_id = NULL, released_voucher_id = $2 WHERE id = $1', [b.id, v.id]);
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [b.id, `Voucher ${label} released (${why}) — it can be used again.`, userId]);
    await logEvent(client, v.id, 'released', why, userId);
  };
  const consume = async why => {
    await client.query(`UPDATE vouchers SET status = 'redeemed', redeemed_at = NOW(), updated_at = NOW() WHERE id = $1`, [v.id]);
    await logEvent(client, v.id, 'redeemed', why, userId);
  };
  if (v.booking_id !== b.id) return v.status;
  if (b.status === 'cancelled') { if (v.status === 'reserved' || v.status === 'redeemed') await release('booking cancelled'); }
  else if (b.status === 'no_show') {
    if (v.status === 'reserved') { if (v.snapshot?.no_show_consumes) await consume('no-show — the voucher is used up'); else await release('no-show'); }
  } else if (b.status === 'checked_out') { if (v.status === 'reserved') await consume('guest checked out'); }
  else if (v.status === 'redeemed') {
    await client.query(`UPDATE vouchers SET status = 'reserved', redeemed_at = NULL, updated_at = NOW() WHERE id = $1`, [v.id]);
    await logEvent(client, v.id, 'reserved', 'booking put back', userId);
  }
  return null;
}

// The booking's voucher was released with its payment (cancelled, or a no-show
// that doesn't use the voucher up): putting the booking back would leave it
// unpaid and the voucher could be used elsewhere meanwhile.
async function releasedVoucherOn(client, bookingId) {
  const { rows: [r] } = await client.query(
    `SELECT v.voucher_no FROM bookings b JOIN vouchers v ON v.id = b.released_voucher_id WHERE b.id = $1`, [bookingId]);
  return r ? voucherNo(r.voucher_no) : null;
}

// ── Exceptions (owner or corrections) ──

async function voidVoucher(propertyId, id, { reason, refund_amount, refund_method } = {}, userId) {
  const why = String(reason || '').trim();
  if (!why) return fail('A reason is required to cancel a voucher', 400, { code: 'REASON_REQUIRED' });
  return tx(async client => {
    const { rows: [v] } = await client.query('SELECT * FROM vouchers WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!v) return fail('Voucher not found', 404);
    if (v.status === 'reserved') return fail('This voucher is booked — cancel that booking first (the voucher then goes back to active).', 409);
    if (v.status === 'redeemed') return fail('This voucher has been used — it can\'t be cancelled.', 409);
    if (v.status === 'voided') return fail('This voucher is already cancelled.', 409);
    if (v.status === 'expired') return fail('This voucher has expired — its value was already taken as income.', 409);
    const refund = round2(num(refund_amount));
    if (v.charged_booking_id && refund > 0) return fail('This voucher was charged to a room — nothing was paid for it here. Cancelling takes it off the bill; if the guest already paid, give the money back with ⋮ → Refund on the reservation.', 400);
    if (refund < 0 || refund > num(v.sold_total) + num(v.fee_amount) + 0.004) return fail('The refund can\'t be more than was paid for it');
    let method = null;
    if (refund > 0) {
      const { rows: [pm] } = await client.query(
        `SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active AND id NOT IN ('ota_managed', 'voucher')`, [refund_method, propertyId]);
      if (!pm) return fail('Choose how the money is given back', 400, { code: 'INVALID_PAYMENT_METHOD' });
      method = pm.id;
    }
    await client.query(
      `UPDATE vouchers SET status = 'voided', void_reason = $2, voided_by = $3, voided_at = NOW(), refunded_amount = $4, refund_method = $5, updated_at = NOW()
       WHERE id = $1`, [id, why.slice(0, 500), userId || null, refund, method]);
    if (v.charged_booking_id) {
      await client.query('UPDATE folio_charges SET is_voided = true, voided_by = $2, voided_at = NOW() WHERE id = $1 AND is_voided = false', [v.charge_id, userId || null]);
      await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
        [v.charged_booking_id, `Voucher ${voucherNo(v.voucher_no)} cancelled — taken off the bill. Reason: ${why}`.slice(0, 1000), userId || null]);
    }
    await logEvent(client, id, 'voided', `${why}${refund ? ` — ${rp(refund)} given back (${method})` : ' — no money given back'}`, userId);
    return { ok: true };
  });
}

async function extend(propertyId, id, { expires_on, reason } = {}, userId) {
  const why = String(reason || '').trim();
  if (!why) return fail('A reason is required to extend a voucher', 400, { code: 'REASON_REQUIRED' });
  if (!YMD.test(String(expires_on))) return fail('Choose the new last day');
  return tx(async client => {
    const { rows: [v] } = await client.query('SELECT * FROM vouchers WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!v) return fail('Voucher not found', 404);
    if (['voided', 'redeemed'].includes(v.status)) return fail(`A ${v.status} voucher can't be extended.`, 409);
    if (v.status === 'expired') return fail('This voucher expired and its value was taken as income — it can\'t be extended.', 409);
    if (String(expires_on) <= ymd(v.expires_on)) return fail('The new last day must be after the current one');
    await client.query('UPDATE vouchers SET expires_on = $2, updated_at = NOW() WHERE id = $1', [id, expires_on]);
    await logEvent(client, id, 'extended', `Valid until ${ymd(v.expires_on)} → ${expires_on}. ${why}`, userId);
    return { ok: true };
  });
}

// Active vouchers past their last day become expired (breakage income). Reserved
// vouchers are on a booking and never expire. The day it lapses is the day after
// its last valid day, so it doesn't depend on when this ran.
async function expireDue(propertyId = null) {
  const { rows } = await db.query(
    `UPDATE vouchers SET status = 'expired', expired_on = expires_on + 1, updated_at = NOW()
     WHERE status = 'active' AND expires_on < (NOW() AT TIME ZONE 'Asia/Makassar')::date
       AND ($1::uuid IS NULL OR property_id = $1)
     RETURNING id`, [propertyId]);
  for (const r of rows) await db.query(`INSERT INTO voucher_events (voucher_id, kind, note) VALUES ($1, 'expired', 'Not used by its last day')`, [r.id]);
  return rows.length;
}

// ── Report ──

// Outstanding = sold and not yet booked: `active`. That is what the liability account
// holds. A booked voucher (reserved) has paid its stay: its value moved to Advance deposits /
// the guest ledger when the booking was made, so it is shown apart.
async function report(propertyId, { from, to } = {}) {
  const today = todayWITA();
  const f = from && YMD.test(from) ? from : today.slice(0, 8) + '01';
  const t = to && YMD.test(to) ? to : today;
  const [{ rows: byStatus }, { rows: byMonth }, { rows: period }, { rows: soon }] = await Promise.all([
    db.query(`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(liability_amount), 0) AS amount FROM vouchers WHERE property_id = $1 AND NOT is_free GROUP BY status`, [propertyId]),
    db.query(`SELECT to_char(expires_on, 'YYYY-MM') AS month, COUNT(*)::int AS n, SUM(liability_amount) AS amount FROM vouchers
              WHERE property_id = $1 AND status = 'active' AND NOT is_free GROUP BY 1 ORDER BY 1`, [propertyId]),
    db.query(`SELECT
        COUNT(*) FILTER (WHERE sold_on BETWEEN $2::date AND $3::date AND NOT is_free)::int AS sold_n,
        COALESCE(SUM(sold_total) FILTER (WHERE sold_on BETWEEN $2::date AND $3::date), 0) AS sold_amount,
        COUNT(*) FILTER (WHERE sold_on BETWEEN $2::date AND $3::date AND is_free)::int AS free_given_n,
        COUNT(*) FILTER (WHERE redeemed_at IS NOT NULL AND (redeemed_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date)::int AS redeemed_n,
        COALESCE(SUM(liability_amount) FILTER (WHERE redeemed_at IS NOT NULL AND (redeemed_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date), 0) AS redeemed_amount,
        COUNT(*) FILTER (WHERE status = 'expired' AND expired_on BETWEEN $2::date AND $3::date)::int AS expired_n,
        COALESCE(SUM(liability_amount) FILTER (WHERE status = 'expired' AND expired_on BETWEEN $2::date AND $3::date), 0) AS expired_amount
      FROM vouchers WHERE property_id = $1`, [propertyId, f, t]),
    db.query(`${LIST_SQL} WHERE v.property_id = $1 AND v.status = 'active' AND v.expires_on BETWEEN $2::date AND ($2::date + 60) ORDER BY v.expires_on LIMIT 100`, [propertyId, today]),
  ]);
  const get = s => byStatus.find(r => r.status === s) || { n: 0, amount: 0 };
  const outstanding = { count: get('active').n, amount: round2(num(get('active').amount)) };
  const booked = { count: get('reserved').n, amount: round2(num(get('reserved').amount)) };
  const { rows: freeRows } = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM vouchers WHERE property_id = $1 AND is_free GROUP BY status`, [propertyId]);
  const freeCount = s => freeRows.find(r => r.status === s)?.n || 0;
  const free = { active: freeCount('active'), booked: freeCount('reserved'), used: freeCount('redeemed'), expired: freeCount('expired'), voided: freeCount('voided') };
  // the ledger balance of the liability account, when accounting is on — the check line
  let ledger = null;
  try {
    const { rows: [mod] } = await db.query(`SELECT is_enabled FROM property_modules WHERE property_id = $1 AND module = 'accounting'`, [propertyId]);
    if (mod?.is_enabled) ledger = await liabilityBalance(propertyId);
  } catch { ledger = null; }
  return {
    from: f, to: t, today,
    outstanding, booked, free,
    by_status: ['active', 'reserved', 'redeemed', 'expired', 'voided'].map(s => ({ status: s, count: get(s).n, amount: num(get(s).amount) })),
    by_expiry_month: byMonth.map(r => ({ month: r.month, count: r.n, amount: num(r.amount) })),
    period: Object.fromEntries(Object.entries(period[0] || {}).map(([k, v]) => [k, k.endsWith('_n') ? v : num(v)])),
    expiring: soon.map(shape).map(v => ({ id: v.id, voucher_label: v.voucher_label, name: v.name, recipient_name: v.recipient_name, buyer_name: v.buyer_name, expires_on: v.expires_on, amount: v.liability_amount, days_left: nightsBetween(today, v.expires_on) })),
    ledger,
  };
}

// What the books say is outstanding: the balance of the liability account
// (credits − debits of every posting to `voucher.liability`).
async function liabilityBalance(propertyId) {
  const { rows: [r] } = await db.query('SELECT MIN(sold_on) AS first FROM vouchers WHERE property_id = $1', [propertyId]);
  if (!r?.first) return { balance: 0, since: null };
  const since = ymd(r.first);
  const { posts, mapping } = await require('./journalService').postingsFor(propertyId, since, todayWITA());
  const acc = mapping.resolve('voucher.liability').account;
  if (!acc) return { balance: null, since, missing_account: true };
  return { balance: round2(-posts.filter(p => p.account?.id === acc.id).reduce((sum, p) => sum + p.amount, 0)), since };
}

module.exports = {
  cleanCode, prettyCode, voucherNo, CODE_LEN,
  listTemplates, saveTemplate, sell, list, detail, check, problemsFor, lockForBooking, attachToBooking, onBookingStatus,
  releasedVoucherOn, voidVoucher, extend, expireDue, report, saleAmounts, liabilityBalance, LIST_SQL, shape,
  FREE_SCOPES, canGrantFree, sellFree, issueFree, cleanFreeRequest, resolveBuyer, loadSellableTemplate,
};
