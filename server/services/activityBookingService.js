const db = require('../db');

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
      'SELECT id, price, capacity_per_slot, is_available FROM activities WHERE id = $1 AND property_id = $2 FOR UPDATE',
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

    const unitPrice = parseFloat(activity.price);
    const totalAmount = unitPrice * participants;
    const status = autoConfirm ? 'confirmed' : 'requested';

    const { rows: [booking] } = await client.query(
      `INSERT INTO activity_bookings
        (property_id, activity_id, booking_id, guest_name, guest_phone, scheduled_date, scheduled_time,
         num_participants, unit_price, total_amount, payment_method, status, pickup_location, notes, booked_via, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [propertyId, activityId, bookingId || null, guestName || null, guestPhone || null, scheduledDate, scheduledTime || null,
        participants, unitPrice, totalAmount, paymentMethod || null, status, pickupLocation || null, notes || null,
        bookedVia || 'staff', createdBy || null]
    );

    let result = booking;
    if (status === 'confirmed' && booking.payment_method === 'room_charge' && booking.booking_id) {
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

async function postFolioCharge(client, activityBooking, actorUserId) {
  const { rows: [activity] } = await client.query('SELECT name FROM activities WHERE id = $1', [activityBooking.activity_id]);
  const description = `${activity?.name || 'Activity'} — ${String(activityBooking.scheduled_date).slice(0, 10)}`;
  const { rows: [charge] } = await client.query(
    `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by)
     VALUES ($1,'activity',$2,$3,$4,$5,$6) RETURNING id`,
    [activityBooking.booking_id, description, activityBooking.num_participants, activityBooking.unit_price, activityBooking.total_amount, actorUserId || null]
  );
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

// Transitions an activity booking's status. Posts a folio charge on the
// transition into 'confirmed' (room-charge bookings only), and voids it on
// the transition into 'cancelled'/'no_show' if one was posted.
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
    if (newStatus === 'confirmed' && current.status !== 'confirmed' && current.payment_method === 'room_charge' && current.booking_id && !current.folio_charge_id) {
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

module.exports = { createBooking, setStatus };
