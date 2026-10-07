const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const roomCharge = require('../services/roomChargeService');
const { recomputeBookingStatus, recomputeGroupStatus } = require('../services/paymentStatusService');
const groupBilling = require('../services/groupBilling');
const { occupiedUntilSql } = require('../services/occupancySql');
const { sendControlAlert } = require('../services/ownerAlerts');
const sse = require('../sse');
const agentBilling = require('../services/agentBillingService');
const agentService = require('../services/agentService');

// Corrections — mounted at /api/bookings (reservations module), ahead of
// routes/bookings.js. Front desk mistakes are put right by reversing the
// step, never by editing records freely: owner or the `corrections`
// permission (Roles & Permissions → Front Desk), a reason every time (Edit
// History + owner control alert), nothing deleted.
//   PUT /:id/undo-checkout   checked out by mistake → back in house
//   PUT /:id/undo-checkin    checked in by mistake  → back to arriving
//   PUT /:id/reinstate       cancelled by mistake   → booked again (room still free)
//   PUT /:id/agent-billing   agent billing decided wrong at check-out
//   PUT /:id/join-group      a booking on its own → a room of a group
//   PUT /:id/leave-group     a group's room → a booking on its own
const canCorrect = requireOwnerOrMenu('corrections');

const readReason = req => String(req.body?.reason || '').trim().slice(0, 500);

async function lockBooking(client, id, propertyId) {
  const { rows: [b] } = await client.query(
    `SELECT b.*, u.name AS unit_name, u.controller_id FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`, [id, propertyId]);
  return b;
}

// Another guest holding this room for any night in [from, to).
async function roomTakenBy(client, b, from, to) {
  if (!(from < to)) return null;
  const { rows: [x] } = await client.query(`
    SELECT g.name AS guest_name FROM bookings x JOIN guests g ON g.id = x.guest_id
    WHERE x.unit_id = $1 AND x.property_id = $2 AND x.id <> $3
      AND x.status NOT IN ('cancelled', 'no_show')
      AND x.check_in_date < $5 AND ${occupiedUntilSql('x')} > $4
    LIMIT 1`, [b.unit_id, b.property_id, b.id, from, to]);
  return x ? x.guest_name : null;
}

async function logEvent(client, bookingId, note, userId) {
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
    [bookingId, note.slice(0, 1000), userId]);
}

