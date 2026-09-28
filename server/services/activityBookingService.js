const db = require('../db');
const { computeFolioTotals, round2 } = require('./folioService');

// Paid directly = a real payment method (not room_charge, not "not specified").
const paidDirectly = m => !!m && m !== 'room_charge';

// Service charge + tax for an activity booking, by the activity's tax_mode
// (migration 078):
//   added     — before tax: paid directly, added on top now; charged to the
//               room / not paid yet, left NULL (the folio adds them)
//   included  — all-in: the parts inside the price (for the reports)
//   none      — nothing
function activityTaxes(mode, total, ps, paid) {
  if (mode === 'none') return { sc: 0, tax: 0 };
  if (mode === 'included') {
    const f = computeFolioTotals(1000000, ps?.tax_rate, ps?.service_charge_rate).total / 1000000;
    const net = Math.round(total / f);   // whole rupiah, so the parts print cleanly
    const sc = computeFolioTotals(net, ps?.tax_rate, ps?.service_charge_rate).service_charge_amount;
    return { sc, tax: round2(total - net - sc) };
  }
  if (!paid) return { sc: null, tax: null };
  const t = computeFolioTotals(total, ps?.tax_rate, ps?.service_charge_rate);
  return { sc: t.service_charge_amount, tax: t.tax_amount };
}
// What the guest pays: the price, plus service + tax only when they're added on top.
function amountPaid(ab) {
  const extra = ab.tax_mode === 'added' ? (parseFloat(ab.service_charge_amount) || 0) + (parseFloat(ab.tax_amount) || 0) : 0;
  return round2(parseFloat(ab.total_amount) + extra);
}

