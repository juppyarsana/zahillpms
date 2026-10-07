const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const roomCharge = require('../services/roomChargeService');
const { recomputeBookingStatus } = require('../services/paymentStatusService');
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

module.exports = router;
