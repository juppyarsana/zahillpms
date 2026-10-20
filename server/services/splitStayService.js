// A stay split over two rooms (migration 118) — Change Room "from a later
// night". The booking keeps its room up to that night; a new booking (same
// guest, same group, same everything) takes the rest of the stay in the new
// room. The price is shared by night (the booking's own night prices when it
// has them, the meal plan evenly), the money received for the moved nights
// goes with them — same date, method, reference and recorded-at time, so no
// day's money changes — and any price difference for the new room is added
// to the new booking exactly as Change Room adds it.
//
// FO used to do this by shortening the booking and adding another room; the
// money then stayed on the first room as a "credit to refund" and the new
// room looked unpaid (Tim Walker group, 2026-10-20).

const { stayNights, computeFolioTotals, round2 } = require('./folioService');
const nightRates = require('./nightRates');
const roomCharge = require('./roomChargeService');
const { recomputeBookingStatus } = require('./paymentStatusService');
const { applyBookingPrice } = require('./bookingPriceService');

const ymd = d => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const whole = n => Math.round(n);

// The two parts' figures. Each part: dates, nights, NET room / meal revenue,
// its share of the stored price (total) and discount, and what it costs the
// guest (payable = total − discount).
async function splitParts(client, booking, fromDate) {
  const ci = ymd(booking.check_in_date), co = ymd(booking.check_out_date);
  const nights = stayNights(ci, co);
  const idx = nights.indexOf(fromDate);
  if (idx < 1) return { error: 'Choose a night after the first night and before check-out' };

  const rates = await nightRates.loadNightRates(client, booking.id);
  const roomTotal = parseFloat(booking.room_revenue ?? booking.total_amount) || 0;
  const fnbTotal = parseFloat(booking.fnb_revenue || 0);
  const roomParts = nightRates.roomNightAmounts(roomTotal, nights, rates);
  const roomA = round2(roomParts.slice(0, idx).reduce((s, v) => s + v, 0));
  const fnbA = round2(fnbTotal * idx / nights.length);
  const netAll = roomTotal + fnbTotal;
  const share = netAll > 0 ? (roomA + fnbA) / netAll : idx / nights.length;

  const total = parseFloat(booking.total_amount) || 0;
  const discount = parseFloat(booking.discount_amount || 0);
  // Whole rupiah for the price as FO sees it; the second part takes the rest.
  const totalA = whole(total * share), discA = whole(discount * share);
  const part = (o) => ({ ...o, payable: round2(o.total - o.discount) });
  return {
    nights, idx,
    a: part({ check_in: ci, check_out: fromDate, nights: idx, room: roomA, fnb: fnbA, total: totalA, discount: discA }),
    b: part({
      check_in: fromDate, check_out: co, nights: nights.length - idx,
      room: round2(roomTotal - roomA), fnb: round2(fnbTotal - fnbA),
      total: round2(total - totalA), discount: round2(discount - discA),
    }),
  };
}

// The booking as the second part would be, for pricing the new room with
// Change Room's own quote (it then prices exactly those nights).
function secondPartBooking(booking, parts) {
  return {
    ...booking,
    check_in_date: parts.b.check_in, check_out_date: parts.b.check_out, nights: parts.b.nights,
    total_amount: parts.b.total, discount_amount: parts.b.discount,
    room_revenue: parts.b.room, fnb_revenue: parts.b.fnb,
    status: 'confirmed',
  };
}

