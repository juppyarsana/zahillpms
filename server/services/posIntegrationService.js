const db = require('../db');
const { computeProforma } = require('./folioService');

// External POS integration (migration 070). The POS owns its menu, recipes,
// stock and cash/card payments; the PMS only hears about sales a guest charges
// to their room. Each one becomes a `sales` row (order_source 'external_pos',
// no sale_items — the POS menu is never mirrored into `products`) plus a
// folio_charges row, the same pair restoSettleService posts for a resto tab.
//
// `amount` is NET: after the POS's own discount, before service charge and
// tax — the folio adds the property's service/tax on top of every charge, so
// a gross amount would be taxed twice. A POS whose menu prices include tax
// sends `gross_amount` instead (what the guest pays, all-in): the PMS takes
// its own service + tax out (priceBasis factor, nudged to the cent so the
// folio shows exactly that figure) and posts the NET part. An older PMS
// refuses a gross-only charge (no `amount`) rather than taxing it twice.

const IN_HOUSE_SQL = `
  SELECT b.id AS booking_id, u.name AS room, u.controller_id AS room_id,
         g.name AS guest_name, b.check_in_date, b.check_out_date, b.num_guests
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN guests g ON g.id = b.guest_id
   WHERE b.property_id = $1 AND b.status = 'checked_in'`;

async function listInHouseRooms(propertyId) {
  const { rows } = await db.query(`${IN_HOUSE_SQL} ORDER BY u.name`, [propertyId]);
  return rows;
}

// A till types a room number: match the room name or its Room ID, any case.
async function lookupRoom(propertyId, room) {
  const { rows } = await db.query(
    `${IN_HOUSE_SQL}
       AND (lower(u.name) = lower($2) OR lower(u.controller_id) = lower($2))
     ORDER BY b.check_in_date DESC LIMIT 1`,
    [propertyId, String(room).trim()]
  );
  return rows[0] || null;
}

// balance_due is the whole-stay estimate (all nights + extras + service/tax −
// payments), same figure as the Balance Due page — the posted ledger leaves
// out nights night audit hasn't posted yet, so it can read low or negative.
async function estimateFor(bookingId, propertyId) {
  return bookingId ? computeProforma(bookingId, propertyId) : null;
}

function saleResult(sale, folioChargeId, folio, replayed) {
  return {
    sale_id: sale.id,
    folio_charge_id: folioChargeId,
    booking_id: sale.booking_id,
    amount: parseFloat(sale.total_amount),
    gross_amount: sale.shown_total != null ? parseFloat(sale.shown_total) : null,
    balance_due: folio ? folio.balance_due : null,
    replayed,
  };
}

// Returns { error, status } or the posted sale. Safe to retry with the same
// externalRef: the original sale comes back with replayed: true.
// All-in amount → NET at the property's rates (service, then tax on top).
async function netFromGross(propertyId, gross) {
  const { priceBasis } = require('./priceBasis');
  const { fitToGross } = require('./bookingPriceService');
  const { round2 } = require('./folioService');
  const b = await priceBasis(propertyId);
  const g = round2(gross);
  return fitToGross(round2(g / b.F), 0, g, b.tax_rate, b.service_charge_rate);
}

