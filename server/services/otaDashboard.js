// The OTA dashboard (Sales): the next 30 nights with the prices we send, the
// dates below their occupancy target, why, and a suggested price.
//
// Occupancy is the Forecast page's (services/forecast.js) and the prices are
// exactly what the channel manager would send now (channelSync.desiredValues),
// so this page can't disagree with either. A price typed here is an ordinary
// OTA price for one night (channelRatePrices): same rules, same send.
//
// The suggestion is a fixed rule, not a prediction — every part of it is stated
// on screen. See cutFor / suggestedPrice.
const db = require('../db');
const { buildForecast } = require('./forecast');
const channelSync = require('./channelSync');
const ratePrices = require('./channelRatePrices');
const { computeFolioTotals } = require('./folioService');
const { todayWITA } = require('./roomChargeService');
const { OTA_LABEL_SQL } = require('./channelBookings');
const otaPriceLog = require('./otaPriceLog');

const PROVIDER = 'channex';
const DAYS = 30;
const DEFAULT_TARGETS = { near: 40, mid: 30, far: 20 };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function bad(message, status = 400, code = 'BAD_REQUEST') {
  const e = new Error(message); e.status = status; e.code = code; return e;
}
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const dowOf = ymd => new Date(ymd + 'T00:00:00Z').getUTCDay();
const short = ymd => `${DOW[dowOf(ymd)]} ${Number(ymd.slice(8))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const long = ymd => `${DOW_LONG[dowOf(ymd)]} ${Number(ymd.slice(8))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const targetFor = (days, t) => (days <= 7 ? t.near : days <= 14 ? t.mid : t.far);

// ── The suggestion rule ──────────────────────────────────────
// Well below target (a quarter or more) → 10%, otherwise 5%; 3 days or less to
// go → 5% more; more than 14 days to go → 5% less, never under 5%.
function cutFor({ days, pct, target }) {
  const gap = target ? (target - pct) / target : 0;
  let cut = gap >= 0.25 ? 10 : 5;
  if (days <= 3) cut += 5;
  if (days > 14) cut -= 5;
  return Math.max(cut, 5);
}

// A type with fewer than 3 rooms left keeps its price; otherwise the cut, rounded
// to a clean figure, stopping at the minimum and never above today's price.
function suggestedPrice({ base, now, free, min, cut }) {
  if (cut == null || free < 3) return now;
  return Math.min(now, Math.max(min || 0, roundedCut(base, cut)));
}
function roundedCut(base, cut) {
  const step = base >= 500000 ? 50000 : 10000;
  return Math.round((base * (1 - cut / 100)) / step) * step;
}

// ── Rules ────────────────────────────────────────────────────
async function loadRules(propertyId) {
  const [{ rows: [s] }, { rows: mins }] = await Promise.all([
    db.query('SELECT ota_targets FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query('SELECT room_type_id, price FROM channel_min_prices WHERE property_id = $1', [propertyId]),
  ]);
  return {
    targets: { ...DEFAULT_TARGETS, ...(s?.ota_targets || {}) },
    minimums: Object.fromEntries(mins.map(m => [m.room_type_id, Number(m.price)])),
  };
}

// body: { targets: { near, mid, far }, minimums: { <room_type_id>: price | null } }
async function saveRules(propertyId, user, body) {
  const t = body?.targets || {};
  const targets = {};
  for (const k of ['near', 'mid', 'far']) {
    const v = Number(t[k]);
    if (!Number.isInteger(v) || v < 1 || v > 100) throw bad('Occupancy targets must be whole numbers from 1 to 100');
    targets[k] = v;
  }
  const { rows: types } = await db.query('SELECT id, name FROM room_types WHERE property_id = $1', [propertyId]);
  const known = new Map(types.map(r => [r.id, r.name]));
  const minimums = body?.minimums || {};
  const set = [], clear = [];
  for (const [id, raw] of Object.entries(minimums)) {
    if (!known.has(id)) throw bad('Unknown room type');
    if (raw === null || raw === '') { clear.push(id); continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0 || v >= 1e12) throw bad(`${known.get(id)}: type a minimum above 0, or leave it empty`);
    set.push([id, Math.round(v * 100) / 100]);
  }
  const before = await loadRules(propertyId);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE property_settings SET ota_targets = $2 WHERE property_id = $1', [propertyId, JSON.stringify(targets)]);
    for (const [id, price] of set) {
      await client.query(
        `INSERT INTO channel_min_prices (property_id, room_type_id, price, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (property_id, room_type_id) DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [propertyId, id, price, user?.id || null]);
    }
    if (clear.length) await client.query('DELETE FROM channel_min_prices WHERE property_id = $1 AND room_type_id = ANY($2::uuid[])', [propertyId, clear]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const changes = [];
  if (['near', 'mid', 'far'].some(k => before.targets[k] !== targets[k])) changes.push(`Occupancy targets ${targets.near}% / ${targets.mid}% / ${targets.far}%`);
  for (const [id, price] of set) if (before.minimums[id] !== price) changes.push(`${known.get(id)} minimum ${idr(price)}`);
  for (const id of clear) if (before.minimums[id] != null) changes.push(`${known.get(id)} minimum removed`);
  if (changes.length) await otaPriceLog.record(propertyId, user, { action: 'rules', summary: changes.join(' · ') });
  return loadRules(propertyId);
}

// ── The 30 nights ────────────────────────────────────────────
async function loadLinks(propertyId) {
  const [{ rows: types }, { rows: plans }, { rows: tiers }] = await Promise.all([
    db.query(`SELECT c.room_type_id AS id, c.external_room_type_id AS external, rt.name
                FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id
               WHERE c.property_id = $1 AND c.provider = $2 ORDER BY rt.sort_order, rt.name`, [propertyId, PROVIDER]),
    db.query(`SELECT c.room_type_id, c.rate_plan_id, c.external_rate_plan_id AS external, rp.name, rp.sort_order
                FROM channel_rate_plans c JOIN rate_plans rp ON rp.id = c.rate_plan_id AND rp.is_active = true
               WHERE c.property_id = $1 AND c.provider = $2`, [propertyId, PROVIDER]),
    db.query('SELECT DISTINCT rate_plan_id, sold_up_to FROM channel_price_ladders WHERE property_id = $1', [propertyId]),
  ]);
  const lowest = new Map();
  for (const t of tiers) lowest.set(t.rate_plan_id, Math.min(lowest.get(t.rate_plan_id) ?? Infinity, t.sold_up_to));
  // Meal plans with a ladder first: those are the ones actually being sold.
  const planList = [...new Map(plans.map(p => [p.rate_plan_id, {
    id: p.rate_plan_id, name: p.name, sort_order: p.sort_order, has_ladder: lowest.has(p.rate_plan_id),
  }])).values()].sort((a, b) => (b.has_ladder - a.has_ladder) || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  return { types, plans, planList, lowest };
}

async function buildNights(propertyId) {
  const today = todayWITA();
  const [forecast, links, rules, desired, { rows: picked }] = await Promise.all([
    buildForecast(propertyId, { from: today, days: DAYS }),
    loadLinks(propertyId),
    loadRules(propertyId),
    channelSync.desiredValues(propertyId, { days: DAYS }),
    db.query(
      `SELECT to_char(gs, 'YYYY-MM-DD') AS night, count(b.id)::int AS rooms
         FROM generate_series($2::date, $2::date + $3::int - 1, '1 day') gs
         LEFT JOIN bookings b ON b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
          AND b.check_in_date <= gs::date AND b.check_out_date > gs::date AND b.created_at > NOW() - INTERVAL '7 days'
        GROUP BY gs`, [propertyId, today, DAYS]),
  ]);
  const pickedBy = new Map(picked.map(p => [p.night, p.rooms]));
  const nights = forecast.rows.map(r => {
    const days = daysBetween(today, r.date);
    const target = targetFor(days, rules.targets);
    const prices = {};
    let manual = false;
    for (const p of links.plans) {
      const key = `r|${p.external}|${r.date}`;
      if (!desired.values.has(key)) continue;
      const isManual = desired.manuals.has(key);
      manual = manual || isManual;
      (prices[p.rate_plan_id] ||= {})[p.room_type_id] = {
        price: desired.values.get(key), base: desired.base.get(key) ?? desired.values.get(key),
        manual: isManual, tier: desired.tiers.get(key) || null,
      };
    }
    const free_by_type = {};
    for (const t of links.types) free_by_type[t.id] = desired.values.get(`a|${t.external}|${r.date}`) ?? 0;
    const slow = r.sellable > 0 && r.occupancy < target;
    return {
      date: r.date, dow: DOW[dowOf(r.date)], day: Number(r.date.slice(8)), label: short(r.date), days,
      pct: r.occupancy, sold: r.sold, sellable: r.sellable, free: r.free, target, slow, manual,
      holiday: r.holiday, picked_up: pickedBy.get(r.date) || 0, prices, free_by_type,
    };
  });
  return { today, nights, links, rules };
}

// Bookings that came in or went since yesterday 00:00 WITA, from the channel manager.
async function loadSince(propertyId) {
  const { rows } = await db.query(
    `SELECT r.id, r.revision_status, r.result, ${OTA_LABEL_SQL} AS ota_name, r.received_at,
            to_char(r.arrival, 'YYYY-MM-DD') AS arrival, to_char(r.departure, 'YYYY-MM-DD') AS departure,
            COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(COALESCE(r.raw->'attributes', r.raw)->'rooms') = 'array'
                                             THEN COALESCE(r.raw->'attributes', r.raw)->'rooms' END), 1) AS rooms,
            COALESCE(r.raw->'attributes', r.raw)->>'amount' AS amount
       FROM channel_revisions r
      WHERE r.property_id = $1 AND r.result IN ('applied', 'attention')
        AND r.received_at >= (((NOW() AT TIME ZONE 'Asia/Makassar')::date - 1)::timestamp AT TIME ZONE 'Asia/Makassar')
      ORDER BY r.received_at DESC LIMIT 50`, [propertyId]);
  const items = rows.map(r => ({
    id: r.id, ota: r.ota_name, received_at: r.received_at, rooms: Number(r.rooms) || 1, amount: Number(r.amount) || 0,
    arrival: r.arrival, departure: r.departure,
    kind: r.result !== 'applied' ? 'attention' : r.revision_status === 'cancelled' ? 'cancelled' : r.revision_status === 'modified' ? 'changed' : 'new',
  }));
  const sum = (kind, k) => items.filter(i => i.kind === kind).reduce((s, i) => s + i[k], 0);
  return {
    booked: { rooms: sum('new', 'rooms'), amount: sum('new', 'amount'), reservations: items.filter(i => i.kind === 'new').length },
    cancelled: { rooms: sum('cancelled', 'rooms'), amount: sum('cancelled', 'amount'), reservations: items.filter(i => i.kind === 'cancelled').length },
    items: items.slice(0, 12),
  };
}

// Reservations made through each OTA source: the last 30 days vs the 30 before.
// Revenue is the price incl. tax (what the guest's stay sells for), without
// cancelled ones. Commission only exists where Channex sends it.
async function loadOtas(propertyId) {
  const [{ rows }, { rows: comm }] = await Promise.all([
    db.query(
      `WITH made AS (
         SELECT bs.label, b.id, COALESCE(b.reservation_group_id, b.id) AS res, b.status, b.nights,
                COALESCE(b.total_amount, 0) - COALESCE(b.discount_amount, 0) AS amount,
                b.check_in_date - (b.created_at AT TIME ZONE 'Asia/Makassar')::date AS lead,
                (b.created_at >= NOW() - INTERVAL '30 days') AS cur
           FROM bookings b
           JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id AND bs.is_ota
          WHERE b.property_id = $1 AND b.created_at >= NOW() - INTERVAL '60 days'
       )
       SELECT label,
              count(DISTINCT res) FILTER (WHERE cur)::int AS reservations,
              count(DISTINCT res) FILTER (WHERE NOT cur)::int AS before,
              COALESCE(sum(nights) FILTER (WHERE cur AND status NOT IN ('cancelled', 'no_show')), 0)::int AS nights,
              COALESCE(sum(amount) FILTER (WHERE cur AND status NOT IN ('cancelled', 'no_show')), 0) AS revenue,
              round(avg(lead) FILTER (WHERE cur))::int AS lead_days,
              count(DISTINCT res) FILTER (WHERE cur AND status = 'cancelled')::int AS cancelled
         FROM made GROUP BY label ORDER BY reservations DESC, label`, [propertyId]),
    db.query(
      `SELECT regexp_replace(lower(${OTA_LABEL_SQL}), '[^a-z0-9]', '', 'g') AS ota,
              sum((a->>'ota_commission')::numeric) AS commission, sum((a->>'amount')::numeric) AS amount
         FROM channel_revisions r, LATERAL (SELECT COALESCE(r.raw->'attributes', r.raw) AS a) x
        WHERE r.property_id = $1 AND r.received_at >= NOW() - INTERVAL '60 days' AND r.revision_status <> 'cancelled'
          AND (a->>'ota_commission') ~ '^[0-9.]+$' AND (a->>'ota_commission')::numeric > 0
          AND (a->>'amount') ~ '^[0-9.]+$' AND (a->>'amount')::numeric > 0
        GROUP BY 1`, [propertyId]),
  ]);
  const commBy = new Map(comm.map(c => [c.ota, (Number(c.commission) / Number(c.amount)) * 100]));
  return rows.map(r => {
    const revenue = Number(r.revenue) || 0;
    const pct = commBy.get(r.label.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return {
      name: r.label, reservations: r.reservations, change: r.reservations - r.before, nights: r.nights, revenue,
      average: r.nights ? revenue / r.nights : 0, lead_days: r.lead_days,
      cancelled_pct: r.reservations ? Math.round((r.cancelled / r.reservations) * 100) : 0,
      commission_pct: pct != null ? Math.round(pct * 10) / 10 : null,
    };
  });
}

// GET / — everything on the page.
async function buildDashboard(propertyId) {
  const { today, nights, links, rules } = await buildNights(propertyId);
  const [since, otas, sync] = await Promise.all([loadSince(propertyId), loadOtas(propertyId), channelSync.status(propertyId)]);
  const firstPlan = links.planList[0]?.id;
  const list = nights.filter(n => n.slow || n.manual).map(n => {
    const row = Object.values(n.prices[firstPlan] || {});
    return {
      date: n.date, label: n.label, days: n.days, pct: n.pct, target: n.target, free: n.free, slow: n.slow, manual: n.manual,
      holiday: n.holiday, picked_up: n.picked_up,
      lowest_price: row.length ? Math.min(...row.map(c => c.price)) : null,
      cut: n.slow ? cutFor(n) : null,
    };
  });
  return {
    today, linked: links.types.length > 0, plans: links.planList, room_types: links.types.map(t => ({ id: t.id, name: t.name })),
    rules, nights, slow_dates: list, slow_total: nights.filter(n => n.slow).length,
    slow_soon: nights.filter(n => n.slow && n.days <= 7).length,
    since, otas,
    channel: sync ? { ok: !sync.last_error, last_ok_at: sync.last_ok_at, last_error: sync.last_error, waiting: !!sync.waiting } : null,
    changes: await otaPriceLog.recent(propertyId),
  };
}

// The menu's red count and Overview's line: nights below target, nothing else.
async function slowCount(propertyId) {
  const today = todayWITA();
  const [forecast, rules] = await Promise.all([buildForecast(propertyId, { from: today, days: DAYS }), loadRules(propertyId)]);
  return forecast.rows.filter(r => r.sellable > 0 && r.occupancy < targetFor(daysBetween(today, r.date), rules.targets)).length;
}

// ── One night: the story and the prices ──────────────────────
// Rooms usually booked in the 7 days before this point, for the same weekday —
// from the daily snapshots. Null until there are at least 3 past nights to go by.
async function usualPace(propertyId, date, days, today) {
  const candidates = [];
  for (let k = 1; k <= 8; k++) {
    const night = addDays(date, -7 * k);
    if (night < today) candidates.push(night);
  }
  if (!candidates.length) return null;
  const { rows } = await db.query(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night, to_char(snapshot_date, 'YYYY-MM-DD') AS snap, rooms_sold
       FROM forecast_snapshots WHERE property_id = $1 AND night = ANY($2::date[])`, [propertyId, candidates]);
  const by = new Map(rows.map(r => [`${r.night}|${r.snap}`, Number(r.rooms_sold)]));
  const samples = [];
  for (const night of candidates) {
    const now = by.get(`${night}|${addDays(night, -days)}`);
    const week = by.get(`${night}|${addDays(night, -days - 7)}`);
    if (now != null && week != null) samples.push(Math.max(0, now - week));
  }
  if (samples.length < 3) return null;
  return Math.round(samples.reduce((s, v) => s + v, 0) / samples.length);
}

// The same weekday over the last 4 weeks: how full, at what average all-in price.
async function sameWeekday(propertyId, date, today, rooms) {
  const { getReport } = require('../routes/reports');
  const from = addDays(today, -28), to = addDays(today, -1);
  const [report, { rows: [s] }] = await Promise.all([
    getReport(propertyId, from, to),
    db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]),
  ]);
  const dow = dowOf(date);
  const days = (report.daily_revenue || []).filter(d => dowOf(String(d.date).slice(0, 10)) === dow);
  if (!days.length || !rooms) return null;
  const sold = days.reduce((n, d) => n + Number(d.nights_sold || 0), 0);
  const paid = days.reduce((n, d) => n + Number(d.paid_nights_sold || 0), 0);
  const net = days.reduce((n, d) => n + Number(d.room_revenue || 0) + Number(d.fnb_rate_plan || 0), 0);
  if (!sold) return null;
  return {
    weekday: `${DOW_LONG[dow]}s`,
    pct: Math.round((sold / (rooms * days.length)) * 100),
    average: paid ? Math.round(computeFolioTotals(net / paid, s?.tax_rate, s?.service_charge_rate).total) : null,
  };
}

