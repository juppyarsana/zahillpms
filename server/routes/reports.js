const router = require('express').Router();
const db = require('../db');
const { round2 } = require('../services/folioService');
const { roomRevPerNightSql } = require('../services/nightRates');
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
      b.unit_id, b.rate_plan_id, b.guest_id, COALESCE(b.num_guests, 0) AS num_guests,
      COALESCE(b.discount_amount, 0) / NULLIF(b.nights, 0) AS discount_per_night,
      d::date AS night,
      -- each night at its own price when the stay has night rates (090)
      ${roomRevPerNightSql('b', 'd')} AS room_rev_per_night,
      COALESCE(b.fnb_revenue, 0) / NULLIF(b.nights, 0) AS fnb_rev_per_night,
      -- Complimentary stay (migration 072): counts for occupancy, not ADR.
      (b.complimentary_scope IS NOT NULL) AS comp,
      COALESCE(b.complimentary_night_value, 0) AS comp_value_per_night
    FROM bookings b, bounds,
      LATERAL generate_series(
        GREATEST(b.check_in_date, bounds.start_date),
        LEAST((b.check_out_date - INTERVAL '1 day')::date, bounds.end_date),
        INTERVAL '1 day'
      ) AS d
    WHERE b.property_id = $3
      -- Every live reservation, paid or not: pending / deposit_paid rooms
      -- are real bookings (Guest Lists, Dashboard and availability all count
      -- them) — leaving them out made occupancy and revenue too low.
      AND b.status NOT IN ('cancelled', 'no_show')
  )
