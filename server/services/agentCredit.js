const db = require('../db');
const { round2, computeProforma } = require('./folioService');
const { sendControlAlert } = require('./ownerAlerts');

// Agent credit — money an agent already paid for a room that was then cancelled
// (or a no-show) and that the hotel still holds. Nothing is stored for it: the
// money stays recorded on the cancelled booking (by the journal's rule it sits in
// Advance deposits, a liability), so Daily Close, Cashier Closing and the books are
// untouched. This service adds it up per agent and lets it be USED on another stay of
// the same agent (a part of a payment moves, same method / date / reference / receiver,
// so no day's money changes) — or refunded (routes/agentCredit.js reuses the refund).
//
// Credit of one cancelled booking = what was received less a no-show / late-cancellation
// fee the hotel keeps and less earlier refunds (the same figure Refund allows). Only
// payments that can be moved count as usable (not a Sales till / activity / voucher
// payment, not one paid for chosen lines).

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

const MOVABLE_SQL = `p.status = 'received' AND p.amount > 0 AND p.type IN ('deposit', 'balance', 'incidental')
  AND p.sale_id IS NULL AND p.activity_booking_id IS NULL AND p.voucher_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM folio_charges fc WHERE fc.paid_payment_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM booking_addons ba WHERE ba.paid_payment_id = p.id)`;

async function itemOf(b) {
  const { rows: [r] } = await db.query(
    "SELECT COALESCE(SUM(amount), 0)::float AS received FROM payments WHERE booking_id = $1 AND status = 'received'", [b.id]);
  const fee = round2((await computeProforma(b.id, b.property_id)).total);
  const available = Math.max(0, round2(r.received - fee));
  if (available < 1) return null;
  const { rows: pays } = await db.query(
    `SELECT p.id, p.amount::float AS amount, p.method, COALESCE(pm.label, p.method) AS method_label,
            p.received_at, p.reference
       FROM payments p LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = $2
      WHERE p.booking_id = $1 AND ${MOVABLE_SQL} ORDER BY p.received_at, p.created_at`, [b.id, b.property_id]);
  const movable = round2(pays.reduce((s, p) => s + p.amount, 0));
  return {
    booking_id: b.id, room: b.room, guest: b.guest, status: b.status,
    group_id: b.reservation_group_id || null, group_name: b.group_name || null,
    cancelled_on: b.cancelled_on, received: round2(r.received), fee, available,
    usable: Math.min(available, movable),
    payments: pays.map(p => ({ method: p.method, method_label: p.method_label, received_on: p.received_at, reference: p.reference, amount: p.amount })),
  };
}

const CANCELLED_SQL = `
  SELECT b.id, b.property_id, b.status, b.reservation_group_id, u.name AS room, g.name AS guest, pg.name AS group_name,
         COALESCE((SELECT max(e.created_at) FROM booking_events e WHERE e.booking_id = b.id AND e.note ILIKE 'Booking cancelled%'), b.updated_at) AS cancelled_on
    FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
    LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
    LEFT JOIN guests pg ON pg.id = rg.primary_guest_id
   WHERE b.property_id = $1 AND b.agent_id = $2 AND b.status IN ('cancelled', 'no_show')
     AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'received' AND p.amount > 0)
   ORDER BY b.updated_at`;

// The credit held for one agent.
async function creditFor(propertyId, agentId) {
  const { rows: [agent] } = await db.query('SELECT id, name, agent_type FROM agents WHERE id = $1 AND property_id = $2', [agentId, propertyId]);
  if (!agent) return null;
  if (agent.agent_type === 'ota') return { agent_id: agent.id, agent_name: agent.name, total: 0, items: [] };
  const { rows } = await db.query(CANCELLED_SQL, [propertyId, agentId]);
  const items = [];
  for (const b of rows) { const it = await itemOf(b); if (it) items.push(it); }
  return { agent_id: agent.id, agent_name: agent.name, total: round2(items.reduce((s, i) => s + i.available, 0)), items };
}

// Every agent with credit held (the agent list).
async function summary(propertyId) {
  const { rows } = await db.query(
    `SELECT DISTINCT b.agent_id FROM bookings b JOIN agents ag ON ag.id = b.agent_id AND ag.agent_type <> 'ota'
      WHERE b.property_id = $1 AND b.agent_id IS NOT NULL AND b.status IN ('cancelled', 'no_show')
        AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'received' AND p.amount > 0)`, [propertyId]);
  const out = [];
  for (const r of rows) {
    const c = await creditFor(propertyId, r.agent_id);
    if (c && c.total >= 1) out.push({ agent_id: c.agent_id, agent_name: c.agent_name, total: c.total, bookings: c.items.length });
  }
  return out.sort((a, b) => b.total - a.total);
}