async function nightContext(propertyId, night, nights, firstPlan, links) {
  const [{ rows: cancelled }, { rows: events }, { rows: yieldEvents }] = await Promise.all([
    db.query(
      `SELECT COALESCE(bs.label, 'A guest') AS label, count(*)::int AS rooms
         FROM bookings b LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
        WHERE b.property_id = $1 AND b.status = 'cancelled' AND b.updated_at > NOW() - INTERVAL '48 hours'
          AND b.check_in_date <= $2::date AND b.check_out_date > $2::date
        GROUP BY 1 ORDER BY 2 DESC`, [propertyId, night.date]),
    db.query(
      `SELECT count(*)::int AS n FROM events
        WHERE property_id = $1 AND status = 'confirmed' AND event_date <= $2::date AND COALESCE(end_date, event_date) >= $2::date`,
      [propertyId, night.date]),
    db.query(
      `SELECT name FROM yield_events
        WHERE property_id = $1 AND status = 'approved' AND date_from <= $2::date AND date_to >= $2::date LIMIT 2`,
      [propertyId, night.date]),
  ]);
  const out = [];
  if (cancelled.length) {
    const who = cancelled.map(c => `${c.label} (${plural(c.rooms, 'room')})`).join(', ');
    out.push(`Cancelled here in the last 2 days: ${who}.`);
  }
  if (night.holiday) out.push(`${night.holiday} falls on this date.`);
  for (const e of yieldEvents) out.push(`${e.name} is on this date.`);
  if (events[0]?.n) out.push('A meeting room event is confirmed on this date, so more rooms may still come.');

  const i = nights.findIndex(n => n.date === night.date);
  const prev = nights[i - 1], next = nights[i + 1];
  const slowBoth = prev?.slow && next?.slow;
  const strong = [prev, next].filter(n => n && !n.slow && n.pct >= 50).sort((a, b) => b.pct - a.pct)[0];
  if (slowBoth) out.push('The nights either side are slow too, so this is a soft patch, not one quiet night.');
  else if (strong) out.push(`${long(strong.date)} is ${strong.pct}% full, so a better price could also win longer stays.`);

  const cells = Object.values(night.prices[firstPlan] || {});
  const lowest = links.lowest.get(firstPlan);
  if (cells.length && lowest != null && cells.some(c => !c.manual) && cells.filter(c => !c.manual).every(c => c.tier === lowest)) {
    out.push("The ladder is already on its lowest tier, so the price won't drop by itself.");
  }
  return out.length ? out.join(' ') : 'Nothing else stands out for this date.';
}

