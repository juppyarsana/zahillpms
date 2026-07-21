const db = require('../db');
const { sendBookingEmail } = require('../services/mailer');

function getWitaDate(offsetDays) {
  const wita = new Date(Date.now() + 8 * 60 * 60 * 1000);
  wita.setUTCDate(wita.getUTCDate() + offsetDays);
  const y = wita.getUTCFullYear();
  const m = String(wita.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wita.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Bookings due for `trigger` on `dateColumn` = targetDate, for active properties,
// that don't already have a log entry for this trigger (dedup guard).
async function findDueBookings(trigger, dateColumn, targetDate, extraFilter = '') {
  const { rows } = await db.query(`
    SELECT DISTINCT b.property_id, b.id AS booking_id
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    LEFT JOIN communication_log cl ON cl.booking_id = b.id AND cl.trigger = $1
    WHERE b.${dateColumn} = $2
      AND g.email IS NOT NULL
      AND cl.id IS NULL
      ${extraFilter}
      AND EXISTS (SELECT 1 FROM properties p WHERE p.id = b.property_id AND p.is_active = true)
  `, [trigger, targetDate]);
  return rows;
}

async function sendPreArrivalEmails() {
  const tomorrow = getWitaDate(1);
  const bookings = await findDueBookings('pre_arrival', 'check_in_date', tomorrow, `AND b.status NOT IN ('cancelled', 'no_show')`);
  let sent = 0;
  for (const b of bookings) {
    try {
      const result = await sendBookingEmail(b.property_id, b.booking_id, 'pre_arrival');
      if (result.sent) sent++;
    } catch (err) {
      console.error(`[Communications] Pre-arrival email failed for booking ${b.booking_id}:`, err.message);
    }
  }
  console.log(`[Communications] Pre-arrival: ${sent}/${bookings.length} email(s) sent for ${tomorrow}`);
  return { checked: bookings.length, sent };
}

async function sendPostCheckoutEmails() {
  const yesterday = getWitaDate(-1);
  const bookings = await findDueBookings('post_checkout', 'check_out_date', yesterday, `AND b.status = 'checked_out'`);
  let sent = 0;
  for (const b of bookings) {
    try {
      const result = await sendBookingEmail(b.property_id, b.booking_id, 'post_checkout');
      if (result.sent) sent++;
    } catch (err) {
      console.error(`[Communications] Post-checkout email failed for booking ${b.booking_id}:`, err.message);
    }
  }
  console.log(`[Communications] Post-checkout: ${sent}/${bookings.length} email(s) sent for ${yesterday}`);
  return { checked: bookings.length, sent };
}

module.exports = { sendPreArrivalEmails, sendPostCheckoutEmails };