// Runs one correction inside a transaction. `work(client, booking)` returns
// { status, error } to refuse, or { json, headline, details? } when done.
function correction(work) {
  return async (req, res) => {
    const reason = readReason(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const b = await lockBooking(client, req.params.id, req.propertyId);
      if (!b) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
      const out = await work(client, b, { reason, userId: req.user.id, propertyId: req.propertyId, body: req.body || {} });
      if (out.error) { await client.query('ROLLBACK'); return res.status(out.status || 409).json({ error: out.error, ...(out.code ? { code: out.code } : {}) }); }
      await client.query('COMMIT');
      if (b.controller_id) sse.notify(b.controller_id, { type: 'guest_changed' });
      sendControlAlert(req.propertyId, { bookingIds: b.id, userId: req.user.id, reason, headline: out.headline, details: out.details || [] });
      res.json(out.json);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  };
}

// PUT /api/bookings/:id/undo-checkout { reason } — the guest is still here
// (wrong room checked out, or checked out too early). The stay is in house
// again exactly as it was: its folio lines and payments are untouched. What
// checkout did is taken back — room occupied again, the housekeeping task and
// "to clean" flag, billed-to-agent mark and an unpaid commission (they are
// set again at the real check-out). A stay already on an agent invoice can't
// be reopened, nor one whose room has the next guest in it. An early
// departure's shortened dates / price stay as they are (Amend Dates).
router.put('/:id/undo-checkout', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId }) => {
  if (b.status !== 'checked_out') return { error: `Only a checked-out stay can be reopened — this booking is ${b.status.replace('_', ' ')}` };
  if (['invoiced', 'paid'].includes(b.folio_status)) {
    return { error: 'This stay is already on an agent invoice — it can\'t be reopened', code: 'ON_AGENT_INVOICE' };
  }
  const { rows: [inRoom] } = await client.query(
    `SELECT g.name AS guest_name FROM bookings x JOIN guests g ON g.id = x.guest_id
     WHERE x.unit_id = $1 AND x.property_id = $2 AND x.id <> $3 AND x.status = 'checked_in' LIMIT 1`,
    [b.unit_id, propertyId, b.id]);
  const today = roomCharge.todayWITA();
  const taken = inRoom?.guest_name || await roomTakenBy(client, b, today, b.check_out_date);
  if (taken) return { error: `Room ${b.unit_name} now has ${taken} — move one of them to another room first`, code: 'ROOM_TAKEN' };

  const { rowCount: commissions } = await client.query(
    "DELETE FROM agent_commissions WHERE booking_id = $1 AND property_id = $2 AND status = 'unpaid'", [b.id, propertyId]);
  await client.query(
    `UPDATE bookings SET status = 'checked_in', updated_at = NOW(),
            folio_status = CASE WHEN folio_status = 'pending_agent_invoice' THEN NULL ELSE folio_status END
     WHERE id = $1`, [b.id]);
  await client.query(
    "UPDATE units SET status = 'occupied', housekeeping_status = 'clean', housekeeping_updated_at = NOW() WHERE id = $1 AND property_id = $2",
    [b.unit_id, propertyId]);
  // The cleaning job checkout made, if nobody has started it.
  await client.query(
    "DELETE FROM tasks WHERE booking_id = $1 AND property_id = $2 AND type = 'housekeeping' AND status = 'todo'", [b.id, propertyId]);
  await client.query('UPDATE checkin_records SET checkout_time = NULL, checkout_by = NULL WHERE booking_id = $1', [b.id]);
  await require('./checkin').recalcGuestTier(client, b.guest_id, propertyId);

  const undone = [
    b.folio_status === 'pending_agent_invoice' ? 'billed-to-agent mark removed' : '',
    commissions ? 'unpaid agent commission removed' : '',
  ].filter(Boolean);
  await logEvent(client, b.id,
    `Check-out undone — guest is in house again${undone.length ? ` (${undone.join(', ')}; set again at check-out)` : ''}. Reason: ${reason}`, userId);
  return { json: { id: b.id, status: 'checked_in' }, headline: '↩️ Check-out undone — stay reopened', details: undone };
}));

// PUT /api/bookings/:id/undo-checkin { reason } — the guest hasn't arrived
// (wrong booking checked in). Status goes back to pending / deposit paid /
// confirmed from its payments, the room is free again, and the nights the
// system already posted are voided (they post again after the real check-in;
// extras charged to the room stay on the folio).
router.put('/:id/undo-checkin', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId }) => {
  if (b.status !== 'checked_in') return { error: `Only a checked-in stay can be put back — this booking is ${b.status.replace('_', ' ')}` };
  const voided = await roomCharge.voidAll(client, b.id, userId);
  await client.query("UPDATE bookings SET status = 'pending', updated_at = NOW() WHERE id = $1", [b.id]);
  const status = await recomputeBookingStatus(client, b.id);
  await client.query("UPDATE units SET status = 'available' WHERE id = $1 AND property_id = $2 AND status = 'occupied'", [b.unit_id, propertyId]);
  await client.query('UPDATE checkin_records SET checkin_time = NULL, processed_by = NULL WHERE booking_id = $1', [b.id]);
  const details = voided ? [`${voided} posted night line${voided === 1 ? '' : 's'} voided (posted again after check-in)`] : [];
  await logEvent(client, b.id,
    `Check-in undone — status back to ${status.replace('_', ' ')}${details.length ? `; ${details[0]}` : ''}. Reason: ${reason}`, userId);
  return { json: { id: b.id, status }, headline: '↩️ Check-in undone — booking back to arriving', details };
}));

