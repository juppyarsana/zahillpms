const db = require('../db');

// Night audit detail — the report of one business date's audit, like the
// "night audit pack" other PMSes print when the day is closed:
//   1. room + meal charges posted for that night, room by room
//   2. per-night extras posted for that night (extra bed…)
//   3. what the audit did / found: no-shows, guests past check-out,
//      rooms counted as sold but never checked in, housekeeping tasks
//   4. the day's figures (occupancy, ADR, RevPAR, revenue) and
//   5. money received by method + balances to collect from guests leaving
// 4 and 5 come from the Daily Close (services/dailyClose.js), so the two
// never disagree. Built by jobs/nightAudit.js right after the audit and
// saved on night_audit_runs.detail (migration 089); for older runs it's
// rebuilt from the data as it is now (`snapshot: false`).
// Amounts are NET (before service charge & tax), like Reports.

const num = v => parseFloat(v || 0);
const ymd = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

async function postedCharges(propertyId, date) {
  const { rows } = await db.query(`
    SELECT fc.booking_id, fc.type, fc.description, fc.quantity, fc.amount, fc.posted_at,
           u.name AS unit_name, g.name AS guest_name, b.status, b.num_guests,
           rp.code AS rate_plan_code, b.complimentary_scope
    FROM folio_charges fc
    JOIN bookings b ON b.id = fc.booking_id
    JOIN units u ON u.id = b.unit_id
    JOIN guests g ON g.id = b.guest_id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.property_id = $1 AND fc.service_date = $2::date
      AND fc.is_voided = false AND fc.type IN ('room', 'fnb', 'addon')
    ORDER BY u.name, fc.type`, [propertyId, date]);

  const byBooking = new Map();
  for (const r of rows) {
    let b = byBooking.get(r.booking_id);
    if (!b) {
      b = { booking_id: r.booking_id, unit_name: r.unit_name, guest_name: r.guest_name, status: r.status,
            num_guests: r.num_guests, rate_plan: r.rate_plan_code || 'RO',
            complimentary: r.complimentary_scope || null, room: 0, meals: 0, extras: [], extras_total: 0, total: 0 };
      byBooking.set(r.booking_id, b);
    }
    const amount = num(r.amount);
    if (r.type === 'room') b.room += amount;
    else if (r.type === 'fnb') b.meals += amount;
    else {
      // "Extra Bed Single — 2026-09-30" → "Extra Bed Single"
      b.extras.push({ description: String(r.description || 'Extra').replace(/\s+—\s+\d{4}-\d{2}-\d{2}$/, ''), quantity: num(r.quantity), amount });
      b.extras_total += amount;
    }
    b.total += amount;
  }
  const list = [...byBooking.values()].sort((a, b) => String(a.unit_name).localeCompare(String(b.unit_name), undefined, { numeric: true }));
  const totals = list.reduce((t, b) => ({
    room: t.room + b.room, meals: t.meals + b.meals, extras: t.extras + b.extras_total, total: t.total + b.total,
  }), { room: 0, meals: 0, extras: 0, total: 0 });
  return { rows: list, totals, rooms: list.filter(b => b.room > 0 || b.meals > 0).length };
}

// Stays that covered the night but have no room charge for it.
// - in house / checked out with a price: should have been posted (a failed
//   posting, or a price of 0 that isn't a complimentary stay)
// - never checked in: still pending / deposit paid / confirmed — counted as
//   sold in the reports until FO marks them no-show or cancels.
async function notPosted(propertyId, date) {
  const { rows } = await db.query(`
    SELECT b.id AS booking_id, u.name AS unit_name, g.name AS guest_name, b.status,
           b.check_in_date, b.check_out_date, b.complimentary_scope,
           COALESCE(b.room_revenue, b.total_amount) AS room_value
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    JOIN guests g ON g.id = b.guest_id
    WHERE b.property_id = $1
      AND b.status IN ('pending', 'deposit_paid', 'confirmed', 'checked_in', 'checked_out')
      AND b.check_in_date <= $2::date AND b.check_out_date > $2::date
      AND NOT EXISTS (SELECT 1 FROM folio_charges fc WHERE fc.booking_id = b.id AND fc.type = 'room'
                        AND fc.service_date = $2::date AND fc.is_voided = false)
    ORDER BY u.name`, [propertyId, date]);
  const missing = [], neverArrived = [];
  for (const r of rows) {
    const row = { booking_id: r.booking_id, unit_name: r.unit_name, guest_name: r.guest_name, status: r.status,
                  check_in_date: ymd(r.check_in_date), check_out_date: ymd(r.check_out_date) };
    if (['pending', 'deposit_paid', 'confirmed'].includes(r.status)) neverArrived.push(row);
    else if (r.complimentary_scope) continue;          // free room: nothing to post
    else if (num(r.room_value) <= 0) missing.push({ ...row, reason: 'Room price is Rp 0' });
    else missing.push({ ...row, reason: 'Room charge not posted' });
  }
  return { missing, never_arrived: neverArrived };
}

// actions: what the audit run itself did — { no_shows, overdue, tasks_created,
// folio_failed }. Rebuilding an older run passes only what the run saved.
async function buildAuditDetail(propertyId, date, actions = {}, { snapshot = true } = {}) {
  const { buildDailyClose } = require('./dailyClose');
  const [posted, gaps, dc] = await Promise.all([
    postedCharges(propertyId, date),
    notPosted(propertyId, date),
    buildDailyClose(propertyId, { date }),
  ]);
  const t = dc.today;
  return {
    business_date: date,
    snapshot,
    built_at: new Date().toISOString(),
    summary: {
      rooms_sold: t.rooms_sold, sellable: dc.sellable, occupancy: t.occupancy, adr: t.adr, revpar: t.revpar,
      room: t.room, fnb: t.fnb, extras: t.extras, activities: t.activities, total: t.total,
      comp_nights: t.comp_nights || 0, comp_value: t.comp_value || 0,
    },
    posted,
    not_posted: gaps.missing,
    never_arrived: gaps.never_arrived,
    actions: {
      no_shows: (actions.no_shows || []).map(n => ({ booking_id: n.id || n.booking_id, guest_name: n.guest_name, unit_name: n.unit_name })),
      overdue: actions.overdue ? actions.overdue.map(o => ({ booking_id: o.id || o.booking_id, guest_name: o.guest_name, unit_name: o.unit_name, check_out_date: ymd(o.check_out_date) })) : null,
      tasks_created: actions.tasks_created ?? null,
      folio_failed: actions.folio_failed ?? null,
    },
    bookings: {
      made: dc.made,
      cancelled: dc.cancelled.length,
      cancelled_value: dc.cancelled_value,
    },
    collected: dc.collected,
    next_day: {
      date: dc.next_day.date,
      arrivals: dc.next_day.arrivals,
      departures: dc.next_day.departures,
      to_collect: dc.next_day.to_collect,
    },
  };
}

// The saved detail, or — for a run before migration 089 — rebuilt now.
async function detailForRun(run) {
  if (run.detail) return run.detail;
  return buildAuditDetail(run.property_id, ymd(run.business_date), {
    no_shows: run.no_shows || [], tasks_created: run.tasks_created,
  }, { snapshot: false });
}

module.exports = { buildAuditDetail, detailForRun };
