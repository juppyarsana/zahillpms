const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// Shared CTE: expands every in-scope booking into one row per night that
// actually falls within the requested month (clipped at the month's start/
// end), with that booking's room/F&B revenue spread evenly across its
// nights. This is what makes every number below "night-based" — a booking
// that crosses a month boundary contributes only the nights that really
// landed in this month, not its whole stay dumped onto whichever month it
// checked in on. $1=month, $2=year, $3=property_id.
const NIGHTS_CTE = `
  WITH bounds AS (
    SELECT
      MAKE_DATE($2::int, $1::int, 1) AS start_date,
      (MAKE_DATE($2::int, $1::int, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS end_date
  ),
  nights AS (
    SELECT
      b.id AS booking_id,
      b.source,
      d::date AS night,
      COALESCE(b.room_revenue, b.total_amount) / NULLIF(b.nights, 0) AS room_rev_per_night,
      COALESCE(b.fnb_revenue, 0) / NULLIF(b.nights, 0) AS fnb_rev_per_night
    FROM bookings b, bounds,
      LATERAL generate_series(
        GREATEST(b.check_in_date, bounds.start_date),
        LEAST((b.check_out_date - INTERVAL '1 day')::date, bounds.end_date),
        INTERVAL '1 day'
      ) AS d
    WHERE b.property_id = $3
      AND b.status IN ('checked_in', 'checked_out', 'confirmed')
  )
`;

// GET /api/reports/revenue?month=&year=
router.get('/revenue', auth, requireRole('owner'), async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    // Room / F&B revenue, bookings, and nights are all night-based: a
    // booking contributes only the nights that actually fall in this
    // month, not its whole stay attributed to whichever month it checked
    // in on. Keeps this in lockstep with the daily chart below (which was
    // always night-based) — the two used to disagree for any booking
    // crossing a month boundary.
    const roomQ = db.query(`
      ${NIGHTS_CTE}
      SELECT
        COALESCE(SUM(room_rev_per_night), 0) as room_revenue,
        COALESCE(SUM(fnb_rev_per_night), 0) as fnb_revenue,
        COUNT(DISTINCT booking_id) as bookings_count,
        COUNT(*) as total_nights
      FROM nights
    `, [month, year, req.propertyId]);

    // Ancillary (POS/sales) revenue is genuinely a different kind of
    // revenue — it's recognized on the date it was sold, not spread across
    // a room stay, so it stays keyed off sales.created_at as before.
    const ancillaryQ = db.query(`
      SELECT COALESCE(SUM(total_amount), 0) as ancillary_revenue, COUNT(*) as sales_count
      FROM sales
      WHERE property_id = $3 AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2
        AND confirmation_status IS DISTINCT FROM 'rejected'
    `, [month, year, req.propertyId]);

    // nights_sold (room-nights occupied that day) rides along so the client
    // can derive that day's own implied rate (room_revenue / nights_sold)
    // and compare it to ADR — comparing a day's aggregate revenue directly
    // against ADR would be misleading on any day with more than one room
    // occupied (ADR is a per-room-night rate, not a per-day total).
    const dailyQ = db.query(`
      ${NIGHTS_CTE}
      SELECT gs::date as date,
        COALESCE(SUM(n.room_rev_per_night), 0) as room_revenue,
        COUNT(n.booking_id) as nights_sold
      FROM generate_series(
        MAKE_DATE($2::int, $1::int, 1),
        MAKE_DATE($2::int, $1::int, 1) + INTERVAL '1 month' - INTERVAL '1 day',
        '1 day'
      ) gs
      LEFT JOIN nights n ON n.night = gs::date
      GROUP BY gs ORDER BY gs
    `, [month, year, req.propertyId]);

    // bookings.source stores the booking_sources.id (a slug like
    // "booking_com") — join for the human-readable label, same as
    // Agents.jsx's source_label, falling back to the raw slug for any
    // orphaned/legacy value with no matching row.
    const sourceQ = db.query(`
      ${NIGHTS_CTE}
      SELECT
        COALESCE(bs.label, nights.source, 'Unspecified') as source,
        COUNT(DISTINCT nights.booking_id) as count,
        COALESCE(SUM(nights.room_rev_per_night + nights.fnb_rev_per_night), 0) as revenue
      FROM nights
      LEFT JOIN booking_sources bs ON bs.id = nights.source AND bs.property_id = $3
      GROUP BY COALESCE(bs.label, nights.source, 'Unspecified')
    `, [month, year, req.propertyId]);

    const [{ rows: [room] }, { rows: [ancillary] }, { rows: daily }, { rows: bySource }] = await Promise.all([roomQ, ancillaryQ, dailyQ, sourceQ]);

    const roomRev = parseFloat(room.room_revenue);
    const fnbRev = parseFloat(room.fnb_revenue);
    const ancRev = parseFloat(ancillary.ancillary_revenue);
    res.json({
      month, year,
      room_revenue: roomRev,
      fnb_revenue: fnbRev,
      ancillary_revenue: ancRev,
      total_revenue: roomRev + fnbRev + ancRev,
      bookings_count: parseInt(room.bookings_count),
      total_nights: parseInt(room.total_nights),
      daily_revenue: daily,
      by_source: bySource,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
