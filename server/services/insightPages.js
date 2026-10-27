// Insights → Rooms, Guests, Bookings (owner, or the `reports` permission — the
// same figures as the Reports page, one question per page). Each takes a
// period from insightPeriod() and compares it with the period before and the
// same dates last year. Nothing stored.
//   Rooms    — how full, which room types and meal plans sell, how long stays are
//   Guests   — who arrived: countries, returning guests, party size, children
//   Bookings — how reservations come in: channels, made / cancelled, how far
//              ahead, cancellations and no-shows, pickup for the next 30 nights
const db = require('../db');
const { roomFigures, pctChange, r2, addDays, MONTHS } = require('./insightPeriod');
const { todayWITA } = require('./roomChargeService');

const ymd = d => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const VALUE_SQL = `COALESCE(b.room_revenue + b.fnb_revenue, b.total_amount - COALESCE(b.discount_amount, 0))`;
const compare = (now, b) => b && {
  revenue: pctChange(now.revenue, b.revenue),
  occupancy_pts: r2(now.occupancy - b.occupancy),
  adr: pctChange(now.adr, b.adr),
  revpar: pctChange(now.revpar, b.revpar),
};

// Buckets by a number: [[label, test]].
function bucket(rows, value, defs) {
  const total = rows.length;
  return defs.map(([lbl, test]) => {
    const n = rows.filter(r => test(value(r))).length;
    return { label: lbl, count: n, share: total ? r2((n / total) * 100) : 0 };
  });
}

// ── Rooms ──
async function buildRooms(propertyId, P) {
  const { buildFullReport } = require('./fullReport');
  const { getReport } = require('../routes/reports');
  const [full, prev, ly, { rows: stays }] = await Promise.all([
    buildFullReport(propertyId, P.from, P.to),
    getReport(propertyId, P.prev.from, P.prev.to),
    getReport(propertyId, P.last_year.from, P.last_year.to),
    db.query(`SELECT b.nights FROM bookings b WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
              AND b.check_in_date BETWEEN $2::date AND $3::date`, [propertyId, P.from, P.to]),
  ]);
  const R = full.rooms;
  const sellable = R.sellable_rooms;
  const now = {
    revenue: r2(full.revenue.total), room_revenue: r2(full.revenue.room), nights_sold: R.nights_sold,
    available_nights: R.available_nights, occupancy: R.occupancy, adr: r2(R.adr), revpar: r2(R.revpar),
  };
  const before = roomFigures(prev, P.prev.from, P.prev.to, sellable);
  const lastYear = ly.total_nights > 0 ? roomFigures(ly, P.last_year.from, P.last_year.to, sellable) : null;

  // Night by night up to two months, month by month beyond.
  const daily = full.daily.map(d => ({ date: ymd(d.date), sold: parseInt(d.nights_sold, 10) || 0, room: parseFloat(d.room_revenue) || 0, paid: parseInt(d.paid_nights_sold, 10) || 0 }));
  let series;
  if (P.days <= 62) {
    series = { by: 'day', points: daily.map(d => ({ key: d.date, sold: d.sold, available: sellable,
      occupancy: sellable ? r2((d.sold / sellable) * 100) : 0, adr: d.paid ? r2(d.room / d.paid) : 0 })) };
  } else {
    const m = new Map();
    for (const d of daily) {
      const k = d.date.slice(0, 7);
      const c = m.get(k) || { key: k, sold: 0, available: 0, room: 0, paid: 0 };
      c.sold += d.sold; c.available += sellable; c.room += d.room; c.paid += d.paid;
      m.set(k, c);
    }
    series = { by: 'month', points: [...m.values()].map(c => ({ key: c.key, label: MONTHS[+c.key.slice(5) - 1], sold: c.sold, available: c.available,
      occupancy: c.available ? r2((c.sold / c.available) * 100) : 0, adr: c.paid ? r2(c.room / c.paid) : 0 })) };
  }
  const nights = stays.map(s => parseInt(s.nights, 10) || 0);
  const totalNights = R.by_room_type.reduce((s, t) => s + (t.nights || 0), 0);
  const planNights = R.by_rate_plan.reduce((s, p) => s + (p.nights || 0), 0);
  return {
    now, before, last_year_figures: lastYear,
    compare_prev: compare(now, before), compare_last_year: compare(now, lastYear),
    sellable_rooms: sellable, guest_nights: R.guest_nights,
    complimentary: { nights: R.comp_nights, value: r2(full.revenue.complimentary?.value) },
    series,
    room_types: R.by_room_type.map(t => ({
      room_type: t.room_type, rooms: t.rooms, nights: t.nights, occupancy: t.occupancy,
      revenue: r2(t.revenue), adr: r2(t.adr), revpar: r2(t.revpar),
      share: totalNights ? r2((t.nights / totalNights) * 100) : 0,
    })),
    rate_plans: R.by_rate_plan.map(p => ({
      rate_plan: p.rate_plan, code: p.code, nights: p.nights, guest_nights: p.guest_nights,
      room_revenue: r2(p.room_revenue), meal_revenue: r2(p.meal_revenue), adr: r2(p.adr),
      share: planNights ? r2((p.nights / planNights) * 100) : 0,
    })),
    length_of_stay: {
      stays: nights.length,
      average: nights.length ? r2(nights.reduce((s, n) => s + n, 0) / nights.length) : 0,
      buckets: bucket(nights, n => n, [['1 night', n => n === 1], ['2 nights', n => n === 2], ['3 nights', n => n === 3],
        ['4–6 nights', n => n >= 4 && n <= 6], ['7+ nights', n => n >= 7]]),
    },
  };
}

