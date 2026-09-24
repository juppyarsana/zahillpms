const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// Shared CTE: expands every in-scope booking into one row per night that
// actually falls within the requested period (clipped at its first/last
// day), with that booking's room/F&B revenue spread evenly across its
// nights. This is what makes every number below "night-based" — a booking
// that crosses the period boundary contributes only the nights that really
// landed inside it, not its whole stay dumped onto its check-in date. A
// night counts on the date it starts (the night of 24 Sep = 24 Sep).
// $1=from, $2=to (inclusive dates), $3=property_id.
const NIGHTS_CTE = `
  WITH bounds AS (
    SELECT $1::date AS start_date, $2::date AS end_date
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
// drift — the export must show exactly what the page shows. `from`/`to` are
// inclusive YYYY-MM-DD dates (a whole month, a single day, any range).
async function getReport(propertyId, from, to) {
    // Room / F&B revenue, bookings, and nights are all night-based: a
    // booking contributes only the nights that actually fall in the
    // period, not its whole stay attributed to its check-in date. Keeps
    // this in lockstep with the daily chart below (which was always
    // night-based) — the two used to disagree for any booking crossing a
    // month boundary.
  const roomQ = db.query(`
    ${NIGHTS_CTE}
    SELECT
      COALESCE(SUM(room_rev_per_night), 0) as room_revenue,
      COALESCE(SUM(fnb_rev_per_night), 0) as fnb_revenue,
      COUNT(DISTINCT booking_id) as bookings_count,
      COUNT(*) as total_nights
    FROM nights
  `, [from, to, propertyId]);

  // Ancillary (POS/sales) revenue is genuinely a different kind of
  // revenue — it's recognized on the date it was sold, not spread across
  // a room stay, so it stays keyed off sales.created_at as before.
  const ancillaryQ = db.query(`
    SELECT COALESCE(SUM(total_amount), 0) as ancillary_revenue, COUNT(*) as sales_count
    FROM sales
    WHERE property_id = $3 AND (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date
      AND confirmation_status IS DISTINCT FROM 'rejected'
  `, [from, to, propertyId]);

  // nights_sold (room-nights occupied that day) rides along so the client
  // can derive that day's own implied rate (room_revenue / nights_sold)
  // and compare it to ADR — comparing a day's aggregate revenue directly
  // against ADR would be misleading on any day with more than one room
  // occupied (ADR is a per-room-night rate, not a per-day total).
  const dailyQ = db.query(`
    ${NIGHTS_CTE}
    SELECT gs::date as date,
      COALESCE(SUM(n.room_rev_per_night), 0) as room_revenue,
      COALESCE(SUM(n.fnb_rev_per_night), 0) as fnb_revenue,
      COUNT(n.booking_id) as nights_sold
    FROM generate_series($1::date, $2::date, '1 day') gs
    LEFT JOIN nights n ON n.night = gs::date
    GROUP BY gs ORDER BY gs
  `, [from, to, propertyId]);

  // Per-day ancillary sales and expenses, same date rules as the totals
  // above — merged into daily_revenue for the CSV's daily breakdown.
  const ancillaryDailyQ = db.query(`
    SELECT (created_at AT TIME ZONE 'Asia/Makassar')::date AS date, COALESCE(SUM(total_amount), 0) AS amount
    FROM sales
    WHERE property_id = $3 AND (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date
      AND confirmation_status IS DISTINCT FROM 'rejected'
    GROUP BY 1
  `, [from, to, propertyId]);
  const expensesDailyQ = db.query(`
    SELECT incurred_on AS date, COALESCE(SUM(amount), 0) AS amount
    FROM expenses
    WHERE property_id = $3 AND is_voided = false AND incurred_on BETWEEN $1::date AND $2::date
    GROUP BY 1
  `, [from, to, propertyId]);

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
  `, [from, to, propertyId]);

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
      AND incurred_on BETWEEN $1::date AND $2::date
  `, [from, to, propertyId]);

  const [{ rows: [room] }, { rows: [ancillary] }, { rows: daily }, { rows: bySource }, { rows: [expenses] }] =
    await Promise.all([roomQ, ancillaryQ, dailyQ, sourceQ, expensesQ]);
  const [{ rows: ancDaily }, { rows: expDaily }] = await Promise.all([ancillaryDailyQ, expensesDailyQ]);
  const dayKey = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const ancByDay = new Map(ancDaily.map(r => [dayKey(r.date), parseFloat(r.amount)]));
  const expByDay = new Map(expDaily.map(r => [dayKey(r.date), parseFloat(r.amount)]));
  for (const d of daily) {
    d.ancillary_revenue = ancByDay.get(dayKey(d.date)) || 0;
    d.expenses = expByDay.get(dayKey(d.date)) || 0;
  }

  const roomRev = parseFloat(room.room_revenue);
  const fnbRev = parseFloat(room.fnb_revenue);
  const ancRev = parseFloat(ancillary.ancillary_revenue);
  const totalRevenue = roomRev + fnbRev + ancRev;
  const expensesTotal = parseFloat(expenses.total);
  return {
    from, to,
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

// Resolves the requested period: ?from=&to= (inclusive dates — Today, This
// week, a custom range, …), or the original ?month=&year= (a whole month),
// defaulting to the current month. Returns { error } on a bad range.
function resolvePeriod(query) {
  if (query.from || query.to) {
    const from = String(query.from || '');
    const to = String(query.to || query.from || '');
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return { error: 'from and to must be dates (YYYY-MM-DD)' };
    }
    if (to < from) return { error: 'to must be on or after from' };
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_RANGE_DAYS) {
      return { error: `Period can be at most ${MAX_RANGE_DAYS} days` };
    }
    return { from, to };
  }
  const now = new Date();
  const month = parseInt(query.month) || now.getMonth() + 1;
  const year = parseInt(query.year) || now.getFullYear();
  const pad = n => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

// GET /api/reports/revenue?from=&to=  (or legacy ?month=&year=)
router.get('/revenue', auth, requireRole('owner'), async (req, res) => {
  const period = resolvePeriod(req.query);
  if (period.error) return res.status(400).json({ error: period.error });
  try {
    res.json(await getReport(req.propertyId, period.from, period.to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/reports/revenue/export?from=&to= (or ?month=&year=) — CSV, for handing to an
// outside accountant/bookkeeper alongside Back Office's Expenses/Purchase
// Orders exports. Blocks in one file: a summary, the revenue-by-source
// breakdown, and (multi-day periods) a daily breakdown — mirrors exactly what the Reports page
// itself shows for the same period, via the same getReport().
router.get('/revenue/export', auth, requireRole('owner'), async (req, res) => {
  const period = resolvePeriod(req.query);
  if (period.error) return res.status(400).json({ error: period.error });
  try {
    const data = await getReport(req.propertyId, period.from, period.to);
    const label = period.from === period.to ? period.from : `${period.from} to ${period.to}`;
    const lines = [
      'Metric,Value',
      `Period,${csvEscape(label)}`,
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
    // Daily breakdown for multi-day periods — one row per day, same rules as
    // the summary (room/F&B night-based, sales by WITA day, expenses by date),
    // so the rows add up to the summary above.
    if (period.from !== period.to) {
      const r2 = n => Math.round(parseFloat(n) * 100) / 100;
      lines.push('', 'Date,Room Revenue,F&B Revenue,Ancillary Revenue,Total Revenue,Expenses,Net Income,Room Nights');
      for (const d of data.daily_revenue) {
        const total = r2(parseFloat(d.room_revenue) + parseFloat(d.fnb_revenue) + d.ancillary_revenue);
        lines.push([String(d.date).slice(0, 10), r2(d.room_revenue), r2(d.fnb_revenue), r2(d.ancillary_revenue),
          total, r2(d.expenses), r2(total - d.expenses), d.nights_sold].join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv');
    const fileLabel = period.from === period.to ? period.from : `${period.from}_to_${period.to}`;
    res.setHeader('Content-Disposition', `attachment; filename="revenue-${fileLabel}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
