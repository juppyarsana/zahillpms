// Recomputes a not-yet-arrived booking's status (pending → deposit_paid →
// confirmed) from its actual room payment rows, order-independently. Shared
// by routes/payments.js (a payment marked received) and the booking price
// correction (PUT /api/bookings/:id/price), which can shrink, grow or add a
// pending line. Takes the caller's transaction `client`.
//
// A booking can have more than one 'balance' row: a price correction that
// raises an already fully-paid booking adds a second, pending balance line
// for the difference. The balance counts as paid only when every balance
// line is received. Zero-amount lines are ignored ("nothing owed").
//
// A room of a group billed as a whole (migration 097) has no deposit /
// balance lines of its own: its status follows the GROUP's payments, so the
// whole group is recomputed (recomputeGroupStatus).
async function recomputeBookingStatus(client, bookingId) {
  const { rows: [grp] } = await client.query(
    `SELECT rg.id FROM bookings b JOIN reservation_groups rg ON rg.id = b.reservation_group_id
     WHERE b.id = $1 AND rg.group_billing`, [bookingId]);
  if (grp) {
    await recomputeGroupStatus(client, grp.id);
    const { rows: [b] } = await client.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    return b?.status;
  }
  const { rows: pmts } = await client.query(
    "SELECT type, status FROM payments WHERE booking_id = $1 AND amount > 0 AND type IN ('deposit', 'balance')",
    [bookingId]
  );
  const { rows: [bkg] } = await client.query(
    'SELECT status, deposit_amount FROM bookings WHERE id = $1',
    [bookingId]
  );
  if (!bkg || !['pending', 'deposit_paid', 'confirmed'].includes(bkg.status)) return bkg?.status;

  const noDeposit = !bkg.deposit_amount || parseFloat(bkg.deposit_amount) === 0;
  const deposits = pmts.filter(p => p.type === 'deposit');
  const balances = pmts.filter(p => p.type === 'balance');

  const depositOk = noDeposit || (deposits.length > 0 && deposits.every(p => p.status === 'received'));
  const balanceOk = balances.every(p => p.status === 'received');

  const newStatus = (depositOk && balanceOk) ? 'confirmed'
    : depositOk ? 'deposit_paid'
    : 'pending';

  if (newStatus !== bkg.status) {
    await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, bookingId]);
  }
  return newStatus;
}

// What a group billed as a whole owes for its rooms and what it has paid
// (migration 097): the rooms' prices as entered (total − discount, incl.
// service & tax and the meal plan) against the group's payments. Extras are
// not part of this — they don't decide whether a booking is confirmed.
async function groupRoomMoney(client, groupId) {
  const { rows: [m] } = await client.query(
    `SELECT rg.group_deposit_amount,
            COALESCE((SELECT SUM(b.total_amount - COALESCE(b.discount_amount, 0)) FROM bookings b
                      WHERE b.reservation_group_id = rg.id AND b.status NOT IN ('cancelled', 'no_show')), 0) AS due,
            COALESCE((SELECT SUM(gp.amount) FROM group_payments gp
                      WHERE gp.group_id = rg.id AND NOT gp.is_voided), 0) AS received
     FROM reservation_groups rg WHERE rg.id = $1`, [groupId]);
  if (!m) return null;
  const due = parseFloat(m.due), received = parseFloat(m.received);
  return { due, received, deposit: Math.min(parseFloat(m.group_deposit_amount || 0), due), unpaid: Math.max(0, Math.round((due - received) * 100) / 100) };
}

// Same rule as a single booking (pending → deposit_paid → confirmed), on the
// group's money, applied to every room not arrived yet.
async function recomputeGroupStatus(client, groupId) {
  const m = await groupRoomMoney(client, groupId);
  if (!m) return null;
  const depositOk = m.deposit <= 0 || m.received >= m.deposit - 0.05;
  const balanceOk = m.received >= m.due - 0.05;
  const status = depositOk && balanceOk ? 'confirmed' : depositOk ? 'deposit_paid' : 'pending';
  await client.query(
    `UPDATE bookings SET status = $1, updated_at = NOW()
     WHERE reservation_group_id = $2 AND status IN ('pending', 'deposit_paid', 'confirmed') AND status <> $1`,
    [status, groupId]);
  return status;
}

module.exports = { recomputeBookingStatus, recomputeGroupStatus, groupRoomMoney };