// ── Guests: everyone who arrived in the period (by the main guest's nationality) ──
const ARRIVALS_SQL = `
  SELECT b.id, b.guest_id, NULLIF(TRIM(g.nationality), '') AS nationality, COALESCE(b.num_guests, 0) AS guests,
         COALESCE(b.children, 0) AS children, b.nights, ${VALUE_SQL} AS value,
         EXISTS (SELECT 1 FROM bookings p WHERE p.guest_id = b.guest_id AND p.property_id = b.property_id AND p.id <> b.id
                 AND p.status NOT IN ('cancelled', 'no_show') AND p.check_in_date < b.check_in_date) AS returning
  FROM bookings b JOIN guests g ON g.id = b.guest_id
  WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show') AND b.check_in_date BETWEEN $2::date AND $3::date`;

function guestTotals(rows) {
  return {
    stays: rows.length,
    guests: rows.reduce((s, r) => s + (parseInt(r.guests, 10) || 0), 0),
    children: rows.reduce((s, r) => s + (parseInt(r.children, 10) || 0), 0),
    room_nights: rows.reduce((s, r) => s + (parseInt(r.nights, 10) || 0), 0),
    value: r2(rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)),
    returning: rows.filter(r => r.returning).length,
  };
}

async function buildGuests(propertyId, P) {
  const [{ rows }, { rows: prevRows }, { rows: lyRows }] = await Promise.all([
    db.query(ARRIVALS_SQL, [propertyId, P.from, P.to]),
    db.query(ARRIVALS_SQL, [propertyId, P.prev.from, P.prev.to]),
    db.query(ARRIVALS_SQL, [propertyId, P.last_year.from, P.last_year.to]),
  ]);
  const totals = guestTotals(rows);
  const byNat = list => {
    const m = new Map();
    for (const r of list) {
      const k = r.nationality || '';
      const c = m.get(k) || { nationality: k, stays: 0, guests: 0, room_nights: 0, value: 0, returning: 0 };
      c.stays += 1; c.guests += parseInt(r.guests, 10) || 0; c.room_nights += parseInt(r.nights, 10) || 0;
      c.value += parseFloat(r.value) || 0; if (r.returning) c.returning += 1;
      m.set(k, c);
    }
    return m;
  };
  const cur = byNat(rows), prev = byNat(prevRows), ly = byNat(lyRows);
  const countries = [...cur.values()].map(c => ({
    ...c, value: r2(c.value),
    share: totals.guests ? r2((c.guests / totals.guests) * 100) : 0,
    prev_guests: prev.get(c.nationality)?.guests || 0,
    ly_guests: lyRows.length ? (ly.get(c.nationality)?.guests || 0) : null,
  })).sort((a, b) => b.guests - a.guests || b.stays - a.stays);
  const sizes = rows.map(r => parseInt(r.guests, 10) || 0);
  const nights = rows.map(r => parseInt(r.nights, 10) || 0);
  return {
    totals, before: guestTotals(prevRows), last_year: lyRows.length ? guestTotals(lyRows) : null,
    countries,
    not_recorded: cur.get('')?.stays || 0,
    returning: { stays: totals.returning, share: totals.stays ? r2((totals.returning / totals.stays) * 100) : 0 },
    party: {
      average: sizes.length ? r2(sizes.reduce((s, n) => s + n, 0) / sizes.length) : 0,
      with_children: rows.filter(r => (parseInt(r.children, 10) || 0) > 0).length,
      buckets: bucket(sizes, n => n, [['1 guest', n => n === 1], ['2 guests', n => n === 2], ['3 guests', n => n === 3], ['4+ guests', n => n >= 4]]),
    },
    length_of_stay: {
      average: nights.length ? r2(nights.reduce((s, n) => s + n, 0) / nights.length) : 0,
    },
  };
}