`;

// A sale charged to a room whose stay is complimentary for everything.
const COMP_SALE_SQL = `(s.payment_method = 'room_charge' AND s.booking_id IN (SELECT id FROM bookings WHERE complimentary_scope = 'all'))`;

// A sale whose one-off items are not on the guest's bill: its folio line was
// voided by hand (the sale itself stays as it was), or it was charged to a
// room and never posted. Not revenue — the journal leaves it out too.
// Per-night lines have no line of their own here (their nights post as
// 'addon' lines), so only 'sale' lines are looked at.
const SALE_OFF_BILL_SQL = `(
  NOT EXISTS (SELECT 1 FROM folio_charges fl WHERE fl.sale_id = s.id AND fl.type = 'sale' AND fl.is_voided = false)
  AND (EXISTS (SELECT 1 FROM folio_charges fv WHERE fv.sale_id = s.id AND fv.type = 'sale')
       OR (s.payment_method = 'room_charge'
           AND (s.order_source = 'external_pos'
                OR EXISTS (SELECT 1 FROM sale_items sx WHERE sx.sale_id = s.id AND NOT sx.per_night))))
)`;

// Sales by the WITA day they were made, with each sale's lines split
// (migration 074): `pn` = per-night lines (extra bed) — NOT counted here,
// they're counted night by night from booking_addons (ADDON_NIGHTS_SQL);
// `meal` = the breakfast part of the other hotel-extra lines → F&B;
// `outlet` = food & drink lines (resto app, Room Display dining, staff POS)
// and external POS bills (no sale_items, migration 070) → F&B outlets;
// the rest → extras. $1=from, $2=to, $3=property_id.
const SALES_SQL = `
  SELECT s.*, (s.created_at AT TIME ZONE 'Asia/Makassar')::date AS day,
         COALESCE(li.pn, 0) AS pn, COALESCE(li.meal, 0) AS meal,
         COALESCE(li.outlet, 0) + CASE WHEN s.order_source = 'external_pos' THEN s.total_amount ELSE 0 END AS outlet,
         COALESCE(${COMP_SALE_SQL}, false) AS comp
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT SUM(si.subtotal) FILTER (WHERE si.per_night) AS pn,
           SUM(si.meal_amount) FILTER (WHERE NOT si.per_night AND p.category NOT IN ('food', 'drinks')) AS meal,
           SUM(si.subtotal) FILTER (WHERE NOT si.per_night AND p.category IN ('food', 'drinks')) AS outlet
    FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id
  ) li ON true
  WHERE s.property_id = $3 AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date
    AND s.confirmation_status IS DISTINCT FROM 'rejected'
    AND NOT ${SALE_OFF_BILL_SQL}`;

// Per-night stay extras (extra bed, migration 074), one row per add-on night
// inside the period and inside its booking's stay (Amend Dates / early
// departure leave nights outside uncharged). `extra` = the item's own part,
// `meal` = its breakfast part (→ F&B). A stay complimentary for everything
// gives them away (comp).
const ADDON_NIGHTS_SQL = `
  SELECT a.service_date AS night, a.product_id,
         a.quantity * a.unit_price - LEAST(a.breakfasts * a.meal_price, a.quantity * a.unit_price) AS extra,
         LEAST(a.breakfasts * a.meal_price, a.quantity * a.unit_price) AS meal,
         COALESCE(b.complimentary_scope = 'all', false) AS comp
  FROM booking_addons a
  JOIN bookings b ON b.id = a.booking_id
  WHERE a.property_id = $3 AND a.status = 'active'
    AND b.status NOT IN ('cancelled', 'no_show')
    AND a.service_date BETWEEN $1::date AND $2::date
    AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
    -- a night whose line was voided by hand on a stay that has checked out
    -- (nothing posts it again) is off the bill
    AND NOT (b.status = 'checked_out'
             AND EXISTS (SELECT 1 FROM folio_charges fv WHERE fv.addon_id = a.id)
             AND NOT EXISTS (SELECT 1 FROM folio_charges fl WHERE fl.addon_id = a.id AND fl.is_voided = false))`;

// Activities (migration 037) on the day they take place, once confirmed or
// completed (a request isn't a sale yet; cancelled / no-show aren't). NET:
// an activity priced tax-included (migration 078) has its service + tax
// parts taken out. Charged to a stay complimentary for everything = given
// away (comp).
const ACTIVITY_SQL = `
  SELECT ab.scheduled_date AS day, a.name, ab.num_participants, ab.tax_mode,
         COALESCE(ab.service_charge_amount, 0) AS sc_part, COALESCE(ab.tax_amount, 0) AS tax_part,
         CASE WHEN ab.tax_mode = 'included'
              THEN ab.total_amount - COALESCE(ab.service_charge_amount, 0) - COALESCE(ab.tax_amount, 0)
              ELSE ab.total_amount END AS net,
         COALESCE(ab.payment_method = 'room_charge' AND b.complimentary_scope = 'all', false) AS comp
  FROM activity_bookings ab
  JOIN activities a ON a.id = ab.activity_id
  LEFT JOIN bookings b ON b.id = ab.booking_id
  WHERE ab.property_id = $3 AND ab.status IN ('confirmed', 'completed')
    AND ab.scheduled_date BETWEEN $1::date AND $2::date`;

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
      COUNT(*) as total_nights,
      COUNT(*) FILTER (WHERE NOT comp) as paid_nights,
      COUNT(*) FILTER (WHERE comp) as comp_nights,
      COALESCE(SUM(comp_value_per_night) FILTER (WHERE comp), 0) as comp_room_value
    FROM nights
  `, [from, to, propertyId]);

  // Ancillary (POS/sales) revenue is genuinely a different kind of
  // revenue — it's recognized on the date it was sold, not spread across
  // a room stay, so it stays keyed off sales.created_at as before.
  // Extras charged to a stay that's complimentary for everything are given
  // away, not revenue — counted in comp_extras_value instead.
  const ancillaryQ = db.query(`
    WITH x AS (${SALES_SQL})
    SELECT COALESCE(SUM(total_amount - pn - meal - outlet) FILTER (WHERE NOT comp), 0) as ancillary_revenue,
           COALESCE(SUM(meal) FILTER (WHERE NOT comp), 0) as sales_meal_revenue,
           COALESCE(SUM(outlet) FILTER (WHERE NOT comp), 0) as outlet_revenue,
           COUNT(*) FILTER (WHERE NOT comp) as sales_count,
           COALESCE(SUM(total_amount - pn) FILTER (WHERE comp), 0) as comp_extras_value
    FROM x
  `, [from, to, propertyId]);
  const activityQ = db.query(`
    WITH x AS (${ACTIVITY_SQL})
    SELECT COALESCE(SUM(net) FILTER (WHERE NOT comp), 0) AS revenue,
           COUNT(*) FILTER (WHERE NOT comp) AS count,
           COALESCE(SUM(net) FILTER (WHERE comp), 0) AS comp_value
    FROM x
  `, [from, to, propertyId]);
  const activityDailyQ = db.query(`
    WITH x AS (${ACTIVITY_SQL})
    SELECT day AS date, COALESCE(SUM(net), 0) AS amount FROM x WHERE NOT comp GROUP BY 1
  `, [from, to, propertyId]);
  const addonQ = db.query(`
    WITH x AS (${ADDON_NIGHTS_SQL})
    SELECT COALESCE(SUM(extra) FILTER (WHERE NOT comp), 0) AS extra,
           COALESCE(SUM(meal) FILTER (WHERE NOT comp), 0) AS meal,
           COALESCE(SUM(extra + meal) FILTER (WHERE comp), 0) AS comp_value
    FROM x
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
      COUNT(n.booking_id) as nights_sold,
      COUNT(n.booking_id) FILTER (WHERE NOT n.comp) as paid_nights_sold
    FROM generate_series($1::date, $2::date, '1 day') gs
    LEFT JOIN nights n ON n.night = gs::date
    GROUP BY gs ORDER BY gs
  `, [from, to, propertyId]);

  // Per-day ancillary sales and expenses, same date rules as the totals
  // above — merged into daily_revenue for the CSV's daily breakdown.
  const ancillaryDailyQ = db.query(`
    WITH x AS (${SALES_SQL})
    SELECT day AS date, COALESCE(SUM(total_amount - pn - meal - outlet), 0) AS amount, COALESCE(SUM(meal), 0) AS meal,
           COALESCE(SUM(outlet), 0) AS outlet
    FROM x WHERE NOT comp
    GROUP BY 1
  `, [from, to, propertyId]);
  const addonDailyQ = db.query(`
    WITH x AS (${ADDON_NIGHTS_SQL})
    SELECT night AS date, COALESCE(SUM(extra), 0) AS extra, COALESCE(SUM(meal), 0) AS meal
    FROM x WHERE NOT comp
    GROUP BY 1
  `, [from, to, propertyId]);
  // Restaurant sessions sent by the POS (migration 086): bills paid at the
  // restaurant, NET, on the session's business day → F&B outlets. Room
  // charges aren't in it (they're sales above), nor package breakfasts.
  const posSessionsQ = db.query(`
    SELECT business_date AS date, COALESCE(SUM(outlet_net), 0) AS net, COUNT(*) AS sessions
    FROM pos_sessions
    WHERE property_id = $3 AND business_date BETWEEN $1::date AND $2::date
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

  const [{ rows: [room] }, { rows: [ancillary] }, { rows: daily }, { rows: bySource }, { rows: [expenses] }, { rows: [addon] }, { rows: [activity] }] =
    await Promise.all([roomQ, ancillaryQ, dailyQ, sourceQ, expensesQ, addonQ, activityQ]);
  const [{ rows: ancDaily }, { rows: expDaily }, { rows: addonDaily }, { rows: actDaily }, { rows: posDaily }] =
    await Promise.all([ancillaryDailyQ, expensesDailyQ, addonDailyQ, activityDailyQ, posSessionsQ]);
  const dayKey = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const ancByDay = new Map(ancDaily.map(r => [dayKey(r.date), r]));
  const addonByDay = new Map(addonDaily.map(r => [dayKey(r.date), r]));
  const expByDay = new Map(expDaily.map(r => [dayKey(r.date), parseFloat(r.amount)]));
  const actByDay = new Map(actDaily.map(r => [dayKey(r.date), parseFloat(r.amount)]));
  const posByDay = new Map(posDaily.map(r => [dayKey(r.date), parseFloat(r.net)]));
  const posSessionsNet = posDaily.reduce((sum, r) => sum + parseFloat(r.net), 0);
  for (const d of daily) {
    const sa = ancByDay.get(dayKey(d.date));
    const ad = addonByDay.get(dayKey(d.date));
    d.fnb_rate_plan = parseFloat(d.fnb_revenue);
    d.fnb_extras = (sa ? parseFloat(sa.meal) : 0) + (ad ? parseFloat(ad.meal) : 0);
    d.fnb_outlets = (sa ? parseFloat(sa.outlet) : 0) + (posByDay.get(dayKey(d.date)) || 0);
    d.fnb_revenue = d.fnb_rate_plan + d.fnb_extras + d.fnb_outlets;
    d.ancillary_revenue = (sa ? parseFloat(sa.amount) : 0) + (ad ? parseFloat(ad.extra) : 0);
    d.activity_revenue = actByDay.get(dayKey(d.date)) || 0;
    d.total_revenue = parseFloat(d.room_revenue) + d.fnb_revenue + d.ancillary_revenue + d.activity_revenue;
    d.expenses = expByDay.get(dayKey(d.date)) || 0;
  }

  const roomRev = parseFloat(room.room_revenue);
  // F&B = meals included in the rate plan + the breakfast part of extras
  // (extra bed nights, items with a breakfast part) + restaurant / POS sales.
  const fnbRatePlan = parseFloat(room.fnb_revenue);
  const fnbExtras = parseFloat(ancillary.sales_meal_revenue) + parseFloat(addon.meal);
  const fnbOutlets = parseFloat(ancillary.outlet_revenue) + posSessionsNet;
  const fnbRev = fnbRatePlan + fnbExtras + fnbOutlets;
  const ancRev = parseFloat(ancillary.ancillary_revenue) + parseFloat(addon.extra);
  const activityRev = parseFloat(activity.revenue);
  const totalRevenue = roomRev + fnbRev + ancRev + activityRev;
  const expensesTotal = parseFloat(expenses.total);
  return {
    from, to,
    room_revenue: roomRev,
    fnb_revenue: fnbRev,
    // outlets = restaurant / POS: bills charged to rooms (sales) + bills paid at
    // the restaurant (POS sessions, `outlets_paid_at_outlet`).
    fnb_breakdown: { rate_plan: round2(fnbRatePlan), extras: round2(fnbExtras), outlets: round2(fnbOutlets),
                     outlets_paid_at_outlet: round2(posSessionsNet) },
    // ancillary_revenue = hotel extras (Sales items, extra bed nights) only;
    // activities are their own line.
    ancillary_revenue: ancRev,
    activity_revenue: activityRev,
    activity_count: parseInt(activity.count),
    total_revenue: totalRevenue,
    expenses_total: expensesTotal,
    net_income: totalRevenue - expensesTotal,
    bookings_count: parseInt(room.bookings_count),
    // total_nights = every occupied room-night (occupancy); paid_nights
    // leaves complimentary nights out — ADR = room_revenue / paid_nights.
    total_nights: parseInt(room.total_nights),
    paid_nights: parseInt(room.paid_nights),
    comp_nights: parseInt(room.comp_nights),
    // NET value given away: comp room(+meal) nights + comped extras.
    comp_value: round2(parseFloat(room.comp_room_value) + parseFloat(ancillary.comp_extras_value) + parseFloat(addon.comp_value) + parseFloat(activity.comp_value)),
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

// GET /api/reports/full?from=&to= — every section of the Reports page
// (services/fullReport.js): revenue, rooms, channels, money.
router.get('/full', auth, requireRole('owner'), async (req, res) => {
  const period = resolvePeriod(req.query);
  if (period.error) return res.status(400).json({ error: period.error });
  try {
    const { buildFullReport } = require('../services/fullReport');
    res.json(await buildFullReport(req.propertyId, period.from, period.to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/full/xlsx?from=&to= — the same report as an Excel
// workbook (services/reportXlsx.js): Revenue, Rooms, Channels, Money, Daily.
router.get('/full/xlsx', auth, requireRole('owner'), async (req, res) => {
  const period = resolvePeriod(req.query);
  if (period.error) return res.status(400).json({ error: period.error });
  try {
    const { buildFullReport, buildDetailRows } = require('../services/fullReport');
    const { buildReportXlsx } = require('../services/reportXlsx');
    const [report, detail, { rows: [p] }] = await Promise.all([
      buildFullReport(req.propertyId, period.from, period.to),
      buildDetailRows(req.propertyId, period.from, period.to),
      db.query(`SELECT COALESCE(NULLIF(ps.property_name, ''), pr.name) AS name
                FROM properties pr LEFT JOIN property_settings ps ON ps.property_id = pr.id WHERE pr.id = $1`, [req.propertyId]),
    ]);
    const buf = await buildReportXlsx(report, { propertyName: p?.name, detail });
    const label = period.from === period.to ? period.from : `${period.from}_to_${period.to}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${label}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/full/pdf?from=&to= — the same report as a printable PDF
// (services/reportPdf.js), with the property's document header.
router.get('/full/pdf', auth, requireRole('owner'), async (req, res) => {
  const period = resolvePeriod(req.query);
  if (period.error) return res.status(400).json({ error: period.error });
  try {
    const { buildFullReport } = require('../services/fullReport');
    const { buildReportPdf } = require('../services/reportPdf');
    const [report, { rows: [property] }] = await Promise.all([
      buildFullReport(req.propertyId, period.from, period.to),
      db.query(`SELECT COALESCE(NULLIF(ps.property_name, ''), pr.name) AS property_name, ps.property_address, ps.property_phone, ps.property_email, ps.logo_url
                FROM properties pr LEFT JOIN property_settings ps ON ps.property_id = pr.id WHERE pr.id = $1`, [req.propertyId]),
    ]);
    const pdf = await buildReportPdf(report, property);
    const label = period.from === period.to ? period.from : `${period.from}_to_${period.to}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${label}.pdf"`);
    res.send(pdf);
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
    res.setHeader('Content-Type', 'text/csv');
    const fileLabel = period.from === period.to ? period.from : `${period.from}_to_${period.to}`;
    res.setHeader('Content-Disposition', `attachment; filename="revenue-${fileLabel}.csv"`);
    res.send(revenueCsv(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The revenue CSV for a getReport() result — shared by the export route above
// and the Monthly Report email (services/monthlyReport.js).
function revenueCsv(data) {
  const period = { from: data.from, to: data.to };
  const label = period.from === period.to ? period.from : `${period.from} to ${period.to}`;
  const lines = [
    'Metric,Value',
    `Period,${csvEscape(label)}`,
    `Room Revenue,${data.room_revenue}`,
    `F&B Revenue,${data.fnb_revenue}`,
    `  F&B - meals in rate plan,${data.fnb_breakdown?.rate_plan ?? ''}`,
    `  F&B - breakfast in extras,${data.fnb_breakdown?.extras ?? ''}`,
    `  F&B - restaurant / POS,${data.fnb_breakdown?.outlets ?? ''}`,
    `Extras Revenue,${data.ancillary_revenue}`,
    `Activities Revenue,${data.activity_revenue ?? 0}`,
    `Total Revenue,${data.total_revenue}`,
    `Expenses,${data.expenses_total}`,
    `Net Income,${data.net_income}`,
    `Bookings,${data.bookings_count}`,
    `Room Nights,${data.total_nights}`,
    `Complimentary Nights,${data.comp_nights}`,
    `Complimentary Value (net),${data.comp_value}`,
    `ADR (paid nights),${data.paid_nights ? Math.round(data.room_revenue / data.paid_nights) : 0}`,
    '',
    'Source,Bookings,Revenue',
    ...data.by_source.map(r => `${csvEscape(r.source)},${r.count},${Math.round(parseFloat(r.revenue) * 100) / 100}`),
  ];
  // Daily breakdown for multi-day periods — one row per day, same rules as
  // the summary (room/F&B night-based, sales by WITA day, expenses by date),
  // so the rows add up to the summary above.
  if (period.from !== period.to) {
    const r2 = n => Math.round(parseFloat(n) * 100) / 100;
    lines.push('', 'Date,Room Revenue,F&B Revenue,Extras Revenue,Activities Revenue,Total Revenue,Expenses,Net Income,Room Nights');
    for (const d of data.daily_revenue) {
      const total = r2(d.total_revenue);
      lines.push([String(d.date).slice(0, 10), r2(d.room_revenue), r2(d.fnb_revenue), r2(d.ancillary_revenue), r2(d.activity_revenue || 0),
        total, r2(d.expenses), r2(total - d.expenses), d.nights_sold].join(','));
    }
  }
  return lines.join('\n');
}

module.exports = router;
// Shared with services/dailyClose.js (Smart Reports), so its figures match this page.
module.exports.getReport = getReport;
module.exports.revenueCsv = revenueCsv;
// The building blocks, for services/fullReport.js (Reports page sections,
// Excel / PDF exports) — same rules, so every figure matches getReport().
module.exports.NIGHTS_CTE = NIGHTS_CTE;
module.exports.SALES_SQL = SALES_SQL;
module.exports.SALE_OFF_BILL_SQL = SALE_OFF_BILL_SQL;
module.exports.ADDON_NIGHTS_SQL = ADDON_NIGHTS_SQL;
module.exports.ACTIVITY_SQL = ACTIVITY_SQL;
module.exports.resolvePeriod = resolvePeriod;