// PUT /api/bookings/:id/reinstate { reason } — a cancelled booking (or a room
// removed from its group) is booked again, as long as nobody else has the
// room for its nights. Status from its payments; its payment lines were never
// removed. A group's room goes back into the group (and its bill).
router.put('/:id/reinstate', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId }) => {
  if (b.status !== 'cancelled') return { error: `Only a cancelled booking can be reinstated — this booking is ${b.status.replace('_', ' ')}` };
  const taken = await roomTakenBy(client, b, b.check_in_date, b.check_out_date);
  if (taken) {
    return { error: `Room ${b.unit_name} is now booked for ${taken} on these dates — it can't be reinstated in this room`, code: 'ROOM_TAKEN' };
  }
  await client.query("UPDATE bookings SET status = 'pending', updated_at = NOW() WHERE id = $1", [b.id]);
  if (b.reservation_group_id) {
    await client.query(
      "UPDATE reservation_groups SET status = 'active', updated_at = NOW() WHERE id = $1 AND property_id = $2 AND status = 'cancelled'",
      [b.reservation_group_id, propertyId]);
    await require('./bookings').syncGroupSpan(client, b.reservation_group_id);
  }
  const status = await recomputeBookingStatus(client, b.id);
  await logEvent(client, b.id, `Booking reinstated — status back to ${status.replace('_', ' ')}. Reason: ${reason}`, userId);
  return { json: { id: b.id, status }, headline: '↩️ Cancelled booking reinstated' };
}));

// PUT /api/bookings/:id/agent-billing { agent_id, commission_type?, commission_value?, bill_to_agent, reason }
// A checked-out stay whose agent billing came out wrong at check-out: wrong
// agent (or none), billed to the agent when the guest paid — or the other way
// round — or the wrong commission. What check-out decided is taken back
// (billed-to-agent mark, an unpaid commission) and decided again with the
// values given, by the same rule check-out uses (agentBilling.settleCheckout).
//   agent_id       '' / null = no agent; absent = keep
//   bill_to_agent  true = on the agent's bill, false = the guest pays
// Refused once the stay is on an agent invoice (void the invoice first), has
// agent payments allocated to it, or its commission is already paid out.
router.put('/:id/agent-billing', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId, body }) => {
  if (b.status !== 'checked_out') return { error: 'Agent billing is corrected here only after check-out — before that, use Edit Details' };
  if (['invoiced', 'paid'].includes(b.folio_status) || b.agent_invoice_id) {
    return { error: 'This stay is on an agent invoice — void the invoice first (Agent Billing → the agent → Invoices)', code: 'ON_AGENT_INVOICE' };
  }
  const { rows: [alloc] } = await client.query('SELECT 1 FROM agent_payment_allocations WHERE booking_id = $1 LIMIT 1', [b.id]);
  if (alloc) return { error: 'The agent has already paid towards this stay — take that payment off it first (Agent Billing → the agent → Payments)', code: 'AGENT_PAID' };
  const { rows: [paidOut] } = await client.query("SELECT 1 FROM agent_commissions WHERE booking_id = $1 AND status <> 'unpaid'", [b.id]);
  if (paidOut) return { error: 'The commission of this stay is already paid out — mark it unpaid first (Agent Billing → the agent → Commissions)', code: 'COMMISSION_PAID' };

  let agentId = b.agent_id;
  if (body.agent_id !== undefined) {
    if (!body.agent_id) agentId = null;
    else {
      const agent = await agentService.getAgent(propertyId, body.agent_id, client);
      if (!agent) return { status: 404, error: 'Agent not found' };
      agentId = agent.id;
    }
  }
  const commission = agentService.parseBookingCommission(body);
  if (commission.error) return { status: 400, error: commission.error };
  const billToAgent = !!body.bill_to_agent;
  if (billToAgent && !agentId) return { status: 400, error: 'Choose the agent this stay is billed to' };

  const snapshot = async id => (await client.query(
    `SELECT (SELECT name FROM agents WHERE id = $2) AS agent_name,
            (SELECT amount FROM agent_commissions WHERE booking_id = $1) AS commission`, [b.id, id])).rows[0];
  const was = await snapshot(b.agent_id);
  await client.query("DELETE FROM agent_commissions WHERE booking_id = $1 AND property_id = $2 AND status = 'unpaid'", [b.id, propertyId]);
  const own = !!agentId && 'commission_type' in commission.values;
  await client.query(
    `UPDATE bookings SET agent_id = $1, folio_status = NULL,
            commission_type = CASE WHEN $2::boolean THEN $3 WHEN $1::uuid IS NULL THEN NULL ELSE commission_type END,
            commission_value = CASE WHEN $2::boolean THEN $4::numeric WHEN $1::uuid IS NULL THEN NULL ELSE commission_value END,
            updated_at = NOW() WHERE id = $5`,
    [agentId, own, own ? commission.values.commission_type : null, own ? commission.values.commission_value : null, b.id]);
  const settled = await agentBilling.settleCheckout(client, { propertyId, bookingId: b.id, billToAgent, actorUserId: userId });
  if (settled.error) return { status: 400, error: settled.error };

  const now = await snapshot(agentId);
  const money = n => (n == null ? 'none' : 'Rp ' + Math.round(parseFloat(n)).toLocaleString('id-ID'));
  const wasBilled = b.folio_status === 'pending_agent_invoice';
  const changes = [
    (was.agent_name || null) !== (now.agent_name || null) ? `agent ${was.agent_name || 'none'} → ${now.agent_name || 'none'}` : '',
    wasBilled !== billToAgent ? (billToAgent ? `now billed to ${now.agent_name}` : 'no longer billed to the agent — the guest pays') : '',
    money(was.commission) !== money(now.commission) ? `commission ${money(was.commission)} → ${money(now.commission)}` : '',
  ].filter(Boolean);
  if (!changes.length) return { status: 400, error: 'Nothing was changed' };
  await logEvent(client, b.id, `Agent billing corrected: ${changes.join('; ')}. Reason: ${reason}`, userId);
  return { json: { id: b.id, folio_status: settled.folio_status, agent_id: agentId, commission: now.commission == null ? null : parseFloat(now.commission) },
    headline: '✏️ Agent billing corrected after check-out', details: changes };
}));

