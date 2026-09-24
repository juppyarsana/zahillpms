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
async function recomputeBookingStatus(client, bookingId) {
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

module.exports = { recomputeBookingStatus };
