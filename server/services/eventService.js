// Events — the meeting room (any function space) booked for a date and time,
// with its own bill, payments and the meals the restaurant prepares
// (migration 106). An event may link to a group booking for its bedrooms; the
// two bills stay separate (the invoice shows both balances).
//
// Money rules, the same as a folio's:
//   - a line's amount is NET; the bill adds service + tax at the event's own
//     rates (stamped when the event is made — events.bill_*), so a later
//     change of the property's rates never re-prices an agreed event;
//   - a price is typed the way the property types prices (events.
//     prices_include_tax): nett → turned to NET here, the typed figure kept
//     on the line (shown_total) so the bill prints what was agreed;
//   - nothing is deleted: lines and payments are voided with a reason.
// Revenue counts for CONFIRMED events only, on each line's service_date
// (routes/reports.js EVENT_SQL).
const db = require('../db');
const { computeFolioTotals, round2, settleCents } = require('./folioService');
const { basisFrom } = require('./priceBasis');
const { fitToGross } = require('./bookingPriceService');
const { todayWITA } = require('./roomChargeService');

class EventError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const STATUSES = ['enquiry', 'tentative', 'confirmed', 'cancelled'];
const MEAL_KINDS = { coffee_break: 'Coffee break', lunch: 'Lunch', dinner: 'Dinner', welcome_drink: 'Welcome drink', other: 'Other' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const ymd = d => (d ? String(d).slice(0, 10) : null);
const hhmm = t => (t ? String(t).slice(0, 5) : null);
const clean = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const validDate = s => typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s));
function fmtDay(d) {
  return new Date(ymd(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function whenText(e) {
  const days = ymd(e.event_date) === ymd(e.end_date) ? fmtDay(e.event_date) : `${fmtDay(e.event_date)} – ${fmtDay(e.end_date)}`;
  return `${days}, ${hhmm(e.start_time)}–${hhmm(e.end_time)}`;
}

const SELECT = `
  SELECT e.*, v.name AS venue_name, v.capacity AS venue_capacity,
         a.name AS agent_name, cu.name AS created_by_name,
         COALESCE(NULLIF(e.company_name, ''), a.name, e.contact_name) AS customer
  FROM events e
  JOIN venues v ON v.id = e.venue_id
  LEFT JOIN agents a ON a.id = e.agent_id
  LEFT JOIN users cu ON cu.id = e.created_by`;

function shape(e) {
  return {
    ...e,
    event_date: ymd(e.event_date), end_date: ymd(e.end_date), hold_until: ymd(e.hold_until),
    start_time: hhmm(e.start_time), end_time: hhmm(e.end_time),
    bill_tax_rate: parseFloat(e.bill_tax_rate), bill_service_charge_rate: parseFloat(e.bill_service_charge_rate),
    hold_expired: e.status === 'tentative' && !!e.hold_until && ymd(e.hold_until) < todayWITA(),
  };
}

async function log(client, eventId, note, userId) {
  await client.query('INSERT INTO event_log (event_id, note, created_by) VALUES ($1, $2, $3)', [eventId, String(note).slice(0, 1000), userId || null]);
}

// ── Venues ───────────────────────────────────────────────────────
async function listVenues(propertyId, { activeOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM venues WHERE property_id = $1 ${activeOnly ? 'AND is_active' : ''} ORDER BY sort_order, name`, [propertyId]);
  return rows;
}

async function saveVenue(propertyId, id, body) {
  const name = clean(body.name, 120);
  if (!name) throw new EventError(400, 'A name is required');
  const capacity = body.capacity === '' || body.capacity == null ? null : parseInt(body.capacity, 10);
  if (capacity !== null && !(capacity >= 1)) throw new EventError(400, 'Capacity must be 1 or more');
  try {
    if (id) {
      const { rows: [v] } = await db.query(
        `UPDATE venues SET name = $1, capacity = $2, is_active = COALESCE($3, is_active), updated_at = NOW()
         WHERE id = $4 AND property_id = $5 RETURNING *`,
        [name, capacity, typeof body.is_active === 'boolean' ? body.is_active : null, id, propertyId]);
      if (!v) throw new EventError(404, 'Venue not found');
      return v;
    }
    const { rows: [v] } = await db.query(
      'INSERT INTO venues (property_id, name, capacity) VALUES ($1, $2, $3) RETURNING *', [propertyId, name, capacity]);
    return v;
  } catch (err) {
    if (err.code === '23505') throw new EventError(409, 'There is already a venue with that name');
    throw err;
  }
}

// ── Reading ──────────────────────────────────────────────────────
// Other events on the same venue whose days and hours overlap.
async function overlaps(client, propertyId, e, { statuses, excludeId = null }) {
  const { rows } = await client.query(
    `${SELECT}
     WHERE e.property_id = $1 AND e.venue_id = $2 AND e.status = ANY($3) AND e.id IS DISTINCT FROM $4
       AND e.event_date <= $6::date AND e.end_date >= $5::date
       AND e.start_time < $8::time AND e.end_time > $7::time
     ORDER BY e.event_date, e.start_time`,
    [propertyId, e.venue_id, statuses, excludeId, ymd(e.event_date), ymd(e.end_date), hhmm(e.start_time), hhmm(e.end_time)]);
  return rows.map(shape);
}

async function getEvent(propertyId, id, client = db) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows: [e] } = await client.query(`${SELECT} WHERE e.id = $1 AND e.property_id = $2`, [id, propertyId]);
  return e ? shape(e) : null;
}

// The event's bill: its lines, subtotal → service → tax → total, payments, balance.
async function eventBill(propertyId, eventId, client = db) {
  const e = await getEvent(propertyId, eventId, client);
  if (!e) return null;
  const [{ rows: charges }, { rows: payments }] = await Promise.all([
    client.query(
      `SELECT c.*, cu.name AS created_by_name, vu.name AS voided_by_name
       FROM event_charges c LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users vu ON vu.id = c.voided_by
       WHERE c.event_id = $1 ORDER BY c.is_voided, c.service_date, c.created_at`, [eventId]),
    client.query(
      `SELECT p.*, COALESCE(pm.label, p.method) AS method_label, us.name AS received_by_name, vu.name AS voided_by_name
       FROM event_payments p
       LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id
       LEFT JOIN users us ON us.id = p.received_by LEFT JOIN users vu ON vu.id = p.voided_by
       WHERE p.event_id = $1 ORDER BY p.received_at, p.recorded_at, p.created_at`, [eventId]),
  ]);
  const F = basisFrom({ tax_rate: e.bill_tax_rate, service_charge_rate: e.bill_service_charge_rate, prices_include_tax: true }).F;
  const lines = charges.map(c => {
    const amount = parseFloat(c.amount);
    return {
      ...c, service_date: ymd(c.service_date), amount, unit_price: parseFloat(c.unit_price), quantity: parseFloat(c.quantity),
      // what the line comes to with service & tax
      total: c.shown_total != null ? parseFloat(c.shown_total) : round2(amount * F),
    };
  });
  const live = lines.filter(c => !c.is_voided);
  const t = computeFolioTotals(live.reduce((s, c) => s + c.amount, 0), e.bill_tax_rate, e.bill_service_charge_rate);
  // The lines' own totals are what was agreed: use their sum when service +
  // tax on the net amounts lands within a few cents of it (cent rounding).
  const agreed = round2(live.reduce((s, c) => s + c.total, 0));
  const total = Math.abs(agreed - t.total) <= 0.05 * Math.max(1, live.length) ? agreed : t.total;
  const pays = payments.map(p => ({ ...p, amount: parseFloat(p.amount) }));
  const received = round2(pays.filter(p => !p.is_voided).reduce((s, p) => s + p.amount, 0));
  // Meals with an agreed price that the restaurant has not rung up yet: not
  // on the bill (and not revenue) until the POS charges them, but part of
  // what the client is expected to pay — the pro forma and the balance count
  // them. A meal is replaced by its restaurant bill once one arrives for it.
  const rung = new Set(live.filter(c => c.type === 'pos' && c.meal_id).map(c => c.meal_id));
  const { rows: mealRows } = await client.query(
    `SELECT * FROM event_meals WHERE event_id = $1 AND status <> 'cancelled' AND unit_price IS NOT NULL
     ORDER BY service_date, service_time NULLS LAST, created_at`, [eventId]);
  const quoted = mealRows.filter(m => !rung.has(m.id)).map(m => {
    const q = mealQuote(e, m);
    return { meal_id: m.id, kind: m.kind, description: `${MEAL_KINDS[m.kind]}${m.note ? ` — ${m.note}` : ''}`, service_date: ymd(m.service_date),
      service_time: hhmm(m.service_time), pax: m.pax, price: q.price, amount: q.net, total: q.total, status: m.status };
  });
  const quotedTotal = round2(quoted.reduce((s, q) => s + q.total, 0));
  const expected = round2(total + quotedTotal);
  return {
    event: e, charges: live, voided_charges: lines.filter(c => c.is_voided),
    subtotal: t.subtotal, service_charge_amount: t.service_charge_amount, tax_amount: round2(total - t.subtotal - t.service_charge_amount),
    service_charge_rate: e.bill_service_charge_rate, tax_rate: e.bill_tax_rate, prices_include_tax: e.prices_include_tax,
    // total = what is on the bill now; expected_total adds the agreed meals still to be rung up
    total, quoted, quoted_total: quotedTotal, expected_total: expected,
    received, balance_due: settleCents(round2(expected - received)), payments: pays,
  };
}

// A meal's agreed price: `unit_price` is NET per person, `shown_price` the
// figure as typed (per person) when prices include service & tax.
// → { price (per person, as typed), net, total (what the client pays for it) }
function mealQuote(e, m) {
  if (m.unit_price == null) return null;
  const pax = parseInt(m.pax, 10) || 0;
  const unit = parseFloat(m.unit_price);
  if (m.shown_price != null) {
    const total = round2(parseFloat(m.shown_price) * pax);
    return { price: parseFloat(m.shown_price), net: priceOf(e, total).net, total };
  }
  const net = round2(unit * pax);
  return { price: unit, net, total: computeFolioTotals(net, e.bill_tax_rate, e.bill_service_charge_rate).total };
}

async function listMeals(eventId, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM event_meals WHERE event_id = $1 ORDER BY (status = 'cancelled'), service_date, service_time NULLS LAST, created_at`, [eventId]);
  return rows.map(m => ({ ...m, service_date: ymd(m.service_date), service_time: hhmm(m.service_time), kind_label: MEAL_KINDS[m.kind],
    unit_price: m.unit_price == null ? null : parseFloat(m.unit_price), shown_price: m.shown_price == null ? null : parseFloat(m.shown_price) }));
}

// The group booking an event is linked to: who booked, dates, rooms, balance.
async function linkedGroup(propertyId, groupId) {
  if (!groupId) return null;
  const { rows: [g] } = await db.query(
    `SELECT rg.id, rg.status, rg.group_billing, to_char(rg.check_in_date, 'YYYY-MM-DD') AS check_in_date,
            to_char(rg.check_out_date, 'YYYY-MM-DD') AS check_out_date, gu.name AS booker,
            (SELECT COUNT(*)::int FROM bookings b WHERE b.reservation_group_id = rg.id AND b.status NOT IN ('cancelled', 'no_show')) AS rooms
     FROM reservation_groups rg LEFT JOIN guests gu ON gu.id = rg.primary_guest_id
     WHERE rg.id = $1 AND rg.property_id = $2`, [groupId, propertyId]);
  if (!g) return null;
  if (g.group_billing) {
    const bill = await require('./groupBilling').groupBill(groupId, propertyId);
    if (bill) Object.assign(g, { total: bill.total, received: bill.received, balance_due: bill.balance_due });
  }
  return g;
}

async function detail(propertyId, id) {
  const bill = await eventBill(propertyId, id);
  if (!bill) return null;
  const e = bill.event;
  const [meals, { rows: history }, group, clashes] = await Promise.all([
    listMeals(id),
    db.query(`SELECT l.id, l.note, l.created_at, u.name AS created_by_name FROM event_log l LEFT JOIN users u ON u.id = l.created_by
              WHERE l.event_id = $1 ORDER BY l.created_at DESC LIMIT 300`, [id]),
    linkedGroup(propertyId, e.reservation_group_id),
    e.status === 'cancelled' ? [] : overlaps(db, propertyId, e, { statuses: ['confirmed', 'tentative'], excludeId: id }),
  ]);
  const rungBy = new Map(bill.charges.filter(c => c.type === 'pos' && c.meal_id).map(c => [c.meal_id, c]));
  for (const m of meals) {
    const q = mealQuote(e, m);
    m.price = q ? q.price : null;                 // per person, as typed
    m.agreed_total = q ? q.total : null;          // what the client pays for it
    m.charged_total = rungBy.has(m.id) ? rungBy.get(m.id).total : null;   // the restaurant's bill, once rung up
  }
  return {
    event: e, bill: { ...bill, event: undefined }, meals, history, group,
    // other events on the venue at the same time (a tentative one only warns)
    clashes: clashes.map(c => ({ id: c.id, event_no: c.event_no, name: c.name, customer: c.customer, status: c.status, when: whenText(c) })),
    today: todayWITA(),
  };
}

// The list / calendar: events touching [from, to], with what is owed.
async function list(propertyId, { from, to, status, q, group_id } = {}) {
  const where = ['e.property_id = $1'];
  const params = [propertyId];
  if (validDate(from)) { params.push(from); where.push(`e.end_date >= $${params.length}::date`); }
  if (validDate(to)) { params.push(to); where.push(`e.event_date <= $${params.length}::date`); }
  if (/^[0-9a-f-]{36}$/i.test(String(group_id || ''))) { params.push(group_id); where.push(`e.reservation_group_id = $${params.length}`); }
  if (STATUSES.includes(status)) { params.push(status); where.push(`e.status = $${params.length}`); }
  else if (status === 'active') where.push(`e.status <> 'cancelled'`);
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(e.name ILIKE $${params.length} OR e.company_name ILIKE $${params.length} OR e.contact_name ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
  }
  const { rows } = await db.query(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.event_date, e.start_time LIMIT 500`, params);
  const events = rows.map(shape);
  if (!events.length) return events;
  const ids = events.map(e => e.id);
  const [{ rows: sums }, { rows: paid }, { rows: meals }] = await Promise.all([
    db.query(`SELECT event_id, SUM(amount) AS net, SUM(shown_total) AS shown, COUNT(*) FILTER (WHERE shown_total IS NULL) AS unshown
              FROM event_charges WHERE event_id = ANY($1) AND NOT is_voided GROUP BY event_id`, [ids]),
    db.query(`SELECT event_id, SUM(amount) AS received FROM event_payments WHERE event_id = ANY($1) AND NOT is_voided GROUP BY event_id`, [ids]),
    db.query(`SELECT event_id, COUNT(*)::int AS meals, COUNT(*) FILTER (WHERE status = 'open')::int AS open_meals
              FROM event_meals WHERE event_id = ANY($1) AND status <> 'cancelled' GROUP BY event_id`, [ids]),
  ]);
  // agreed meals not rung up yet, per event
  const { rows: quotedMeals } = await db.query(
    `SELECT m.* FROM event_meals m
     WHERE m.event_id = ANY($1) AND m.status <> 'cancelled' AND m.unit_price IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event_charges c WHERE c.meal_id = m.id AND c.type = 'pos' AND NOT c.is_voided)`, [ids]);
  const quotedBy = new Map();
  const eventBy = new Map(events.map(e => [e.id, e]));
  for (const m of quotedMeals) quotedBy.set(m.event_id, (quotedBy.get(m.event_id) || 0) + mealQuote(eventBy.get(m.event_id), m).total);
  const by = (arr) => new Map(arr.map(r => [r.event_id, r]));
  const s = by(sums), p = by(paid), m = by(meals);
  return events.map(e => {
    const c = s.get(e.id);
    const net = parseFloat(c?.net || 0);
    const billed = c && parseInt(c.unshown, 10) === 0 ? round2(parseFloat(c.shown))
      : computeFolioTotals(net, e.bill_tax_rate, e.bill_service_charge_rate).total;
    const total = round2(billed + (quotedBy.get(e.id) || 0));   // incl. agreed meals still to be rung up
    const received = round2(parseFloat(p.get(e.id)?.received || 0));
    return { ...e, total, received, balance_due: settleCents(round2(total - received)), meals: m.get(e.id)?.meals || 0, open_meals: m.get(e.id)?.open_meals || 0 };
  });
}

// ── Writing ──────────────────────────────────────────────────────
// A typed price → { net, shown } for this event's rates.
function priceOf(e, price) {
  const p = round2(parseFloat(price));
  if (!Number.isFinite(p) || p < 0) throw new EventError(400, 'Enter a price');
  if (!e.prices_include_tax) return { net: p, shown: null };
  const b = basisFrom({ tax_rate: e.bill_tax_rate, service_charge_rate: e.bill_service_charge_rate, prices_include_tax: true });
  return { net: fitToGross(round2(p / b.F), 0, p, b.tax_rate, b.service_charge_rate), shown: p };
}

// Checks the body of a new / changed event. `cur` = the event being changed.
async function validate(client, propertyId, body, cur = null) {
  const pick = k => (body[k] !== undefined ? body[k] : cur?.[k]);
  const v = {
    name: clean(pick('name'), 200),
    agent_id: pick('agent_id') || null,
    company_name: clean(pick('company_name'), 200),
    contact_name: clean(pick('contact_name'), 200),
    contact_phone: clean(pick('contact_phone'), 50),
    contact_email: clean(pick('contact_email'), 200),
    venue_id: pick('venue_id'),
    event_date: ymd(pick('event_date')),
    end_date: ymd(pick('end_date') || pick('event_date')),
    start_time: hhmm(pick('start_time')),
    end_time: hhmm(pick('end_time')),
    pax: parseInt(pick('pax'), 10),
    hold_until: ymd(pick('hold_until')) || null,
    reservation_group_id: pick('reservation_group_id') || null,
    notes: clean(pick('notes'), 4000),
    internal_notes: clean(pick('internal_notes'), 4000),
  };
  if (!v.name) throw new EventError(400, 'Give the event a name (e.g. "Annual meeting — PT …")');
  if (!v.agent_id && !v.company_name && !v.contact_name) throw new EventError(400, 'Who is it for? Pick a company / agent or type a contact name');
  if (!validDate(v.event_date) || !validDate(v.end_date)) throw new EventError(400, 'Choose the date');
  if (v.end_date < v.event_date) throw new EventError(400, 'The last day is before the first day');
  if ((Date.parse(v.end_date) - Date.parse(v.event_date)) / 864e5 > 30) throw new EventError(400, 'An event can run for 31 days at most');
  if (!TIME_RE.test(v.start_time || '') || !TIME_RE.test(v.end_time || '')) throw new EventError(400, 'Choose the start and end time');
  if (v.end_time <= v.start_time) throw new EventError(400, 'The end time must be after the start time');
  if (!(v.pax >= 1)) throw new EventError(400, 'How many people?');
  if (v.hold_until && !validDate(v.hold_until)) throw new EventError(400, 'Hold until: not a date');

  const { rows: [venue] } = await client.query('SELECT * FROM venues WHERE id = $1 AND property_id = $2', [v.venue_id || null, propertyId]);
  if (!venue) throw new EventError(400, 'Choose the venue');
  if (!venue.is_active && venue.id !== cur?.venue_id) throw new EventError(400, 'That venue is no longer in use');
  if (v.agent_id) {
    const { rows: [a] } = await client.query('SELECT id FROM agents WHERE id = $1 AND property_id = $2', [v.agent_id, propertyId]);
    if (!a) throw new EventError(400, 'Company / agent not found');
  }
  if (v.reservation_group_id) {
    const { rows: [g] } = await client.query('SELECT id FROM reservation_groups WHERE id = $1 AND property_id = $2', [v.reservation_group_id, propertyId]);
    if (!g) throw new EventError(400, 'Group booking not found');
  }
  return { v, venue };
}

// A confirmed event may not overlap another confirmed one on the venue.
async function assertFree(client, propertyId, e, excludeId) {
  const [clash] = await overlaps(client, propertyId, e, { statuses: ['confirmed'], excludeId });
  if (clash) {
    throw new EventError(409, `The ${clash.venue_name} is already booked then: #${clash.event_no} ${clash.name} (${whenText(clash)})`,
      { code: 'VENUE_TAKEN', clash_id: clash.id });
  }
}

async function tx(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// body: the event's fields + status (enquiry / tentative / confirmed) and an
// optional hire_price for the venue (typed the way the property types prices).
async function create(propertyId, body, user) {
  const status = ['enquiry', 'tentative', 'confirmed'].includes(body.status) ? body.status : 'enquiry';
  const id = await tx(async client => {
    const { v, venue } = await validate(client, propertyId, body);
    if (status === 'confirmed') await assertFree(client, propertyId, v, null);
    const { rows: [ps] } = await client.query(
      'SELECT tax_rate, service_charge_rate, prices_include_tax FROM property_settings WHERE property_id = $1', [propertyId]);
    const basis = basisFrom(ps);
    // event_no: next number of the property (one at a time per property)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['event_no:' + propertyId]);
    const { rows: [e] } = await client.query(
      `INSERT INTO events (property_id, event_no, name, agent_id, company_name, contact_name, contact_phone, contact_email,
                           venue_id, event_date, end_date, start_time, end_time, pax, status, hold_until, reservation_group_id,
                           notes, internal_notes, bill_tax_rate, bill_service_charge_rate, prices_include_tax, created_by)
       VALUES ($1, (SELECT COALESCE(MAX(event_no), 0) + 1 FROM events WHERE property_id = $1),
               $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [propertyId, v.name, v.agent_id, v.company_name, v.contact_name, v.contact_phone, v.contact_email,
       v.venue_id, v.event_date, v.end_date, v.start_time, v.end_time, v.pax, status,
       status === 'tentative' ? v.hold_until : null, v.reservation_group_id, v.notes, v.internal_notes,
       basis.tax_rate, basis.service_charge_rate, basis.include, user.id]);
    let hire = '';
    if (body.hire_price !== undefined && body.hire_price !== '' && body.hire_price !== null) {
      const ev = shape(e);
      const { net, shown } = priceOf(ev, body.hire_price);
      if (net > 0) {
        await client.query(
          `INSERT INTO event_charges (property_id, event_id, type, description, service_date, quantity, unit_price, amount, shown_total, created_by)
           VALUES ($1, $2, 'venue', $3, $4, 1, $5, $5, $6, $7)`,
          [propertyId, e.id, `${venue.name} hire`, v.event_date, net, shown, user.id]);
        hire = ` Hire ${fmtIDR(shown ?? net)}${shown == null && (basis.tax_rate || basis.service_charge_rate) ? ' ++' : ''}.`;
      }
    }
    await log(client, e.id, `Event created as ${status}: ${venue.name}, ${whenText(shape(e))}, ${v.pax} people.${hire}`, user.id);
    return e.id;
  });
  const e = await getEvent(propertyId, id);
  if (status === 'confirmed') alertEvent(propertyId, 'confirmed', e, user);
  return e;
}

const FIELD_LABELS = {
  name: 'Name', company_name: 'Company', contact_name: 'Contact', contact_phone: 'Phone', contact_email: 'Email',
  event_date: 'First day', end_date: 'Last day', start_time: 'From', end_time: 'To', pax: 'People', hold_until: 'Hold until',
};

async function update(propertyId, id, body, user) {
  const { before, after, changes } = await tx(async client => {
    const { rows: [row] } = await client.query('SELECT * FROM events WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!row) throw new EventError(404, 'Event not found');
    const cur = shape(row);
    if (cur.status === 'cancelled') throw new EventError(409, 'This event is cancelled');
    const { v, venue } = await validate(client, propertyId, body, cur);
    if (cur.status === 'confirmed') await assertFree(client, propertyId, v, id);
    await client.query(
      `UPDATE events SET name = $1, agent_id = $2, company_name = $3, contact_name = $4, contact_phone = $5, contact_email = $6,
              venue_id = $7, event_date = $8, end_date = $9, start_time = $10, end_time = $11, pax = $12, hold_until = $13,
              reservation_group_id = $14, notes = $15, internal_notes = $16, updated_by = $17, updated_at = NOW()
       WHERE id = $18`,
      [v.name, v.agent_id, v.company_name, v.contact_name, v.contact_phone, v.contact_email, v.venue_id, v.event_date, v.end_date,
       v.start_time, v.end_time, v.pax, cur.status === 'tentative' ? v.hold_until : null, v.reservation_group_id, v.notes, v.internal_notes, user.id, id]);
    // The event moved to other days: its own lines (venue hire, other) and the
    // meals not handled yet move with it, by the same number of days — or the
    // hire would be reported on the old day and the kitchen told the old day.
    // Restaurant bills keep the day they were rung up.
    const shift = Math.round((Date.parse(v.event_date) - Date.parse(cur.event_date)) / 864e5);
    let moved = '';
    if (shift !== 0 || v.end_date !== cur.end_date) {
      const within = `LEAST(GREATEST(service_date + $2::int, $3::date), $4::date)`;
      const c1 = await client.query(
        `UPDATE event_charges SET service_date = ${within} WHERE event_id = $1 AND type <> 'pos' AND NOT is_voided
           AND service_date <> ${within}`, [id, shift, v.event_date, v.end_date]);
      const c2 = await client.query(
        `UPDATE event_meals SET service_date = ${within}, updated_at = NOW() WHERE event_id = $1 AND status = 'open'
           AND service_date <> ${within}`, [id, shift, v.event_date, v.end_date]);
      if (c1.rowCount || c2.rowCount) moved = `Moved with the event: ${c1.rowCount} bill line${c1.rowCount === 1 ? '' : 's'}, ${c2.rowCount} meal${c2.rowCount === 1 ? '' : 's'}`;
    }
    const diffs = Object.keys(FIELD_LABELS)
      .filter(k => String(cur[k] ?? '') !== String(v[k] ?? ''))
      .map(k => `${FIELD_LABELS[k]}: ${cur[k] ?? '—'} → ${v[k] ?? '—'}`);
    if (cur.venue_id !== v.venue_id) diffs.push(`Venue: ${cur.venue_name} → ${venue.name}`);
    if ((cur.agent_id || null) !== (v.agent_id || null)) diffs.push('Company / agent changed');
    if ((cur.reservation_group_id || null) !== (v.reservation_group_id || null)) diffs.push(v.reservation_group_id ? 'Linked to a group booking' : 'Link to the group booking removed');
    if ((cur.notes || '') !== (v.notes || '')) diffs.push('Notes updated');
    if ((cur.internal_notes || '') !== (v.internal_notes || '')) diffs.push('Internal notes updated');
    if (moved) diffs.push(moved);
    if (diffs.length) await log(client, id, diffs.join('; '), user.id);
    return { before: cur, after: null, changes: diffs };
  });
  const e = after || await getEvent(propertyId, id);
  // The restaurant / housekeeping only need to hear about what they act on.
  const matters = changes.filter(c => /^(First day|Last day|From|To|People|Venue|Name)/.test(c));
  if (before.status === 'confirmed' && matters.length) alertEvent(propertyId, 'changed', e, user, matters.join('; '));
  return e;
}

async function setStatus(propertyId, id, body, user) {
  const status = body.status;
  if (!STATUSES.includes(status)) throw new EventError(400, 'Unknown status');
  const reason = clean(body.reason, 500);
  const before = await tx(async client => {
    const { rows: [row] } = await client.query('SELECT * FROM events WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!row) throw new EventError(404, 'Event not found');
    const cur = shape(row);
    if (cur.status === status) throw new EventError(409, `This event is already ${status}`);
    if (status === 'cancelled' && !reason) throw new EventError(400, 'A reason is required', { code: 'REASON_REQUIRED' });
    if (status === 'confirmed') await assertFree(client, propertyId, cur, id);
    const hold = status === 'tentative' ? (ymd(body.hold_until) || cur.hold_until || null) : null;
    if (hold && !validDate(hold)) throw new EventError(400, 'Hold until: not a date');
    await client.query(
      `UPDATE events SET status = $1, hold_until = $2, updated_by = $3, updated_at = NOW(),
              cancel_reason = $4, cancelled_by = $5, cancelled_at = $6
       WHERE id = $7`,
      [status, hold, user.id, status === 'cancelled' ? reason : null, status === 'cancelled' ? user.id : null,
       status === 'cancelled' ? new Date() : null, id]);
    await log(client, id,
      `Status: ${cur.status} → ${status}${hold ? ` (hold until ${hold})` : ''}${reason ? `. Reason: ${reason}` : ''}`, user.id);
    return cur;
  });
  const e = await getEvent(propertyId, id);
  if (status === 'confirmed') alertEvent(propertyId, 'confirmed', e, user);
  else if (before.status === 'confirmed') alertEvent(propertyId, status === 'cancelled' ? 'cancelled' : 'unconfirmed', e, user, reason);
  return e;
}

async function lockOpen(client, propertyId, id) {
  const { rows: [row] } = await client.query('SELECT * FROM events WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
  if (!row) throw new EventError(404, 'Event not found');
  return shape(row);
}

// ── Bill lines ───────────────────────────────────────────────────
async function addCharge(propertyId, id, body, user) {
  return tx(async client => {
    const e = await lockOpen(client, propertyId, id);
    if (e.status === 'cancelled') throw new EventError(409, 'This event is cancelled');
    const type = body.type === 'venue' ? 'venue' : 'other';
    const description = clean(body.description, 300);
    if (!description) throw new EventError(400, 'Say what the line is for');
    const date = ymd(body.service_date) || e.event_date;
    if (!validDate(date)) throw new EventError(400, 'Choose the date');
    const qty = body.quantity === undefined || body.quantity === '' ? 1 : parseFloat(body.quantity);
    if (!(qty > 0)) throw new EventError(400, 'Quantity must be more than 0');
    const unit = priceOf(e, body.price);
    if (!(unit.net > 0)) throw new EventError(400, 'Enter a price');
    const shown = unit.shown == null ? null : round2(unit.shown * qty);
    const amount = shown == null ? round2(unit.net * qty) : priceOf(e, shown).net;
    const { rows: [c] } = await client.query(
      `INSERT INTO event_charges (property_id, event_id, type, description, service_date, quantity, unit_price, amount, shown_total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [propertyId, id, type, description, date, qty, unit.net, amount, shown, user.id]);
    await log(client, id, `Line added: ${description}${qty !== 1 ? ` × ${qty}` : ''} — ${fmtIDR(shown ?? amount)}`, user.id);
    return c.id;
  });
}

// Voids a bill line. A restaurant bill (type 'pos') is also taken back at the
// POS: its meal is "not rung up" again (the agreed price counts again) and the
// POS is told, which reopens that bill there to be corrected and charged to
// the event again — it then arrives as a NEW line. The void never waits on
// the POS: if it can't be told, the line is voided anyway and the event shows
// "POS not told" with a button to try again. → { pos: { told, error } | null }
async function voidCharge(propertyId, id, chargeId, body, user) {
  const reason = clean(body?.reason, 500);
  if (!reason) throw new EventError(400, 'A reason is required', { code: 'REASON_REQUIRED' });
  const line = await tx(async client => {
    await lockOpen(client, propertyId, id);
    const { rows: [c] } = await client.query('SELECT * FROM event_charges WHERE id = $1 AND event_id = $2 FOR UPDATE', [chargeId, id]);
    if (!c) throw new EventError(404, 'Line not found');
    if (c.is_voided) throw new EventError(409, 'This line is already voided');
    await client.query('UPDATE event_charges SET is_voided = true, void_reason = $1, voided_by = $2, voided_at = NOW() WHERE id = $3', [reason, user.id, chargeId]);
    if (c.type === 'pos' && c.meal_id) {
      // no other live restaurant bill for that meal → it is to be rung up again
      await client.query(
        `UPDATE event_meals SET status = 'open', done_by = NULL, done_at = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'done'
           AND NOT EXISTS (SELECT 1 FROM event_charges x WHERE x.meal_id = $1 AND x.type = 'pos' AND NOT x.is_voided)`, [c.meal_id]);
    }
    await log(client, id, `Line voided: ${c.description} — ${fmtIDR(c.shown_total ?? c.amount)}${c.type === 'pos' ? ' (restaurant bill)' : ''}. Reason: ${reason}`, user.id);
    return c;
  });
  if (line.type !== 'pos' || !line.external_ref) return { pos: null };
  return { pos: await tellPosAboutVoid(propertyId, id, line, { reason, by: user?.name || null, userId: user?.id }) };
}

// Tells the POS that a restaurant line of an event was voided and records the
// result on the line. Used by the void itself and by "Tell the POS" later.
async function tellPosAboutVoid(propertyId, eventId, line, { reason, by, userId }) {
  const r = await require('./posRoomOrders').tellPosVoidRef(propertyId, line.external_ref, { reason, by });
  await db.query(
    `UPDATE event_charges SET pos_void_sent_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE pos_void_sent_at END, pos_void_error = $2 WHERE id = $1`,
    [line.id, r.error]);
  await log(db, eventId, r.told
    ? `The POS was told: it reopened the bill "${line.description}" to be corrected and charged again`
    : `The POS could NOT be told about the voided bill "${line.description}" (${r.error}) — tell the restaurant, or press Tell the POS`, userId || null);
  return r;
}

// "Tell the POS" on a voided restaurant line that the POS has not heard about.
async function tellPos(propertyId, id, chargeId, user) {
  const { rows: [c] } = await db.query(
    `SELECT c.* FROM event_charges c JOIN events e ON e.id = c.event_id
     WHERE c.id = $1 AND c.event_id = $2 AND e.property_id = $3`, [chargeId, id, propertyId]);
  if (!c) throw new EventError(404, 'Line not found');
  if (c.type !== 'pos' || !c.external_ref) throw new EventError(400, 'This line is not a restaurant bill');
  if (!c.is_voided) throw new EventError(409, 'This line is not voided');
  if (c.pos_void_sent_at) return { told: true, already: true };
  return tellPosAboutVoid(propertyId, id, c, { reason: c.void_reason, by: user?.name || null, userId: user?.id });
}

// ── Meals for the restaurant ─────────────────────────────────────
function mealValues(e, body, cur = null) {
  const pick = k => (body[k] !== undefined ? body[k] : cur?.[k]);
  const kind = pick('kind');
  if (!MEAL_KINDS[kind]) throw new EventError(400, 'Choose what it is (coffee break, lunch, dinner…)');
  const date = ymd(pick('service_date')) || e.event_date;
  if (!validDate(date) || date < e.event_date || date > e.end_date) throw new EventError(400, 'The meal must be on a day of the event');
  const time = hhmm(pick('service_time')) || null;
  if (time && !TIME_RE.test(time)) throw new EventError(400, 'Time: use HH:MM');
  const pax = parseInt(pick('pax') ?? e.pax, 10);
  if (!(pax >= 1)) throw new EventError(400, 'For how many people?');
  const note = clean(pick('note'), 1000);
  if (kind === 'other' && !note) throw new EventError(400, 'Say what is wanted');
  // Agreed price per person (optional), typed the way the property types
  // prices. Empty = no price agreed here (the restaurant's bill decides).
  let unit = cur?.unit_price ?? null, shown = cur?.shown_price ?? null;
  if (body.price !== undefined) {
    if (body.price === '' || body.price === null) { unit = null; shown = null; }
    else {
      const p = priceOf(e, body.price);
      if (!(p.net > 0)) throw new EventError(400, 'Enter the price per person, or leave it empty');
      unit = p.net; shown = p.shown;
    }
  }
  return { kind, date, time, pax, note, unit, shown };
}
const mealText = m => `${MEAL_KINDS[m.kind]} ${ymd(m.date || m.service_date)}${m.time || m.service_time ? ' ' + hhmm(m.time || m.service_time) : ''}, ${m.pax} people${m.note ? ` — ${m.note}` : ''}`;
// for the history: with the agreed price per person
const mealPriceText = m => {
  const p = m.shown ?? m.unit ?? m.shown_price ?? m.unit_price;
  return p == null ? '' : ` · ${fmtIDR(p)} per person`;
};

async function addMeal(propertyId, id, body, user) {
  const { e, text } = await tx(async client => {
    const ev = await lockOpen(client, propertyId, id);
    if (ev.status === 'cancelled') throw new EventError(409, 'This event is cancelled');
    const m = mealValues(ev, body);
    await client.query(
      `INSERT INTO event_meals (property_id, event_id, kind, service_date, service_time, pax, note, unit_price, shown_price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [propertyId, id, m.kind, m.date, m.time, m.pax, m.note, m.unit, m.shown, user.id]);
    await log(client, id, `Meal added: ${mealText(m)}${mealPriceText(m)}`, user.id);
    return { e: ev, text: mealText(m) };
  });
  if (e.status === 'confirmed') alertEvent(propertyId, 'meal', await getEvent(propertyId, id), user, `Added: ${text}`);
}

async function updateMeal(propertyId, id, mealId, body, user) {
  const { e, text } = await tx(async client => {
    const ev = await lockOpen(client, propertyId, id);
    const { rows: [cur] } = await client.query('SELECT * FROM event_meals WHERE id = $1 AND event_id = $2 FOR UPDATE', [mealId, id]);
    if (!cur) throw new EventError(404, 'Meal not found');
    if (cur.status !== 'open') throw new EventError(409, cur.status === 'done' ? 'The restaurant has already handled this meal' : 'This meal is cancelled');
    const m = mealValues(ev, body, { ...cur, service_date: ymd(cur.service_date), service_time: hhmm(cur.service_time) });
    await client.query(
      'UPDATE event_meals SET kind = $1, service_date = $2, service_time = $3, pax = $4, note = $5, unit_price = $6, shown_price = $7, updated_at = NOW() WHERE id = $8',
      [m.kind, m.date, m.time, m.pax, m.note, m.unit, m.shown, mealId]);
    await log(client, id, `Meal changed: ${mealText(cur)}${mealPriceText(cur)} → ${mealText(m)}${mealPriceText(m)}`, user.id);
    return { e: ev, text: `${mealText(cur)} → ${mealText(m)}` };
  });
  if (e.status === 'confirmed') alertEvent(propertyId, 'meal', await getEvent(propertyId, id), user, `Changed: ${text}`);
}

async function cancelMeal(propertyId, id, mealId, user) {
  const { e, text } = await tx(async client => {
    const ev = await lockOpen(client, propertyId, id);
    const { rows: [cur] } = await client.query('SELECT * FROM event_meals WHERE id = $1 AND event_id = $2 FOR UPDATE', [mealId, id]);
    if (!cur) throw new EventError(404, 'Meal not found');
    if (cur.status !== 'open') throw new EventError(409, cur.status === 'done' ? 'The restaurant has already handled this meal' : 'This meal is already cancelled');
    await client.query("UPDATE event_meals SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [mealId]);
    await log(client, id, `Meal cancelled: ${mealText(cur)}`, user.id);
    return { e: ev, text: mealText(cur) };
  });
  if (e.status === 'confirmed') alertEvent(propertyId, 'meal', await getEvent(propertyId, id), user, `Cancelled: ${text}`);
}

// ── Payments (the shape of services/groupBilling.js) ─────────────
async function methodOf(client, propertyId, method) {
  if (!method) throw new EventError(400, 'Payment method required');
  const { rows: [pm] } = await client.query(
    "SELECT id, label FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true AND id <> 'ota_managed'", [method, propertyId]);
  if (!pm) throw new EventError(400, 'Unknown payment method');
  return pm;
}

async function recordPayment(propertyId, id, body, user) {
  return tx(async client => {
    const e = await lockOpen(client, propertyId, id);
    if (e.status === 'cancelled') throw new EventError(409, 'This event is cancelled');
    const amt = round2(parseFloat(body.amount));
    if (!(amt > 0)) throw new EventError(400, 'Enter the amount received');
    const pm = await methodOf(client, propertyId, body.method);
    const { rows: [p] } = await client.query(
      `INSERT INTO event_payments (property_id, event_id, amount, method, received_at, received_by, reference, notes)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7, $8) RETURNING id, reference`,
      [propertyId, id, amt, pm.id, body.received_at || null, user.id, clean(body.reference, 120), clean(body.notes, 1000)]);
    await log(client, id, `Payment received: ${fmtIDR(amt)} by ${pm.label}${p.reference ? ` (ref ${p.reference})` : ''}.`, user.id);
    return p.id;
  });
}

async function voidPayment(propertyId, id, paymentId, body, user) {
  const reason = clean(body?.reason, 500);
  if (!reason) throw new EventError(400, 'A reason is required', { code: 'REASON_REQUIRED' });
  return tx(async client => {
    await lockOpen(client, propertyId, id);
    const { rows: [p] } = await client.query(
      `SELECT p.*, COALESCE(pm.label, p.method) AS method_label FROM event_payments p
       LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id
       WHERE p.id = $1 AND p.event_id = $2 FOR UPDATE OF p`, [paymentId, id]);
    if (!p) throw new EventError(404, 'Payment not found');
    if (p.is_voided) throw new EventError(409, 'This payment is already voided');
    await client.query('UPDATE event_payments SET is_voided = true, void_reason = $1, voided_by = $2, voided_at = NOW() WHERE id = $3', [reason, user.id, paymentId]);
    await log(client, id, `${p.is_refund ? 'Refund' : 'Payment'} voided: ${fmtIDR(Math.abs(p.amount))} by ${p.method_label}. Reason: ${reason}`, user.id);
    return true;
  });
}

// What can be given back: what was received beyond the bill (everything
// received once the event is cancelled).
async function refundable(propertyId, id) {
  const bill = await eventBill(propertyId, id);
  if (!bill) return null;
  const owed = bill.event.status === 'cancelled' ? 0 : bill.expected_total;
  return { refundable: Math.max(0, round2(bill.received - owed)), received: bill.received, bill: owed };
}

async function refund(propertyId, id, body, user) {
  const reason = clean(body?.reason, 500);
  if (!reason) throw new EventError(400, 'A reason is required', { code: 'REASON_REQUIRED' });
  const amt = round2(parseFloat(body.amount));
  if (!(amt > 0)) throw new EventError(400, 'Enter the amount given back');
  const can = await refundable(propertyId, id);
  if (!can) throw new EventError(404, 'Event not found');
  if (amt > can.refundable + 0.05) {
    throw new EventError(409, can.refundable > 0 ? `Only ${fmtIDR(can.refundable)} can be refunded — that is the event's credit`
      : 'This event has no credit to refund. If its bill is wrong, correct the lines first, or cancel the event.', { code: 'OVER_CREDIT', refundable: can.refundable });
  }
  return tx(async client => {
    await lockOpen(client, propertyId, id);
    const pm = await methodOf(client, propertyId, body.method);
    await client.query(
      `INSERT INTO event_payments (property_id, event_id, amount, method, received_at, received_by, reference, notes, is_refund)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7, $8, true)`,
      [propertyId, id, -amt, pm.id, body.refunded_at || null, user.id, clean(body.reference, 120), `Refund: ${reason}`.slice(0, 500)]);
    await log(client, id, `Refund: ${fmtIDR(amt)} given back by ${pm.label}. Reason: ${reason}`, user.id);
    return true;
  });
}

// ── Telegram (free alert `alert_event`) ──────────────────────────
// Sent for confirmed events only — what the kitchen / housekeeping act on.
function alertEvent(propertyId, what, e, user, extra) {
  (async () => {
    const meals = (await listMeals(e.id)).filter(m => m.status !== 'cancelled');
    const head = { confirmed: '🗓 Event confirmed', changed: '✏️ Event changed', cancelled: '❌ Event cancelled', unconfirmed: '⏸ Event no longer confirmed', meal: '🍽 Event meals changed' }[what];
    const lines = [
      `${head} — #${e.event_no} ${e.name}`,
      `${e.venue_name} · ${whenText(e)} · ${e.pax} people`,
      e.customer ? `For: ${e.customer}` : null,
      extra ? (what === 'cancelled' || what === 'unconfirmed' ? `Reason: ${extra}` : extra) : null,
      what !== 'cancelled' && meals.length ? 'Meals:\n' + meals.map(m => `• ${mealText(m)}`).join('\n') : null,
      what !== 'cancelled' && what !== 'meal' && e.notes ? `Notes: ${e.notes}` : null,
      user?.name ? `By ${user.name}` : null,
    ].filter(Boolean);
    await require('./telegramService').sendAlert(propertyId, 'alert_event', lines.join('\n'));
  })().catch(() => {});
}

// ── For the POS (routes/posIntegration.js) ───────────────────────
// Confirmed events touching [from, to] with the meals to prepare — what the
// restaurant sees on its side. No prices.
async function posEvents(propertyId, from, to) {
  const { rows } = await db.query(
    `${SELECT} WHERE e.property_id = $1 AND e.status = 'confirmed' AND e.end_date >= $2::date AND e.event_date <= $3::date
     ORDER BY e.event_date, e.start_time`, [propertyId, from, to]);
  if (!rows.length) return [];
  const { rows: meals } = await db.query(
    `SELECT * FROM event_meals WHERE event_id = ANY($1) AND status <> 'cancelled'
     ORDER BY service_date, service_time NULLS LAST, created_at`, [rows.map(r => r.id)]);
  const { rows: chargedRows } = await db.query(
    `SELECT DISTINCT meal_id FROM event_charges WHERE event_id = ANY($1) AND type = 'pos' AND NOT is_voided AND meal_id IS NOT NULL`, [rows.map(r => r.id)]);
  const charged = new Set(chargedRows.map(r => r.meal_id));
  return rows.map(shape).map(e => ({
    event_id: e.id, event_no: e.event_no, name: e.name, company: e.customer || null, venue: e.venue_name,
    date: e.event_date, end_date: e.end_date, start_time: e.start_time, end_time: e.end_time, pax: e.pax, notes: e.notes || '',
    meals: meals.filter(m => m.event_id === e.id).map(m => {
      const q = mealQuote(e, m);
      return {
        id: m.id, kind: m.kind, label: MEAL_KINDS[m.kind], service_date: ymd(m.service_date), service_time: hhmm(m.service_time),
        pax: m.pax, note: m.note || '', status: m.status, done_by: m.done_by, done_at: m.done_at,
        // agreed with the client (what they pay, incl. service & tax): ring the meal up at this amount. null = no price agreed.
        agreed_per_person: q ? round2(q.total / (parseInt(m.pax, 10) || 1)) : null, agreed_total: q ? q.total : null,
        charged: charged.has(m.id),
      };
    }),
  }));
}

// The restaurant handled a meal (or undid that).
async function posMealStatus(propertyId, mealId, status, by) {
  if (!['done', 'open'].includes(status)) throw new EventError(400, 'status must be done or open');
  if (!/^[0-9a-f-]{36}$/i.test(String(mealId))) throw new EventError(404, 'Meal not found');
  return tx(async client => {
    const { rows: [m] } = await client.query('SELECT * FROM event_meals WHERE id = $1 AND property_id = $2 FOR UPDATE', [mealId, propertyId]);
    if (!m || m.status === 'cancelled') throw new EventError(404, 'Meal not found');
    const who = clean(by, 100);
    await client.query(
      'UPDATE event_meals SET status = $1, done_by = $2, done_at = $3, updated_at = NOW() WHERE id = $4',
      [status, status === 'done' ? who : null, status === 'done' ? new Date() : null, mealId]);
    if (m.status !== status) {
      await log(client, m.event_id, status === 'done'
        ? `Restaurant handled: ${mealText(m)}${who ? ` (${who}, POS)` : ' (POS)'}`
        : `Restaurant reopened: ${mealText(m)}${who ? ` (${who}, POS)` : ' (POS)'}`, null);
    }
    return { id: mealId, event_id: m.event_id, status };
  });
}

// A restaurant bill charged to an event: one 'pos' line on its bill. `amount`
// is NET; or `grossAmount` = what the client pays, turned to NET at the
// event's own rates. Safe to retry with the same externalRef (replayed: true).
async function posCharge(propertyId, { eventId, mealId, amount, grossAmount, description, externalRef }) {
  const gross = grossAmount != null && grossAmount !== '' ? Number(grossAmount) : null;
  if (gross != null && (!Number.isFinite(gross) || gross <= 0)) throw new EventError(400, 'gross_amount must be a positive number');
  if (gross == null && !(Number(amount) > 0)) throw new EventError(400, 'amount must be a positive number');
  const ref = clean(externalRef, 100);
  const desc = clean(description, 300) || 'Restaurant bill';
  const result = async (c, replayed) => {
    const bill = await eventBill(propertyId, c.event_id);
    return { event_charge_id: c.id, event_id: c.event_id, amount: parseFloat(c.amount),
      gross_amount: c.shown_total != null ? parseFloat(c.shown_total) : null, balance_due: bill.balance_due, replayed };
  };
  const existing = async client => (ref
    ? (await client.query('SELECT * FROM event_charges WHERE property_id = $1 AND external_ref = $2', [propertyId, ref])).rows[0] : null);
  try {
    const row = await tx(async client => {
      const again = await existing(client);
      if (again) return { again };
      if (!/^[0-9a-f-]{36}$/i.test(String(eventId))) throw new EventError(404, 'Event not found');
      const { rows: [raw] } = await client.query('SELECT * FROM events WHERE id = $1 AND property_id = $2 FOR UPDATE', [eventId, propertyId]);
      if (!raw) throw new EventError(404, 'Event not found');
      const e = shape(raw);
      if (e.status !== 'confirmed') throw new EventError(409, 'This event is not confirmed — a bill cannot be charged to it', { code: 'NOT_CONFIRMED' });
      let meal = null;
      if (mealId) {
        ({ rows: [meal] } = await client.query('SELECT * FROM event_meals WHERE id = $1 AND event_id = $2', [mealId, e.id]));
        if (!meal) throw new EventError(404, 'Meal not found on this event');
      }
      let net, shownTotal = null;
      if (gross != null) {
        const g = round2(gross);
        const b = basisFrom({ tax_rate: e.bill_tax_rate, service_charge_rate: e.bill_service_charge_rate, prices_include_tax: true });
        net = fitToGross(round2(g / b.F), 0, g, b.tax_rate, b.service_charge_rate);
        shownTotal = g;
      } else {
        net = round2(Number(amount));
      }
      // the day it belongs to: the meal's, else today (never outside the event)
      const today = todayWITA();
      const day = meal ? ymd(meal.service_date) : today < e.event_date ? e.event_date : today > e.end_date ? e.end_date : today;
      const { rows: [c] } = await client.query(
        `INSERT INTO event_charges (property_id, event_id, type, description, service_date, quantity, unit_price, amount, shown_total, external_ref, meal_id)
         VALUES ($1, $2, 'pos', $3, $4, 1, $5, $5, $6, $7, $8) RETURNING *`,
        [propertyId, e.id, desc, day, net, shownTotal, ref, meal ? meal.id : null]);
      if (meal && meal.status === 'open') {
        await client.query("UPDATE event_meals SET status = 'done', done_by = 'POS', done_at = NOW(), updated_at = NOW() WHERE id = $1", [meal.id]);
      }
      await log(client, e.id, `Restaurant bill charged to the event: ${desc} — ${fmtIDR(shownTotal ?? net)}${shownTotal == null ? ' net' : ''}${ref ? ` (POS ${ref})` : ''}`, null);
      return { c };
    });
    return row.again ? result(row.again, true) : result(row.c, false);
  } catch (err) {
    // two retries at once: the loser hits the unique index — answer with the winner's line
    if (err.code === '23505' && ref) {
      const again = await existing(db);
      if (again) return result(again, true);
    }
    throw err;
  }
}

module.exports = {
  EventError, STATUSES, MEAL_KINDS, whenText, posEvents, posMealStatus, posCharge,
  listVenues, saveVenue, list, getEvent, detail, eventBill, listMeals, linkedGroup,
  create, update, setStatus, addCharge, voidCharge, tellPos, addMeal, updateMeal, cancelMeal,
  recordPayment, voidPayment, refundable, refund, priceOf, log, tx,
};