// Money still held on the cancelled / no-show rooms of ONE group (agent or not; never an OTA's):
// the group page's "Paid" and the printed pro forma show it, so the money the agent really sent
// is visible next to the total of the rooms that remain.
async function heldForGroup(propertyId, groupId) {
  const { rows } = await db.query(
    `SELECT b.id, b.property_id, b.status, b.reservation_group_id, u.name AS room, g.name AS guest, pg.name AS group_name,
            COALESCE((SELECT max(e.created_at) FROM booking_events e WHERE e.booking_id = b.id AND e.note ILIKE 'Booking cancelled%'), b.updated_at) AS cancelled_on,
            ag.name AS agent_name
       FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
       LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
       LEFT JOIN guests pg ON pg.id = rg.primary_guest_id
       LEFT JOIN agents ag ON ag.id = b.agent_id
      WHERE b.property_id = $1 AND b.reservation_group_id = $2 AND b.status IN ('cancelled', 'no_show')
        AND COALESCE(ag.agent_type, '') <> 'ota'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'received' AND p.amount > 0)
      ORDER BY u.name`, [propertyId, groupId]);
  const items = [];
  for (const b of rows) { const it = await itemOf(b); if (it) items.push({ ...it, agent_name: b.agent_name || null }); }
  return { held: round2(items.reduce((s, i) => s + i.available, 0)), items };
}

// The agent's stays that can take credit: not cancelled / no-show, still owing something.
async function targetsFor(propertyId, agentId) {
  const { rows } = await db.query(
    `SELECT b.id, b.status, b.check_in_date::text AS ci, b.check_out_date::text AS co, u.name AS room, g.name AS guest, pg.name AS group_name,
            COALESCE(rg.group_billing, false) AS group_billing
       FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
       LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
       LEFT JOIN guests pg ON pg.id = rg.primary_guest_id
      WHERE b.property_id = $1 AND b.agent_id = $2 AND b.status IN ('pending', 'deposit_paid', 'confirmed', 'checked_in')
        AND b.check_out_date >= CURRENT_DATE - 1
      ORDER BY b.check_in_date, u.name LIMIT 80`, [propertyId, agentId]);
  const out = [];
  for (const b of rows) {
    if (b.group_billing) continue;                        // a group billed as one bill takes group payments
    const est = await computeProforma(b.id, propertyId);
    const owed = round2(est?.balance_due || 0);
    if (owed >= 1) out.push({ booking_id: b.id, room: b.room, guest: b.guest, group_name: b.group_name, status: b.status, check_in: b.ci, check_out: b.co, owed });
  }
  return out;
}

