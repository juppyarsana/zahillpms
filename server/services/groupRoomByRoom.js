// A group billed as a whole (migration 097) → billed room by room.
//
// Why: a room whose agent pays the hotel later (city ledger, or an OTA that
// collects from the guest) is billed to that agent at check-out — but only
// what is unpaid on the ROOM's own folio. In a group billed as a whole the
// room money lives on the GROUP's bill, so check-out put nothing on the
// agent's bill and the money stayed owed by "the group" (Receivables showed
// the stay as "Paid before check-out"). New groups under a billed agent are
// already made room by room (bookingCreateService); the 2026-10-16 one-off
// (maintenance/groupBillingToAgent.js) switched the old ones but left groups
// with a room already checked out. This does the same switch for any group,
// before or after check-out:
//   1. every group payment still standing is moved onto the rooms, room by
//      room in room order (each up to its price), as received room deposits
//      with the same amount, method, received date, who took it, when it was
//      recorded, reference and notes — Daily Close / Cashier Closing of that
//      day don't change; the group payment is voided ("moved to the rooms"),
//      never deleted;
//   2. each room gets its unpaid rest as a pending balance line;
//   3. the group is switched to room by room;
//   4. a room ALREADY CHECKED OUT whose agent is billed gets what check-out
//      would have done: its nights posted (check-out's catch-up) and the unpaid
//      rest put on the agent's bill (agentBilling.settleCheckout).
// The money doesn't change (checked; the caller rolls back otherwise).
//
// Runs in the caller's transaction. Returns { error, status, code } to
// refuse (nothing written yet), else { details, rooms, received }.
const { CITY_LEDGER, settleCheckout } = require('./agentBillingService');
const { otaCollectsSql } = require('./otaCollect');
const { recomputeBookingStatus } = require('./paymentStatusService');
const { postStay } = require('./roomChargeService');
const { logToRooms } = require('./groupBilling');

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ACTIVE = b => !['cancelled', 'no_show'].includes(b.status);

// The room's agent takes the room money at check-out by default — the same
// rule as agentBilling.settleCheckout with billToAgent not chosen.
const BILLED_SQL = `(
  (${otaCollectsSql('b', 'bs')} AND (a.id IS NULL OR a.agent_type = 'ota'))
  OR (a.payment_status = ANY($2::text[]) AND NOT (b.payment_collect = 'property' AND a.agent_type = 'ota'))
)`;

async function loadRooms(client, groupId) {
  const { rows } = await client.query(
    `SELECT b.*, u.name AS unit_name, a.name AS agent_name, ${BILLED_SQL} AS agent_billed,
            EXISTS (SELECT 1 FROM agent_payment_allocations al WHERE al.booking_id = b.id) AS agent_paid
     FROM bookings b JOIN units u ON u.id = b.unit_id
     LEFT JOIN agents a ON a.id = b.agent_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.reservation_group_id = $1 ORDER BY u.name`, [groupId, CITY_LEDGER]);
  return rows;
}