// Money received on the booking: what stays (up to the first part's price)
// and what moves with the nights.
async function moneySplit(client, bookingId, aPayable) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS received FROM payments
     WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'received'`, [bookingId]);
  const received = round2(rows[0].received);
  const stays = round2(Math.min(received, aPayable));
  return { received, stays, moves: round2(received - stays) };
}

// Quote for the window: Change Room's quote for the new room over the moved
// nights, plus how the stay and its money are shared.
async function quote(client, { booking, fromDate, targetUnitId, changeRoomQuote, propertyId }) {
  const parts = await splitParts(client, booking, fromDate);
  if (parts.error) return parts;
  const q = await changeRoomQuote(client, { propertyId, booking: secondPartBooking(booking, parts), targetUnitId });
  if (!q) return null;
  const money = await moneySplit(client, booking.id, parts.a.payable);
  return { ...q, split: { from: fromDate, a: parts.a, b: parts.b, money } };
}

async function insertSecondPart(client, before, overrides) {
  const { rows: cols } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bookings' AND table_schema = current_schema()
      AND is_generated = 'NEVER' AND column_name NOT IN ('id')`);
  const names = [], exprs = [], params = [before.id];
  for (const { column_name: c } of cols) {
    names.push(c);
    if (Object.prototype.hasOwnProperty.call(overrides, c)) {
      params.push(overrides[c]);
      exprs.push(`$${params.length}`);
    } else {
      exprs.push(c);
    }
  }
  const { rows: [row] } = await client.query(
    `INSERT INTO bookings (${names.join(', ')}) SELECT ${exprs.join(', ')} FROM bookings WHERE id = $1 RETURNING *`, params);
  return row;
}

// Received room payments of `fromId` worth `amount` move to `toId`, newest
// first; a payment bigger than what is left is cut in two (the cut keeps
// every detail of the original, incl. when it was recorded).
async function moveReceived(client, fromId, toId, amount, note) {
  let left = round2(amount);
  const { rows } = await client.query(
    `SELECT * FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'received'
     ORDER BY created_at DESC, id DESC FOR UPDATE`, [fromId]);
  for (const p of rows) {
    if (left <= 0.005) break;
    const amt = parseFloat(p.amount);
    const notes = [p.notes, note].filter(Boolean).join(' · ').slice(0, 1000);
    if (amt <= left + 0.005) {
      await client.query('UPDATE payments SET booking_id = $1, notes = $2 WHERE id = $3', [toId, notes, p.id]);
      left = round2(left - amt);
    } else {
      await client.query('UPDATE payments SET amount = amount - $1 WHERE id = $2', [left, p.id]);
      const { rows: [made] } = await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, reference, notes)
         VALUES ($1, $2, $3, 'received', $4, $5, $6, $7, $8) RETURNING id`,
        [toId, p.type, left, p.method, p.received_at, p.received_by, p.reference, notes]);
      // The trigger stamped "recorded now"; keep the original's time.
      await client.query('UPDATE payments SET recorded_at = $1 WHERE id = $2', [p.recorded_at, made.id]);
      left = 0;
    }
  }
}

// Unpaid lines of a part = its price − what it has received (a pending
// deposit stays a deposit, up to what is still owed).
async function reshapePending(client, bookingId, payable, keptPendingDeposit) {
  await client.query(
    `DELETE FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'pending'`, [bookingId]);
  const { rows: [{ received }] } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS received FROM payments
     WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'received'`, [bookingId]);
  const owed = round2(payable - received);
  if (owed <= 0.005) return;
  const dep = round2(Math.min(keptPendingDeposit || 0, owed));
  if (dep > 0.005) await client.query(`INSERT INTO payments (booking_id, type, amount) VALUES ($1, 'deposit', $2)`, [bookingId, dep]);
  if (owed - dep > 0.005) await client.query(`INSERT INTO payments (booking_id, type, amount) VALUES ($1, 'balance', $2)`, [bookingId, round2(owed - dep)]);
}

async function syncDepositAmount(client, bookingId) {
  await client.query(`
    UPDATE bookings SET deposit_amount = COALESCE((SELECT SUM(amount) FROM payments
      WHERE booking_id = $1 AND type = 'deposit' AND status IN ('pending', 'received')), 0) WHERE id = $1`, [bookingId]);
}

