const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { recomputeBookingStatus, recomputeGroupStatus } = require('../services/paymentStatusService');
const groupBilling = require('../services/groupBilling');
const agentBilling = require('../services/agentBillingService');
const agentService = require('../services/agentService');
const { PUBLISH_RATE_SQL, ARRANGED_BY_SQL } = require('../services/publishRate');
const { sendBookingEmail, sendGroupBookingEmail } = require('../services/mailer');
const { computeFolioTotals, computeProforma, round2, PAYMENTS_WITH_RECEIPT_SQL } = require('../services/folioService');
const ratePlanService = require('../services/ratePlanService');
const { grossFactor, splitRevenue, applyBookingPrice, snapPayable } = require('../services/bookingPriceService');
const nightRatesSvc = require('../services/nightRates');
const { stayNights: stayNightList } = require('../services/folioService');
const { nightlyRoomRates } = require('../services/pricingService');
const { priceBasis } = require('../services/priceBasis');
const { searchAvailability } = require('../services/availabilityService');
const roomCharge = require('../services/roomChargeService');
const guestMessageService = require('../services/guestMessageService');
const telegramService = require('../services/telegramService');
const { sendControlAlert } = require('../services/ownerAlerts');
const sse = require('../sse');
const { renderGuestReport } = require('../services/guestReportPdf');
const { renderGuestLists, fmtLongDate } = require('../services/guestListsPdf');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { renderBalanceDue } = require('../services/balanceDuePdf');
const { renderKitchen } = require('../services/kitchenPdf');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');


const BED_PREFS = ['double', 'twin', 'twin_or_double', 'other'];

const { TODAY_WITA_SQL, checkoutDaySql, occupiedUntilSql, overdueSql } = require('../services/occupancySql');

// A booking can carry more than one 'balance' payment line: a price
// correction (PUT /:id/price) that raises an already fully-paid booking adds a
// second, pending line for the difference. balance_paid = every balance line
// received; balance_amount = what is still pending, or (all paid) the total
// received — the same values the single-line case always produced.
const BALANCE_PAID_SQL = `(EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance' AND p.status = 'received')
             AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance' AND p.status = 'pending' AND p.amount > 0))`;
const BALANCE_AMOUNT_SQL = `COALESCE(
               (SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance' AND p.status = 'pending' AND p.amount > 0),
               (SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance'))`;

// The booking's agent for the Check-in / Quick Check-in lists (migration
// 084): agent_billed = the agent pays the hotel later, so the guest pays
// nothing for the room at the desk (like an OTA).
const AGENT_ON_BOOKING_SQL = `(SELECT ag.name FROM agents ag WHERE ag.id = b.agent_id) AS agent_name,
             EXISTS (SELECT 1 FROM agents ag WHERE ag.id = b.agent_id
                       AND ag.payment_status IN ('city_ledger', 'city_ledger_payment', 'commission_and_city_ledger')) AS agent_billed`;

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID'); }