async function billRoomByRoom(client, { propertyId, groupId, userId = null, reason = '' }) {
  const { rows: [g] } = await client.query(
    `SELECT rg.*, gu.name AS booker FROM reservation_groups rg JOIN guests gu ON gu.id = rg.primary_guest_id
     WHERE rg.id = $1 AND rg.property_id = $2 FOR UPDATE OF rg`, [groupId, propertyId]);
  if (!g) return { status: 404, error: 'Group not found' };
  if (!g.group_billing) return { status: 409, code: 'NOT_GROUP_BILLED', error: 'This group is already paid room by room' };

  const rooms = await loadRooms(client, groupId);
  const active = rooms.filter(ACTIVE);
  if (!active.length) return { status: 409, error: 'This group has no active room' };
  for (const r of active) {
    if (['invoiced', 'paid'].includes(r.folio_status) || r.agent_invoice_id) {
      return { status: 409, code: 'ON_AGENT_INVOICE', error: `Room ${r.unit_name} is on an agent invoice — void the invoice first (Receivables → the agent → Invoices)` };
    }
    if (r.agent_paid) return { status: 409, code: 'AGENT_PAID', error: `The agent has already paid towards room ${r.unit_name} — take that payment off it first (Receivables → the agent → Payments)` };
  }
  const { rows: gps } = await client.query(
    'SELECT * FROM group_payments WHERE group_id = $1 AND NOT is_voided ORDER BY received_at, created_at FOR UPDATE', [groupId]);
  if (gps.some(x => x.is_refund || parseFloat(x.amount) < 0)) {
    return { status: 409, code: 'HAS_REFUND', error: 'The group has a refund on its bill — this has to be put right by hand' };
  }
  const { rows: [lines] } = await client.query(
    `SELECT count(*)::int n FROM payments p JOIN bookings b ON b.id = p.booking_id
     WHERE b.reservation_group_id = $1 AND p.type IN ('deposit', 'balance')`, [groupId]);
  if (lines.n > 0) return { status: 409, code: 'HAS_ROOM_LINES', error: 'The rooms already have payment lines of their own — this has to be put right by hand' };

  const price = r => r2(parseFloat(r.total_amount) - parseFloat(r.discount_amount || 0));
  const due = r2(active.reduce((s, r) => s + price(r), 0));
  const received = r2(gps.reduce((s, x) => s + parseFloat(x.amount), 0));
  if (received > due + 0.05) {
    return { status: 409, code: 'OVERPAID', error: `The group has paid ${rp(received)}, more than its rooms' price ${rp(due)} — refund or put right the difference first` };
  }

  // 1. Spread each group payment over the rooms, room by room in room order.
  const left = new Map(active.map(r => [r.id, price(r)]));
  const moves = [];   // { gp, room, amount }
  for (const gp of gps) {
    let amt = r2(parseFloat(gp.amount));
    for (const r of active) {
      if (amt <= 0.004) break;
      const take = r2(Math.min(amt, left.get(r.id)));
      if (take <= 0.004) continue;
      moves.push({ gp, room: r, amount: take });
      left.set(r.id, r2(left.get(r.id) - take));
      amt = r2(amt - take);
    }
  }

  await client.query('UPDATE reservation_groups SET group_billing = false, updated_at = NOW() WHERE id = $1', [groupId]);
  for (const m of moves) {
    const { gp } = m;
    const notes = [gp.notes, 'moved from the group payment (group now billed room by room)'].filter(Boolean).join(' · ');
    const { rows: [pay] } = await client.query(
      `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, reference, notes, created_at)
       VALUES ($1, 'deposit', $2, 'received', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [m.room.id, m.amount, gp.method, gp.received_at, gp.received_by, gp.reference, notes, gp.created_at]);
    // the trigger stamps recorded_at = now on insert — keep when it was really recorded
    await client.query('UPDATE payments SET recorded_at = $2 WHERE id = $1', [pay.id, gp.recorded_at || gp.created_at]);
  }
  // 2. Each room's unpaid rest.
  for (const r of active) {
    const rest = left.get(r.id);
    if (rest > 0.004) {
      await client.query(
        "INSERT INTO payments (booking_id, type, amount, status, notes) VALUES ($1, 'balance', $2, 'pending', $3)",
        [r.id, rest, r.agent_billed ? `Billed to ${r.agent_name || 'the agent'}` : 'Still to pay']);
    }
    await client.query('UPDATE bookings SET deposit_amount = $2, updated_at = NOW() WHERE id = $1', [r.id, r2(price(r) - rest)]);
  }
  for (const gp of gps) {
    const parts = moves.filter(m => m.gp === gp).map(m => `room ${m.room.unit_name} ${rp(m.amount)}`).join(', ');
    await client.query(
      'UPDATE group_payments SET is_voided = true, voided_at = NOW(), voided_by = $3, void_reason = $2 WHERE id = $1',
      [gp.id, `Moved to the rooms — group now billed room by room (${parts})`, userId]);
  }
  for (const r of active) await recomputeBookingStatus(client, r.id);

  // 4. Rooms already checked out: what check-out would have done.
  const out = [];
  for (const r of active) {
    const row = { booking_id: r.id, unit_name: r.unit_name, price: price(r), paid: r2(price(r) - left.get(r.id)), rest: left.get(r.id),
      agent_name: r.agent_name, checked_out: r.status === 'checked_out', nights_posted: 0, on_agent_bill: r.folio_status === 'pending_agent_invoice' };
    if (r.status === 'checked_out' && r.agent_billed && !r.folio_status) {
      const { rows: [b] } = await client.query('SELECT * FROM bookings WHERE id = $1', [r.id]);
      const posted = await postStay(client, b, { upToDate: String(b.check_out_date).slice(0, 10), actorUserId: userId });
      row.nights_posted = posted.roomPosted;
      const settled = await settleCheckout(client, { propertyId, bookingId: r.id, billToAgent: null, actorUserId: userId });
      if (settled.error) throw new Error(`room ${r.unit_name}: ${settled.error}`);
      row.on_agent_bill = settled.folio_status === 'pending_agent_invoice';
    }
    out.push(row);
  }

  // The money must not change, and every room's lines = its price.
  const { rows: [chk] } = await client.query(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'received'), 0) recv
     FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.reservation_group_id = $1 AND p.type IN ('deposit', 'balance')`, [groupId]);
  if (Math.abs(parseFloat(chk.recv) - received) > 0.005) throw new Error(`received ${rp(received)} before but ${rp(chk.recv)} on the rooms after`);
  for (const r of active) {
    const { rows: [s] } = await client.query(
      "SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance')", [r.id]);
    if (Math.abs(parseFloat(s.s) - price(r)) > 0.005) throw new Error(`room ${r.unit_name}: lines ${rp(s.s)} ≠ price ${rp(price(r))}`);
  }

  const details = [
    received ? `${rp(received)} received by the group moved onto the rooms` : 'the group had no payment — nothing moved',
    ...out.map(x => `room ${x.unit_name}: ${x.rest > 0.004 ? `${rp(x.rest)} still owed` : 'paid'}`
      + (x.on_agent_bill ? ` — on ${x.agent_name || 'the agent'}'s bill` : x.checked_out && x.rest > 0.004 ? ' — owed by the guest' : '')
      + (x.nights_posted ? ` (${x.nights_posted} night${x.nights_posted === 1 ? '' : 's'} posted)` : '')),
  ];
  await logToRooms(client, groupId,
    `Group now billed room by room (was one bill for the group): ${details.join('; ')}.${reason ? ` Reason: ${reason}` : ''}`, userId);
  return { details, rooms: out, received, booker: g.booker, booking_ids: active.map(r => r.id) };
}

// Check-out of a room in a group billed as a whole whose agent takes the room
// money: switch the group first, so the room's unpaid price goes on the
// agent's bill instead of staying on the group's. Inside a savepoint — when
// the group can't be switched automatically (refund, invoice…) check-out
// carries on with the room left off the agent's bill (the caller's job: the
// money is on the group's) and the reason is written to the room's history.
async function switchAtCheckout(client, { propertyId, bookingId, userId }) {
  const { rows: [x] } = await client.query(
    `SELECT b.reservation_group_id AS group_id, ${BILLED_SQL} AS agent_billed
     FROM bookings b JOIN reservation_groups rg ON rg.id = b.reservation_group_id AND rg.group_billing
     LEFT JOIN agents a ON a.id = b.agent_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.id = $1 AND b.property_id = $3`, [bookingId, CITY_LEDGER, propertyId]);
  if (!x || !x.agent_billed) return null;
  await client.query('SAVEPOINT group_room_by_room');
  try {
    const r = await billRoomByRoom(client, { propertyId, groupId: x.group_id, userId, reason: 'check-out of a room billed to its agent' });
    if (r.error) throw new Error(r.error);
    await client.query('RELEASE SAVEPOINT group_room_by_room');
    return r;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT group_room_by_room');
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [bookingId,
      `Not put on the agent's bill: the room is on the group's bill and the group could not be switched to room by room (${err.message}). Fix it on the group page → Bill room by room.`.slice(0, 1000), userId]);
    return { error: err.message };
  }
}

module.exports = { billRoomByRoom, switchAtCheckout };