// ── Into / out of a group ────────────────────────────────────────────────
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MOVABLE = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];

// What can go with a room that leaves a group billed as a whole: the room's
// price, and how much of the group's payments may move with it — up to the
// room's price, never more than the group has received. What moves is no
// longer paid towards the group's other rooms (group_owes_after says what the
// group would still owe if `max` moved; group_credit = what it has paid
// beyond its other rooms).
async function leaveQuote(b, propertyId) {
  const { rows: [g] } = await db.query(
    `SELECT rg.id, rg.group_billing, gu.name AS booker,
            (SELECT COUNT(*)::int FROM bookings x WHERE x.reservation_group_id = rg.id AND x.id <> $2
               AND x.status NOT IN ('cancelled', 'no_show')) AS other_rooms
     FROM reservation_groups rg JOIN guests gu ON gu.id = rg.primary_guest_id
     WHERE rg.id = $1 AND rg.property_id = $3`, [b.reservation_group_id, b.id, propertyId]);
  if (!g) return null;
  const price = r2(parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0));
  const out = { group_id: g.id, booker: g.booker, group_billing: g.group_billing, other_rooms: g.other_rooms, price, group_credit: 0, max: 0 };
  if (g.group_billing) {
    const bill = await groupBilling.groupBill(g.id, propertyId);
    const mine = bill.rooms.find(r => r.booking_id === b.id);
    out.group_received = bill.received;
    out.group_bill_after = r2(bill.total - (mine?.group_total || 0));
    out.group_credit = Math.max(0, r2(bill.received - out.group_bill_after));
    out.max = Math.min(price, Math.max(0, bill.received));
  }
  return out;
}