// Creates an activity booking. Prices are always resolved from the locked
// `activities` row server-side — callers (especially routes/display.js's
// guest-tablet endpoint) must never pass a trusted price. Capacity is
// re-checked inside the same transaction (row-locked) to avoid a race
// between two concurrent bookings for the last slot.
//
// autoConfirm=true is for staff desk bookings (status starts 'confirmed');
// guest self-bookings from the tablet always pass autoConfirm=false, since
// capacity/guide/vehicle availability needs a human check before the guest
// is guaranteed a spot or billed for it.
async function createBooking(propertyId, {
  activityId, bookingId, guestName, guestPhone, scheduledDate, scheduledTime,
  numParticipants, paymentMethod, pickupLocation, notes, bookedVia, createdBy, autoConfirm,
}) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [activity] } = await client.query(
      'SELECT id, price, capacity_per_slot, is_available, tax_mode FROM activities WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [activityId, propertyId]
    );
    if (!activity || !activity.is_available) {
      await client.query('ROLLBACK');
      return { error: 'Activity not found' };
    }

    const participants = parseInt(numParticipants) || 1;
    if (activity.capacity_per_slot != null) {
      const { rows: [{ booked }] } = await client.query(
        `SELECT COALESCE(SUM(num_participants), 0) AS booked
         FROM activity_bookings
         WHERE activity_id = $1 AND scheduled_date = $2 AND status NOT IN ('cancelled', 'no_show')`,
        [activityId, scheduledDate]
      );
      if (parseInt(booked) + participants > activity.capacity_per_slot) {
        await client.query('ROLLBACK');
        return { error: 'This activity is fully booked for the selected date', code: 'CAPACITY_FULL' };
      }
    }

    // payment_method used to be a DB CHECK (cash/qris/room_charge only,
    // migration 037). Migration 064 dropped that so a property's real,
    // configurable payment methods can be selected here too — same choke
    // point salesService.createSale already uses for sales.payment_method
    // (migration 048). 'room_charge' isn't a real payment_methods row; it
    // means "post to the guest's folio," and requires a booking to post to.
    if (paymentMethod === 'room_charge') {
      if (!bookingId) {
        await client.query('ROLLBACK');
        return { error: 'Room Charge requires a linked reservation', code: 'ROOM_CHARGE_REQUIRES_BOOKING' };
      }
    } else if (paymentMethod) {
      const { rows: [pm] } = await client.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true',
        [paymentMethod, propertyId]
      );
      if (!pm) {
        await client.query('ROLLBACK');
        return { error: 'Invalid payment method', code: 'INVALID_PAYMENT_METHOD' };
      }
    }

    const unitPrice = parseFloat(activity.price);
    const totalAmount = unitPrice * participants;
    const status = autoConfirm ? 'confirmed' : 'requested';
    // Service charge + tax by the activity's tax_mode (migration 078, see
    // activityTaxes). total_amount is always price × participants.
    const { rows: [ps] } = await client.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]);
    const taxMode = activity.tax_mode || 'added';
    const taxes = activityTaxes(taxMode, totalAmount, ps, paidDirectly(paymentMethod));

    const { rows: [booking] } = await client.query(
      `INSERT INTO activity_bookings
        (property_id, activity_id, booking_id, guest_name, guest_phone, scheduled_date, scheduled_time,
         num_participants, unit_price, total_amount, payment_method, status, pickup_location, notes, booked_via, created_by,
         service_charge_amount, tax_amount, tax_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [propertyId, activityId, bookingId || null, guestName || null, guestPhone || null, scheduledDate, scheduledTime || null,
        participants, unitPrice, totalAmount, paymentMethod || null, status, pickupLocation || null, notes || null,
        bookedVia || 'staff', createdBy || null, taxes.sc, taxes.tax, taxMode]
    );

    let result = booking;
    if (status === 'confirmed' && booking.payment_method && booking.booking_id) {
      result = await postFolioCharge(client, booking, createdBy);
    }

    await client.query('COMMIT');
    return { booking: result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Puts a confirmed activity linked to a reservation on the guest's folio. The
// line carries the activity's tax_mode, so the folio adds service + tax only
// to an 'added' one (at checkout, like the room):
//   room_charge     — the charge.
//   paid directly   — the charge plus a received 'incidental' payment of what
//                     the guest paid, like a Pay-now extra: the folio shows it,
//                     its balance is unchanged.
async function postFolioCharge(client, activityBooking, actorUserId) {
  const { rows: [activity] } = await client.query('SELECT name FROM activities WHERE id = $1', [activityBooking.activity_id]);
  const description = `${activity?.name || 'Activity'} — ${String(activityBooking.scheduled_date).slice(0, 10)}`;
  const { rows: [charge] } = await client.query(
    `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, tax_mode)
     VALUES ($1,'activity',$2,$3,$4,$5,$6,$7) RETURNING id`,
    [activityBooking.booking_id, description, activityBooking.num_participants, activityBooking.unit_price, activityBooking.total_amount, actorUserId || null,
     activityBooking.tax_mode || 'added']
  );
  if (paidDirectly(activityBooking.payment_method)) {
    if (activityBooking.service_charge_amount == null || activityBooking.tax_amount == null) {   // booked before migration 078
      const { rows: [ps] } = await client.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [activityBooking.property_id]);
      const t = activityTaxes(activityBooking.tax_mode || 'added', parseFloat(activityBooking.total_amount), ps, true);
      activityBooking = { ...activityBooking, service_charge_amount: t.sc, tax_amount: t.tax };
      await client.query('UPDATE activity_bookings SET service_charge_amount = $1, tax_amount = $2 WHERE id = $3', [t.sc, t.tax, activityBooking.id]);
    }
    const gross = amountPaid(activityBooking);
    await client.query(
      `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, activity_booking_id)
       VALUES ($1,'incidental',$2,'received',$3,NOW(),$4,$5,$6)`,
      [activityBooking.booking_id, gross, activityBooking.payment_method, actorUserId || null,
       `Paid at front desk: ${description}`.slice(0, 250), activityBooking.id]
    );
  }
  const { rows: [updated] } = await client.query(
    'UPDATE activity_bookings SET folio_charge_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [charge.id, activityBooking.id]
  );
  return updated;
}

async function voidFolioCharge(client, activityBooking, actorUserId) {
  await client.query(
    `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
     WHERE id = $2 AND is_voided = false`,
    [actorUserId || null, activityBooking.folio_charge_id]
  );
}

const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'];

// Transitions an activity booking's status. Posts it to the folio on the
// transition into 'confirmed' / 'completed' (linked to a reservation, with a
// payment method — see postFolioCharge), and voids the folio charge on the
// transition into 'cancelled'/'no_show'. A paid-directly activity's payment
// stays on the folio as a credit (no refund flow — returned by hand).
async function setStatus(propertyId, id, newStatus, actorUserId) {
  if (!STATUSES.includes(newStatus)) return { error: `status must be one of ${STATUSES.join(', ')}` };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query(
      'SELECT * FROM activity_bookings WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [id, propertyId]
    );
    if (!current) { await client.query('ROLLBACK'); return { error: 'Booking not found' }; }

    let updated = current;
    if (['confirmed', 'completed'].includes(newStatus) && !['cancelled', 'no_show'].includes(current.status)
        && current.payment_method && current.booking_id && !current.folio_charge_id) {
      updated = await postFolioCharge(client, current, actorUserId);
    } else if (['cancelled', 'no_show'].includes(newStatus) && current.folio_charge_id) {
      await voidFolioCharge(client, current, actorUserId);
    }

    const { rows: [result] } = await client.query(
      'UPDATE activity_bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newStatus, updated.id]
    );
    await client.query('COMMIT');
    return { booking: result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Takes payment for an activity booked as "Not paid yet": sets the method
// (room_charge, or a real payment method = paid now), works out service + tax
// like at booking, and — when it's confirmed / completed and linked to a stay
// — puts it on the folio exactly like a booking made with that method.
async function setPayment(propertyId, id, paymentMethod, actorUserId) {
  if (!paymentMethod) return { error: 'Choose how it is paid', code: 'PAYMENT_METHOD_REQUIRED' };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query(
      'SELECT * FROM activity_bookings WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [id, propertyId]
    );
    if (!current) { await client.query('ROLLBACK'); return { error: 'Booking not found', code: 'NOT_FOUND' }; }
    if (current.payment_method) { await client.query('ROLLBACK'); return { error: 'This activity already has a payment', code: 'ALREADY_PAID' }; }
    if (['cancelled', 'no_show'].includes(current.status)) { await client.query('ROLLBACK'); return { error: 'This activity is cancelled', code: 'CANCELLED' }; }
    if (paymentMethod === 'room_charge') {
      if (!current.booking_id) { await client.query('ROLLBACK'); return { error: 'Room Charge requires a linked reservation', code: 'ROOM_CHARGE_REQUIRES_BOOKING' }; }
    } else {
      const { rows: [pm] } = await client.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true',
        [paymentMethod, propertyId]
      );
      if (!pm) { await client.query('ROLLBACK'); return { error: 'Invalid payment method', code: 'INVALID_PAYMENT_METHOD' }; }
    }
    const { rows: [ps] } = await client.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]);
    const taxes = activityTaxes(current.tax_mode || 'added', parseFloat(current.total_amount), ps, paidDirectly(paymentMethod));
    let { rows: [updated] } = await client.query(
      `UPDATE activity_bookings SET payment_method = $1, service_charge_amount = $2, tax_amount = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [paymentMethod, taxes.sc, taxes.tax, id]
    );
    if (['confirmed', 'completed'].includes(updated.status) && updated.booking_id && !updated.folio_charge_id) {
      updated = await postFolioCharge(client, updated, actorUserId);
    }
    await client.query('COMMIT');
    return { booking: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createBooking, setStatus, setPayment, activityTaxes, amountPaid };
