const db = require('../db');

// Reservations MADE in a period (by the day they were created, WITA — not the
// stay dates). ONE definition shared by the Dashboard ("New reservations
// today"), the Reservations page's "Booked on" view, the Daily Close and the
// Weekly report, so they can never disagree.
//
//   bookings = reservations: a group booking counts once, however many rooms
//   rooms    = room bookings (a 5-room group = 1 booking, 5 rooms)
//   nights   = room-nights
//   value    = NET — room + meals after discount, before service and tax
//              (bookings.room_revenue + fnb_revenue), the same basis as the
//              revenue reports
// Everything made in the period counts, even if cancelled later (that shows
// under cancelled). Cancelled = status cancelled and last changed in the
// period (there is no cancelled_at column).

const WITA_DAY = col => `(${col} AT TIME ZONE 'Asia/Makassar')::date`;
const VALUE_SQL = `COALESCE(b.room_revenue + b.fnb_revenue, b.total_amount - COALESCE(b.discount_amount, 0))`;

const ROW_SQL = `
  SELECT b.id, b.reservation_group_id, b.status, b.check_in_date, b.check_out_date, b.nights,
         b.num_guests, b.created_at, b.updated_at, ${VALUE_SQL} AS value,
         g.name AS guest_name, bg.name AS booker_name, u.name AS unit_name,
         COALESCE(bs.label, b.source) AS source_label, cu.name AS created_by_name
  FROM bookings b
  JOIN guests g ON g.id = b.guest_id
  JOIN units u ON u.id = b.unit_id
  LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
  LEFT JOIN guests bg ON bg.id = rg.primary_guest_id
  LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
  LEFT JOIN users cu ON cu.id = b.created_by
  WHERE b.property_id = $1`;

const num = v => parseFloat(v || 0);

function summarize(rows) {
  return {
    bookings: new Set(rows.map(r => r.reservation_group_id || r.id)).size,
    rooms: rows.length,
    nights: rows.reduce((s, r) => s + (parseInt(r.nights, 10) || 0), 0),
    guests: rows.reduce((s, r) => s + (parseInt(r.num_guests, 10) || 0), 0),
    value: rows.reduce((s, r) => s + num(r.value), 0),
  };
}

// Room rows → one row per reservation (a group's rooms folded into one).
function foldGroups(rows) {
  const out = new Map();
  for (const r of rows) {
    const key = r.reservation_group_id || r.id;
    const cur = out.get(key);
    if (!cur) {
      out.set(key, {
        id: r.id,
        group_id: r.reservation_group_id,
        guest_name: r.reservation_group_id ? (r.booker_name || r.guest_name) : r.guest_name,
        source_label: r.source_label,
        created_at: r.created_at,
        created_by_name: r.created_by_name,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        rooms: 1,
        unit_names: [r.unit_name],
        nights: parseInt(r.nights, 10) || 0,
        guests: parseInt(r.num_guests, 10) || 0,
        value: num(r.value),
        statuses: [r.status],
      });
    } else {
      cur.rooms++;
      cur.unit_names.push(r.unit_name);
      cur.nights += parseInt(r.nights, 10) || 0;
      cur.guests += parseInt(r.num_guests, 10) || 0;
      cur.value += num(r.value);
      cur.statuses.push(r.status);
      if (r.check_in_date < cur.check_in_date) cur.check_in_date = r.check_in_date;
      if (r.check_out_date > cur.check_out_date) cur.check_out_date = r.check_out_date;
    }
  }
  return [...out.values()].map(r => ({
    ...r,
    unit_names: r.unit_names.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
    // Whole reservation cancelled / partly cancelled / live.
    cancelled_rooms: r.statuses.filter(s => s === 'cancelled').length,
  }));
}

// from / to: inclusive YYYY-MM-DD (WITA). withRows: also return the
// reservations themselves (Reservations page), newest first.
async function bookingsMade(propertyId, from, to = from, { withRows = false } = {}) {
  const [{ rows: made }, { rows: cancelled }] = await Promise.all([
    db.query(`${ROW_SQL} AND ${WITA_DAY('b.created_at')} BETWEEN $2::date AND $3::date
              ORDER BY b.created_at DESC`, [propertyId, from, to]),
    db.query(`${ROW_SQL} AND b.status = 'cancelled' AND ${WITA_DAY('b.updated_at')} BETWEEN $2::date AND $3::date
              ORDER BY b.updated_at DESC`, [propertyId, from, to]),
  ]);
  const result = {
    from, to,
    made: summarize(made),
    cancelled: summarize(cancelled),
  };
  if (withRows) {
    result.rows = foldGroups(made);
    result.cancelled_rows = foldGroups(cancelled);
  }
  return result;
}

module.exports = { bookingsMade };
