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

// Shared by GET /revenue and GET /revenue/export (CSV) so the two never
// drift — the export must show exactly what the page shows.
async function getMonthlyReport(propertyId, month, year) {
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
  `, [month, year, propertyId]);

  // Ancillary (POS/sales) revenue is genuinely a different kind of
  // revenue — it's recognized on the date it was sold, not spread across
  // a room stay, so it stays keyed off sales.created_at as before.
  const ancillaryQ = db.query(`
    SELECT COALESCE(SUM(total_amount), 0) as ancillary_revenue, COUNT(*) as sales_count
    FROM sales
    WHERE property_id = $3 AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2
      AND confirmation_status IS DISTINCT FROM 'rejected'
  `, [month, year, propertyId]);

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
  `, [month, year, propertyId]);

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
  `, [month, year, propertyId]);

  // Expenses (Back Office Slice B) aren't night-based — recognized on the
  // date incurred, same as ancillary/sales revenue above. Safe to query
  // regardless of whether the property has back_office enabled: an
  // unused table just returns 0, so Net Income quietly degrades to
  // "= Total Revenue" rather than erroring for properties that don't use
  // Expenses at all.
  const expensesQ = db.query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE property_id = $3 AND is_voided = false
      AND EXTRACT(MONTH FROM incurred_on) = $1 AND EXTRACT(YEAR FROM incurred_on) = $2
  `, [month, year, propertyId]);

  const [{ rows: [room] }, { rows: [ancillary] }, { rows: daily }, { rows: bySource }, { rows: [expenses] }] =
    await Promise.all([roomQ, ancillaryQ, dailyQ, sourceQ, expensesQ]);

  const roomRev = parseFloat(room.room_revenue);
  const fnbRev = parseFloat(room.fnb_revenue);
  const ancRev = parseFloat(ancillary.ancillary_revenue);
  const totalRevenue = roomRev + fnbRev + ancRev;
  const expensesTotal = parseFloat(expenses.total);
  return {
    month, year,
    room_revenue: roomRev,
    fnb_revenue: fnbRev,
    ancillary_revenue: ancRev,
    total_revenue: totalRevenue,
    expenses_total: expensesTotal,
    net_income: totalRevenue - expensesTotal,
    bookings_count: parseInt(room.bookings_count),
    total_nights: parseInt(room.total_nights),
    daily_revenue: daily,
    by_source: bySource,
  };
}

// GET /api/reports/revenue?month=&year=
router.get('/revenue', auth, requireRole('owner'), async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    res.json(await getMonthlyReport(req.propertyId, month, year));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/reports/revenue/export?month=&year= — CSV, for handing to an
// outside accountant/bookkeeper alongside Back Office's Expenses/Purchase
// Orders exports. Two blocks in one file (a summary row, then the
// revenue-by-source breakdown) — mirrors exactly what the Reports page
// itself shows for the same month, via the same getMonthlyReport().
router.get('/revenue/export', auth, requireRole('owner'), async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const data = await getMonthlyReport(req.propertyId, month, year);
    const lines = [
      'Metric,Value',
      `Month,${csvEscape(`${year}-${String(month).padStart(2, '0')}`)}`,
      `Room Revenue,${data.room_revenue}`,
      `F&B Revenue,${data.fnb_revenue}`,
      `Ancillary Revenue,${data.ancillary_revenue}`,
      `Total Revenue,${data.total_revenue}`,
      `Expenses,${data.expenses_total}`,
      `Net Income,${data.net_income}`,
      `Bookings,${data.bookings_count}`,
      `Room Nights,${data.total_nights}`,
      '',
      'Source,Bookings,Revenue',
      ...data.by_source.map(r => `${csvEscape(r.source)},${r.count},${Math.round(parseFloat(r.revenue) * 100) / 100}`),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="revenue-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