// Does the split. `before` = the booking row (locked), `amount` = the price
// difference for the new room (already chosen: difference / complimentary /
// custom), `q` = the quote. Returns { a, b, moved } or { status, error }.
async function apply(client, { propertyId, before, unitId, fromDate, userId, amount, parts, q, labels, reason }) {
  const fail = (status, error, code) => ({ status, error: { error, ...(code ? { code } : {}) } });

  const { rows: addons } = await client.query(
    `SELECT 1 FROM booking_addons WHERE booking_id = $1 AND status = 'active' AND service_date >= $2 LIMIT 1`,
    [before.id, fromDate]);
  if (addons.length) {
    return fail(409, `This stay has extras (e.g. an extra bed) on ${fromDate} or later — remove those nights first and add them on the new room afterwards`, 'HAS_EXTRAS');
  }

  const { rows: [groupBilled] } = await client.query(
    'SELECT 1 FROM reservation_groups WHERE id = $1 AND group_billing', [before.reservation_group_id || null]);
  const { rows: [{ dep: pendingDeposit }] } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS dep FROM payments WHERE booking_id = $1 AND type = 'deposit' AND status = 'pending'`,
    [before.id]);
  const money = await moneySplit(client, before.id, parts.a.payable);

  const fixed = before.discount_type !== 'percentage';
  const b = await insertSecondPart(client, before, {
    unit_id: unitId,
    check_in_date: parts.b.check_in, check_out_date: parts.b.check_out,
    total_amount: parts.b.total, discount_amount: parts.b.discount,
    discount_value: parts.b.discount > 0 && fixed ? parts.b.discount : before.discount_value,
    room_revenue: parts.b.room, fnb_revenue: parts.b.fnb,
    deposit_amount: 0,
    status: before.status === 'checked_in' ? 'confirmed' : before.status,
    folio_status: null, agent_invoice_id: null,
    to_check: null, to_check_done_at: null, to_check_done_by: null,
    split_from_booking_id: before.id,
    created_by: userId, created_at: new Date(), updated_at: new Date(),
  });
  const { rows: [a] } = await client.query(`
    UPDATE bookings SET check_out_date = $1, total_amount = $2, discount_amount = $3, discount_value = $4,
           room_revenue = $5, fnb_revenue = $6, updated_at = NOW()
    WHERE id = $7 RETURNING *`,
    [parts.a.check_out, parts.a.total, parts.a.discount,
     parts.a.discount > 0 && fixed ? parts.a.discount : before.discount_value,
     parts.a.room, parts.a.fnb, before.id]);

  // What belongs to the moved nights goes with them.
  await client.query('UPDATE booking_night_rates SET booking_id = $1 WHERE booking_id = $2 AND night >= $3', [b.id, a.id, fromDate]);
  await client.query(
    `UPDATE restaurant_requests SET booking_id = $1 WHERE booking_id = $2 AND service_date >= $3 AND status = 'open'`,
    [b.id, a.id, fromDate]);
  await client.query(
    `INSERT INTO booking_guests (property_id, booking_id, guest_id, created_by)
     SELECT property_id, $1, guest_id, created_by FROM booking_guests WHERE booking_id = $2
     ON CONFLICT DO NOTHING`, [b.id, a.id]);

  if (!groupBilled) {
    if (money.moves > 0.005) {
      await moveReceived(client, a.id, b.id, money.moves, `Moved with the nights from ${fromDate} to room ${labels.to}`);
    }
    await reshapePending(client, a.id, parts.a.payable, pendingDeposit);
    await reshapePending(client, b.id, parts.b.payable, 0);
    await syncDepositAmount(client, a.id);
    await syncDepositAmount(client, b.id);
  } else {
    await client.query('UPDATE bookings SET deposit_amount = 0 WHERE id = ANY($1)', [[a.id, b.id]]);
  }

  await roomCharge.repostStay(client, a, userId);

  let priced = null;
  if (amount !== 0) {
    const { rows: [bRow] } = await client.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
    priced = await applyBookingPrice(client, {
      propertyId, before: bRow, userId,
      newTotal: Math.max(0, round2(parts.b.total + amount)),
      keepDiscount: true, receivedWasTypo: false,
      balanceNote: `Room change ${labels.from} → ${labels.to} — additional amount due`,
    });
    if (priced.error) return { status: priced.status, error: priced.error };
  }

  await recomputeBookingStatus(client, a.id);
  await recomputeBookingStatus(client, b.id);
  const { rows: [aAfter] } = await client.query('SELECT * FROM bookings WHERE id = $1', [a.id]);
  const { rows: [bAfter] } = await client.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
  return { a: aAfter, b: bAfter, money, priced };
}

module.exports = { splitParts, secondPartBooking, moneySplit, quote, apply };