// GET /api/bookings/:id/leave-group/quote — for the "Take out of the group" window.
router.get('/:id/leave-group/quote', auth, canCorrect, async (req, res) => {
  try {
    const { rows: [b] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (!b.reservation_group_id) return res.status(409).json({ error: 'This booking is not in a group' });
    res.json(await leaveQuote(b, req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/join-group { group_id, reason } — a reservation made on
// its own turns out to belong to a group. The booking keeps its room, guest,
// dates, price, folio and check-in state; only its group changes (the group's
// dates stretch to cover it). In a group billed as a whole (migration 097) the
// room has no payment lines of its own: its deposit / balance lines are
// removed and what was received on them becomes group payments (same amount,
// method, date, person, reference). Extras the guest paid stay on the room.
router.put('/:id/join-group', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId, body }) => {
  if (b.reservation_group_id) return { error: 'This booking is already in a group — take it out of that group first', code: 'ALREADY_IN_GROUP' };
  if (!MOVABLE.includes(b.status)) return { error: `A ${b.status.replace('_', ' ')} booking can't be moved into a group` };
  if (b.folio_status) return { error: 'This stay is on an agent\'s bill — it can\'t be moved into a group', code: 'ON_AGENT_INVOICE' };
  if (!body.group_id) return { status: 400, error: 'Choose the group' };
  const { rows: [g] } = await client.query(
    `SELECT rg.*, gu.name AS booker FROM reservation_groups rg JOIN guests gu ON gu.id = rg.primary_guest_id
     WHERE rg.id = $1 AND rg.property_id = $2 FOR UPDATE OF rg`, [body.group_id, propertyId]);
  if (!g) return { status: 404, error: 'Group not found' };
  if (g.status === 'cancelled') return { error: 'This group is cancelled' };

  const details = [];
  if (g.group_billing) {
    const { rows: [ag] } = await client.query('SELECT name, payment_status FROM agents WHERE id = $1', [b.agent_id]);
    if (ag && agentBilling.CITY_LEDGER.includes(ag.payment_status)) {
      return { error: `This booking is billed to ${ag.name} — it can't also be on the group's bill. Change its agent first (Edit Details).`, code: 'AGENT_BILLED' };
    }
    const { rows: [refunded] } = await client.query(
      "SELECT 1 FROM payments WHERE booking_id = $1 AND type = 'refund' AND status = 'received' LIMIT 1", [b.id]);
    if (refunded) return { error: 'This booking has a refund on it — undo the refund first (it can be given again from the group)', code: 'HAS_REFUND' };

    const { rows: lines } = await client.query(
      "SELECT * FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') ORDER BY received_at NULLS LAST, created_at FOR UPDATE", [b.id]);
    const received = lines.filter(l => l.status === 'received' && parseFloat(l.amount) > 0);
    let moved = 0;
    for (const l of received) {
      await client.query(
        `INSERT INTO group_payments (property_id, group_id, amount, method, received_at, received_by, recorded_at, reference, notes, legacy_payment_id)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, $7::timestamptz, $11::timestamptz, NOW()), $6, $7::timestamptz, $8, $9, $10)`,
        [propertyId, g.id, l.amount, l.method || 'other', l.received_at, l.received_by, l.recorded_at, l.reference,
         [l.notes, `moved from room ${b.unit_name} ${l.type}`].filter(Boolean).join(' · '), l.id, l.created_at]);
      moved = r2(moved + parseFloat(l.amount));
    }
    if (lines.length) await client.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [lines.map(l => l.id)]);
    await client.query('UPDATE bookings SET deposit_amount = 0 WHERE id = $1', [b.id]);
    details.push(moved > 0 ? `${rp(moved)} received on the room is now a group payment` : 'nothing was received on the room yet',
      'the room and meal plan are now on the group\'s bill');
  }
  await client.query('UPDATE bookings SET reservation_group_id = $1, updated_at = NOW() WHERE id = $2', [g.id, b.id]);
  const { syncGroupSpan } = require('./bookings');
  await syncGroupSpan(client, g.id);
  const status = await recomputeBookingStatus(client, b.id);
  await groupBilling.logToRooms(client, g.id,
    `Room ${b.unit_name} moved into this group (was a booking on its own)${details.length ? ` — ${details[0]}` : ''}. Reason: ${reason}`, userId);
  return { json: { id: b.id, reservation_group_id: g.id, status: status || b.status },
    headline: `👥 Booking moved into the group of ${g.booker}`, details };
}));

// PUT /api/bookings/:id/leave-group { amount?, reason } — a group's room
// becomes a booking on its own (same room, guest, dates, price, folio). Not
// the group's last room. Out of a group billed as a whole the room gets its
// own payment lines back; `amount` = how much of the group's payments goes
// with it (0 … the room's price, at most what the group has received): taken
// off the group as a minus line and recorded as received on the room, the
// rest of the price is a pending balance. The group owes that much more.
router.put('/:id/leave-group', auth, canCorrect, correction(async (client, b, { reason, userId, propertyId, body }) => {
  if (!b.reservation_group_id) return { error: 'This booking is not in a group' };
  if (!MOVABLE.includes(b.status)) return { error: `A ${b.status.replace('_', ' ')} room can't be taken out of its group` };
  if (b.folio_status) return { error: 'This stay is on an agent\'s bill — it can\'t be taken out of its group', code: 'ON_AGENT_INVOICE' };
  const groupId = b.reservation_group_id;
  await client.query('SELECT id FROM reservation_groups WHERE id = $1 AND property_id = $2 FOR UPDATE', [groupId, propertyId]);
  const q = await leaveQuote(b, propertyId);
  if (!q) return { status: 404, error: 'Group not found' };
  if (q.other_rooms === 0) return { error: 'This is the group\'s last room — a group needs at least one', code: 'LAST_ROOM' };

  const details = [];
  await client.query(
    // A fixed group discount is stored on every room as the GROUP's value;
    // on its own the booking keeps only its share.
    `UPDATE bookings SET reservation_group_id = NULL, updated_at = NOW(),
            discount_value = CASE WHEN discount_type = 'fixed' THEN discount_amount ELSE discount_value END
     WHERE id = $1`, [b.id]);
  if (q.group_billing) {
    const amt = r2(parseFloat(body.amount || 0));
    if (!(amt >= 0)) return { status: 400, error: 'Enter the amount that goes with the room (0 for none)' };
    if (amt > q.max + 0.05) {
      return { code: 'OVER_CREDIT', error: q.max > 0
        ? `Only ${rp(q.max)} of the group's payments can go with this room`
        : 'None of the group\'s payments can go with this room — the group has not paid anything yet' };
    }
    if (amt > 0) {
      const { rows: [last] } = await client.query(
        `SELECT method FROM group_payments WHERE group_id = $1 AND NOT is_voided AND amount > 0
         ORDER BY received_at DESC, created_at DESC LIMIT 1`, [groupId]);
      const method = last?.method || 'other';
      await client.query(
        `INSERT INTO group_payments (property_id, group_id, amount, method, received_by, notes, is_refund)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [propertyId, groupId, -amt, method, userId, `Moved to room ${b.unit_name}, taken out of the group`]);
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes)
         VALUES ($1, 'deposit', $2, 'received', $3, NOW(), $4, $5)`,
        [b.id, amt, method, userId, `Moved from the payments of ${q.booker}'s group`]);
    }
    const rest = r2(q.price - amt);
    if (rest > 0.05) await client.query("INSERT INTO payments (booking_id, type, amount) VALUES ($1, 'balance', $2)", [b.id, rest]);
    await client.query('UPDATE bookings SET deposit_amount = $1 WHERE id = $2', [amt, b.id]);
    details.push(amt > 0 ? `${rp(amt)} of the group's payments went with the room` : 'none of the group\'s payments went with the room',
      rest > 0.05 ? `${rp(rest)} still to pay on the room` : 'the room is paid');
  }
  const { syncGroupSpan } = require('./bookings');
  await syncGroupSpan(client, groupId);
  if (q.group_billing) await recomputeGroupStatus(client, groupId);
  const status = await recomputeBookingStatus(client, b.id);
  const note = `Room ${b.unit_name} taken out of the group of ${q.booker} — now a booking on its own${details.length ? ` (${details.join('; ')})` : ''}. Reason: ${reason}`;
  await logEvent(client, b.id, note, userId);
  await groupBilling.logToRooms(client, groupId, note, userId);
  return { json: { id: b.id, reservation_group_id: null, status: status || b.status },
    headline: `👤 Room taken out of the group of ${q.booker}`, details };
}));

module.exports = router;