// Use part or all of the credit of a cancelled booking on another stay of the same agent.
async function useCredit(propertyId, userId, { fromBookingId, toBookingId, amount, reason }) {
  amount = round2(parseFloat(amount));
  if (!reason) return { status: 400, code: 'REASON_REQUIRED', error: 'A reason is required' };
  if (!(amount > 0)) return { status: 400, error: 'Enter an amount above 0' };
  if (!fromBookingId || !toBookingId || fromBookingId === toBookingId) return { status: 400, error: 'Choose the credit and the stay to use it on' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [fromBookingId, toBookingId].sort();
    const { rows: locked } = await client.query(
      `SELECT b.id, b.status, b.agent_id, b.reservation_group_id, u.name AS unit_name, g.name AS guest_name,
              COALESCE(rg.group_billing, false) AS group_billing
         FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
         LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
        WHERE b.id = ANY($1) AND b.property_id = $2 ORDER BY b.id FOR UPDATE OF b`, [ids, propertyId]);
    const from = locked.find(b => b.id === fromBookingId), to = locked.find(b => b.id === toBookingId);
    if (!from || !to) { await client.query('ROLLBACK'); return { status: 404, error: 'Booking not found' }; }
    const { rows: [fa] } = await client.query('SELECT agent_type FROM agents WHERE id = $1', [from.agent_id]);
    if (fa?.agent_type === 'ota') { await client.query('ROLLBACK'); return { status: 409, code: 'OTA', error: 'An OTA holds no credit — the money belongs to the guest: give it back with ⋮ → Refund on the booking' }; }
    if (!['cancelled', 'no_show'].includes(from.status) || !from.agent_id) {
      await client.query('ROLLBACK'); return { status: 409, error: 'That booking holds no agent credit' };
    }
    if (to.agent_id !== from.agent_id) { await client.query('ROLLBACK'); return { status: 409, code: 'OTHER_AGENT', error: 'Credit can only be used on a stay of the same agent' }; }
    if (['cancelled', 'no_show'].includes(to.status)) { await client.query('ROLLBACK'); return { status: 409, error: `Room ${to.unit_name}'s booking is ${to.status.replace('_', '-')}` }; }
    if (to.group_billing) { await client.query('ROLLBACK'); return { status: 409, code: 'GROUP_BILLED', error: 'That room is on a group paid as one bill — record the credit with Record Group Payment instead' }; }

    const item = await itemOf({ id: from.id, property_id: propertyId });
    const est = await computeProforma(to.id, propertyId);
    const owed = round2(est?.balance_due || 0);
    if (!item || amount > item.usable + 0.05) {
      await client.query('ROLLBACK');
      return { status: 409, code: 'OVER_CREDIT', error: item ? `Only ${rp(item.usable)} of credit can be used from room ${from.unit_name}` : 'That booking holds no credit' };
    }
    if (amount > owed + 0.05) {
      await client.query('ROLLBACK');
      return { status: 409, code: 'OVER_OWED', error: `Room ${to.unit_name} only owes ${rp(owed)} — use at most that` };
    }

    const { payRoomLines } = require('../routes/folio');
    const { rows: pays } = await client.query(
      `SELECT p.id, p.type, p.amount::float AS amount, p.method, COALESCE(pm.label, p.method) AS method_label,
              p.received_at, p.received_by, p.reference
         FROM payments p LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = $2
        WHERE p.booking_id = $1 AND ${MOVABLE_SQL} ORDER BY p.received_at, p.created_at FOR UPDATE OF p`, [from.id, propertyId]);

    let left = amount;
    const used = [];
    for (const p of pays) {
      if (left <= 0.005) break;
      const take = round2(Math.min(left, p.amount));
      left = round2(left - take);
      if (take >= p.amount - 0.005) {
        await client.query(
          "UPDATE payments SET status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2 WHERE id = $3",
          [userId, `Used as agent credit on room ${to.unit_name}`, p.id]);
      } else {
        await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [round2(p.amount - take), p.id]);
      }
      // On the other stay: unpaid room lines first, the rest as an extras payment (as Move does).
      let rest = take;
      const { rows: pending } = await client.query(
        `SELECT id, amount FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'pending' AND amount > 0
          ORDER BY (type = 'deposit') DESC, created_at, id`, [to.id]);
      const parts = [];
      for (const l of pending) {
        if (rest <= 0.005) break;
        const t = Math.min(rest, parseFloat(l.amount));
        parts.push({ payment_id: l.id, amount: t });
        rest = round2(rest - t);
      }
      const opts = { method: p.method, receivedAt: p.received_at ? new Date(p.received_at).toISOString() : null,
        notes: `Agent credit from room ${from.unit_name} (${from.guest_name})`, userId: p.received_by || userId, reference: p.reference || null };
      const room = await payRoomLines(client, { id: to.id }, parts, opts);
      if (room.error) { await client.query('ROLLBACK'); return { status: room.status || 400, error: room.error }; }
      if (rest > 0.005) {
        await client.query(
          `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, reference)
           VALUES ($1, 'incidental', $2, 'received', $3, COALESCE($4::timestamptz, NOW()), $5, $6, $7)`,
          [to.id, rest, opts.method, opts.receivedAt, opts.userId, opts.notes, opts.reference]);
      }
      used.push(`${rp(take)} (${p.method_label})`);
    }

    const note = `Agent credit ${rp(amount)} — ${used.join(' + ')}`;
    const ev = (bid, text) => client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [bid, text.slice(0, 1000), userId]);
    await ev(from.id, `${note} used on room ${to.unit_name} (${to.guest_name}). Reason: ${reason}`);
    await ev(to.id, `${note} from cancelled room ${from.unit_name} (${from.guest_name}) paid this stay. Reason: ${reason}`);
    await client.query('COMMIT');
    sendControlAlert(propertyId, { bookingIds: [to.id], userId, reason, headline: `🏷 Agent credit ${rp(amount)} used on room ${to.unit_name} (from cancelled room ${from.unit_name})` });
    return { ok: true, amount, left_on_booking: round2(item.available - amount) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { creditFor, summary, targetsFor, useCredit, heldForGroup };