// GET /night/:date
async function nightDetail(propertyId, date) {
  if (!YMD.test(date || '')) throw bad('Pick a date');
  const { today, nights, links, rules } = await buildNights(propertyId);
  const night = nights.find(n => n.date === date);
  if (!night) throw bad('That date is not in the next 30 nights', 404, 'NOT_FOUND');
  const cut = night.slow ? cutFor(night) : null;
  const firstPlan = links.planList[0]?.id;

  const plans = links.planList.map(plan => ({
    id: plan.id, name: plan.name, has_ladder: plan.has_ladder,
    lines: links.types.filter(t => night.prices[plan.id]?.[t.id]).map(t => {
      const c = night.prices[plan.id][t.id];
      const free = night.free_by_type[t.id] ?? 0;
      const min = rules.minimums[t.id] ?? null;
      return {
        room_type_id: t.id, name: t.name, free, now: c.price, manual: c.manual, min,
        suggested: suggestedPrice({ base: c.base, now: c.price, free, min, cut }),
        // The rule alone would have gone lower than the minimum.
        at_min: cut != null && free >= 3 && min != null && roundedCut(c.base, cut) < min,
      };
    }),
  })).filter(p => p.lines.length);

  const [same, usual, context] = await Promise.all([
    sameWeekday(propertyId, date, today, night.sellable),
    usualPace(propertyId, date, night.days, today),
    nightContext(propertyId, night, nights, firstPlan, links),
  ]);

  const rooms = n => (n === 1 ? '1 room' : n ? `${n} rooms` : 'No rooms');
  const pace = usual == null
    ? `${rooms(night.picked_up)} booked in the last 7 days.`
    : night.picked_up >= usual
      ? `Bookings are at the usual pace, with ${rooms(night.picked_up).toLowerCase()} in the last 7 days.`
      : `${rooms(night.picked_up)} booked in the last 7 days, when ${usual} is usual at this point.`;

  const first = plans[0]?.lines || [];
  const cutTypes = first.filter(l => l.suggested < l.now);
  const kept = first.filter(l => l.free < 3);
  const atMin = first.filter(l => l.at_min);
  let headline = null;
  if (night.slow) {
    if (!cutTypes.length) headline = "Keep today's prices";
    else if (cutTypes.length === first.length) headline = `About ${cut}% lower on every room type`;
    else if (cutTypes.length <= 3) headline = `About ${cut}% lower on ${cutTypes.map(l => l.name).join(', ')}`;
    else headline = `About ${cut}% lower on ${cutTypes.length} of ${first.length} room types`;
  }
  const notes = [];
  if (kept.length) notes.push(`${kept.map(l => l.name).join(', ')} ${kept.length === 1 ? 'keeps its' : 'keep their'} price, with fewer than 3 rooms left.`);
  if (atMin.length) notes.push(`${atMin.map(l => l.name).join(', ')} ${atMin.length === 1 ? 'stops' : 'stop'} at your minimum.`);

  return {
    date, label: night.label, long_label: long(date), days: night.days, pct: night.pct, target: night.target, free: night.free,
    sold: night.sold, sellable: night.sellable, slow: night.slow, manual: night.manual, cut,
    needed: Math.max(0, Math.ceil((night.sellable * night.target) / 100) - night.sold),
    same, pace, context, headline, notes,
    breakeven: cut && cutTypes.length ? Math.ceil(10 / (1 - cut / 100)) : null,
    plans,
  };
}