// Telegram "new booking" alert (Reports & Alerts → New bookings): sections
// separated by a blank line, one fact per line (Telegram HTML).
function newBookingAlert({ title, guest, rooms, checkIn, checkOut, guests, total, by }) {
  const h = telegramService.escapeHtml;
  const d = v => { const [y, m, dd] = String(v).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
  const nights = Math.round((Date.parse(String(checkOut).slice(0, 10)) - Date.parse(String(checkIn).slice(0, 10))) / 86400000);
  return [
    [`📅 <b>${h(title)}</b>`, guest ? `<b>${h(guest)}</b>` : ''],
    [`🛏 ${h((rooms || []).join(', '))}`,
     `• ${d(checkIn)} – ${d(checkOut)} · ${nights} night${nights === 1 ? '' : 's'}`,
     guests ? `• ${guests} guest${Number(guests) === 1 ? '' : 's'}` : '',
     total != null && Number.isFinite(Number(total)) ? `• ${h(fmtIDR(Math.round(total)))}` : ''],
    by ? [`<i>By ${h(by)}</i>`] : [],
  ].map(s => s.filter(Boolean)).filter(s => s.length).map(s => s.join('\n')).join('\n\n');
}

// Adds guest_balance_due (what the guest still owes — checkoutBalance rule:
// whole stay, 0 for a stay billed to its agent, extras only for an OTA) to
// checked-in booking rows, for the Check-in / out and Quick Check-in lists.
async function withGuestBalance(rows, propertyId) {
  const { guestBalance } = require('../services/checkoutBalance');
  for (const r of rows) {
    const g = await guestBalance(r.id, propertyId);
    r.guest_balance_due = g ? g.owed : null;
    // a room of a group billed as a whole (migration 097): what the group still owes
    r.group_owed = g?.group ? g.group.group_owed : null;
  }
  return rows;
}
// A booking's own commission for Edit History — "10%", "Rp 150.000" or "agent's default".
function commissionLabel(b) {
  if (!b.commission_type || b.commission_value == null) return 'agent\'s default';
  return b.commission_type === 'percent' ? `${parseFloat(b.commission_value)}%` : fmtIDR(b.commission_value);
}
// '2026-09-08' → '8 Sep' (for Edit History notes)
function fmtShortYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

// Compares the before/after rows PUT /:id produces and writes one
// booking_events row summarizing whatever actually changed — a single
// choke point, so every caller of this endpoint (Edit Details today,
// anything else later) gets an audit trail for free, without each
// caller having to remember to log it themselves. No-ops (no row
// written) when nothing tracked actually changed.
async function logBookingChanges(client, { propertyId, bookingId, userId, before, after }) {
  const norm = v => (v === null || v === undefined) ? '' : String(v);
  const changes = [];

  if (norm(before.num_guests) !== norm(after.num_guests)) {
    changes.push(`Guests: ${before.num_guests} → ${after.num_guests}`);
  }
  if (norm(before.source) !== norm(after.source)) {
    const { rows } = await client.query(
      'SELECT id, label FROM booking_sources WHERE property_id = $1 AND id = ANY($2)',
      [propertyId, [before.source, after.source]]
    );
    const labelOf = srcId => rows.find(r => r.id === srcId)?.label || srcId;
    changes.push(`Source: ${labelOf(before.source)} → ${labelOf(after.source)}`);
  }
  if (norm(before.total_amount) !== norm(after.total_amount)) {
    changes.push(`Total Amount: ${fmtIDR(before.total_amount)} → ${fmtIDR(after.total_amount)}`);
  }
  if (norm(before.special_requests) !== norm(after.special_requests)) {
    changes.push('Special Requests updated');
  }
  if (norm(before.internal_notes) !== norm(after.internal_notes)) {
    changes.push('Internal Notes updated');
  }
  if (norm(before.status) !== norm(after.status)) {
    changes.push(`Status: ${before.status} → ${after.status}`);
  }
  if (norm(before.rate_plan_id) !== norm(after.rate_plan_id)) {
    const ids = [before.rate_plan_id, after.rate_plan_id].filter(Boolean);
    const { rows } = ids.length
      ? await client.query('SELECT id, code FROM rate_plans WHERE property_id = $1 AND id = ANY($2)', [propertyId, ids])
      : { rows: [] };
    const codeOf = planId => planId ? (rows.find(r => r.id === planId)?.code || 'Unknown') : 'None';
    changes.push(`Rate Plan: ${codeOf(before.rate_plan_id)} → ${codeOf(after.rate_plan_id)}`);
  }
  if (norm(before.bed_preference) !== norm(after.bed_preference)) {
    const label = v => v ? v.replace('_', ' ') : 'No preference';
    changes.push(`Bed Preference: ${label(before.bed_preference)} → ${label(after.bed_preference)}`);
  }
  if (norm(before.purpose_of_stay) !== norm(after.purpose_of_stay)) {
    changes.push(`Purpose of Stay: ${before.purpose_of_stay || '(none)'} → ${after.purpose_of_stay || '(none)'}`);
  }
  if (norm(before.agent_id) !== norm(after.agent_id)) {
    const ids = [before.agent_id, after.agent_id].filter(Boolean);
    const { rows } = ids.length
      ? await client.query('SELECT id, name FROM agents WHERE property_id = $1 AND id = ANY($2::uuid[])', [propertyId, ids])
      : { rows: [] };
    const nameOf = id => id ? (rows.find(r => r.id === id)?.name || 'Unknown') : 'None';
    changes.push(`Agent: ${nameOf(before.agent_id)} → ${nameOf(after.agent_id)}`);
  }
  if (norm(before.commission_type) !== norm(after.commission_type) || norm(before.commission_value) !== norm(after.commission_value)) {
    changes.push(`Commission: ${commissionLabel(before)} → ${commissionLabel(after)}`);
  }

  if (changes.length === 0) return;
  await client.query(
    'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
    [bookingId, changes.join('; '), userId]
  );
}


// Shared by GET / (JSON list) and GET /guest-report/pdf, so the exported
// report always matches exactly what the list view is currently showing.
function buildBookingsQuery(propertyId, { month, year, unit_id, status, source, group_id, q, date_from, date_to, include_overdue }) {
  let query = `
    SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality, g.id_number, u.name as unit_name,
           u.bed_config, rp.code as rate_plan_code, rp.name as rate_plan_name,
           EXISTS(
             SELECT 1 FROM checkin_records cr
             WHERE cr.booking_id = b.id
               AND cr.condition_notes IS NOT NULL
               AND cr.condition_notes <> ''
           ) AS has_condition_notes
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN units u ON b.unit_id = u.id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.property_id = $1
  `;
  const params = [propertyId];
  // date_from/date_to (an explicit range — used by search and the guest
  // report export) takes precedence over month/year (the calendar's
  // single-month view) when both are somehow present.
  if (date_from && date_to) {
    params.push(date_from, date_to);
    // include_overdue (Reservations calendar): also guests still checked in
    // past their check-out, whose stay effectively runs on to today.
    query += include_overdue
      ? ` AND b.check_in_date <= $${params.length} AND (b.check_out_date > $${params.length - 1} OR ${overdueSql('b')})`
      : ` AND b.check_in_date <= $${params.length} AND b.check_out_date > $${params.length - 1}`;
  } else if (month && year) {
    params.push(year, month);
    query += ` AND EXTRACT(YEAR FROM b.check_in_date) = $${params.length-1} AND EXTRACT(MONTH FROM b.check_in_date) = $${params.length}`;
  }
  if (unit_id) { params.push(unit_id); query += ` AND b.unit_id = $${params.length}`; }
  if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
  if (source) { params.push(source); query += ` AND b.source = $${params.length}`; }
  if (group_id) { params.push(group_id); query += ` AND b.reservation_group_id = $${params.length}`; }
  if (q) { params.push(`%${q}%`); query += ` AND g.name ILIKE $${params.length}`; }
  query += ' ORDER BY b.check_in_date';
  return { query, params };
}

// GET /api/bookings
router.get('/', auth, async (req, res) => {
  const { query, params } = buildBookingsQuery(req.propertyId, req.query);
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/guest-report/pdf — daily/ranged guest list for the local
// police report (STPM/lapor tamu). Accepts the same filter query params as
// GET / so the export always matches what's currently shown in the list.
router.get('/guest-report/pdf', auth, async (req, res) => {
  try {
    const { query, params } = buildBookingsQuery(req.propertyId, req.query);
    const [{ rows: all }, { rows: [property] }] = await Promise.all([
      db.query(query, params),
      db.query(
        `SELECT property_name, property_address, property_phone, property_email, logo_url
         FROM property_settings WHERE property_id = $1`,
        [req.propertyId]
      ),
    ]);

    // A police report lists guests who actually stay: cancelled / no-show
    // bookings are left out unless that status was asked for explicitly.
    const rows = req.query.status ? all : all.filter(b => !['cancelled', 'no_show'].includes(b.status));

    const { date_from, date_to, month, year } = req.query;
    // Filename must stay ASCII-only (an en-dash or similar in a
    // Content-Disposition header value throws a Node header-encoding error);
    // the on-page label can use nicer punctuation freely.
    const dateLabel = date_from && date_to
      ? (date_from === date_to ? date_from : `${date_from} to ${date_to}`)
      : (month && year ? `${year}-${String(month).padStart(2, '0')}` : 'All dates');
    const filenameSafe = dateLabel.replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="guest-report-${filenameSafe}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    renderGuestReport(doc, { property: property || {}, dateLabel, rows });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/today/arrivals
router.get('/today/arrivals', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality,
             u.name as unit_name, u.bed_config, u.housekeeping_status, rp.code as rate_plan_code,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size,
             ${AGENT_ON_BOOKING_SQL}
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      WHERE b.property_id = $1
        AND b.check_in_date <= CURRENT_DATE
        AND b.status IN ('confirmed','deposit_paid','pending')
      ORDER BY b.check_in_date DESC, g.name
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/today/departures
router.get('/today/departures', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp,
             u.name as unit_name,
             ${BALANCE_PAID_SQL} as balance_paid,
             ${BALANCE_AMOUNT_SQL} as balance_amount,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size,
             ${AGENT_ON_BOOKING_SQL}
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.property_id = $1
        AND b.check_out_date = CURRENT_DATE
        AND b.status = 'checked_in'
      ORDER BY g.name
    `, [req.propertyId]);
    res.json(await withGuestBalance(rows, req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/in-house  (all currently checked-in guests)
router.get('/in-house', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp,
             u.name as unit_name,
             b.check_out_date < CURRENT_DATE as overdue,
             ${BALANCE_PAID_SQL} as balance_paid,
             ${BALANCE_AMOUNT_SQL} as balance_amount,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size,
             ${AGENT_ON_BOOKING_SQL}
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.property_id = $1
        AND b.status = 'checked_in'
      ORDER BY b.check_out_date, g.name
    `, [req.propertyId]);
    res.json(await withGuestBalance(rows, req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Who is where on a date — ONE definition shared by Guest Lists and the
// Kitchen tab, matching the Check-in/out page and the Dashboard.
//   Today: the booked dates, fixed for the whole day (a guest who checks in
//   stays under Arriving marked "Arrived"), plus what has actually happened —
//     arriving   = arrival date today (arrived or not), plus late arrivals
//                  (not checked in, arrival date earlier — flagged)
//     in house   = checked in before today, leaving after today
//     departing  = due out today (still here or already left), overdue
//                  guests (still checked in past check-out), and anyone who
//                  actually checked out today
//   Any other date: by the booked DATES (nothing has happened yet / history).
// Meals: breakfast on the date's morning = guests who slept here the night
// before; dinner that night = guests sleeping here that night. For today
// only guests actually checked in count for breakfast (a late arrival who
// never came didn't sleep here).
const PRE_ARRIVAL = "('pending', 'deposit_paid', 'confirmed')";
// $2 = the date, $3 = today (WITA)
const MEAL_FLAGS_SQL = `
  CASE WHEN $2::date = $3::date
       THEN (b.status = 'checked_in' AND b.check_in_date < $2::date)
         OR (b.status = 'checked_out' AND b.check_out_date = $2::date AND b.check_in_date < $2::date)
       ELSE b.check_in_date < $2::date AND b.check_out_date >= $2::date END AS breakfast_here,
  CASE WHEN $2::date = $3::date
       THEN (b.status = 'checked_in' AND b.check_out_date > $2::date)
         OR (b.status IN ${PRE_ARRIVAL} AND b.check_in_date <= $2::date AND b.check_out_date > $2::date)
       ELSE b.check_in_date <= $2::date AND b.check_out_date > $2::date END AS dinner_here`;

// Breakfasts from per-night extras (an extra bed with breakfast, migration
// 074): the morning of `date` = add-on nights of the night before, inside the
// booking's stay. booking_id → units (people). Added to a booking's breakfast
// count only when that booking has breakfast "here" that morning.
async function extraBreakfasts(propertyId, date) {
  const { rows } = await db.query(`
    SELECT a.booking_id, SUM(a.breakfasts)::int AS qty
    FROM booking_addons a JOIN bookings b ON b.id = a.booking_id
    WHERE a.property_id = $1 AND a.status = 'active' AND a.breakfasts > 0
      AND a.service_date = $2::date - 1
      AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
    GROUP BY a.booking_id`, [propertyId, date]);
  return new Map(rows.map(r => [r.booking_id, r.qty]));
}

// NET value of the breakfasts a room has on `date` (for the POS breakfast
// recap): plan guests × the rate plan's meal price (split over the meals the
// plan includes, prices-incl.-tax taken out) + extra-bed breakfasts at their
// own NET breakfast price. booking_id → total.
async function breakfastValues(propertyId, date, rows) {
  const { divisor } = await priceBasis(propertyId);
  const { rows: extra } = await db.query(`
    SELECT a.booking_id, SUM(a.breakfasts * COALESCE(a.meal_price, 0)) AS value
    FROM booking_addons a JOIN bookings b ON b.id = a.booking_id
    WHERE a.property_id = $1 AND a.status = 'active' AND a.breakfasts > 0
      AND a.service_date = $2::date - 1
      AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
    GROUP BY a.booking_id`, [propertyId, date]);
  const extraValue = new Map(extra.map(r => [r.booking_id, parseFloat(r.value) || 0]));
  const out = new Map();
  for (const r of rows) {
    let v = extraValue.get(r.id) || 0;
    if (r.includes_breakfast) {
      const meals = [r.includes_breakfast, r.includes_lunch, r.includes_dinner].filter(Boolean).length || 1;
      v += (parseFloat(r.rate_plan_meal_price) || 0) / (divisor || 1) / meals * (parseInt(r.num_guests, 10) || 0);
    }
    out.set(r.id, Math.round(v * 100) / 100);
  }
  return out;
}

// GET /api/bookings/guest-lists?date=YYYY-MM-DD (default today, WITA)
// Morning briefing for one date — every live booking lands in exactly one list:
//   arrivals   — check-in on the date (expected, or already arrived)
//   in_house   — staying over: arrived before the date, leaves after it
//   departures — check-out on the date; for today, also guests still checked
//                in past their check-out date (overdue), since they're still here
// Meal counts for the kitchen: breakfast this morning = guests who slept here
// last night (in-house + departures) on a plan that includes breakfast;
// dinner tonight = guests sleeping here tonight (arrivals + in-house) on a
// plan that includes dinner.
// Shared by the JSON endpoint and the PDF download so both always show the
// same lists. Returns null for a malformed date.
// opts.balances = false skips the per-row balance (one Pro Forma per booking)
// for callers that only need the lists and counts (the Dashboard polls it).
async function loadGuestLists(propertyId, requestedDate, { balances = true } = {}) {
  const today = roomCharge.todayWITA();
  const date = requestedDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return null;
  {
    const { rows } = await db.query(`
      SELECT b.id, b.check_in_date, b.check_out_date, b.nights, b.num_guests, b.status,
             b.special_requests, b.bed_preference, b.reservation_group_id,
             g.name AS guest_name, g.nationality, g.whatsapp AS guest_whatsapp,
             u.name AS unit_name, u.type AS unit_type, u.housekeeping_status,
             rp.code AS rate_plan_code, rp.includes_breakfast, rp.includes_dinner,
             COALESCE(bs.label, b.source) AS source_label, COALESCE(bs.is_ota, false) AS is_ota,
             CASE WHEN $2::date = $3::date THEN
                    CASE WHEN b.status IN ${PRE_ARRIVAL} THEN 'arrival'
                         WHEN b.status = 'checked_out' OR b.check_out_date <= $2::date THEN 'departure'
                         WHEN b.check_in_date = $2::date THEN 'arrival'
                         ELSE 'in_house' END
                  ELSE
                    CASE WHEN b.check_in_date = $2::date THEN 'arrival'
                         WHEN b.check_out_date <= $2::date THEN 'departure'
                         ELSE 'in_house' END
             END AS list,
             (b.status = 'checked_in' AND b.check_out_date < $2::date) AS overdue,
             ($2::date = $3::date AND b.status IN ${PRE_ARRIVAL} AND b.check_in_date < $2::date) AS late_arrival,
             ${MEAL_FLAGS_SQL}
      FROM bookings b
      JOIN guests g ON g.id = b.guest_id
      JOIN units u ON u.id = b.unit_id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
      WHERE b.property_id = $1
        AND b.status NOT IN ('cancelled', 'no_show')
        AND CASE WHEN $2::date = $3::date THEN
              -- today: everyone not yet arrived (incl. late), everyone in
              -- the house (incl. overdue), and whoever left today
              (b.status IN ${PRE_ARRIVAL} AND b.check_in_date <= $2::date)
              OR b.status = 'checked_in'
              OR (b.status = 'checked_out' AND COALESCE(${checkoutDaySql('b')}, b.check_out_date) = $2::date)
            ELSE b.check_in_date <= $2::date AND b.check_out_date >= $2::date END
      ORDER BY u.name, g.name
    `, [propertyId, date, today]);

    // Extra beds (per-night extras, migration 074) the room has: tonight for
    // arriving / staying guests, last night for those leaving.
    const { rows: beds } = await db.query(`
      SELECT a.booking_id, a.service_date::text AS night, a.description, SUM(a.quantity)::int AS qty
      FROM booking_addons a JOIN bookings b ON b.id = a.booking_id
      WHERE a.property_id = $1 AND a.status = 'active'
        AND a.service_date IN ($2::date, $2::date - 1)
        AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
      GROUP BY a.booking_id, a.service_date, a.description`, [propertyId, date]);
    const prevNight = new Date(Date.parse(date) - 864e5).toISOString().slice(0, 10);

    const lists = { arrivals: [], in_house: [], departures: [] };
    // Today only: bookings that never checked in and whose stay is already
    // over — not arriving any more, just never marked no-show / cancelled
    // (the night audit only no-shows on the arrival day itself). Kept out of the three
    // lists and the counts, listed separately so someone cleans them up.
    const neverArrived = [];
    for (const r of rows) {
      // Same whole-stay figure as the Balance Due tab / the Folio Pro Forma
      // (nights + extras charged to the room + tax − payments), so the two
      // lists can never disagree. A credit shows as nothing owed.
      if (balances) {
        const pf = await computeProforma(r.id, propertyId);
        r.balance_due = pf ? Math.max(0, pf.balance_due) : 0;
      }
      const night = r.list === 'departure' ? prevNight : date;
      const mine = beds.filter(x => x.booking_id === r.id && x.night === night);
      r.extra_beds = mine.reduce((s, x) => s + x.qty, 0);
      r.extra_beds_text = mine.map(x => `${x.qty} × ${x.description}`).join(', ');
      if (r.list === 'arrival' && date === today && ['pending', 'deposit_paid', 'confirmed'].includes(r.status)
          && r.check_out_date <= date) neverArrived.push(r);
      else if (r.list === 'arrival') lists.arrivals.push(r);
      else if (r.list === 'departure') lists.departures.push(r);
      else lists.in_house.push(r);
    }
    const pax = list => list.reduce((s, r) => s + (parseInt(r.num_guests, 10) || 0), 0);
    const bedsOf = list => list.reduce((s, r) => s + (r.extra_beds || 0), 0);
    const mealPax = (list, flag) => list.filter(r => r[flag]).reduce((s, r) => s + (parseInt(r.num_guests, 10) || 0), 0);
    // + breakfasts that come with an extra bed (the night before)
    const extra = await extraBreakfasts(propertyId, date);
    const extraBreakfastPax = rows.filter(r => r.breakfast_here).reduce((s, r) => s + (extra.get(r.id) || 0), 0);
    return {
      date,
      is_today: date === today,
      ...lists,
      never_arrived: neverArrived,
      summary: {
        arrivals: { rooms: lists.arrivals.length, pax: pax(lists.arrivals), extra_beds: bedsOf(lists.arrivals) },
        in_house: { rooms: lists.in_house.length, pax: pax(lists.in_house), extra_beds: bedsOf(lists.in_house) },
        departures: { rooms: lists.departures.length, pax: pax(lists.departures), extra_beds: bedsOf(lists.departures) },
        breakfast_pax: mealPax(rows.filter(r => r.breakfast_here), 'includes_breakfast') + extraBreakfastPax,
        dinner_pax: mealPax(rows.filter(r => r.dinner_here), 'includes_dinner'),
      },
    };
  }
}

router.get('/guest-lists', auth, async (req, res) => {
  try {
    const data = await loadGuestLists(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/booked?from=&to= — reservations MADE in a period (by the
// day they were created, WITA), not by stay dates: the Reservations page's
// "Booked on" view. A group counts as one reservation. Same numbers as the
// Dashboard's "New reservations" and the Daily Close (services/bookingPickup).
router.get('/booked', auth, async (req, res) => {
  try {
    const today = roomCharge.todayWITA();
    const from = String(req.query.from || today);
    const to = String(req.query.to || from);
    const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
    if (!ok(from) || !ok(to)) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    if (to < from) return res.status(400).json({ error: 'to must be on or after from' });
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) return res.status(400).json({ error: 'Pick at most 3 months' });
    const { bookingsMade } = require('../services/bookingPickup');
    res.json(await bookingsMade(req.propertyId, from, to, { withRows: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/guest-lists/pdf?date= — the same lists as a branded PDF
// download (same header as the invoice / guest report).
router.get('/guest-lists/pdf', auth, async (req, res) => {
  try {
    const data = await loadGuestLists(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="guest-lists-${data.date}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Guest Lists', refLine: fmtLongDate(data.date) });
    renderGuestLists(doc, data);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kitchen list for one date — meals to prepare, room by room, from each
// booking's rate plan (includes_breakfast / includes_dinner):
//   breakfast — the morning of the date: guests who slept here the night
//               before (staying over + checking out that day)
//   dinner    — the night of the date: guests sleeping here that night
//               (arriving that day + staying over)
// Counted in guests (num_guests), not rooms. Also reports how many guests are
// in house without the meal (room only), since the kitchen may still sell it.
async function loadKitchen(propertyId, requestedDate) {
  const today = roomCharge.todayWITA();
  const date = requestedDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return null;
  const { rows } = await db.query(`
    SELECT b.id, b.check_in_date, b.check_out_date, b.num_guests, b.status, b.special_requests,
           g.name AS guest_name, u.name AS unit_name, u.type AS unit_type,
           rp.code AS rate_plan_code, rp.meal_price AS rate_plan_meal_price,
           COALESCE(rp.includes_lunch, false) AS includes_lunch,
           COALESCE(rp.includes_breakfast, false) AS includes_breakfast,
           COALESCE(rp.includes_dinner, false) AS includes_dinner,
           ${MEAL_FLAGS_SQL}
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.property_id = $1
      AND b.status NOT IN ('cancelled', 'no_show')
      AND (b.check_in_date <= $2::date AND b.check_out_date >= $2::date
           OR ($2::date = $3::date AND b.status = 'checked_in'))  -- overdue guests are still here
    ORDER BY u.name, g.name
  `, [propertyId, date, today]);

  const pax = list => list.reduce((s, r) => s + (parseInt(r.num_guests, 10) || 0), 0);
  const mealPaxOf = list => list.reduce((s, r) => s + r.meal_pax, 0);
  // Extra beds with breakfast (the night before) add to that room's breakfast.
  const extra = await extraBreakfasts(propertyId, date);
  // Breakfast boxes front desk asked for that morning (restaurant_requests).
  const boxes = await require('../services/restaurantRequests').boxesForDate(propertyId, date);
  for (const r of rows) {
    r.extra_breakfast = r.breakfast_here ? (extra.get(r.id) || 0) : 0;
    r.breakfast_pax = (r.includes_breakfast ? (parseInt(r.num_guests, 10) || 0) : 0) + r.extra_breakfast;
  }
  const breakfastIn = rows.filter(r => r.breakfast_here);
  const dinnerIn = rows.filter(r => r.dinner_here);
  const breakfast = breakfastIn.filter(r => r.includes_breakfast || r.extra_breakfast > 0).map(r => ({ ...r, meal_pax: r.breakfast_pax, box: boxes.get(r.id) || null }));
  const dinner = dinnerIn.filter(r => r.includes_dinner).map(r => ({ ...r, meal_pax: parseInt(r.num_guests, 10) || 0 }));
  const breakfastPlanIds = new Set(breakfastIn.filter(r => r.includes_breakfast).map(r => r.id));
  const without = (all, withMeal) => ({ rooms: all.length - withMeal.length, pax: pax(all) - pax(withMeal) });
  return {
    date,
    breakfast: {
      rows: breakfast, rooms: breakfast.length, pax: mealPaxOf(breakfast),
      extra_beds: breakfast.reduce((s, r) => s + r.extra_breakfast, 0),
      without: without(breakfastIn, breakfastIn.filter(r => breakfastPlanIds.has(r.id))),
    },
    dinner: { rows: dinner, rooms: dinner.length, pax: mealPaxOf(dinner), without: without(dinnerIn, dinner) },
  };
}

// GET /api/bookings/kitchen?date=
router.get('/kitchen', auth, async (req, res) => {
  try {
    const data = await loadKitchen(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/kitchen/pdf?date= — the kitchen printout.
router.get('/kitchen/pdf', auth, async (req, res) => {
  try {
    const data = await loadKitchen(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kitchen-${data.date}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Kitchen List', refLine: fmtLongDate(data.date) });
    renderKitchen(doc, data);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Balance Due for one date — the money twin of Guest Lists, for front desk to
// print in the morning instead of opening each booking. Every row's balance
// is the whole-stay figure the Folio tab's Pro Forma shows
// (folioService.computeProforma: all nights + extras charged to the room +
// service/tax − payments received). Sections:
//   departing — check-out on the date (incl. already checked out but unpaid)
//   overdue   — today only: still checked in past their check-out date
//   staying   — in the hotel that night (incl. the date's arrivals)
// Only bookings that still owe something are listed. Stays billed to an
// agent (city ledger) are listed but marked and left out of "to collect".
async function loadBalanceDue(propertyId, requestedDate) {
  const today = roomCharge.todayWITA();
  const date = requestedDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return null;

  const { rows: candidates } = await db.query(`
    SELECT b.id, b.check_in_date, b.check_out_date, b.nights, b.num_guests, b.status, b.folio_status, b.reservation_group_id,
           g.name AS guest_name, u.name AS unit_name, u.type AS unit_type,
           COALESCE(bs.label, b.source) AS source_label, COALESCE(bs.is_ota, false) AS is_ota,
           COALESCE(ag.payment_status, 'normal') AS source_payment_status, ag.name AS agent_name,
           CASE WHEN b.status = 'checked_out' OR b.check_out_date = $2::date THEN 'departing'
                WHEN b.check_out_date < $2::date THEN 'overdue'
                ELSE 'staying' END AS section
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
    LEFT JOIN agents ag ON ag.id = b.agent_id
    WHERE b.property_id = $1
      AND b.status NOT IN ('cancelled', 'no_show')
      AND (
        b.check_out_date = $2::date
        OR (b.status = 'checked_out' AND ${checkoutDaySql('b')} = $2::date)
        OR (b.check_in_date <= $2::date AND b.check_out_date > $2::date AND b.status <> 'checked_out')
        OR ($2::date = $3::date AND b.status = 'checked_in' AND b.check_out_date < $2::date)
      )
    ORDER BY u.name, g.name
  `, [propertyId, date, today]);

  const sections = { departing: [], overdue: [], staying: [] };
  for (const c of candidates) {
    const pf = await computeProforma(c.id, propertyId);
    if (!pf || pf.balance_due < 1) continue;
    const roomAndMeals = round2(pf.charges.filter(x => x.type === 'room' || x.type === 'fnb').reduce((s, x) => s + parseFloat(x.amount), 0));
    const extras = round2(pf.charges.filter(x => x.type !== 'room' && x.type !== 'fnb').reduce((s, x) => s + parseFloat(x.amount), 0));
    const paid = round2(pf.payments.filter(p => p.status === 'received').reduce((s, p) => s + parseFloat(p.amount), 0));
    const agentBilled = agentBilling.CITY_LEDGER.includes(c.source_payment_status)
      || ['pending_agent_invoice', 'invoiced', 'paid'].includes(c.folio_status);
    sections[c.section].push({
      ...c,
      room_and_meals: roomAndMeals,
      extras,
      service_and_tax: round2(pf.service_charge_amount + pf.tax_amount),
      total: pf.total,
      paid,
      balance_due: pf.balance_due,
      agent_billed: agentBilled,
    });
  }
  // Groups billed as a whole (migration 097): the rooms above show only their
  // own extras; the group's bill is one row (the booker, its rooms), in the
  // section of the group's last check-out (departing on it, else staying).
  const groupIds = [...new Set(candidates.map(c => c.reservation_group_id).filter(Boolean))];
  for (const gid of groupIds) {
    const bill = await groupBilling.groupBill(gid, propertyId);
    if (!bill || bill.balance_due < 1) continue;
    const { rows: [g] } = await db.query(
      `SELECT gg.name AS guest_name, to_char(rg.check_in_date, 'YYYY-MM-DD') AS check_in_date,
              to_char(rg.check_out_date, 'YYYY-MM-DD') AS check_out_date
       FROM reservation_groups rg JOIN guests gg ON gg.id = rg.primary_guest_id WHERE rg.id = $1`, [gid]);
    const section = g.check_out_date <= date ? 'departing' : 'staying';
    sections[section].push({
      id: null, group_id: gid, is_group: true,
      guest_name: g.guest_name, unit_name: `Group · ${bill.rooms.map(r => r.unit_name).join(', ')}`,
      check_in_date: g.check_in_date, check_out_date: g.check_out_date, nights: null, num_guests: null,
      status: null, source_label: null, is_ota: false,
      room_and_meals: null, extras: null, service_and_tax: null,
      total: bill.total, paid: bill.received, balance_due: bill.balance_due, agent_billed: false,
    });
  }
  const toCollect = list => round2(list.filter(r => !r.agent_billed).reduce((s, r) => s + r.balance_due, 0));
  return {
    date,
    is_today: date === today,
    ...sections,
    totals: {
      departing: toCollect(sections.departing),
      overdue: toCollect(sections.overdue),
      staying: toCollect(sections.staying),
      all: toCollect([...sections.departing, ...sections.overdue, ...sections.staying]),
    },
  };
}

// Money details — only for staff who take payments (owner or Check-in/out).
const canSeeBalances = requireOwnerOrMenu('checkin_full');

// GET /api/bookings/balance-due?date=
router.get('/balance-due', auth, canSeeBalances, async (req, res) => {
  try {
    const data = await loadBalanceDue(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/balance-due/pdf?date= — same list as a branded PDF download.
router.get('/balance-due/pdf', auth, canSeeBalances, async (req, res) => {
  try {
    const data = await loadBalanceDue(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="balance-due-${data.date}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Balance Due', refLine: fmtLongDate(data.date) });
    renderBalanceDue(doc, data);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/availability?unit_id=&check_in=&check_out=&exclude_booking_id=
router.get('/availability', auth, async (req, res) => {
  const { unit_id, check_in, check_out, exclude_booking_id } = req.query;
  if (!unit_id || !check_in || !check_out) {
    return res.status(400).json({ error: 'unit_id, check_in, check_out required' });
  }
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found' });

    const conflictParams = [unit_id, check_in, check_out, req.propertyId];
    let excludeClause = '';
    if (exclude_booking_id) { conflictParams.push(exclude_booking_id); excludeClause = `AND b.id != $${conflictParams.length}`; }
    const conflictQ = db.query(`
      SELECT b.id, b.check_in_date, b.check_out_date, b.status, g.name as guest_name, ${overdueSql('b')} AS overdue
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.unit_id = $1
        AND b.property_id = $4
        AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in_date < $3
        AND ${occupiedUntilSql('b')} > $2
        ${excludeClause}
    `, conflictParams);

    const checkInDate = new Date(check_in);
    const allotmentQ = db.query(
      `SELECT channel, notes FROM allotments WHERE unit_id = $1 AND month = $2 AND year = $3`,
      [unit_id, checkInDate.getUTCMonth() + 1, checkInDate.getUTCFullYear()]
    );

    const [{ rows: conflicts }, { rows: allotmentRows }] = await Promise.all([conflictQ, allotmentQ]);

    res.json({
      available: conflicts.length === 0,
      conflicts: conflicts.map(c => ({
        id: c.id,
        guest_name: c.guest_name,
        check_in_date: c.check_in_date,
        check_out_date: c.check_out_date,
        status: c.status,
        overdue: c.overdue, // still checked in after check-out — blocks the room until checked out
      })),
      allotment: allotmentRows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/transfer-availability?check_in=&check_out=&exclude_booking_id=
// Returns all units with availability status for the given dates
router.get('/transfer-availability', auth, async (req, res) => {
  const { check_in, check_out, exclude_booking_id } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: 'check_in, check_out required' });
  try {
    const { rows: units } = await db.query('SELECT id, name, type, status FROM units WHERE property_id = $1 ORDER BY name', [req.propertyId]);
    const params = [check_in, check_out, req.propertyId];
    let excludeClause = '';
    if (exclude_booking_id) { params.push(exclude_booking_id); excludeClause = `AND b.id != $${params.length}`; }
    const { rows: conflicts } = await db.query(`
      SELECT b.unit_id, g.name as guest_name, b.check_in_date, b.check_out_date, ${overdueSql('b')} AS overdue
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.property_id = $3
        AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in_date < $2
        AND ${occupiedUntilSql('b')} > $1
        ${excludeClause}
    `, params);
    const conflictMap = {};
    conflicts.forEach(c => { conflictMap[c.unit_id] = c; });
    res.json(units.map(u => ({
      ...u,
      available: !conflictMap[u.id],
      conflict: conflictMap[u.id] || null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/availability-search?check_in=&check_out=&guests=&rooms=
// Check Availability page: free rooms per room type + the normal price for
// the stay. `guests` is the whole party, `rooms` how many rooms they want —
// room types too small for guests ÷ rooms are flagged. Logic in
// services/availabilityService.js (also meant for a booking-engine widget).
router.get('/availability-search', auth, async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(check_in || '') || !/^\d{4}-\d{2}-\d{2}$/.test(check_out || '') || check_out <= check_in) {
    return res.status(400).json({ error: 'check_in and a later check_out are required (YYYY-MM-DD)' });
  }
  const nights = Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  if (nights > 90) return res.status(400).json({ error: 'Search up to 90 nights at a time' });
  const guests = Math.max(1, parseInt(req.query.guests, 10) || 1);
  const rooms = Math.max(1, parseInt(req.query.rooms, 10) || 1);
  try {
    const result = await searchAvailability(req.propertyId, {
      checkIn: check_in, checkOut: check_out, guestsPerRoom: Math.ceil(guests / rooms), includeGuests: true,
    });
    res.json({ ...result, guests, rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/groups?when=current|past|all&q= — one row per group
// booking for the Reservations page's Groups view. when: current (default —
// not yet checked out: upcoming + in house), past, or all. q matches the
// booker's name or any room guest's name. Money uses the same formula as the
// group page's payment summary (GET /group/:groupId rollup), so the two
// always agree: rooms' totals − group discount − received room payments.
router.get('/groups', auth, async (req, res) => {
  const when = ['current', 'past', 'all'].includes(req.query.when) ? req.query.when : 'current';
  const params = [req.propertyId];
  let where = 'rg.property_id = $1';
  if (when !== 'all') {
    params.push(roomCharge.todayWITA());
    where += ` AND rg.check_out_date ${when === 'current' ? '>=' : '<'} $${params.length}::date`;
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where += ` AND (g.name ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM bookings b3 JOIN guests g3 ON g3.id = b3.guest_id
      WHERE b3.reservation_group_id = rg.id AND g3.name ILIKE $${params.length}))`;
  }
  try {
    const { rows } = await db.query(`
      SELECT rg.id, rg.check_in_date, rg.check_out_date, rg.status AS group_status,
             g.name AS booker_name, g.whatsapp AS booker_whatsapp,
             COUNT(b.id)::int AS room_count,
             COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled', 'no_show'))::int AS active_rooms,
             COUNT(b.id) FILTER (WHERE b.status = 'checked_in')::int AS checked_in_rooms,
             COUNT(b.id) FILTER (WHERE b.status = 'checked_out')::int AS checked_out_rooms,
             COALESCE(SUM(b.num_guests) FILTER (WHERE b.status NOT IN ('cancelled', 'no_show')), 0)::int AS pax,
             COUNT(b.id) FILTER (WHERE b.guest_id = rg.primary_guest_id
                                  AND b.status NOT IN ('cancelled', 'no_show', 'checked_out'))::int AS rooms_with_booker,
             string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE b.status NOT IN ('cancelled', 'no_show')) AS room_names,
             COALESCE(SUM(b.total_amount - COALESCE(b.discount_amount, 0))
                        FILTER (WHERE b.status NOT IN ('cancelled', 'no_show')), 0) AS net_amount,
             rg.group_billing, rg.billing_mode,
             -- billed as a whole (migration 097): the group's own payments
             CASE WHEN rg.group_billing
               THEN COALESCE((SELECT SUM(gp.amount) FROM group_payments gp WHERE gp.group_id = rg.id AND NOT gp.is_voided), 0)
               ELSE COALESCE((SELECT SUM(p.amount) FROM payments p JOIN bookings b2 ON b2.id = p.booking_id
                        WHERE b2.reservation_group_id = rg.id AND p.status = 'received'
                          AND b2.status NOT IN ('cancelled', 'no_show')
                          AND p.type IN ('deposit', 'balance')), 0) END AS paid_amount
      FROM reservation_groups rg
      JOIN guests g ON g.id = rg.primary_guest_id
      LEFT JOIN bookings b ON b.reservation_group_id = rg.id
      LEFT JOIN units u ON u.id = b.unit_id
      WHERE ${where}
      GROUP BY rg.id, g.name, g.whatsapp
      ORDER BY ${when === 'past' ? 'rg.check_in_date DESC' : 'rg.check_in_date'}
    `, params);
    res.json(rows.map(r => ({
      ...r,
      net_amount: parseFloat(r.net_amount),
      paid_amount: parseFloat(r.paid_amount),
      balance_due: round2(parseFloat(r.net_amount) - parseFloat(r.paid_amount)),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/group/:groupId
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { rows: [group] } = await db.query(`
      SELECT rg.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.email as guest_email
      FROM reservation_groups rg JOIN guests g ON g.id = rg.primary_guest_id
      WHERE rg.id = $1 AND rg.property_id = $2`, [req.params.groupId, req.propertyId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { rows: bookings } = await db.query(`
      SELECT b.*, u.name as unit_name,
             g.name AS guest_name, g.nationality AS guest_nationality, g.id_number AS guest_id_number,
             (SELECT name FROM agents ag WHERE ag.id = b.agent_id) AS agent_name,
             (SELECT checkin_time FROM checkin_records cr WHERE cr.booking_id = b.id) as checkin_time,
             (SELECT checkout_time FROM checkin_records cr WHERE cr.booking_id = b.id) as checkout_time
      FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
      WHERE b.reservation_group_id = $1 AND b.property_id = $2
      ORDER BY u.name`, [req.params.groupId, req.propertyId]);

    const paymentsByBooking = await db.query(
      `SELECT * FROM payments WHERE booking_id = ANY($1::uuid[]) ORDER BY booking_id, type`,
      [bookings.map(b => b.id)]
    );
    const bookingsWithPayments = bookings.map(b => ({
      ...b,
      payments: paymentsByBooking.rows.filter(p => p.booking_id === b.id),
    }));

    const statusBreakdown = {};
    bookings.forEach(b => { statusBreakdown[b.status] = (statusBreakdown[b.status] || 0) + 1; });
    // Money is summed over ACTIVE rooms only — a room cancelled (or no-show)
    // out of the group no longer owes anything. Each room carries its own
    // prorated share of the group discount, so summing the active rooms'
    // discount_amount drops the cancelled room's share with it.
    const inactive = new Set(bookings.filter(b => ['cancelled', 'no_show'].includes(b.status)).map(b => b.id));
    const active = bookings.filter(b => !inactive.has(b.id));
    // Room payments only — an 'incidental' payment (an extra paid at the desk,
    // migration 067) settles its own sale, not the group's room balance.
    const roomPaid = p => p.status === 'received' && (p.type === 'deposit' || p.type === 'balance');
    const paidAmount = paymentsByBooking.rows
      .filter(p => roomPaid(p) && !inactive.has(p.booking_id))
      .reduce((s, p) => s + parseFloat(p.amount), 0);
    // Money already received on a room that was later cancelled — not counted
    // toward the group; FO refunds it or moves it by hand.
    const paidOnCancelled = paymentsByBooking.rows
      .filter(p => roomPaid(p) && inactive.has(p.booking_id))
      .reduce((s, p) => s + parseFloat(p.amount), 0);
    const totalAmount = active.reduce((s, b) => s + parseFloat(b.total_amount), 0);
    const discountAmount = active.reduce((s, b) => s + parseFloat(b.discount_amount || 0), 0);
    const netAmount = totalAmount - discountAmount;
    // Billed as a whole (migration 097): the group's own payments and bill
    // (room nights + meal plan, plus extras when the group pays everything).
    const bill = group.group_billing ? await groupBilling.groupBill(group.id, req.propertyId) : null;

    // The group's history: every room's Edit History, newest first, with the
    // room it belongs to (the group page merges one action on several rooms).
    const { rows: events } = await db.query(`
      SELECT be.id, be.booking_id, be.note, be.created_at, u.name AS author_name, un.name AS unit_name
      FROM booking_events be
      JOIN bookings b ON b.id = be.booking_id
      JOIN units un ON un.id = b.unit_id
      LEFT JOIN users u ON u.id = be.created_by
      WHERE b.reservation_group_id = $1 AND b.property_id = $2
      ORDER BY be.created_at DESC, un.name
      LIMIT 500`, [req.params.groupId, req.propertyId]);

    res.json({
      group,
      bookings: bookingsWithPayments,
      events,
      // group_billing: { billing_mode, total, received, balance_due, payments, rooms [{ group_total, own_total, own_balance }] }
      bill,
      rollup: {
        room_count: active.length,
        cancelled_count: inactive.size,
        total_amount: round2(totalAmount),
        discount_amount: round2(discountAmount),
        net_amount: round2(netAmount),
        deposit_amount: parseFloat(group.group_deposit_amount || 0),
        group_billing: !!group.group_billing,
        billing_mode: group.billing_mode,
        // A group billed as a whole: its payments against its bill.
        paid_amount: bill ? bill.received : round2(paidAmount),
        paid_on_cancelled: bill ? 0 : round2(paidOnCancelled),
        bill_total: bill ? bill.total : round2(netAmount),
        balance_due: bill ? bill.balance_due : round2(netAmount - paidAmount),
        status_breakdown: statusBreakdown,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const bookingQ = db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality, g.email as guest_email,
             g.address as guest_address, g.id_number,
             (g.id_document_url IS NOT NULL) AS guest_has_id_document,
             u.name as unit_name, u.bed_config, u.type as room_type_name,
             rp.code as rate_plan_code, rp.name as rate_plan_name,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size,
             -- A group billed as a whole (migration 097): the room price is paid by the group.
             COALESCE((SELECT rg.group_billing FROM reservation_groups rg WHERE rg.id = b.reservation_group_id), false) AS group_billed,
             (SELECT rg.billing_mode FROM reservation_groups rg WHERE rg.id = b.reservation_group_id) AS group_billing_mode,
             -- Agent billing (city ledger): shown as a badge on the booking page.
             ai.invoice_number AS agent_invoice_number,
             (SELECT COALESCE(SUM(apa.amount), 0) FROM agent_payment_allocations apa
               WHERE apa.booking_id = b.id) AS agent_paid_amount,
             (SELECT name FROM users cu WHERE cu.id = b.complimentary_by) AS complimentary_by_name,
             EXISTS (SELECT 1 FROM complimentary_requests cr WHERE cr.booking_id = b.id
                       AND cr.status = 'pending' AND cr.expires_at > NOW()) AS complimentary_request_pending,
             -- Publish Rate off (OTA / agent, migration 065): invoices get a guest copy without the room rate
             -- rate hidden: source Publish Rate off, or an agent billing the hotel (services/publishRate.js)
             (SELECT ${PUBLISH_RATE_SQL} FROM (SELECT 1) x LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
                LEFT JOIN agents ag ON ag.id = b.agent_id) AS source_publish_rate,
             (SELECT ${ARRANGED_BY_SQL} FROM (SELECT 1) x LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
                LEFT JOIN agents ag ON ag.id = b.agent_id) AS arranged_by,
             (SELECT bs.label FROM booking_sources bs WHERE bs.id = b.source AND bs.property_id = b.property_id) AS source_label,
             -- the booking's agent (migration 084) and its billing terms
             ag.name AS agent_name, ag.agent_type, ag.payment_status AS agent_payment_status,
             ag.commission_type AS agent_commission_type, ag.commission_value AS agent_commission_value,
             ag.credit_limit AS agent_credit_limit
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      LEFT JOIN agents ag ON ag.id = b.agent_id
      LEFT JOIN agent_invoices ai ON ai.id = b.agent_invoice_id AND ai.property_id = b.property_id
      WHERE b.id = $1 AND b.property_id = $2`, [req.params.id, req.propertyId]);
    const paymentsQ = db.query(PAYMENTS_WITH_RECEIPT_SQL, [req.params.id]);   // + receipt_kind (Download → Receipts)
    const notesQ = db.query(`
      SELECT bn.*, u.name as author_name FROM booking_notes bn
      LEFT JOIN users u ON bn.author_id = u.id
      WHERE bn.booking_id = $1 ORDER BY bn.created_at`, [req.params.id]);
    const checkinQ = db.query(
      `SELECT checkin_time, checkout_time, condition_notes, id_captured
       FROM checkin_records WHERE booking_id = $1`,
      [req.params.id]);
    const eventsQ = db.query(`
      SELECT be.*, u.name as author_name FROM booking_events be
      LEFT JOIN users u ON be.created_by = u.id
      WHERE be.booking_id = $1 ORDER BY be.created_at DESC`, [req.params.id]);

    const [{ rows: [booking] }, { rows: payments }, { rows: notes }, { rows: [checkin_record] }, { rows: events }] =
      await Promise.all([bookingQ, paymentsQ, notesQ, checkinQ, eventsQ]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const group = booking.reservation_group_id ? { id: booking.reservation_group_id, room_count: booking.group_size } : null;
    // Each night's price when the stay isn't priced the same every night
    // (migration 090) — [] otherwise.
    const night_prices = nightRatesSvc.nightPrices(booking,
      stayNightList(booking.check_in_date, booking.check_out_date), await nightRatesSvc.loadNightRates(db, booking.id));
    res.json({ ...booking, payments, notes, checkin_record: checkin_record || null, group, events, night_prices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings
router.post('/', auth, async (req, res) => {
  const { guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, special_requests, internal_notes, status, discount_type, discount_value, rate_plan_id, bed_preference, room_revenue } = req.body;
  if (!guest_id || !unit_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ error: 'guest_id, unit_id, check_in_date, check_out_date required' });
  }
  const commission = agentService.parseBookingCommission(req.body);
  if (commission.error) return res.status(400).json({ error: commission.error });
  if (bed_preference && !BED_PREFS.includes(bed_preference)) {
    return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: unitRows } = await client.query('SELECT id, name FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unitRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unit not found' }); }
    const { rows: guestRows } = await client.query('SELECT id, name FROM guests WHERE id = $1 AND property_id = $2', [guest_id, req.propertyId]);
    if (!guestRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }
    const agentPick = await agentService.agentForBooking(client, req.propertyId, { agentId: req.body.agent_id, source: source || 'direct' });
    if (agentPick.error) { await client.query('ROLLBACK'); return res.status(404).json({ error: agentPick.error }); }

    // Check availability
    const conflict = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $4
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $3
        AND ${occupiedUntilSql('')} > $2
    `, [unit_id, check_in_date, check_out_date, req.propertyId]);
    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Unit is not available for the selected dates' });
    }

    // A price per night (migration 090): the total is then the nights' sum.
    const nightPrices = nightRatesSvc.parseNightPrices(req.body.night_prices, stayNightList(check_in_date, check_out_date));
    if (nightPrices?.error) { await client.query('ROLLBACK'); return res.status(400).json(nightPrices); }
    const total = nightPrices ? nightPrices.total : parseFloat(total_amount || 0);

    // Compute discount
    const dType  = discount_type || null;
    const dValue = parseFloat(discount_value || 0);
    let discountAmount = 0;
    if (dType === 'fixed')      discountAmount = Math.min(dValue, total);
    if (dType === 'percentage') discountAmount = Math.round(total * dValue / 100);

    // Rate plan + room/F&B net split
    const nights = Math.max(1, Math.round((new Date(check_out_date) - new Date(check_in_date)) / 86400000));
    const guests = Math.max(1, parseInt(num_guests, 10) || 1);
    const ratePlan = await ratePlanService.resolveForBooking(req.propertyId, rate_plan_id || null);
    const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, req.propertyId);
    const { roomNet, mealNet } = splitRevenue({
      grossNet: total - discountAmount, nights, ratePlan, numGuests: guests, F, divisor, clientRoomRevenue: room_revenue,
      tax_rate, service_charge_rate,
    });
    // Store total_amount consistently with the split (pre-discount gross rack);
    // the price typed when the split lands within a few cents of it.
    const payable = room_revenue != null && room_revenue !== ''
      ? computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total
      : snapPayable(computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total, total - discountAmount);
    const storedTotal = round2(payable + discountAmount);

    const net = payable;
    const depositAmount = deposit_amount !== undefined
      ? Math.min(parseFloat(deposit_amount), net)
      : Math.round(net * 0.5); // default deposit 50% (same as New Booking)
    const balanceAmount = round2(net - depositAmount);

    const { rows } = await client.query(
      `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue, agent_id, commission_type, commission_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [guest_id, unit_id, check_in_date, check_out_date, num_guests || 1, source || 'direct', storedTotal, depositAmount, dType, dValue, discountAmount, special_requests, internal_notes, status || 'pending', req.user.id, req.propertyId, ratePlan?.id || null, bed_preference || null, roomNet, mealNet,
       agentPick.agentId, agentPick.agentId ? commission.values.commission_type ?? null : null, agentPick.agentId ? commission.values.commission_value ?? null : null]
    );
    const booking = rows[0];
    if (nightPrices?.shares) {
      const saved = await nightRatesSvc.saveNightRates(client, {
        bookingId: booking.id, nights: stayNightList(check_in_date, check_out_date), shares: nightPrices.shares, roomNet, mealNet });
      if (saved.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A night is priced below its meals — raise that night or change the rate plan', code: saved.error });
      }
    }
    if (depositAmount > 0) {
      await client.query(
        'INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)',
        [booking.id, 'deposit', depositAmount]
      );
    }
    if (balanceAmount > 0) {
      await client.query(
        'INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)',
        [booking.id, 'balance', balanceAmount]
      );
    }

    await client.query('COMMIT');

    // Fire and forget — don't await, don't fail the booking if email fails
    sendBookingEmail(req.propertyId, booking.id, 'booking_confirmed')
      .catch(err => console.error('Email trigger failed:', err));
    telegramService.sendAlert(req.propertyId, 'alert_new_booking',
      newBookingAlert({ title: 'New booking', guest: guestRows[0].name, rooms: [unitRows[0].name],
        checkIn: check_in_date, checkOut: check_out_date, guests: booking.num_guests,
        total: parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0), by: req.user?.name }),
      { html: true }
    ).catch(() => {});

    res.status(201).json(booking);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/group — multi-room reservation under one guest + shared dates.
// Single-room bookings keep using POST / above unchanged; this endpoint only
// exists once there are 2+ rooms (rooms.length < 2 is rejected below).
// A group's dates are the span of its rooms (first arrival → last departure),
// since each room can have its own dates. Cancelled / no-show rooms don't
// count (unless every room is — then the dates stay as they were).
async function syncGroupSpan(client, groupId) {
  await client.query(`
    UPDATE reservation_groups rg SET check_in_date = s.ci, check_out_date = s.co, updated_at = NOW()
    FROM (SELECT MIN(check_in_date) AS ci, MAX(check_out_date) AS co FROM bookings
          WHERE reservation_group_id = $1 AND status NOT IN ('cancelled', 'no_show')) s
    WHERE rg.id = $1 AND s.ci IS NOT NULL`, [groupId]);
}

router.post('/group', auth, async (req, res) => {
  const {
    guest_id, check_in_date, check_out_date, source, status,
    special_requests, internal_notes,
    group_discount_type, group_discount_value, group_deposit_amount,
    rooms,
  } = req.body;

  if (!guest_id || !check_in_date || !check_out_date || !Array.isArray(rooms) || rooms.length < 2) {
    return res.status(400).json({ error: 'guest_id, check_in_date, check_out_date, and at least 2 rooms are required' });
  }
  const commission = agentService.parseBookingCommission(req.body);
  if (commission.error) return res.status(400).json({ error: commission.error });
  const unitIds = rooms.map(r => r.unit_id);
  if (unitIds.some(id => !id) || new Set(unitIds).size !== unitIds.length) {
    return res.status(400).json({ error: 'Each room needs a unit_id, and units must not repeat' });
  }
  // Each room can have its own dates (check_in_date / check_out_date on the
  // room); without them it takes the group's.
  const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of rooms) {
    r.ci = r.check_in_date || check_in_date;
    r.co = r.check_out_date || check_out_date;
    if (!ymdRe.test(String(r.ci)) || !ymdRe.test(String(r.co)) || r.co <= r.ci) {
      return res.status(400).json({ error: 'Every room needs a check-out date after its check-in date' });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: guestRows } = await client.query('SELECT id FROM guests WHERE id = $1 AND property_id = $2', [guest_id, req.propertyId]);
    if (!guestRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }
    // One agent for the whole group (and its commission, per room)
    const agentPick = await agentService.agentForBooking(client, req.propertyId, { agentId: req.body.agent_id, source: source || 'direct' });
    if (agentPick.error) { await client.query('ROLLBACK'); return res.status(404).json({ error: agentPick.error }); }

    const { rows: unitRows } = await client.query('SELECT id, name FROM units WHERE id = ANY($1::uuid[]) AND property_id = $2', [unitIds, req.propertyId]);
    if (unitRows.length !== unitIds.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'One or more units not found' }); }

    for (const r of rooms) {
      const conflict = await client.query(`
        SELECT id FROM bookings
        WHERE unit_id = $1 AND property_id = $4
          AND status NOT IN ('cancelled','no_show')
          AND check_in_date < $3 AND ${occupiedUntilSql('')} > $2
      `, [r.unit_id, r.ci, r.co, req.propertyId]);
      if (conflict.rows.length > 0) {
        await client.query('ROLLBACK');
        const unitName = unitRows.find(u => u.id === r.unit_id)?.name || r.unit_id;
        return res.status(409).json({ error: `Room ${unitName} is not available for ${r.ci} to ${r.co}` });
      }
    }

    if (rooms.some(r => r.bed_preference && !BED_PREFS.includes(r.bed_preference))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
    }

    const nightsOf = r => Math.max(1, Math.round((new Date(r.co) - new Date(r.ci)) / 86400000));
    const spanIn = rooms.reduce((m, r) => (r.ci < m ? r.ci : m), rooms[0].ci);
    const spanOut = rooms.reduce((m, r) => (r.co > m ? r.co : m), rooms[0].co);
    const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, req.propertyId);

    // A price per night for a room (migration 090): its total is the nights' sum.
    for (const r of rooms) {
      const np = nightRatesSvc.parseNightPrices(r.night_prices, stayNightList(r.ci, r.co));
      if (np?.error) { await client.query('ROLLBACK'); return res.status(400).json(np); }
      if (np) { r.total_amount = np.total; r.nightShares = np.shares; }
    }
    const groupTotal = rooms.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);

    const gdType = group_discount_type || null;
    const gdValue = parseFloat(group_discount_value || 0);
    let groupDiscountAmount = 0;
    if (gdType === 'fixed')      groupDiscountAmount = Math.min(gdValue, groupTotal);
    if (gdType === 'percentage') groupDiscountAmount = Math.round(groupTotal * gdValue / 100);
    const groupNet = groupTotal - groupDiscountAmount;
    const groupDepositAmount = Math.min(parseFloat(group_deposit_amount || 0), groupNet);

    // Prorate discount/deposit per room by each room's share of the group total.
    // The last room absorbs the rounding remainder so both sums stay exact.
    let discountRemaining = groupDiscountAmount;
    let depositRemaining = groupDepositAmount;
    const shares = rooms.map((room, i) => {
      const isLast = i === rooms.length - 1;
      const roomTotal = parseFloat(room.total_amount || 0);
      const discountShare = isLast ? discountRemaining : Math.round(groupDiscountAmount * roomTotal / (groupTotal || 1));
      discountRemaining -= discountShare;
      const roomNet = roomTotal - discountShare;
      return { room, roomTotal, discountShare, roomNet, isLast };
    });
    // Second pass for deposit share, since it's proportional to roomNet / groupNet
    shares.forEach(s => {
      s.depositShare = s.isLast ? depositRemaining : Math.round(groupDepositAmount * s.roomNet / (groupNet || 1));
      depositRemaining -= s.depositShare;
      s.balanceShare = s.roomNet - s.depositShare;
    });

    // Billed as a whole (migration 097): one bill and one payment record for
    // the group, no deposit / balance lines on its rooms — except a group
    // billed to a city-ledger agent, which keeps per-room agent billing.
    let groupBilled = true;
    if (agentPick.agentId) {
      const { rows: [ag] } = await client.query('SELECT payment_status FROM agents WHERE id = $1', [agentPick.agentId]);
      if (agentBilling.CITY_LEDGER.includes(ag?.payment_status)) groupBilled = false;
    }
    const billingMode = req.body.billing_mode === 'everything' ? 'everything' : 'room_meals';

    const { rows: [group] } = await client.query(
      `INSERT INTO reservation_groups (property_id, primary_guest_id, check_in_date, check_out_date, group_discount_type, group_discount_value, group_discount_amount, group_deposit_amount, special_requests, internal_notes, created_by, group_billing, billing_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.propertyId, guest_id, spanIn, spanOut, gdType, gdValue, groupDiscountAmount, groupDepositAmount, special_requests, internal_notes, req.user.id, groupBilled, billingMode]
    );

    const bookings = [];
    for (const s of shares) {
      // Child bookings store the GROUP's discount_type/discount_value verbatim
      // (so BookingDetail.jsx's existing discount box renders unchanged) but
      // their own prorated discount_amount/deposit_amount — that amount won't
      // self-reconcile if recomputed against this one room's total in
      // isolation, which is intentional, not a bug to "fix" later.
      const roomGuests = Math.max(1, parseInt(s.room.num_guests, 10) || 1);
      const roomPlan = await ratePlanService.resolveForBooking(req.propertyId, s.room.rate_plan_id || null);
      const { roomNet: roomRevNet, mealNet } = splitRevenue({
        grossNet: s.roomNet, nights: nightsOf(s.room), ratePlan: roomPlan, numGuests: roomGuests, F, divisor, tax_rate, service_charge_rate,
      });
      const roomStoredTotal = round2(snapPayable(computeFolioTotals(roomRevNet + mealNet, tax_rate, service_charge_rate).total, s.roomNet) + s.discountShare);

      const { rows: [booking] } = await client.query(
        `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, reservation_group_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue, agent_id, commission_type, commission_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
        [guest_id, s.room.unit_id, s.room.ci, s.room.co, s.room.num_guests || 1, source || 'direct', roomStoredTotal, groupBilled ? 0 : s.depositShare, gdType, gdValue, s.discountShare, special_requests, internal_notes, status || 'pending', req.user.id, req.propertyId, group.id, roomPlan?.id || null, s.room.bed_preference || null, roomRevNet, mealNet,
         agentPick.agentId, agentPick.agentId ? commission.values.commission_type ?? null : null, agentPick.agentId ? commission.values.commission_value ?? null : null]
      );
      if (s.room.nightShares) {
        const saved = await nightRatesSvc.saveNightRates(client, {
          bookingId: booking.id, nights: stayNightList(s.room.ci, s.room.co), shares: s.room.nightShares, roomNet: roomRevNet, mealNet });
        if (saved.error) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'A night is priced below its meals — raise that night or change the rate plan', code: saved.error });
        }
      }
      if (!groupBilled && s.depositShare > 0) {
        await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'deposit', s.depositShare]);
      }
      if (!groupBilled && s.balanceShare > 0) {
        await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'balance', s.balanceShare]);
      }
      bookings.push(booking);
    }

    await client.query('COMMIT');

    sendGroupBookingEmail(req.propertyId, group.id)
      .catch(err => console.error('Group email trigger failed:', err));

    res.status(201).json({ group, bookings });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// What a group billed as a whole can be refunded: received beyond its bill
// (a cancelled group has no bill left, so everything received).
async function groupRefundable(groupId, propertyId) {
  const bill = await groupBilling.groupBill(groupId, propertyId);
  if (!bill) return null;
  return { received: bill.received, bill: bill.total, amount: Math.max(0, round2(bill.received - bill.total)) };
}

// GET /api/bookings/group/:groupId/refundable
router.get('/group/:groupId/refundable', auth, async (req, res) => {
  try {
    const r = await groupRefundable(req.params.groupId, req.propertyId);
    if (!r) return res.status(409).json({ error: 'This group is paid room by room — refund on the room\'s own booking', code: 'NOT_GROUP_BILLED' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/group/:groupId/refund { amount, method, refunded_at?, reference?, reason }
// Money given back to a group billed as a whole (a correction: owner or the
// `corrections` permission). Never more than the group's credit.
router.post('/group/:groupId/refund', auth, requireOwnerOrMenu('corrections'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const can = await groupRefundable(req.params.groupId, req.propertyId);
    if (!can) return res.status(409).json({ error: 'This group is paid room by room — refund on the room\'s own booking', code: 'NOT_GROUP_BILLED' });
    await client.query('BEGIN');
    await client.query('SELECT id FROM reservation_groups WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.groupId, req.propertyId]);
    const r = await groupBilling.refund(client, {
      propertyId: req.propertyId, groupId: req.params.groupId, userId: req.user.id,
      amount: req.body.amount, method: req.body.method, refundedAt: req.body.refunded_at || null,
      reference: req.body.reference, reason: req.body.reason, refundable: can.amount,
    });
    if (r.error) { await client.query('ROLLBACK'); return res.status(r.status).json({ error: r.error, code: r.code, refundable: r.refundable }); }
    const { rows: rooms } = await client.query('SELECT id FROM bookings WHERE reservation_group_id = $1', [req.params.groupId]);
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: rooms.map(x => x.id), userId: req.user.id, reason: String(req.body.reason).trim(),
      headline: `💸 Group refund ${fmtIDR(-r.payment.amount)} (${r.payment.method_label})` });
    res.status(201).json(r.payment);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/group/:groupId  (cancel whole group — no hard delete)
router.delete('/group/:groupId', auth, async (req, res) => {
  // A reason every time; a group with a guest in house can't be cancelled as
  // a whole (it used to cancel checked-in rooms too) — remove the rooms that
  // aren't coming instead.
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'A reason is required to cancel a group', code: 'REASON_REQUIRED' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inHouse] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM bookings WHERE reservation_group_id = $1 AND property_id = $2 AND status = 'checked_in'`,
      [req.params.groupId, req.propertyId]);
    if (inHouse.n > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `${inHouse.n} room${inHouse.n === 1 ? ' is' : 's are'} checked in — remove the rooms that aren't coming instead of cancelling the whole group`, code: 'ROOMS_IN_HOUSE' });
    }
    const { rows: [group] } = await client.query(
      "UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.groupId, req.propertyId]
    );
    if (!group) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    const { rows: bookings } = await client.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
       WHERE reservation_group_id = $1 AND property_id = $2 AND status NOT IN ('checked_out','cancelled')
       RETURNING *`,
      [req.params.groupId, req.propertyId]
    );
    for (const b of bookings) {
      await roomCharge.voidAll(client, b.id, req.user.id);
      await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
        [b.id, `Group cancelled. Reason: ${reason}`.slice(0, 1000), req.user.id]);
    }
    await client.query('COMMIT');
    res.json({ group, bookings });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/confirm  (for zero-net bookings with no payments to collect)
router.put('/:id/confirm', auth, async (req, res) => {
  try {
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'pending') return res.status(409).json({ error: 'Booking is not in pending status' });

    const net = parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0);
    const hasPendingPayment = await db.query(
      "SELECT id FROM payments WHERE booking_id = $1 AND status = 'pending' AND amount > 0",
      [booking.id]
    );
    if (net > 0 && hasPendingPayment.rows.length > 0) {
      return res.status(409).json({ error: 'Use payment confirmation to confirm this booking' });
    }

    const { rows: [updated] } = await db.query(
      "UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [booking.id, req.propertyId]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/transfer
router.put('/:id/transfer', auth, async (req, res) => {
  const { unit_id } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    const transferable = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
    if (!transferable.includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot transfer — booking status is ${booking.status}` });
    }
    if (booking.unit_id === unit_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking is already assigned to this unit' });
    }

    const { rows: [targetUnit] } = await client.query('SELECT id FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!targetUnit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Target unit not found' }); }

    const { rows: conflicts } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $5
        AND id != $2
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $4
        AND ${occupiedUntilSql('')} > $3
    `, [unit_id, req.params.id, booking.check_in_date, booking.check_out_date, req.propertyId]);
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Target unit is not available for these booking dates' });
    }

    const oldUnitId = booking.unit_id;
    await client.query('UPDATE bookings SET unit_id = $1, updated_at = NOW() WHERE id = $2 AND property_id = $3', [unit_id, req.params.id, req.propertyId]);

    if (booking.status === 'checked_in') {
      await client.query("UPDATE units SET status = 'available' WHERE id = $1 AND property_id = $2", [oldUnitId, req.propertyId]);
      await client.query("UPDATE units SET status = 'occupied' WHERE id = $1 AND property_id = $2", [unit_id, req.propertyId]);
    }

    await client.query('COMMIT');
    const { rows: [updated] } = await db.query(`
      SELECT b.*, g.name as guest_name, u.name as unit_name
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1 AND b.property_id = $2
    `, [req.params.id, req.propertyId]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/dates  (amend check-in/check-out dates, same unit)
// Amend Dates pricing, same idea as Change Room: the CURRENT dates count at
// the booking's own price (room + meals, after discount — what FO typed and
// the guest agreed to), and the NEW dates are suggested at that same booked
// price per night × the new number of nights. So extending charges the added
// nights at the guest's own nightly price (meals included), shortening
// credits exactly what those nights cost them, and a plain shift costs
// nothing. FO can type another price in the window. The room's NORMAL rate
// for the new dates (base rate + pricing periods + rate-plan meals, same as
// New Booking) is returned too, for reference. All incl. service/tax.
async function datesQuote(client, { propertyId, booking, checkIn, checkOut }) {
  const oldCi = String(booking.check_in_date).slice(0, 10);
  const oldCo = String(booking.check_out_date).slice(0, 10);
  const nightsOf = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
  const oldNights = Math.max(1, nightsOf(oldCi, oldCo));
  const newNights = nightsOf(checkIn, checkOut);
  const { tax_rate, service_charge_rate, divisor } = await grossFactor(client, propertyId);
  const gross = net => computeFolioTotals(net, tax_rate, service_charge_rate).total;

  // The booking's own price (room + meals, after discount, incl. service/tax)
  // — straight from what FO entered, so a later tax-rate change can't shift it.
  const oldTotal = round2(parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0));
  const perNight = oldTotal / oldNights;
  // A price per night (migration 090): a night that stays keeps its own
  // price, an added night takes the average — instead of average × nights.
  const carried = nightRatesSvc.carryPrices(
    nightRatesSvc.nightPrices(booking, stayNightList(oldCi, oldCo), await nightRatesSvc.loadNightRates(client, booking.id)),
    stayNightList(checkIn, checkOut));
  const newTotal = carried ? round2(oldTotal * carried.sum / carried.oldSum) : round2(perNight * newNights);

  // Normal rate for the new dates, for reference.
  const [newR, plan] = await Promise.all([
    nightlyRoomRates(propertyId, booking.unit_id, checkIn, checkOut, client),
    ratePlanService.resolveForBooking(propertyId, booking.rate_plan_id || null),
  ]);
  const guests = Math.max(1, parseInt(booking.num_guests, 10) || 1);
  const normalNew = round2(gross(newR.room_total + ratePlanService.mealNetPerNight(plan, guests, divisor) * newNights));

  return {
    old: { check_in: oldCi, check_out: oldCo, nights: oldNights, total: oldTotal },
    new: { check_in: checkIn, check_out: checkOut, nights: newNights, total: newTotal, normal_total: normalNew, per_night: round2(perNight) },
    difference: round2(newTotal - oldTotal),
    // each new night's share of the price, when the stay has night prices
    night_shares: carried ? carried.shares : undefined,
  };
}

function datesSpan(q) {
  return `${fmtShortYmd(q.check_in)}–${fmtShortYmd(q.check_out)} (${q.nights} night${q.nights === 1 ? '' : 's'})`;
}

// Moves one booking to new dates and puts `amount` (+ charge / − credit) on
// its price — or, with amount 0, keeps the price and re-spreads it over the
// new nights. Logs the change to Edit History. Shared by PUT /:id/dates and
// the group version (PUT /group/:groupId/dates). Runs in the caller's txn.
async function applyNewDates(client, { propertyId, booking, userId, checkIn, checkOut, quote, amount, charge, reason, notePrefix = '' }) {
  // Room and meals are free: a typed price would put meals back on the bill.
  if (amount !== 0 && ['room_meals', 'all'].includes(booking.complimentary_scope)) {
    return { status: 409, error: { error: 'This stay is complimentary — change the dates without a charge, or remove complimentary first' } };
  }
  await client.query(
    'UPDATE bookings SET check_in_date = $1, check_out_date = $2, updated_at = NOW() WHERE id = $3 AND property_id = $4',
    [checkIn, checkOut, booking.id, propertyId]
  );
  const { rows: [fresh] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [booking.id, propertyId]);

  let priced = null;
  if (amount !== 0) {
    // New price → split, folio nights, pending lines, status (also reposts).
    priced = await applyBookingPrice(client, {
      propertyId, before: fresh, userId,
      newTotal: Math.max(0, round2(parseFloat(booking.total_amount) + amount)),
      keepDiscount: true, receivedWasTypo: false,
      balanceNote: `Date change ${quote.old.check_in}–${quote.old.check_out} → ${checkIn}–${checkOut} — additional amount due`,
      // nights that stay keep their own price (see datesQuote)
      nightShares: quote.night_shares,
    });
    if (priced.error) return priced;
  } else {
    // Same price: re-spread the unchanged room/F&B totals over the new
    // night count and re-post the folio nights.
    if (quote.night_shares) {
      const saved = await nightRatesSvc.saveNightRates(client, {
        bookingId: booking.id, nights: stayNightList(checkIn, checkOut), shares: quote.night_shares,
        roomNet: fresh.room_revenue, mealNet: fresh.fnb_revenue });
      // a night below its meals → the same price every night instead
      if (saved.error) await client.query('DELETE FROM booking_night_rates WHERE booking_id = $1', [booking.id]);
    }
    await roomCharge.repostStay(client, fresh, userId);
  }

  let note = `${notePrefix}Dates changed: ${datesSpan(quote.old)} → ${datesSpan(quote.new)}.`;
  if (charge === 'complimentary') note += ` Price kept — no charge (normal difference ${fmtIDR(quote.difference)}).`;
  else if (amount > 0) note += ` Charged +${fmtIDR(amount)}${charge === 'custom' ? ` (normal difference ${fmtIDR(quote.difference)})` : ''}.`;
  else if (amount < 0) note += ` Credit ${fmtIDR(-amount)}${charge === 'custom' ? ` (normal difference ${fmtIDR(quote.difference)})` : ''}.`;
  if (priced?.credit > 0) note += ` Guest overpaid ${fmtIDR(priced.credit)} — to be refunded.`;
  note += ` Reason: ${reason}`;
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [booking.id, note.slice(0, 1000), userId]);
  return { priced };
}

// GET /api/bookings/:id/dates/quote?check_in=&check_out= — price difference
// shown before saving new dates.
router.get('/:id/dates/quote', auth, async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!check_in || !check_out || check_out <= check_in) return res.status(400).json({ error: 'check_in and a later check_out are required' });
  try {
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(await datesQuote(db, { propertyId: req.propertyId, booking, checkIn: check_in, checkOut: check_out }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/dates — { check_in_date, check_out_date, charge,
// amount?, reason }. charge: 'difference' (the quoted normal-rate
// difference — an extension is charged, a shortening credited) |
// 'complimentary' (keep the current price) | 'custom' (amount, may be
// negative). The charge goes onto the booking price via applyBookingPrice
// (same as Change Room — not discounted; a credit if the guest already paid
// more). Reason required; logged to Edit History.
router.put('/:id/dates', auth, async (req, res) => {
  const { check_in_date, check_out_date, charge = 'difference' } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!check_in_date || !check_out_date) return res.status(400).json({ error: 'check_in_date, check_out_date required' });
  if (!['difference', 'complimentary', 'custom'].includes(charge)) return res.status(400).json({ error: 'charge must be difference, complimentary or custom' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const custom = parseFloat(req.body.amount);
  if (charge === 'custom' && !Number.isFinite(custom)) return res.status(400).json({ error: 'amount required for a custom charge' });
  if (new Date(check_out_date) <= new Date(check_in_date)) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    // A group room can have its own dates (the group page's Amend Dates moves
    // every room together); the group's dates follow as the span of its rooms.

    const amendable = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
    if (!amendable.includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot amend dates — booking status is ${booking.status}` });
    }

    if (booking.check_in_date === check_in_date && booking.check_out_date === check_out_date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'New dates are the same as the current dates' });
    }

    const { rows: conflicts } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $5
        AND id != $2
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $4
        AND ${occupiedUntilSql('')} > $3
    `, [booking.unit_id, req.params.id, check_in_date, check_out_date, req.propertyId]);
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Unit is not available for the new dates' });
    }

    const quote = await datesQuote(client, { propertyId: req.propertyId, booking, checkIn: check_in_date, checkOut: check_out_date });
    const amount = charge === 'complimentary' ? 0 : charge === 'custom' ? round2(custom) : quote.difference;
    if (amount !== 0 && ['invoiced', 'paid'].includes(booking.folio_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This stay is already on an agent invoice — change the dates without a charge, or correct it through Agent Billing' });
    }

    const done = await applyNewDates(client, {
      propertyId: req.propertyId, booking, userId: req.user.id,
      checkIn: check_in_date, checkOut: check_out_date, quote, amount, charge, reason,
    });
    if (done.error) { await client.query('ROLLBACK'); return res.status(done.status).json(done.error); }
    if (booking.reservation_group_id) await syncGroupSpan(client, booking.reservation_group_id);

    await client.query('COMMIT');
    if (amount !== 0 && booking.folio_status === 'pending_agent_invoice') {
      await agentBilling.recomputeCommission(req.propertyId, booking.id).catch(err => console.error('Commission recompute failed:', err));
    }
    // Owner alert: extra nights (or pricier dates) given free or below the normal price.
    const span = datesSpan;
    if (quote.difference > 0 && amount < quote.difference) {
      sendControlAlert(req.propertyId, {
        bookingIds: booking.id, userId: req.user.id, reason,
        headline: amount <= 0
          ? `🎁 Free stay change: ${span(quote.old)} → ${span(quote.new)}, no charge`
          : `🏷 Discounted stay change: ${span(quote.old)} → ${span(quote.new)}, charged ${fmtIDR(amount)}`,
        details: [`Normal price ${fmtIDR(quote.difference)} — given away ${fmtIDR(quote.difference - Math.max(0, amount))}`],
      });
    }
    const { rows: [updated] } = await db.query(`
      SELECT b.*, g.name as guest_name, u.name as unit_name
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1 AND b.property_id = $2
    `, [req.params.id, req.propertyId]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// PUT /api/bookings/:id/price — owner corrects a wrongly-entered booking
// price. `total_amount` is the same figure New Booking takes (gross, tax
// included, before any discount); `reason` is required and goes to the Edit
// History. Everything derived from the price is recomputed together, the same
// way booking creation derives it: discount amount, the net room/F&B split
// (reports, dashboard, night audit, reg card, yield history), the folio's
// posted room/F&B nights (void + re-post), and the pending deposit/balance
// lines. Received payments are never touched: if the new price is higher than
// everything already received, the difference becomes a pending balance line;
// if it's lower than what's recorded as received, the owner must say which is
// true (`received_was_typo`): the received amount was typed from the same
// wrong price (the guest actually paid the new price) → the received lines
// are corrected down to it; or the guest really paid more → the overpayment
// stays as a credit on the folio (no refund flow yet — returned by hand).
// An unpaid agent commission is re-derived.
// Group rooms: a percentage group discount is re-applied to the room's new
// price; a fixed group discount keeps the room's prorated share as-is (the
// room stores the group's full fixed value, not its share).
// Blocked for cancelled/no-show bookings and stays already invoiced to an agent.
// Owner, or a role with the `edit_price` permission (Roles & Permissions).
router.put('/:id/price', auth, requireOwnerOrMenu('edit_price'), async (req, res) => {
  // night_prices: [{ date, amount }] — a price per night (tax included, before
  // discount, like total_amount); the total is then their sum.
  const nightPricesIn = Array.isArray(req.body.night_prices) && req.body.night_prices.length ? req.body.night_prices : null;
  if (nightPricesIn && nightPricesIn.some(n => !Number.isFinite(parseFloat(n?.amount)) || parseFloat(n.amount) < 0)) {
    return res.status(400).json({ error: 'Each night needs a price of 0 or more' });
  }
  const newTotal = nightPricesIn ? round2(nightPricesIn.reduce((s, n) => s + parseFloat(n.amount), 0)) : parseFloat(req.body.total_amount);
  const reason = String(req.body.reason || '').trim();
  if (!Number.isFinite(newTotal) || newTotal < 0) return res.status(400).json({ error: 'total_amount must be a number of 0 or more' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]
    );
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    if (['cancelled', 'no_show'].includes(before.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot change the price — booking is ${before.status.replace('_', '-')}` });
    }
    if (['invoiced', 'paid'].includes(before.folio_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This stay is already on an agent invoice — correct it through Agent Billing' });
    }
    if (before.complimentary_scope) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This stay is complimentary — remove complimentary first to set a price' });
    }

    // A price per night: one for every night of the stay, in any order.
    let nightShares = null, nightNote = '';
    const hadNights = (await nightRatesSvc.loadNightRates(client, before.id)).size > 0;
    if (nightPricesIn) {
      const stay = stayNightList(before.check_in_date, before.check_out_date);
      const byDate = new Map(nightPricesIn.map(n => [String(n.date || '').slice(0, 10), parseFloat(n.amount)]));
      if (byDate.size !== stay.length || stay.some(d => !byDate.has(d))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Give one price for each night of the stay', code: 'NIGHTS_MISMATCH' });
      }
      if (newTotal > 0) {
        nightShares = stay.map(d => byDate.get(d) / newTotal);
        nightNote = ` Per night: ${stay.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)} ${fmtIDR(byDate.get(d))}`).join(', ')}.`;
      }
    }

    const result = await applyBookingPrice(client, {
      propertyId: req.propertyId, before, newTotal, userId: req.user.id,
      keepDiscount: !!before.reservation_group_id && before.discount_type !== 'percentage',
      receivedWasTypo: req.body.received_was_typo,
      nightShares,
    });
    if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json(result.error); }
    const { payable, received, credit, receivedFixes } = result;

    const oldNet = round2(parseFloat(before.total_amount) - parseFloat(before.discount_amount || 0));
    let note = `Price corrected: ${fmtIDR(oldNet)} → ${fmtIDR(payable)}.`;
    const hasNights = (await nightRatesSvc.loadNightRates(client, before.id)).size > 0;
    if (hasNights) note += nightNote;
    else if (hadNights) note += ' Same price every night now.';
    if (receivedFixes.length) note += ` Received payment was a typo too, corrected: ${receivedFixes.join(', ')}.`;
    if (credit > 0) note += ` Guest overpaid ${fmtIDR(credit)} — to be refunded.`;
    note += ` Reason: ${reason}`;
    await client.query(
      'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [before.id, note.slice(0, 1000), req.user.id]
    );
    await client.query('COMMIT');

    if (before.folio_status === 'pending_agent_invoice' || before.status === 'checked_out') {
      await agentBilling.recomputeCommission(req.propertyId, before.id).catch(err => console.error('Commission recompute failed:', err));
    }
    if (payable !== oldNet || hasNights || hadNights) {
      sendControlAlert(req.propertyId, {
        bookingIds: before.id, userId: req.user.id, reason,
        headline: `💰 Price edited: ${fmtIDR(oldNet)} → ${fmtIDR(payable)} (${payable > oldNet ? '+' : '−'}${fmtIDR(Math.abs(payable - oldNet))})`,
        details: [hasNights ? nightNote.trim() : null, credit > 0 ? `Guest has overpaid ${fmtIDR(credit)} — to be refunded` : null].filter(Boolean),
      });
    }

    res.json({ old_total: oldNet, new_total: payable, received, credit, received_corrected: receivedFixes.length > 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/group/:groupId/rooms — add a room to an existing group
// (the group asked for one more room). Same dates as the group — from today
// if the group is already in house — under the booker's name (Assign Guests
// later). total_amount is the whole stay, tax included, like New Booking;
// default = the room's normal rate (+ rate plan meals). The group discount is
// NOT applied to the added room. Fewer rooms = cancel that room's booking.
router.post('/group/:groupId/rooms', auth, async (req, res) => {
  const { unit_id, num_guests, rate_plan_id, bed_preference, total_amount, deposit_amount, reason } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });
  if ((req.body.check_in_date || req.body.check_out_date) && !(req.body.check_in_date && req.body.check_out_date && req.body.check_out_date > req.body.check_in_date)) {
    return res.status(400).json({ error: 'Give both dates, check-out after check-in' });
  }
  if (bed_preference && !BED_PREFS.includes(bed_preference)) {
    return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
  }
  const given = v => v !== undefined && v !== null && v !== '';
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [group] } = await client.query(
      `SELECT rg.*, to_char(rg.check_in_date, 'YYYY-MM-DD') AS ci, to_char(rg.check_out_date, 'YYYY-MM-DD') AS co
       FROM reservation_groups rg WHERE rg.id = $1 AND rg.property_id = $2 FOR UPDATE`,
      [req.params.groupId, req.propertyId]);
    if (!group) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    if (group.status === 'cancelled') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This group is cancelled' }); }

    const today = roomCharge.todayWITA();
    // Its own dates if given, else the group's — never before today.
    const wantIn = req.body.check_in_date || group.ci;
    const checkIn = wantIn < today ? today : wantIn;
    const checkOut = req.body.check_out_date || group.co;
    if (checkIn >= checkOut) { await client.query('ROLLBACK'); return res.status(409).json({ error: req.body.check_out_date ? 'Those dates are already past' : 'This group has already checked out' }); }

    const { rows: [unit] } = await client.query('SELECT id, name FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Room not found' }); }
    const { rows: conflict } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1 AND property_id = $4
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $3 AND ${occupiedUntilSql('')} > $2
    `, [unit_id, checkIn, checkOut, req.propertyId]);
    if (conflict.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Room ${unit.name} is not available for ${checkIn} to ${checkOut}` }); }

    // Source / special requests follow the group's existing rooms.
    const { rows: [sibling] } = await client.query(
      `SELECT source, special_requests, agent_id, commission_type, commission_value FROM bookings WHERE reservation_group_id = $1 AND property_id = $2
       ORDER BY (status IN ('cancelled','no_show')), created_at LIMIT 1`,
      [group.id, req.propertyId]);

    const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
    const guests = Math.max(1, parseInt(num_guests, 10) || 1);
    const ratePlan = await ratePlanService.resolveForBooking(req.propertyId, rate_plan_id || null);
    const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, req.propertyId);

    let total;
    if (given(total_amount)) {
      total = parseFloat(total_amount);
      if (!Number.isFinite(total) || total < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'total_amount must be a positive number' }); }
    } else {
      const rates = await nightlyRoomRates(req.propertyId, unit_id, checkIn, checkOut, client);
      const meal = ratePlanService.mealNetPerNight(ratePlan, guests, divisor) * nights;
      total = computeFolioTotals(rates.room_total + meal, tax_rate, service_charge_rate).total;
    }

    const { roomNet, mealNet } = splitRevenue({ grossNet: total, nights, ratePlan, numGuests: guests, F, divisor, tax_rate, service_charge_rate });
    const payable = snapPayable(round2(computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total), total);
    // A group billed as a whole (migration 097): no lines on the room — the
    // group's bill simply grows by it.
    const depositAmount = group.group_billing ? 0 : given(deposit_amount)
      ? Math.max(0, Math.min(parseFloat(deposit_amount) || 0, payable))
      : Math.round(payable * 0.5); // 50%, same default as New Booking
    const balanceAmount = group.group_billing ? 0 : round2(payable - depositAmount);

    const { rows: [booking] } = await client.query(
      `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_amount, special_requests, status, created_by, property_id, reservation_group_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue, agent_id, commission_type, commission_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [group.primary_guest_id, unit_id, checkIn, checkOut, guests, sibling?.source || 'direct', payable, depositAmount,
       sibling?.special_requests || null, req.user.id, req.propertyId, group.id, ratePlan?.id || null, bed_preference || null, roomNet, mealNet,
       sibling?.agent_id || null, sibling?.commission_type || null, sibling?.commission_value ?? null]);
    if (depositAmount > 0) await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'deposit', depositAmount]);
    if (balanceAmount > 0) await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'balance', balanceAmount]);
    const why = String(reason || '').trim();
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [booking.id, `Added to group booking: room ${unit.name}, ${fmtIDR(payable)}${why ? `. Reason: ${why}` : ''}`.slice(0, 1000), req.user.id]);
    await syncGroupSpan(client, group.id);
    if (group.group_billing) await recomputeGroupStatus(client, group.id);
    await client.query('COMMIT');

    telegramService.sendAlert(req.propertyId, 'alert_new_booking',
      newBookingAlert({ title: 'Room added to a group booking', rooms: [unit.name], checkIn, checkOut,
        guests: booking.num_guests, total: payable, by: req.user?.name }),
      { html: true }
    ).catch(() => {});
    res.status(201).json(booking);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Group: Amend Dates for every room at once ─────────────────────────────
// Rooms that change: every room not cancelled / no-show / checked out. Each
// room is priced exactly like a single booking's Amend Dates (datesQuote:
// normal rate for the new dates − old dates, incl. service/tax) and moved by
// the same applyNewDates(). A room already checked in can only change its
// check-out date. All-or-nothing: one unavailable room stops the whole change.
const GROUP_AMENDABLE = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];

async function groupDatesPlan(client, { propertyId, groupId, checkIn, checkOut, perRoom = null, lock = false }) {
  const { rows: [group] } = await client.query(
    `SELECT *, to_char(check_in_date, 'YYYY-MM-DD') AS ci, to_char(check_out_date, 'YYYY-MM-DD') AS co
     FROM reservation_groups WHERE id = $1 AND property_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [groupId, propertyId]);
  if (!group) return { status: 404, error: 'Group not found' };
  if (group.status === 'cancelled') return { status: 409, error: 'This group is cancelled' };
  const { rows: rooms } = await client.query(
    `SELECT b.*, u.name AS unit_name FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.reservation_group_id = $1 AND b.property_id = $2 AND b.status = ANY($3::text[])
     ORDER BY u.name${lock ? ' FOR UPDATE OF b' : ''}`,
    [groupId, propertyId, GROUP_AMENDABLE]);
  if (rooms.length === 0) return { status: 409, error: 'No rooms left to change in this group' };
  // Per room (each room its own new dates): only the rooms asked for.
  if (perRoom) {
    const known = new Set(rooms.map(b => b.id));
    const missing = [...perRoom.keys()].filter(id => !known.has(id));
    if (missing.length) return { status: 400, error: 'A room is not in this group or can no longer be changed — refresh and try again' };
  }

  const plan = [];
  for (const b of perRoom ? rooms.filter(x => perRoom.has(x.id)) : rooms) {
    if (perRoom) ({ checkIn, checkOut } = perRoom.get(b.id));
    const oldCi = String(b.check_in_date).slice(0, 10);
    const oldCo = String(b.check_out_date).slice(0, 10);
    const row = { booking_id: b.id, unit_name: b.unit_name, status: b.status, booking: b, problem: null };
    if (b.status === 'checked_in' && checkIn !== oldCi) {
      row.problem = 'Already checked in — only the check-out date can change';
    } else {
      const { rows: conflicts } = await client.query(`
        SELECT g.name AS guest_name, ${overdueSql('b2')} AS overdue FROM bookings b2 JOIN guests g ON g.id = b2.guest_id
        WHERE b2.unit_id = $1 AND b2.property_id = $5 AND b2.id <> $2
          AND b2.status NOT IN ('cancelled','no_show')
          AND b2.check_in_date < $4 AND ${occupiedUntilSql('b2')} > $3
        LIMIT 1`, [b.unit_id, b.id, checkIn, checkOut, propertyId]);
      if (conflicts[0]) {
        row.problem = conflicts[0].overdue
          ? `${conflicts[0].guest_name} is still checked in there (overdue)`
          : `Booked by ${conflicts[0].guest_name} for those dates`;
      }
    }
    row.quote = await datesQuote(client, { propertyId, booking: b, checkIn, checkOut });
    row.unchanged = oldCi === checkIn && oldCo === checkOut;
    row.checkIn = checkIn; row.checkOut = checkOut;
    plan.push(row);
  }
  const totalDifference = round2(plan.reduce((sum, r) => sum + r.quote.difference, 0));
  return { group, plan, totalDifference };
}

function planJson(p) {
  return {
    rooms: p.plan.map(r => ({
      booking_id: r.booking_id, unit_name: r.unit_name, status: r.status, problem: r.problem,
      unchanged: r.unchanged, old: r.quote.old, new: r.quote.new, difference: r.quote.difference,
    })),
    total_difference: p.totalDifference,
    ok: p.plan.every(r => !r.problem),
  };
}

// GET /api/bookings/group/:groupId/dates/quote?check_in=&check_out=
router.get('/group/:groupId/dates/quote', auth, async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!check_in || !check_out || check_out <= check_in) return res.status(400).json({ error: 'check_in and a later check_out are required' });
  try {
    const p = await groupDatesPlan(db, { propertyId: req.propertyId, groupId: req.params.groupId, checkIn: check_in, checkOut: check_out });
    if (p.error) return res.status(p.status).json({ error: p.error });
    res.json(planJson(p));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/group/:groupId/dates — { check_in_date, check_out_date,
// charge: 'difference'|'complimentary'|'custom', amount? (custom: the extra
// for the WHOLE group, + charge / − credit, split over the rooms by their
// share of the new normal price), reason }.
router.put('/group/:groupId/dates', auth, async (req, res) => {
  const { check_in_date, check_out_date, charge = 'difference' } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!check_in_date || !check_out_date || check_out_date <= check_in_date) {
    return res.status(400).json({ error: 'check_in_date and a later check_out_date are required' });
  }
  if (!['difference', 'complimentary', 'custom'].includes(charge)) return res.status(400).json({ error: 'charge must be difference, complimentary or custom' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const custom = parseFloat(req.body.amount);
  if (charge === 'custom' && !Number.isFinite(custom)) return res.status(400).json({ error: 'amount required for a custom charge' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const p = await groupDatesPlan(client, { propertyId: req.propertyId, groupId: req.params.groupId, checkIn: check_in_date, checkOut: check_out_date, lock: true });
    if (p.error) { await client.query('ROLLBACK'); return res.status(p.status).json({ error: p.error }); }
    const blocked = p.plan.filter(r => r.problem);
    if (blocked.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Can't change the dates: ${blocked.map(r => `Room ${r.unit_name} — ${r.problem}`).join('; ')}`,
        ...planJson(p),
      });
    }
    const moving = p.plan.filter(r => !r.unchanged);
    if (moving.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'New dates are the same as the current dates' }); }

    // What each room is charged.
    const amounts = new Map();
    if (charge === 'difference') moving.forEach(r => amounts.set(r.booking_id, r.quote.difference));
    else if (charge === 'complimentary') moving.forEach(r => amounts.set(r.booking_id, 0));
    else {
      const target = round2(custom);
      const weight = moving.reduce((sum, r) => sum + r.quote.new.total, 0) || moving.length;
      let left = target;
      moving.forEach((r, i) => {
        const share = i === moving.length - 1 ? round2(left) : round2(target * (r.quote.new.total || 1) / weight);
        left = round2(left - share);
        amounts.set(r.booking_id, share);
      });
    }
    const invoiced = moving.filter(r => amounts.get(r.booking_id) !== 0 && ['invoiced', 'paid'].includes(r.booking.folio_status));
    if (invoiced.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Room ${invoiced.map(r => r.unit_name).join(', ')} is already on an agent invoice — change the dates without a charge, or correct it through Agent Billing` });
    }

    let credit = 0;
    for (const r of moving) {
      const done = await applyNewDates(client, {
        propertyId: req.propertyId, booking: r.booking, userId: req.user.id,
        checkIn: check_in_date, checkOut: check_out_date, quote: r.quote,
        amount: amounts.get(r.booking_id), charge, reason, notePrefix: 'Group ',
      });
      if (done.error) { await client.query('ROLLBACK'); return res.status(done.status).json(done.error); }
      credit = round2(credit + (done.priced?.credit || 0));
    }
    await syncGroupSpan(client, p.group.id);   // = the new dates, unless some rooms keep their own
    await client.query('COMMIT');

    for (const r of moving) {
      if (amounts.get(r.booking_id) !== 0 && r.booking.folio_status === 'pending_agent_invoice') {
        await agentBilling.recomputeCommission(req.propertyId, r.booking_id).catch(err => console.error('Commission recompute failed:', err));
      }
    }
    const charged = round2([...amounts.values()].reduce((sum, a) => sum + a, 0));
    const normal = round2(moving.reduce((sum, r) => sum + r.quote.difference, 0));
    const oldSpan = datesSpan(moving[0].quote.old);
    const newSpan = datesSpan(moving[0].quote.new);
    if (normal > 0 && charged < normal) {
      sendControlAlert(req.propertyId, {
        bookingIds: moving.map(r => r.booking_id), userId: req.user.id, reason,
        headline: charged <= 0
          ? `🎁 Free group stay change (${moving.length} rooms): ${oldSpan} → ${newSpan}, no charge`
          : `🏷 Discounted group stay change (${moving.length} rooms): ${oldSpan} → ${newSpan}, charged ${fmtIDR(charged)}`,
        details: [`Normal price ${fmtIDR(normal)} — given away ${fmtIDR(normal - Math.max(0, charged))}`],
      });
    }
    res.json({ rooms: moving.length, charged, normal_difference: normal, credit });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Amend Dates per room (each ticked room gets its own new dates) ──
// rooms: [{ booking_id, check_in_date, check_out_date, new_total? }]
function perRoomDates(list) {
  if (!Array.isArray(list) || !list.length) return { error: 'Choose at least one room' };
  const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
  const map = new Map();
  for (const r of list) {
    const ci = r.check_in_date || r.check_in, co = r.check_out_date || r.check_out;
    if (!r.booking_id || !ymdRe.test(String(ci)) || !ymdRe.test(String(co)) || co <= ci) return { error: 'Every room needs a check-out after its check-in' };
    if (map.has(String(r.booking_id))) return { error: 'A room is listed twice' };
    map.set(String(r.booking_id), { checkIn: ci, checkOut: co });
  }
  return { map };
}

// POST /api/bookings/group/:groupId/dates/quote-rooms { rooms } — availability,
// problems and prices for each room's new dates (nothing is saved).
router.post('/group/:groupId/dates/quote-rooms', auth, async (req, res) => {
  const pr = perRoomDates(req.body.rooms);
  if (pr.error) return res.status(400).json({ error: pr.error });
  try {
    const p = await groupDatesPlan(db, { propertyId: req.propertyId, groupId: req.params.groupId, perRoom: pr.map });
    if (p.error) return res.status(p.status).json({ error: p.error });
    res.json(planJson(p));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/group/:groupId/dates/rooms { rooms: [{ booking_id,
// check_in_date, check_out_date, new_total? }], complimentary?, reason }
// Each room moves to its own dates (same pricing as a single room's Amend
// Dates: the difference, the price typed for its new dates, or no charge
// with complimentary). All or nothing; the group's span follows.
router.put('/group/:groupId/dates/rooms', auth, async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const pr = perRoomDates(req.body.rooms);
  if (pr.error) return res.status(400).json({ error: pr.error });
  const typed = new Map((req.body.rooms || []).filter(r => r.new_total !== undefined && r.new_total !== null && r.new_total !== '')
    .map(r => [String(r.booking_id), parseFloat(r.new_total)]));
  if ([...typed.values()].some(v => !Number.isFinite(v) || v < 0)) return res.status(400).json({ error: 'A new price must be 0 or more' });
  const complimentary = req.body.complimentary === true;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const p = await groupDatesPlan(client, { propertyId: req.propertyId, groupId: req.params.groupId, perRoom: pr.map, lock: true });
    if (p.error) { await client.query('ROLLBACK'); return res.status(p.status).json({ error: p.error }); }
    const blocked = p.plan.filter(r => r.problem);
    if (blocked.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Can't change the dates: ${blocked.map(r => `Room ${r.unit_name} — ${r.problem}`).join('; ')}`, ...planJson(p) });
    }
    const moving = p.plan.filter(r => !r.unchanged);
    if (!moving.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The new dates are the same as the current ones' }); }

    const amounts = new Map();
    for (const r of moving) {
      const t = typed.get(r.booking_id);
      amounts.set(r.booking_id, complimentary ? 0 : t !== undefined ? round2(t - r.quote.old.total) : r.quote.difference);
    }
    const invoiced = moving.filter(r => amounts.get(r.booking_id) !== 0 && ['invoiced', 'paid'].includes(r.booking.folio_status));
    if (invoiced.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Room ${invoiced.map(r => r.unit_name).join(', ')} is already on an agent invoice — change the dates without a charge, or correct it through Agent Billing` });
    }
    let credit = 0;
    for (const r of moving) {
      const amount = amounts.get(r.booking_id);
      const charge = complimentary ? 'complimentary' : Math.abs(amount - r.quote.difference) < 0.5 ? 'difference' : 'custom';
      const done = await applyNewDates(client, {
        propertyId: req.propertyId, booking: r.booking, userId: req.user.id,
        checkIn: r.checkIn, checkOut: r.checkOut, quote: r.quote, amount, charge, reason, notePrefix: 'Group ',
      });
      if (done.error) { await client.query('ROLLBACK'); return res.status(done.status).json(done.error); }
      credit = round2(credit + (done.priced?.credit || 0));
    }
    await syncGroupSpan(client, p.group.id);
    await client.query('COMMIT');

    for (const r of moving) {
      if (amounts.get(r.booking_id) !== 0 && r.booking.folio_status === 'pending_agent_invoice') {
        await agentBilling.recomputeCommission(req.propertyId, r.booking_id).catch(err => console.error('Commission recompute failed:', err));
      }
    }
    const charged = round2([...amounts.values()].reduce((sum, a) => sum + a, 0));
    const normal = round2(moving.reduce((sum, r) => sum + r.quote.difference, 0));
    if (normal > 0 && charged < normal) {
      sendControlAlert(req.propertyId, {
        bookingIds: moving.map(r => r.booking_id), userId: req.user.id, reason,
        headline: charged <= 0
          ? `🎁 Free group stay change (${moving.length} room${moving.length === 1 ? '' : 's'}): ${moving.map(r => `${r.unit_name} ${datesSpan(r.quote.new)}`).join(', ')}, no charge`
          : `🏷 Discounted group stay change (${moving.length} room${moving.length === 1 ? '' : 's'}), charged ${fmtIDR(charged)}`,
        details: [`Normal price ${fmtIDR(normal)} — given away ${fmtIDR(normal - Math.max(0, charged))}`],
      });
    }
    res.json({ rooms: moving.length, charged, normal_difference: normal, credit });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/group/:groupId/rooms/:bookingId/cancel — { reason }
// The group needs one room fewer. Cancels that room only (same as cancelling
// its booking) and logs why. Not for a room already checked in or out, nor
// the group's last room (cancel the whole group instead). Money already
// received on it shows on the group page as paid on a cancelled room.
router.post('/group/:groupId/rooms/:bookingId/cancel', auth, async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await client.query(
      `SELECT b.*, u.name AS unit_name FROM bookings b JOIN units u ON u.id = b.unit_id
       WHERE b.id = $1 AND b.reservation_group_id = $2 AND b.property_id = $3 FOR UPDATE OF b`,
      [req.params.bookingId, req.params.groupId, req.propertyId]);
    if (!b) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Room not found in this group' }); }
    if (!['pending', 'deposit_paid', 'confirmed'].includes(b.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: b.status === 'checked_in' ? 'This room is checked in — check the guest out instead' : `This room is already ${b.status.replace('_', ' ')}` });
    }
    const { rows: [{ n }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM bookings WHERE reservation_group_id = $1 AND property_id = $2
         AND id <> $3 AND status NOT IN ('cancelled', 'no_show')`,
      [req.params.groupId, req.propertyId, b.id]);
    if (n === 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: "This is the group's last room — use Cancel Group instead" }); }

    await client.query("UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [b.id]);
    await roomCharge.voidAll(client, b.id, req.user.id);
    const { rows: [{ paid }] } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
       WHERE booking_id = $1 AND status = 'received' AND type IN ('deposit', 'balance')`, [b.id]);
    let note = `Room ${b.unit_name} removed from the group (cancelled).`;
    if (parseFloat(paid) > 0) note += ` ${fmtIDR(paid)} already received on it — refund or move it by hand.`;
    note += ` Reason: ${reason}`;
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [b.id, note.slice(0, 1000), req.user.id]);
    await syncGroupSpan(client, req.params.groupId);   // the group's dates = its remaining rooms
    // Billed as a whole: the money stays with the group; its bill shrinks.
    await recomputeBookingStatus(client, (await client.query(
      "SELECT id FROM bookings WHERE reservation_group_id = $1 AND status NOT IN ('cancelled', 'no_show') LIMIT 1",
      [req.params.groupId])).rows[0].id);
    await client.query('COMMIT');
    res.json({ ok: true, paid_on_room: parseFloat(paid) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/group/:groupId/payments — record ONE payment from the
// group (e.g. the booker's single transfer) against several rooms' pending
// deposit/balance lines at once: { lines: [{ payment_id, amount }], method,
// received_at?, reference?, notes? } (or the older payment_ids: [...] = each
// line in full). A line paid in full is marked received exactly as "Mark
// Received" on a room does; a smaller amount is a part payment — the
// received part becomes its own line and the rest stays pending (same as the
// room's Record Payment window). Each room's status is recomputed
// (pending → deposit_paid → confirmed). All-or-nothing.
//
// A group billed as a whole (migration 097) has no room lines: the body is
// { amount, method, received_at?, reference?, notes? } and the payment is
// recorded once, on the group (services/groupBilling.js).
router.post('/group/:groupId/payments', auth, async (req, res, next) => {
  try {
    const { rows: [g] } = await db.query(
      'SELECT group_billing FROM reservation_groups WHERE id = $1 AND property_id = $2', [req.params.groupId, req.propertyId]);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.group_billing) return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await groupBilling.recordPayment(client, {
      propertyId: req.propertyId, groupId: req.params.groupId, userId: req.user.id,
      amount: req.body.amount, method: req.body.method, receivedAt: req.body.received_at || null,
      reference: req.body.reference, notes: req.body.notes,
    });
    if (r.error) { await client.query('ROLLBACK'); return res.status(r.status).json({ error: r.error, code: r.code }); }
    await client.query('COMMIT');
    res.status(201).json({ payment: r.payment, total: r.payment.amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/group/:groupId/payments/:paymentId — { reason } — void
// a group payment (kept, struck through; Edit History of every room).
router.delete('/group/:groupId/payments/:paymentId', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await groupBilling.voidPayment(client, {
      propertyId: req.propertyId, groupId: req.params.groupId, paymentId: req.params.paymentId,
      userId: req.user.id, reason: req.body?.reason,
    });
    if (r.error) { await client.query('ROLLBACK'); return res.status(r.status).json({ error: r.error, code: r.code }); }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/group/:groupId/billing — { billing_mode: 'room_meals' |
// 'everything' } — what the group pays: room nights + meal plan only (each
// room's guest pays its own extras), or everything. Only for a group billed
// as a whole.
router.put('/group/:groupId/billing', auth, async (req, res) => {
  const mode = req.body.billing_mode;
  if (!['room_meals', 'everything'].includes(mode)) return res.status(400).json({ error: 'billing_mode must be room_meals or everything' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [g] } = await client.query(
      'SELECT group_billing, billing_mode FROM reservation_groups WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.groupId, req.propertyId]);
    if (!g) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    if (!g.group_billing) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This group is paid room by room', code: 'NOT_GROUP_BILLED' }); }
    if (g.billing_mode !== mode) {
      await client.query('UPDATE reservation_groups SET billing_mode = $1, updated_at = NOW() WHERE id = $2', [mode, req.params.groupId]);
      const label = m => (m === 'everything' ? 'everything (rooms, meals and extras)' : 'room & meal plan (extras paid by each room)');
      await groupBilling.logToRooms(client, req.params.groupId, `Group pays: ${label(g.billing_mode)} → ${label(mode)}.`, req.user.id);
    }
    await client.query('COMMIT');
    res.json({ billing_mode: mode });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/group/:groupId/payments', auth, async (req, res) => {
  const parts = Array.isArray(req.body.lines)
    ? req.body.lines.filter(l => l && l.payment_id).map(l => ({ id: String(l.payment_id), amount: round2(parseFloat(l.amount)) }))
    : (Array.isArray(req.body.payment_ids) ? req.body.payment_ids.map(id => ({ id: String(id), amount: null })) : []);
  const ids = [...new Set(parts.map(p => p.id))];
  const { method, notes } = req.body;
  if (!ids.length) return res.status(400).json({ error: 'Select at least one payment line' });
  if (ids.length !== parts.length) return res.status(400).json({ error: 'A payment line is listed twice' });
  if (!method) return res.status(400).json({ error: 'Payment method required' });
  const receivedAt = req.body.received_at || null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: lines } = await client.query(
      `SELECT p.id, p.booking_id, p.status, p.type, p.amount
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE p.id = ANY($1::uuid[]) AND b.reservation_group_id = $2 AND b.property_id = $3
         AND b.status NOT IN ('cancelled', 'no_show')
       FOR UPDATE OF p`,
      [ids, req.params.groupId, req.propertyId]
    );
    if (lines.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Some payment lines are not part of this group' });
    }
    if (lines.some(l => l.status === 'received')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Some of these lines are already marked received — refresh and try again' });
    }
    const reference = String(req.body.reference || '').trim().slice(0, 120) || null;
    const byId = new Map(lines.map(l => [l.id, l]));
    let total = 0;
    for (const part of parts) {
      const l = byId.get(part.id);
      const lineAmt = parseFloat(l.amount);
      const amt = part.amount === null ? lineAmt : part.amount;
      if (!(amt > 0) || amt > lineAmt + 0.005) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `The amount for a ${l.type} line must be between 1 and ${Math.round(lineAmt).toLocaleString('id-ID')}` });
      }
      if (amt >= lineAmt - 0.005) {
        await client.query(
          `UPDATE payments SET status = 'received', method = $1, received_at = COALESCE($2::timestamptz, NOW()),
                               received_by = $3, notes = COALESCE(NULLIF($4, ''), notes), reference = COALESCE($6, reference)
           WHERE id = $5`,
          [method, receivedAt, req.user.id, notes || '', l.id, reference]);
        total = round2(total + lineAmt);
      } else {
        // Part payment: the rest stays pending on the same line.
        await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [round2(lineAmt - amt), l.id]);
        await client.query(
          `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, reference)
           VALUES ($1, $2, $3, 'received', $4, COALESCE($5::timestamptz, NOW()), $6, NULLIF($7, ''), $8)`,
          [l.booking_id, l.type, amt, method, receivedAt, req.user.id, notes || '', reference]);
        total = round2(total + amt);
      }
    }
    const bookingIds = [...new Set(lines.map(l => l.booking_id))];
    for (const bid of bookingIds) await recomputeBookingStatus(client, bid);
    await client.query('COMMIT');
    res.json({ lines: lines.length, rooms: bookingIds.length, total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Assign the guest actually staying in a room ─────────────────────────────
// A group (or an agent/company) is often booked under one person's name and
// the real guest list arrives later. Re-pointing a room's booking at the real
// guest makes everything that reads bookings.guest_id correct at once: Room /
// TV Display, Registration Card, the police Guest Report, Guest Lists, guest
// history. The booker stays on reservation_groups.primary_guest_id as the
// group's contact; charges stay on the room's own folio (unchanged).
// Takes either an existing guest_id or new_guest { name, nationality,
// id_number, whatsapp, email } (only name required — details can follow on
// the guest profile). Runs inside the caller's transaction; returns
// { error, status } on a bad request.
async function assignGuest(client, { propertyId, bookingId, guestId, newGuest, userId }) {
  const { rows: [b] } = await client.query(
    `SELECT b.id, b.guest_id, b.status, u.controller_id, g.name AS guest_name
     FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
     WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`,
    [bookingId, propertyId]
  );
  if (!b) return { status: 404, error: 'Booking not found' };
  if (['cancelled', 'no_show', 'checked_out'].includes(b.status)) {
    return { status: 409, error: `Cannot change the guest — booking is ${b.status.replace('_', ' ')}` };
  }

  let guest;
  if (newGuest) {
    const name = String(newGuest.name || '').trim();
    if (!name) return { status: 400, error: 'Guest name is required' };
    const clean = v => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
    ({ rows: [guest] } = await client.query(
      `INSERT INTO guests (name, nationality, id_number, whatsapp, email, property_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name`,
      [name, clean(newGuest.nationality), clean(newGuest.id_number), clean(newGuest.whatsapp), clean(newGuest.email), propertyId]
    ));
  } else if (guestId) {
    ({ rows: [guest] } = await client.query('SELECT id, name FROM guests WHERE id = $1 AND property_id = $2', [guestId, propertyId]));
    if (!guest) return { status: 404, error: 'Guest not found' };
  } else {
    return { status: 400, error: 'guest_id or new_guest is required' };
  }

  if (guest.id === b.guest_id) return { guest, changed: false };
  await client.query('UPDATE bookings SET guest_id = $1, updated_at = NOW() WHERE id = $2', [guest.id, b.id]);
  await client.query(
    'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
    [b.id, `Guest: ${b.guest_name} → ${guest.name}`, userId]
  );
  return { guest, changed: true, controllerId: b.controller_id };
}

// PUT /api/bookings/:id/guest — { guest_id } or { new_guest: {...} }
router.put('/:id/guest', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await assignGuest(client, {
      propertyId: req.propertyId, bookingId: req.params.id,
      guestId: req.body.guest_id, newGuest: req.body.new_guest, userId: req.user.id,
    });
    if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json({ error: result.error }); }
    await client.query('COMMIT');
    // Room Display refetches its state on any push — shows the new name now.
    if (result.controllerId) sse.notify(result.controllerId, { type: 'guest_changed' });
    res.json({ guest: result.guest, changed: result.changed });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/group/:groupId/guests — assign several rooms at once:
// { assignments: [{ booking_id, guest_id } | { booking_id, new_guest }] }.
// All-or-nothing: one bad row rolls back the whole save.
router.put('/group/:groupId/guests', auth, async (req, res) => {
  const assignments = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  if (!assignments.length) return res.status(400).json({ error: 'assignments required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: members } = await client.query(
      'SELECT id FROM bookings WHERE reservation_group_id = $1 AND property_id = $2',
      [req.params.groupId, req.propertyId]
    );
    if (!members.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    const memberIds = new Set(members.map(m => m.id));
    const notify = [];
    let changed = 0;
    for (const a of assignments) {
      if (!memberIds.has(a.booking_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A room in the list is not part of this group' });
      }
      const result = await assignGuest(client, {
        propertyId: req.propertyId, bookingId: a.booking_id,
        guestId: a.guest_id, newGuest: a.new_guest, userId: req.user.id,
      });
      if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json({ error: result.error, booking_id: a.booking_id }); }
      if (result.changed) { changed++; if (result.controllerId) notify.push(result.controllerId); }
    }
    await client.query('COMMIT');
    for (const c of notify) sse.notify(c, { type: 'guest_changed' });
    res.json({ changed });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Change Room (upgrade / downgrade / plain move) ──────────────────────────
// Replaces the old price-less Transfer Room in the UI. For the nights still
// to come (all nights for a stay that hasn't started, from today for a guest
// already in house) the difference is: the NEW room's normal rate (base rate
// + pricing periods, services/pricingService.js — same as New Booking's
// suggestion) plus the booking's meal plan, minus what the guest actually
// pays now — the booking's own price (after discount, the price FO typed)
// spread per night. Using the current room's normal rate instead gave a wrong
// difference whenever the booking had a special price. Both grossed up with
// service/tax, so it's what the guest pays on top. Negative = downgrade (a
// credit). The current room's normal rate is returned too, for reference.
async function changeRoomQuote(client, { propertyId, booking, targetUnitId }) {
  const today = roomCharge.todayWITA();
  const ci = String(booking.check_in_date).slice(0, 10);
  const co = String(booking.check_out_date).slice(0, 10);
  const from = booking.status === 'checked_in' && today > ci ? today : ci;
  const [cur, next] = await Promise.all([
    nightlyRoomRates(propertyId, booking.unit_id, from, co, client),
    nightlyRoomRates(propertyId, targetUnitId, from, co, client),
  ]);
  if (!next) return null;
  const { tax_rate, service_charge_rate } = await grossFactor(client, propertyId);
  const gross = net => computeFolioTotals(net, tax_rate, service_charge_rate).total;
  const nights = from < co ? next.night_breakdown.length : 0;
  // Both sides are the price the guest pays for those nights WITH the meal
  // plan, in whole rupiah — the same figure the booking page shows. Current =
  // the booking's price as entered (total − discount, incl. service/tax; from
  // the stored total, so a later tax-rate change can't shift it). The meal
  // part (its share of the net split) doesn't change with the room, so it is
  // added to the new room's normal rate. Comparing room parts only showed a
  // 900.000 booking as "699.999,99" and read as the wrong price.
  const whole = n => Math.round(n);
  const stayNights = Math.max(1, parseInt(booking.nights, 10) || 1);
  const bookedGross = parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0);
  const roomNet = parseFloat(booking.room_revenue ?? 0), mealNet = parseFloat(booking.fnb_revenue ?? 0);
  const roomShare = booking.room_revenue != null && roomNet + mealNet > 0 ? roomNet / (roomNet + mealNet) : 1;
  const curTotal = nights ? whole(bookedGross / stayNights * nights) : 0;
  const meals = nights ? whole(curTotal * (1 - roomShare)) : 0;
  const curNormal = nights ? whole(gross(cur.room_total)) + meals : 0;
  const nextTotal = nights ? whole(gross(next.room_total)) + meals : 0;
  return {
    from, to: co, nights, meals,
    current: { unit_id: cur.unit.id, name: cur.unit.name, type: cur.unit.type, total: curTotal, normal_total: curNormal },
    next: { unit_id: next.unit.id, name: next.unit.name, type: next.unit.type, total: nextTotal, room_total: nextTotal - meals },
    difference: nextTotal - curTotal,
  };
}

const CHANGEABLE = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];

// GET /api/bookings/:id/change-room/quote?unit_id= — the price difference
// shown before confirming.
router.get('/:id/change-room/quote', auth, async (req, res) => {
  if (!req.query.unit_id) return res.status(400).json({ error: 'unit_id required' });
  try {
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const quote = await changeRoomQuote(db, { propertyId: req.propertyId, booking, targetUnitId: req.query.unit_id });
    if (!quote) return res.status(404).json({ error: 'Room not found' });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/change-room — { unit_id, charge, amount?, reason }
//   charge: 'difference' (the quoted difference) | 'complimentary' (no price
//   change) | 'custom' (amount, may be negative for a refund/credit).
// Moves the booking; the charge is added to the booking price as room
// revenue (applyBookingPrice with keepDiscount — the charge isn't
// discounted), so the folio, pending balance lines, reports and Balance Due
// all follow. In house: the old room is freed and flagged for cleaning, both
// rooms' tablets refresh. Logged to Edit History with the reason.
router.put('/:id/change-room', auth, async (req, res) => {
  const { unit_id, charge = 'difference', reason: rawReason } = req.body;
  const reason = String(rawReason || '').trim();
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });
  if (!['difference', 'complimentary', 'custom'].includes(charge)) return res.status(400).json({ error: 'charge must be difference, complimentary or custom' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const custom = parseFloat(req.body.amount);
  if (charge === 'custom' && !Number.isFinite(custom)) return res.status(400).json({ error: 'amount required for a custom charge' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]
    );
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    if (!CHANGEABLE.includes(before.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot change room — booking is ${before.status.replace('_', ' ')}` });
    }
    if (before.unit_id === unit_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The booking is already in this room' }); }

    const { rows: [conflict] } = await client.query(`
      SELECT b.id, g.name AS guest_name FROM bookings b JOIN guests g ON g.id = b.guest_id
      WHERE b.unit_id = $1 AND b.property_id = $2 AND b.id <> $3
        AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date < $5 AND ${occupiedUntilSql('b')} > $4
      LIMIT 1`, [unit_id, req.propertyId, before.id, before.check_in_date, before.check_out_date]);
    if (conflict) { await client.query('ROLLBACK'); return res.status(409).json({ error: `That room is booked for these dates (${conflict.guest_name})` }); }

    const quote = await changeRoomQuote(client, { propertyId: req.propertyId, booking: before, targetUnitId: unit_id });
    if (!quote) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Room not found' }); }
    const amount = charge === 'complimentary' ? 0 : charge === 'custom' ? round2(custom) : quote.difference;
    if (amount !== 0 && ['invoiced', 'paid'].includes(before.folio_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This stay is already on an agent invoice — change the room without a charge, or correct it through Agent Billing' });
    }
    if (amount !== 0 && before.complimentary_scope) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This stay is complimentary — move it as Complimentary, or remove complimentary first' });
    }

    const { rows: [oldUnit] } = await client.query('SELECT id, name, type, controller_id FROM units WHERE id = $1', [before.unit_id]);
    const { rows: [newUnit] } = await client.query('SELECT id, name, type, controller_id FROM units WHERE id = $1', [unit_id]);
    await client.query('UPDATE bookings SET unit_id = $1, updated_at = NOW() WHERE id = $2', [unit_id, before.id]);
    if (before.status === 'checked_in') {
      await client.query(
        "UPDATE units SET status = 'available', housekeeping_status = 'dirty', housekeeping_updated_at = NOW() WHERE id = $1 AND property_id = $2",
        [before.unit_id, req.propertyId]
      );
      await client.query("UPDATE units SET status = 'occupied' WHERE id = $1 AND property_id = $2", [unit_id, req.propertyId]);
    }

    let priced = null;
    if (amount !== 0) {
      const { rows: [moved] } = await client.query('SELECT * FROM bookings WHERE id = $1', [before.id]);
      priced = await applyBookingPrice(client, {
        propertyId: req.propertyId, before: moved, userId: req.user.id,
        newTotal: Math.max(0, round2(parseFloat(before.total_amount) + amount)),
        keepDiscount: true, receivedWasTypo: false,
        balanceNote: `Room change ${oldUnit.name} → ${newUnit.name} — additional amount due`,
      });
      if (priced.error) { await client.query('ROLLBACK'); return res.status(priced.status).json(priced.error); }
    }

    const label = u => `${u.name}${u.type ? ` (${u.type})` : ''}`;
    let note = `Room changed: ${label(oldUnit)} → ${label(newUnit)}.`;
    if (charge === 'complimentary') note += ` Complimentary — no charge (normal difference ${fmtIDR(quote.difference)}).`;
    else if (amount > 0) note += ` Charged +${fmtIDR(amount)}${charge === 'custom' ? ` (normal difference ${fmtIDR(quote.difference)})` : ''} for ${quote.nights} night${quote.nights === 1 ? '' : 's'}.`;
    else if (amount < 0) note += ` Credit ${fmtIDR(-amount)}${charge === 'custom' ? ` (normal difference ${fmtIDR(quote.difference)})` : ''}.`;
    if (priced?.credit > 0) note += ` Guest overpaid ${fmtIDR(priced.credit)} — to be refunded.`;
    note += ` Reason: ${reason}`;
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [before.id, note.slice(0, 1000), req.user.id]);
    await client.query('COMMIT');

    for (const c of [oldUnit.controller_id, newUnit.controller_id]) if (c) sse.notify(c, { type: 'room_changed' });
    // Owner alert: an upgrade given free or below the normal difference.
    if (quote.difference > 0 && amount < quote.difference) {
      sendControlAlert(req.propertyId, {
        bookingIds: before.id, userId: req.user.id, reason,
        headline: amount <= 0
          ? `🎁 Free upgrade: ${label(oldUnit)} → ${label(newUnit)}, no charge`
          : `🏷 Discounted upgrade: ${label(oldUnit)} → ${label(newUnit)}, charged ${fmtIDR(amount)}`,
        details: [`Normal difference ${fmtIDR(quote.difference)} for ${quote.nights} night${quote.nights === 1 ? '' : 's'} — given away ${fmtIDR(quote.difference - Math.max(0, amount))}`],
      });
    }
    if (amount !== 0 && (before.folio_status === 'pending_agent_invoice' || before.status === 'checked_out')) {
      await agentBilling.recomputeCommission(req.propertyId, before.id).catch(err => console.error('Commission recompute failed:', err));
    }
    res.json({ from: oldUnit.name, to: newUnit.name, charged: amount, quote, credit: priced?.credit || 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/no-show
router.put('/:id/no-show', auth, async (req, res) => {
  try {
    const { rows: [booking] } = await db.query('SELECT status FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['pending', 'deposit_paid', 'confirmed'].includes(booking.status)) {
      return res.status(409).json({ error: `Cannot mark as no-show — booking status is ${booking.status}` });
    }
    const { rows } = await db.query(
      "UPDATE bookings SET status = 'no_show', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.id, req.propertyId]
    );
    await roomCharge.voidAll(db, req.params.id, req.user.id);
    await db.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [req.params.id, 'Marked no-show.', req.user.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/undo-no-show — puts a no-show back (e.g. the night
// audit flagged a guest who did arrive but was never checked in). The status
// goes back to pending / deposit paid / confirmed from its payments, and the
// room must still be free for the nights not yet over. Nothing is re-posted
// here: the nights post as usual once the guest is checked in (checkout
// catches up nights already past).
router.put('/:id/undo-no-show', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await client.query(
      `SELECT b.id, b.status, b.unit_id, b.check_in_date, b.check_out_date, u.name AS unit_name
       FROM bookings b JOIN units u ON u.id = b.unit_id
       WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`,
      [req.params.id, req.propertyId]
    );
    if (!b) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    if (b.status !== 'no_show') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Only a no-show can be put back — booking status is ${b.status}` });
    }
    const today = roomCharge.todayWITA();
    const from = b.check_in_date > today ? b.check_in_date : today;
    if (from < b.check_out_date) {
      const { rows: conflicts } = await client.query(`
        SELECT g.name AS guest_name FROM bookings x JOIN guests g ON g.id = x.guest_id
        WHERE x.unit_id = $1 AND x.property_id = $2 AND x.id != $3
          AND x.status NOT IN ('cancelled','no_show')
          AND x.check_in_date < $5 AND ${occupiedUntilSql('x')} > $4
        LIMIT 1`, [b.unit_id, req.propertyId, b.id, from, b.check_out_date]);
      if (conflicts.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Room ${b.unit_name} is booked for ${conflicts[0].guest_name} on these dates — change the room or dates of one of them first`,
        });
      }
    }
    await client.query("UPDATE bookings SET status = 'pending', updated_at = NOW() WHERE id = $1", [b.id]);
    const status = await recomputeBookingStatus(client, b.id);
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [b.id, `No-show undone — status back to ${status.replace('_', ' ')}.`, req.user.id]);
    await client.query('COMMIT');
    res.json({ id: b.id, status });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/:id/message — send a guest-facing message to the
// booking's room, shown full-screen on Room Display until dismissed.
router.post('/:id/message', auth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'body required' });
  try {
    const { rows: [booking] } = await db.query(
      'SELECT id, unit_id FROM bookings WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const message = await guestMessageService.sendMessage(req.propertyId, {
      unitId: booking.unit_id, bookingId: booking.id, body: body.trim(), sentBy: req.user.id,
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id
router.put('/:id', auth, async (req, res) => {
  const { num_guests, source, total_amount, special_requests, internal_notes, status, rate_plan_id, bed_preference, purpose_of_stay } = req.body;
  // Changing the price here would leave the room/F&B split, posted folio
  // nights and pending payment lines on the old price — PUT /:id/price does
  // all of that together.
  if (total_amount !== undefined) {
    return res.status(400).json({ error: 'Use PUT /api/bookings/:id/price to change the booking price' });
  }
  if (bed_preference !== undefined && bed_preference !== null && bed_preference !== '' && !BED_PREFS.includes(bed_preference)) {
    return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
  }
  const commission = agentService.parseBookingCommission(req.body);
  if (commission.error) return res.status(400).json({ error: commission.error });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    // After check-out, what the bill and the reports are built on (source,
    // agent + commission, guests, meal plan) is a correction: owner or the
    // `corrections` permission, with a reason. Notes, bed preference and
    // purpose of stay stay open to everyone (the Registration Card saves one).
    let correctionReason = null;
    if (before.status === 'checked_out') {
      const changed = (v, old) => v !== undefined && v !== null && String(v) !== String(old ?? '');
      const agentSent = req.body.agent_id !== undefined && (req.body.agent_id || null) !== (before.agent_id || null);
      const commissionSent = 'commission_type' in commission.values
        && (String(commission.values.commission_type ?? '') !== String(before.commission_type ?? '')
          || Number(commission.values.commission_value ?? 0) !== Number(before.commission_value ?? 0));
      if (changed(source, before.source) || changed(num_guests, before.num_guests) || changed(rate_plan_id, before.rate_plan_id) || agentSent || commissionSent) {
        const allowed = req.user.role === 'owner' || (Array.isArray(req.user.allowed_menus) && req.user.allowed_menus.includes('corrections'));
        if (!allowed) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This guest has checked out — changing the source, agent, guests or meal plan needs the Corrections permission', code: 'NEEDS_CORRECTIONS' }); }
        correctionReason = String(req.body.reason || '').trim().slice(0, 500);
        if (!correctionReason) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A reason is required to change a stay after check-out', code: 'REASON_REQUIRED' }); }
      }
    }

    // Agent (migration 084): agent_id absent = unchanged, '' / null = none.
    let agentId = before.agent_id;
    if (req.body.agent_id !== undefined) {
      if (req.body.agent_id === '' || req.body.agent_id === null) agentId = null;
      else {
        const agent = await agentService.getAgent(req.propertyId, req.body.agent_id, client);
        if (!agent) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Agent not found' }); }
        agentId = agent.id;
      }
      // Already billed to an agent, or its commission already posted at
      // checkout: the statement / invoice / commission depend on it.
      const { rows: [posted] } = agentId !== before.agent_id
        ? await client.query('SELECT 1 FROM agent_commissions WHERE booking_id = $1', [before.id])
        : { rows: [] };
      if (agentId !== before.agent_id && (before.folio_status || posted)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This stay is already billed to its agent — the agent can\'t be changed now', code: 'AGENT_BILLED' });
      }
    }
    // Meal plan change re-splits room / meals: not on a free stay (its split
    // is the value given) nor one already on an agent invoice.
    if (rate_plan_id && rate_plan_id !== before.rate_plan_id) {
      if (before.complimentary_scope || ['invoiced', 'paid'].includes(before.folio_status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: before.complimentary_scope ? 'The meal plan cannot be changed on a complimentary stay' : 'This stay is already on an agent invoice — the meal plan cannot be changed now', code: 'PLAN_LOCKED' });
      }
      const { rows: [planRow] } = await client.query('SELECT 1 FROM rate_plans WHERE id = $1 AND property_id = $2', [rate_plan_id, req.propertyId]);
      if (!planRow) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown meal plan' }); }
    }
    const commissionVals = agentId ? commission.values : { commission_type: null, commission_value: null };
    const commissionChanged = 'commission_type' in commissionVals || agentId !== before.agent_id;

    const { rows } = await client.query(
      `UPDATE bookings SET
        num_guests = COALESCE($1, num_guests),
        source = COALESCE($2, source),
        total_amount = COALESCE($3, total_amount),
        special_requests = COALESCE($4, special_requests),
        internal_notes = COALESCE($5, internal_notes),
        status = COALESCE($6, status),
        rate_plan_id = COALESCE($9, rate_plan_id),
        bed_preference = CASE WHEN $10::text IS NULL THEN bed_preference
                             WHEN $10 = '' THEN NULL ELSE $10 END,
        purpose_of_stay = COALESCE($11, purpose_of_stay),
        agent_id = $12,
        commission_type = CASE WHEN $13::boolean THEN $14 ELSE commission_type END,
        commission_value = CASE WHEN $13::boolean THEN $15::numeric ELSE commission_value END,
        updated_at = NOW()
       WHERE id = $7 AND property_id = $8 RETURNING *`,
      // status is never set here (it has its own flows: check in / out, cancel, no-show, corrections)
      [num_guests, source, null, special_requests, internal_notes, null, req.params.id, req.propertyId,
        rate_plan_id || null, bed_preference === undefined ? null : bed_preference, purpose_of_stay,
        agentId, 'commission_type' in commissionVals, commissionVals.commission_type ?? null, commissionVals.commission_value ?? null]
    );
    let booking = rows[0];

    // Rate plan or guest count changed → recompute the net F&B portion,
    // keep the grand total (room + F&B) fixed by having room absorb the delta,
    // then re-post the folio nights.
    const planChanged = rate_plan_id && rate_plan_id !== before.rate_plan_id;
    const guestsChanged = num_guests !== undefined && parseInt(num_guests, 10) !== before.num_guests;
    if (before.complimentary_scope) {
      // A complimentary stay keeps its split (the plan can't change — see
      // above). Meals free too: more guests cost nothing, so nothing to
      // re-split. Room only: the meals are still paid, so they follow the
      // guest count and the room stays free.
      if (guestsChanged && before.complimentary_scope === 'room') {
        const plan = await ratePlanService.resolveForBooking(req.propertyId, booking.rate_plan_id);
        const guests = Math.max(1, parseInt(booking.num_guests, 10) || 1);
        const { divisor } = await grossFactor(client, req.propertyId);
        const priced = await applyBookingPrice(client, {
          propertyId: req.propertyId, before: booking, userId: req.user.id,
          split: { roomNet: 0, mealNet: round2(ratePlanService.mealNetPerNight(plan, guests, divisor) * booking.nights) },
          receivedWasTypo: false, balanceNote: 'Number of guests changed — meals',
        });
        if (priced.error) { await client.query('ROLLBACK'); return res.status(priced.status).json(priced.error); }
        booking = priced.after;
      }
    } else if (planChanged || guestsChanged) {
      const plan = await ratePlanService.resolveForBooking(req.propertyId, booking.rate_plan_id);
      const guests = Math.max(1, parseInt(booking.num_guests, 10) || 1);
      const grossNet = round2(parseFloat(before.room_revenue ?? before.total_amount) + parseFloat(before.fnb_revenue || 0));
      const { divisor } = await grossFactor(client, req.propertyId);
      const newFnb = round2(ratePlanService.mealNetPerNight(plan, guests, divisor) * booking.nights);
      let newRoom = round2(grossNet - newFnb);
      if (newRoom < 0) newRoom = 0;
      const { rows: [b2] } = await client.query(
        'UPDATE bookings SET room_revenue = $1, fnb_revenue = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
        [newRoom, newFnb, req.params.id]
      );
      booking = b2;
      await roomCharge.repostStay(client, booking, req.user.id);
    }

    await logBookingChanges(client, { propertyId: req.propertyId, bookingId: req.params.id, userId: req.user.id, before, after: booking });
    if (correctionReason) {
      await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
        [req.params.id, `Details corrected after check-out. Reason: ${correctionReason}`, req.user.id]);
    }

    await client.query('COMMIT');
    if (correctionReason) {
      sendControlAlert(req.propertyId, { bookingIds: booking.id, userId: req.user.id, reason: correctionReason, headline: '✏️ Stay details corrected after check-out' });
    }
    // A commission already posted at checkout (still unpaid) follows the new rate.
    if (commissionChanged && booking.agent_id) {
      await agentBilling.recomputeCommission(req.propertyId, booking.id).catch(err => console.error('Commission recompute failed:', err));
    }
    res.json(booking);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/:id  (cancel only — no hard delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    // A reason every time, and only a booking that hasn't arrived (it used to
    // cancel anything, a checked-in or checked-out stay included).
    if (!String(req.body?.reason || '').trim()) return res.status(400).json({ error: 'A reason is required to cancel a booking', code: 'REASON_REQUIRED' });
    const { rows: [cur] } = await db.query('SELECT status FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!cur) return res.status(404).json({ error: 'Booking not found' });
    if (!['pending', 'deposit_paid', 'confirmed'].includes(cur.status)) {
      return res.status(409).json({ error: cur.status === 'checked_in' ? 'This guest is checked in — check them out (or undo the check-in) instead' : `This booking is already ${cur.status.replace('_', ' ')}`, code: 'NOT_CANCELLABLE' });
    }
    const { rows } = await db.query(
      "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    await roomCharge.voidAll(db, req.params.id, req.user.id);
    // Optional reason (e.g. after a complimentary request was declined) → Edit History.
    const reason = String(req.body?.reason || '').trim();
    if (reason) {
      await db.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
        [req.params.id, `Booking cancelled. Reason: ${reason}`.slice(0, 1000), req.user.id]);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/note
router.post('/:id/note', auth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const { rows } = await db.query(
      'INSERT INTO booking_notes (booking_id, author_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, content]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Shared with services/reports (Smart Reports' Morning Brief), so the brief
// shows exactly the figures of the Guest Lists and Balance Due pages.
module.exports.loadGuestLists = loadGuestLists;
module.exports.syncGroupSpan = syncGroupSpan;   // routes/corrections.js (reinstate a group's room)
module.exports.loadBalanceDue = loadBalanceDue;
module.exports.loadKitchen = loadKitchen;
module.exports.breakfastValues = breakfastValues;
module.exports.occupiedUntilSql = occupiedUntilSql;
module.exports.TODAY_WITA_SQL = TODAY_WITA_SQL;