async function postTransaction(propertyId, { bookingId, room, amount, grossAmount, description, externalRef }) {
  const gross = grossAmount != null && grossAmount !== '' ? Number(grossAmount) : null;
  if (gross != null && (!Number.isFinite(gross) || gross <= 0)) return { error: 'gross_amount must be a positive number', status: 400 };
  const amt = gross != null ? await netFromGross(propertyId, gross) : Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'amount must be a positive number', status: 400 };
  const desc = String(description || '').trim().slice(0, 500) || 'Restaurant bill';
  const ref = externalRef ? String(externalRef).trim().slice(0, 100) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if (ref) {
      const { rows: [existing] } = await client.query(
        `SELECT s.*, fc.id AS folio_charge_id
           FROM sales s LEFT JOIN folio_charges fc ON fc.sale_id = s.id
          WHERE s.property_id = $1 AND s.external_ref = $2 LIMIT 1`,
        [propertyId, ref]
      );
      if (existing) {
        await client.query('ROLLBACK');
        const folio = await estimateFor(existing.booking_id, propertyId);
        return saleResult(existing, existing.folio_charge_id, folio, true);
      }
    }

    // Resolve the stay: an explicit booking_id (from the rooms list) or a
    // typed room number. Either way it must be checked in right now.
    let booking = null;
    if (bookingId) {
      const { rows } = await client.query(
        `SELECT id FROM bookings WHERE id = $1 AND property_id = $2 AND status = 'checked_in' FOR UPDATE`,
        [bookingId, propertyId]
      );
      booking = rows[0];
    } else if (room) {
      const found = await lookupRoom(propertyId, room);
      if (found) {
        const { rows } = await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [found.booking_id]);
        booking = rows[0];
      }
    } else {
      await client.query('ROLLBACK');
      return { error: 'room or booking_id is required', status: 400 };
    }
    if (!booking) {
      await client.query('ROLLBACK');
      return { error: 'No guest is checked in to that room', status: 404 };
    }

    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (property_id, booking_id, payment_method, total_amount, order_source, external_ref, description, shown_total)
       VALUES ($1, $2, 'room_charge', $3, 'external_pos', $4, $5, $6)
       RETURNING *`,
      [propertyId, booking.id, amt, ref, desc, gross != null ? Math.round(gross * 100) / 100 : null]
    );
    const { rows: [charge] } = await client.query(
      `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, sale_id)
       VALUES ($1, 'sale', $2, 1, $3, $3, $4) RETURNING id`,
      [booking.id, desc.slice(0, 200), amt, sale.id]
    );

    await client.query('COMMIT');
    const folio = await estimateFor(booking.id, propertyId);
    return saleResult(sale, charge.id, folio, false);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Two concurrent retries with the same ref: the loser hits the unique
    // index — return the winner's sale instead of an error.
    if (err.code === '23505' && ref) {
      return postTransaction(propertyId, { bookingId, room, amount, grossAmount, description, externalRef: ref });
    }
    throw err;
  } finally {
    client.release();
  }
}


// POS restaurant session (Breakfast / Lunch / Dinner) — POST /api/pos/sessions.
// pos_sessions holds the latest copy (keyed by business day + session); every
// send is also kept in pos_session_versions with what it changed (migration
// 087). outlet.net (bills paid at the restaurant, before service & tax) is what
// the reports add to F&B; room charges already reached the folio one by one.
const SESSION_KEYS = ['breakfast', 'lunch', 'dinner'];
const money2 = v => Math.round((Number(v) || 0) * 100) / 100;

// What a send changed against the previous one. Bills are matched by their POS
// id (bill_list — older POS builds didn't send it, then only totals compare).
function sessionChanges(prev, next) {
  if (!prev) return null;
  const out = { bills_added: [], bills_removed: [], bills_changed: [], totals: [] };
  const P = new Map((prev.bill_list || []).map(b => [b.id, b]));
  const N = new Map((next.bill_list || []).map(b => [b.id, b]));
  const brief = b => ({ id: b.id, total: money2(b.total), method: b.method, where: b.room ? `Room ${b.room}` : b.table || null });
  if (prev.bill_list && next.bill_list) {
    for (const [id, b] of N) if (!P.has(id)) out.bills_added.push(brief(b));
    for (const [id, b] of P) if (!N.has(id)) out.bills_removed.push(brief(b));
    for (const [id, b] of N) {
      const a = P.get(id);
      if (!a) continue;
      const what = [];
      if (money2(a.total) !== money2(b.total)) what.push({ field: 'total', from: money2(a.total), to: money2(b.total) });
      if (a.method !== b.method) what.push({ field: 'method', from: a.method, to: b.method });
      const items = x => (x.items || []).map(i => `${i.qty}× ${i.name}`).join(', ');
      if (items(a) !== items(b)) what.push({ field: 'items', from: items(a), to: items(b) });
      if (what.length) out.bills_changed.push({ ...brief(b), what });
    }
  }
  const tot = [['Bills', x => x.bills], ['Paid at the restaurant', x => money2(x.outlet?.total)],
    ['Before service & tax', x => money2(x.outlet?.net)], ['Charged to rooms', x => money2(x.room_charges?.total)],
    ['Breakfast came', x => (x.breakfast ? x.breakfast.pax_came : null)]];
  for (const [label, f] of tot) {
    const a = f(prev), b = f(next);
    if (a !== b && !(a == null && b == null)) out.totals.push({ label, from: a, to: b });
  }
  return out;
}

async function saveSession(propertyId, body) {
  const b = body || {};
  const date = String(b.business_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return { error: 'business_date must be YYYY-MM-DD', status: 400 };
  if (!SESSION_KEYS.includes(b.session)) return { error: 'session must be breakfast, lunch or dinner', status: 400 };
  if (b.bill_list != null && !Array.isArray(b.bill_list)) return { error: 'bill_list must be a list', status: 400 };
  const o = b.outlet || {};
  const money = v => { const n = Number(v ?? 0); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
  const outlet = { bills: parseInt(o.bills, 10) || 0, net: money(o.net), service: money(o.service), tax: money(o.tax), total: money(o.total) };
  if ([outlet.net, outlet.service, outlet.tax, outlet.total].some(n => !Number.isFinite(n) || n < 0)) {
    return { error: 'outlet amounts must be numbers ≥ 0', status: 400 };
  }
  const roomTotal = money(b.room_charges?.total);
  const bf = b.breakfast || null;
  const time = v => (v && !isNaN(Date.parse(v)) ? v : null);
  const sentBy = String(b.sent_by || '').slice(0, 100) || null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [prev] } = await client.query(
      `SELECT summary FROM pos_sessions WHERE property_id = $1 AND business_date = $2 AND session_key = $3 FOR UPDATE`,
      [propertyId, date, b.session]);
    const { rows: [row] } = await client.query(
      `INSERT INTO pos_sessions (property_id, business_date, session_key, label, started_at, ended_at,
          bills, outlet_bills, outlet_net, outlet_service, outlet_tax, outlet_total, room_charge_total,
          breakfast_pax_expected, breakfast_pax_came, summary, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (property_id, business_date, session_key) DO UPDATE SET
          label = EXCLUDED.label, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
          bills = EXCLUDED.bills, outlet_bills = EXCLUDED.outlet_bills, outlet_net = EXCLUDED.outlet_net,
          outlet_service = EXCLUDED.outlet_service, outlet_tax = EXCLUDED.outlet_tax, outlet_total = EXCLUDED.outlet_total,
          room_charge_total = EXCLUDED.room_charge_total,
          breakfast_pax_expected = EXCLUDED.breakfast_pax_expected, breakfast_pax_came = EXCLUDED.breakfast_pax_came,
          summary = EXCLUDED.summary, sent_by = EXCLUDED.sent_by,
          sent_at = NOW(), send_count = pos_sessions.send_count + 1
       RETURNING id, business_date, session_key, outlet_net, send_count, first_sent_at, sent_at`,
      [propertyId, date, b.session, String(b.label || '').slice(0, 30) || null, time(b.started_at), time(b.ended_at),
       parseInt(b.bills, 10) || 0, outlet.bills, outlet.net, outlet.service, outlet.tax, outlet.total,
       Number.isFinite(roomTotal) ? roomTotal : 0,
       bf ? parseInt(bf.pax_expected, 10) || 0 : null, bf ? parseInt(bf.pax_came, 10) || 0 : null,
       JSON.stringify(b), sentBy]);
    const changes = sessionChanges(prev?.summary, b);
    await client.query(
      `INSERT INTO pos_session_versions (session_id, property_id, version, summary, changes, sent_by)
       VALUES ($1, $2, COALESCE((SELECT MAX(version) FROM pos_session_versions WHERE session_id = $1), 0) + 1, $3, $4, $5)`,
      [row.id, propertyId, JSON.stringify(b), changes ? JSON.stringify(changes) : null, sentBy]);
    await client.query('COMMIT');
    return {
      id: row.id, business_date: date, session: row.session_key, outlet_net: parseFloat(row.outlet_net),
      replaced: row.send_count > 1, send_count: row.send_count,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

module.exports = { listInHouseRooms, lookupRoom, postTransaction, saveSession, sessionChanges };