// ── Bookings ──
async function buildBookings(propertyId, P) {
  const { buildFullReport } = require('./fullReport');
  const { bookingsMade } = require('./bookingPickup');
  const today = todayWITA();
  const leadSql = `
    SELECT b.id, b.status, (b.check_in_date - (b.created_at AT TIME ZONE 'Asia/Makassar')::date) AS lead,
           COALESCE(bs.label, b.source) AS source, COALESCE(bs.is_ota OR bs.source_type = 'ota', false) AS ota
    FROM bookings b LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
    WHERE b.property_id = $1 AND b.check_in_date BETWEEN $2::date AND $3::date`;
  const [full, made, madePrev, { rows: arrivals }, { rows: snaps }] = await Promise.all([
    buildFullReport(propertyId, P.from, P.to),
    bookingsMade(propertyId, P.from, P.to, { withRows: true }),
    bookingsMade(propertyId, P.prev.from, P.prev.to),
    db.query(leadSql, [propertyId, P.from, P.to]),
    // Pickup: rooms on the books for the next 30 nights, in the latest
    // snapshot and the one about a week earlier (forecast_snapshots, 104).
    db.query(`
      WITH latest AS (SELECT MAX(snapshot_date) AS d FROM forecast_snapshots WHERE property_id = $1),
           earlier AS (SELECT MAX(snapshot_date) AS d FROM forecast_snapshots, latest
                       WHERE property_id = $1 AND snapshot_date <= latest.d - 7)
      SELECT s.snapshot_date, SUM(s.rooms_sold) AS rooms, SUM(s.room_revenue + s.meal_revenue) AS value
      FROM forecast_snapshots s, latest, earlier
      WHERE s.property_id = $1 AND s.snapshot_date IN (latest.d, earlier.d)
        AND s.night >= latest.d AND s.night < latest.d + 30
      GROUP BY s.snapshot_date ORDER BY s.snapshot_date`, [propertyId]),
  ]);

  // Channels: the stays of the period (room + meal plan revenue), as on Reports.
  const { rows: sources } = await db.query(`SELECT label, is_ota, source_type FROM booking_sources WHERE property_id = $1`, [propertyId]);
  const otaLabels = new Set(sources.filter(s => s.is_ota || s.source_type === 'ota').map(s => s.label));
  const channels = full.channels.map(c => ({
    source: c.source, bookings: c.bookings, nights: c.nights, revenue: r2(c.revenue), adr: r2(c.adr), share: c.share, ota: otaLabels.has(c.source),
  }));
  const stayTotal = channels.reduce((s, c) => s + c.revenue, 0);
  const otaTotal = channels.filter(c => c.ota).reduce((s, c) => s + c.revenue, 0);

  // Reservations made in the period, by channel and day (a group = one).
  const mByChannel = new Map();
  for (const r of made.rows) {
    const c = mByChannel.get(r.source_label) || { source: r.source_label, bookings: 0, rooms: 0, value: 0 };
    c.bookings += 1; c.rooms += r.rooms; c.value += r.value;
    mByChannel.set(r.source_label, c);
  }
  const madeDay = new Map();
  for (const r of made.rows) {
    const t = new Date(r.created_at);
    const day = new Date(t.getTime() + 8 * 3600000).toISOString().slice(0, 10);   // WITA
    const k = P.days <= 62 ? day : day.slice(0, 7);
    madeDay.set(k, (madeDay.get(k) || 0) + 1);
  }
  const points = [];
  if (P.days <= 62) for (let d = P.from; d <= P.to; d = addDays(d, 1)) points.push({ key: d, made: madeDay.get(d) || 0 });
  else for (let d = P.from.slice(0, 7); d <= P.to.slice(0, 7);) {
    points.push({ key: d, label: MONTHS[+d.slice(5) - 1], made: madeDay.get(d) || 0 });
    const [y, m] = d.split('-').map(Number); d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  // How far ahead the guests arriving in the period booked.
  const live = arrivals.filter(a => !['cancelled', 'no_show'].includes(a.status));
  const leads = live.map(a => Math.max(0, parseInt(a.lead, 10) || 0));
  const leadBy = new Map();
  for (const a of live) {
    const c = leadBy.get(a.source) || { source: a.source, ota: a.ota, rooms: 0, days: 0 };
    c.rooms += 1; c.days += Math.max(0, parseInt(a.lead, 10) || 0); leadBy.set(a.source, c);
  }
  const cancelledArr = arrivals.filter(a => a.status === 'cancelled').length;
  const noShows = arrivals.filter(a => a.status === 'no_show').length;

  const pick = snaps.length === 2 ? {
    from_date: ymd(snaps[0].snapshot_date), to_date: ymd(snaps[1].snapshot_date),
    rooms_then: parseInt(snaps[0].rooms, 10), rooms_now: parseInt(snaps[1].rooms, 10),
    rooms: parseInt(snaps[1].rooms, 10) - parseInt(snaps[0].rooms, 10),
    value: r2(parseFloat(snaps[1].value) - parseFloat(snaps[0].value)),
  } : null;

  return {
    today,
    channels, ota_share: stayTotal > 0 ? r2((otaTotal / stayTotal) * 100) : null,
    made: { ...made.made, value: r2(made.made.value), change: pctChange(made.made.bookings, madePrev.made.bookings), before: madePrev.made.bookings },
    cancelled: { ...made.cancelled, value: r2(made.cancelled.value) },
    made_by_channel: [...mByChannel.values()].map(c => ({ ...c, value: r2(c.value) })).sort((a, b) => b.bookings - a.bookings),
    made_series: { by: P.days <= 62 ? 'day' : 'month', points },
    lead: {
      rooms: leads.length,
      average: leads.length ? r2(leads.reduce((s, n) => s + n, 0) / leads.length) : 0,
      buckets: bucket(leads, n => n, [['Same day', n => n === 0], ['1–7 days', n => n >= 1 && n <= 7], ['8–30 days', n => n >= 8 && n <= 30],
        ['31–90 days', n => n >= 31 && n <= 90], ['Over 90 days', n => n > 90]]),
      by_channel: [...leadBy.values()].map(c => ({ source: c.source, ota: c.ota, rooms: c.rooms, average: r2(c.days / c.rooms) }))
        .sort((a, b) => b.rooms - a.rooms),
    },
    arrivals: {
      rooms: arrivals.length, cancelled: cancelledArr, no_shows: noShows,
      cancel_rate: arrivals.length ? r2((cancelledArr / arrivals.length) * 100) : null,
      no_show_rate: arrivals.length ? r2((noShows / arrivals.length) * 100) : null,
    },
    pickup: pick,
  };
}


// ── Drill-down: the reservations behind a figure of Rooms, Guests or Bookings ──
// basis: stays (a night in the period — Rooms, channels), arrivals (arrived in
// the period — Guests, how far ahead, cancellations), made (reserved in the
// period). Filters match the pages' own groupings, by name. One row per room;
// at most 500.
const LIST_LIMIT = 500;
async function buildStayList(propertyId, P, q = {}) {
  const basis = ['stays', 'arrivals', 'made'].includes(q.basis) ? q.basis : 'stays';
  const params = [propertyId, P.from, P.to];
  const where = ['b.property_id = $1'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', `$${params.length}`)); };
  if (basis === 'stays') where.push('b.check_in_date <= $3::date AND b.check_out_date > $2::date');
  if (basis === 'arrivals') where.push('b.check_in_date BETWEEN $2::date AND $3::date');
  if (basis === 'made') where.push(`(b.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date`);
  if (['cancelled', 'no_show'].includes(q.status)) add('b.status = $?', q.status);
  else if (basis !== 'made') where.push(`b.status NOT IN ('cancelled', 'no_show')`);
  if (q.source) add(`COALESCE(bs.label, b.source, 'Unspecified') = $?`, String(q.source));
  if (q.room_type) add(`COALESCE(rt.name, u.type, 'Other') = $?`, String(q.room_type));
  if (q.rate_plan) add(`COALESCE(rp.name, 'No rate plan') = $?`, String(q.rate_plan));
  if (q.nationality !== undefined) {
    if (q.nationality === '' || q.nationality === 'Not recorded') where.push(`NULLIF(TRIM(g.nationality), '') IS NULL`);
    else add('TRIM(g.nationality) = $?', String(q.nationality));
  }
  const LEAD = `(b.check_in_date - (b.created_at AT TIME ZONE 'Asia/Makassar')::date)`;
  const int = v => (v === undefined || v === '' ? null : parseInt(v, 10));
  if (int(q.lead_min) != null) add(`GREATEST(${LEAD}, 0) >= $?`, int(q.lead_min));
  if (int(q.lead_max) != null) add(`GREATEST(${LEAD}, 0) <= $?`, int(q.lead_max));
  if (int(q.nights_min) != null) add('b.nights >= $?', int(q.nights_min));
  if (int(q.nights_max) != null) add('b.nights <= $?', int(q.nights_max));
  if (int(q.guests_min) != null) add('COALESCE(b.num_guests, 0) >= $?', int(q.guests_min));
  if (int(q.guests_max) != null) add('COALESCE(b.num_guests, 0) <= $?', int(q.guests_max));
  if (q.returning === '1') where.push(`EXISTS (SELECT 1 FROM bookings p WHERE p.guest_id = b.guest_id AND p.property_id = b.property_id AND p.id <> b.id
    AND p.status NOT IN ('cancelled', 'no_show') AND p.check_in_date < b.check_in_date)`);
  const { rows } = await db.query(`
    SELECT b.id, b.reservation_group_id, b.status, b.check_in_date, b.check_out_date, b.nights, COALESCE(b.num_guests, 0) AS guests,
           COALESCE(b.children, 0) AS children, ${VALUE_SQL} AS value,
           g.name AS guest_name, NULLIF(TRIM(g.nationality), '') AS nationality, u.name AS unit_name,
           COALESCE(rt.name, u.type, 'Other') AS room_type, COALESCE(rp.name, 'No rate plan') AS rate_plan,
           COALESCE(bs.label, b.source, 'Unspecified') AS source,
           (b.created_at AT TIME ZONE 'Asia/Makassar')::date AS made_on, GREATEST(${LEAD}, 0) AS lead,
           GREATEST(0, LEAST(b.check_out_date, $3::date + 1) - GREATEST(b.check_in_date, $2::date)) AS nights_in_period
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN room_types rt ON rt.id = u.room_type_id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.check_in_date, u.name
    LIMIT ${LIST_LIMIT + 1}`, params);
  const more = rows.length > LIST_LIMIT;
  const list = rows.slice(0, LIST_LIMIT).map(r => ({
    id: r.id, group_id: r.reservation_group_id, status: r.status,
    check_in: ymd(r.check_in_date), check_out: ymd(r.check_out_date), nights: r.nights,
    nights_in_period: parseInt(r.nights_in_period, 10) || 0,
    guests: parseInt(r.guests, 10) || 0, children: parseInt(r.children, 10) || 0, value: r2(r.value),
    guest_name: r.guest_name, nationality: r.nationality, unit_name: r.unit_name, room_type: r.room_type,
    rate_plan: r.rate_plan, source: r.source, made_on: ymd(r.made_on), lead: parseInt(r.lead, 10) || 0,
  }));
  return {
    basis, more, rows: list,
    totals: {
      rooms: list.length,
      guests: list.reduce((s, r) => s + r.guests, 0),
      nights: list.reduce((s, r) => s + (basis === 'stays' ? r.nights_in_period : r.nights), 0),
      value: r2(list.reduce((s, r) => s + r.value, 0)),
    },
  };
}

module.exports = { buildRooms, buildGuests, buildBookings, buildStayList };