// ── Changing one night ───────────────────────────────────────
// lines: [{ room_type_id, rate_plan_id, price }]
async function saveNight(propertyId, user, date, lines) {
  const detail = await nightDetail(propertyId, date);
  if (!Array.isArray(lines) || !lines.length) throw bad('Change at least one price');
  await ratePrices.save(propertyId, user?.id, lines.map(l => ({ ...l, date_from: date, date_to: date })));
  const planName = new Map(detail.plans.map(p => [p.id, p.name]));
  const typeName = new Map(detail.plans.flatMap(p => p.lines.map(l => [l.room_type_id, l.name])));
  const summary = `${detail.label}: ` + lines.map(l => `${typeName.get(l.room_type_id)} ${planName.get(l.rate_plan_id)} ${idr(l.price)}`).join(', ');
  await otaPriceLog.record(propertyId, user, { action: 'night_price', night: date, summary });
  return { saved: lines.length };
}

async function removeNight(propertyId, user, date) {
  if (!YMD.test(date || '')) throw bad('Pick a date');
  const removed = await ratePrices.removeForNight(propertyId, date);
  if (!removed) throw bad('No manual price on this date', 404, 'NOT_FOUND');
  await otaPriceLog.record(propertyId, user, { action: 'night_removed', night: date, summary: `${short(date)}: manual prices removed, back to the ladder or normal price` });
  return { removed };
}

module.exports = { buildDashboard, slowCount, nightDetail, saveNight, removeNight, saveRules, loadRules, cutFor, suggestedPrice, targetFor };
