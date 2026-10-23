// Channel Manager stage 2 (migration 120): free rooms and prices out to
// Channex, for every room type / meal plan linked on the setup page.
//
// What is sent, per night, today (WITA) → SYNC_DAYS ahead:
//   availability of a room type = its rooms not out of order and not booked
//     that night (every booking except cancelled / no-show, the same
//     occupiedUntilSql rule as every availability check — an overdue guest
//     still holds the room);
//   price of a rate plan = the room type's normal rate that night (base rate
//     + pricing periods incl. the yield engine's, pricingService — from the
//     type's first room) + the meal plan for the type's max guests, service &
//     tax included, whole rupiah. The same figure New Booking suggests —
//     unless the meal plan has an OTA price ladder (migration 137,
//     channelPriceLadders.js): then the price of the tier the next room
//     falls in, by rooms sold that night in the whole hotel — or an OTA price
//     was typed for that meal plan and night (migration 125,
//     channelRatePrices.js): then that, exactly as typed (it wins).
//
// When: the database triggers of migration 120 mark a linked property
// "dirty" on any change of bookings, rooms, pricing periods, room types,
// meal plans, tax settings or links. A worker (every 10 s, at most one run per
// property per 15 s — a change reaches Channex within ~20 s) works out the
// values again and sends ONLY the nights that differ from what was last sent
// (channel_sync_values), as date ranges — at most two Channex requests a run.
// Every night at 04:10 WITA everything is sent again (also adds the new last
// night of the window). A failed send is retried after a minute.
const db = require('../db');
const channex = require('./channexAdapter');
const { occupiedUntilSql, TODAY_WITA_SQL } = require('./occupancySql');
const { nightlyRoomRates } = require('./pricingService');
const { computeFolioTotals } = require('./folioService');
const { mealNetPerNight } = require('./ratePlanService');
const { basisFrom } = require('./priceBasis');
const health = require('./channelHealth');
const { tierFor } = require('./channelPriceLadders');

const PROVIDER = 'channex';
const SYNC_DAYS = 500;          // Channex certification: a full sync covers 500 days
const TICK_MS = 10_000;
const GAP_SECONDS = 15;        // at most one run per property per 15 s (≤ 4 calls / min / endpoint; Channex allows 10)
const RETRY_SECONDS = [60, 120, 240, 480, 900];   // after the 1st, 2nd, … failure in a row (also a 429)
const MANUAL_FULL_GAP_MS = 60 * 60 * 1000;         // "Send everything now" at most once an hour
const fails = new Map();       // property → failures in a row (in memory; a restart starts again at 60 s)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The last 20 sends, newest first (migration 124).
async function logSend(propertyId, entry) {
  await db.query(
    `UPDATE channel_sync_state SET send_log = (
       SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb)
         FROM jsonb_array_elements(jsonb_build_array($2::jsonb) || send_log) WITH ORDINALITY AS t(e, i) WHERE i <= 20)
      WHERE property_id = $1`, [propertyId, JSON.stringify(entry)]).catch(err => console.error('[CHANNEL SYNC] log', err.message));
}

const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// The values the channel manager should have now, keyed `kind|external|night`.
async function desiredValues(propertyId) {
  const { rows: [{ today }] } = await db.query(`SELECT to_char(${TODAY_WITA_SQL}, 'YYYY-MM-DD') AS today`);
  const from = today, to = addDays(today, SYNC_DAYS);   // `to` = the morning after the last night
  const nights = [];
  for (let d = from; d < to; d = addDays(d, 1)) nights.push(d);

  const [{ rows: rtLinks }, { rows: rpLinks }, { rows: [settings] }] = await Promise.all([
    db.query(`SELECT c.room_type_id, c.external_room_type_id, rt.name, rt.max_guests
                FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id
               WHERE c.property_id = $1 AND c.provider = $2`, [propertyId, PROVIDER]),
    db.query(`SELECT c.room_type_id, c.external_rate_plan_id, rp.*
                FROM channel_rate_plans c JOIN rate_plans rp ON rp.id = c.rate_plan_id
               WHERE c.property_id = $1 AND c.provider = $2 AND rp.is_active = true`, [propertyId, PROVIDER]),
    db.query('SELECT tax_rate, service_charge_rate, prices_include_tax FROM property_settings WHERE property_id = $1', [propertyId]),
  ]);
  const values = new Map();
  const tiers = new Map();      // `r|external|night` → the ladder tier sent ("sold up to")
  if (!rtLinks.length) return { values, tiers, from, to };
  const typeIds = rtLinks.map(l => l.room_type_id);

  const [{ rows: units }, { rows: stays }] = await Promise.all([
    db.query(`SELECT id, room_type_id, status, to_char(status_expected_back, 'YYYY-MM-DD') AS back
                FROM units WHERE property_id = $1 AND room_type_id = ANY($2::uuid[]) ORDER BY name`, [propertyId, typeIds]),
    db.query(`SELECT b.unit_id, to_char(b.check_in_date, 'YYYY-MM-DD') AS ci, to_char(${occupiedUntilSql('b')}, 'YYYY-MM-DD') AS until
                FROM bookings b JOIN units u ON u.id = b.unit_id
               WHERE b.property_id = $1 AND u.room_type_id = ANY($2::uuid[])
                 AND b.status NOT IN ('cancelled', 'no_show')
                 AND b.check_in_date < $4 AND ${occupiedUntilSql('b')} > $3`, [propertyId, typeIds, from, to]),
  ]);

  // Busy nights per room: a set of 'YYYY-MM-DD'.
  const busy = new Map();
  for (const s of stays) {
    if (!busy.has(s.unit_id)) busy.set(s.unit_id, new Set());
    const set = busy.get(s.unit_id);
    for (let d = s.ci < from ? from : s.ci; d < s.until && d < to; d = addDays(d, 1)) set.add(d);
  }

  for (const link of rtLinks) {
    const rooms = units.filter(u => u.room_type_id === link.room_type_id);
    for (const night of nights) {
      let free = 0;
      for (const u of rooms) {
        // Out of order is a current status: not for sale until it is expected back (no date = not for sale).
        if (u.status === 'out_of_order' && (!u.back || night < u.back)) continue;
        if (busy.get(u.id)?.has(night)) continue;
        free++;
      }
      values.set(`a|${link.external_room_type_id}|${night}`, free);
    }
  }

  const divisor = basisFrom(settings || {}).divisor;
  for (const link of rtLinks) {
    const plans = rpLinks.filter(p => p.room_type_id === link.room_type_id);
    const room = units.find(u => u.room_type_id === link.room_type_id);
    if (!plans.length || !room) continue;
    const rates = await nightlyRoomRates(propertyId, room.id, from, to);
    if (!rates) continue;
    for (const plan of plans) {
      const meal = mealNetPerNight(plan, link.max_guests || 1, divisor);
      for (const n of rates.night_breakdown) {
        const price = Math.round(computeFolioTotals(n.room_rate + meal, settings?.tax_rate, settings?.service_charge_rate).total);
        values.set(`r|${plan.external_rate_plan_id}|${n.date}`, price);
      }
    }
  }

  // OTA price ladders (migration 137): by rooms sold that night in the whole
  // hotel (every room, linked or not — the same booking rule as above).
  const { rows: ladderRows } = await db.query(
    `SELECT c.external_rate_plan_id, l.sold_up_to, l.price
       FROM channel_price_ladders l
       JOIN channel_rate_plans c ON c.property_id = l.property_id AND c.provider = $2
                                AND c.room_type_id = l.room_type_id AND c.rate_plan_id = l.rate_plan_id
       JOIN rate_plans rp ON rp.id = l.rate_plan_id AND rp.is_active = true
      WHERE l.property_id = $1 ORDER BY l.sold_up_to`, [propertyId, PROVIDER]);
  if (ladderRows.length) {
    const { rows: hotelStays } = await db.query(
      `SELECT b.unit_id, to_char(b.check_in_date, 'YYYY-MM-DD') AS ci, to_char(${occupiedUntilSql('b')}, 'YYYY-MM-DD') AS until
         FROM bookings b
        WHERE b.property_id = $1 AND b.unit_id IS NOT NULL AND b.status NOT IN ('cancelled', 'no_show')
          AND b.check_in_date < $3 AND ${occupiedUntilSql('b')} > $2`, [propertyId, from, to]);
    const soldRooms = new Map();   // night → Set of rooms sold
    for (const s of hotelStays) {
      for (let d = s.ci < from ? from : s.ci; d < s.until && d < to; d = addDays(d, 1)) {
        if (!soldRooms.has(d)) soldRooms.set(d, new Set());
        soldRooms.get(d).add(s.unit_id);
      }
    }
    const ladders = new Map();
    for (const r of ladderRows) {
      if (!ladders.has(r.external_rate_plan_id)) ladders.set(r.external_rate_plan_id, []);
      ladders.get(r.external_rate_plan_id).push({ up_to: r.sold_up_to, price: Number(r.price) });
    }
    for (const night of nights) {
      const sold = soldRooms.get(night)?.size || 0;
      for (const [ext, list] of ladders) {
        const t = tierFor(list, sold);
        values.set(`r|${ext}|${night}`, t.price);
        tiers.set(`r|${ext}|${night}`, t.up_to);
      }
    }
  }

  // OTA prices typed for one meal plan (migration 125) replace the worked-out
  // price on their nights, sent exactly as typed; the last one saved wins.
  const { rows: overrides } = await db.query(
    `SELECT c.external_rate_plan_id, to_char(GREATEST(o.date_from, $2::date), 'YYYY-MM-DD') AS d1,
            to_char(LEAST(o.date_to, $3::date - 1), 'YYYY-MM-DD') AS d2, o.price
       FROM channel_rate_prices o
       JOIN channel_rate_plans c ON c.property_id = o.property_id AND c.provider = $4
                                AND c.room_type_id = o.room_type_id AND c.rate_plan_id = o.rate_plan_id
       JOIN rate_plans rp ON rp.id = o.rate_plan_id AND rp.is_active = true
      WHERE o.property_id = $1 AND o.date_to >= $2::date AND o.date_from < $3::date
      ORDER BY o.created_at, o.id`, [propertyId, from, to, PROVIDER]);
  for (const o of overrides) {
    for (let d = o.d1; d <= o.d2; d = addDays(d, 1)) {
      values.set(`r|${o.external_rate_plan_id}|${d}`, Number(o.price));
      tiers.delete(`r|${o.external_rate_plan_id}|${d}`);
    }
  }
  return { values, tiers, from, to };
}

// Consecutive nights with the same value → one range.
function toRanges(entries) {
  const byId = new Map();
  for (const e of entries) {
    const k = `${e.kind}|${e.external}`;
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(e);
  }
  const ranges = [];
  for (const list of byId.values()) {
    list.sort((a, b) => (a.night < b.night ? -1 : 1));
    let cur = null;
    for (const e of list) {
      if (cur && e.value === cur.value && e.night === addDays(cur.date_to, 1)) cur.date_to = e.night;
      else { cur = { kind: e.kind, external: e.external, value: e.value, date_from: e.night, date_to: e.night }; ranges.push(cur); }
    }
  }
  return ranges;
}

async function syncProperty(propertyId, { full = false } = {}) {
  const { rows: [p] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
  const cxProperty = p?.channex_property_id;
  if (!cxProperty) return { skipped: 'not linked' };

  const { values, tiers, from } = await desiredValues(propertyId);
  const { rows: stored } = await db.query(
    `SELECT kind, external_id, to_char(night, 'YYYY-MM-DD') AS night, value FROM channel_sync_values WHERE property_id = $1`, [propertyId]);
  const sent = new Map(stored.map(s => [`${s.kind}|${s.external_id}|${s.night}`, Number(s.value)]));

  const changed = [];
  for (const [key, value] of values) {
    if (!full && sent.get(key) === value) continue;
    const [kind, external, night] = key.split('|');
    changed.push({ kind, external, night, value });
  }
  const ranges = toRanges(changed);
  const avail = ranges.filter(r => r.kind === 'a').map(r => ({
    property_id: cxProperty, room_type_id: r.external, date_from: r.date_from, date_to: r.date_to, availability: r.value,
  }));
  const rates = ranges.filter(r => r.kind === 'r').map(r => ({
    property_id: cxProperty, rate_plan_id: r.external, date_from: r.date_from, date_to: r.date_to, rate: r.value.toFixed(2),
  }));

  // One call for availability, one for prices — whatever the number of values.
  const a = await channex.pushAri('availability', avail);
  const r = await channex.pushAri('restrictions', rates);
  const warnings = [...a.warnings, ...r.warnings];

  // Remember what Channex now has; forget past nights and unlinked items.
  if (changed.length) {
    await db.query(
      `INSERT INTO channel_sync_values (property_id, kind, external_id, night, value, sent_at)
       SELECT $1, k, e, n::date, v, NOW() FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[]) AS t(k, e, n, v)
       ON CONFLICT (property_id, kind, external_id, night) DO UPDATE SET value = EXCLUDED.value, sent_at = NOW()`,
      [propertyId, changed.map(c => c.kind), changed.map(c => c.external), changed.map(c => c.night), changed.map(c => c.value)]);
  }
  const live = [...new Set([...values.keys()].map(k => k.split('|').slice(0, 2).join('|')))];
  await db.query(
    `DELETE FROM channel_sync_values WHERE property_id = $1 AND (night < $2::date OR NOT ((kind || '|' || external_id) = ANY($3::text[])))`,
    [propertyId, from, live]);

  // What went, in words, for the send list (room type / meal plan + dates).
  const { rows: names } = await db.query(`
    SELECT c.external_room_type_id AS id, rt.name AS label FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id WHERE c.property_id = $1
    UNION ALL
    SELECT c.external_rate_plan_id, rt.name || ' ' || rp.name FROM channel_rate_plans c
      JOIN room_types rt ON rt.id = c.room_type_id JOIN rate_plans rp ON rp.id = c.rate_plan_id WHERE c.property_id = $1`, [propertyId]);
  const label = new Map(names.map(n => [n.id, n.label]));
  const day = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const rng = r => (r.date_from === r.date_to ? day(r.date_from) : `${day(r.date_from)} – ${day(r.date_to)}`);
  const items = [
    ...avail.map(r => `${label.get(r.room_type_id) || 'room type'}: ${r.availability} free · ${rng(r)}`),
    ...rates.map(r => {
      const tier = tiers.get(`r|${r.rate_plan_id}|${r.date_from}`);
      return `${label.get(r.rate_plan_id) || 'rate'}: Rp ${Number(r.rate).toLocaleString('id-ID', { maximumFractionDigits: 2 })}${tier ? ` (sold up to ${tier})` : ''} · ${rng(r)}`;
    }),
  ];

  return {
    full, nights_changed: changed.length,
    items: full ? [] : items.slice(0, 12), items_more: full ? 0 : Math.max(0, items.length - 12),
    availability_ranges: avail.length, rate_ranges: rates.length,
    task_ids: { availability: a.taskIds, restrictions: r.taskIds },
    warnings: warnings.slice(0, 20),
  };
}

// ── Worker ───────────────────────────────────────────────────

const running = new Set();
let timer = null;

// mode: 'change' (the worker), 'full' (nightly), 'manual' (Send everything now — also full).
async function runSync(propertyId, mode = 'change') {
  if (running.has(propertyId)) return { busy: true };
  running.add(propertyId);
  await db.query('INSERT INTO channel_sync_state (property_id) VALUES ($1) ON CONFLICT DO NOTHING', [propertyId]);
  // As text: a JS Date drops the microseconds, and done_dirty_at would then
  // always look older than dirty_at (the worker would run again forever).
  const { rows: [st] } = await db.query('SELECT dirty_at::text AS dirty_at FROM channel_sync_state WHERE property_id = $1', [propertyId]);
  const full = mode !== 'change';
  if (mode === 'manual') {
    const { rows: [f] } = await db.query('SELECT last_full_at FROM channel_sync_state WHERE property_id = $1', [propertyId]);
    if (f?.last_full_at && Date.now() - new Date(f.last_full_at).getTime() < MANUAL_FULL_GAP_MS) {
      running.delete(propertyId);
      const next = new Date(new Date(f.last_full_at).getTime() + MANUAL_FULL_GAP_MS);
      return { tooSoon: true, next };
    }
  }
  try {
    const result = await syncProperty(propertyId, { full });
    await db.query(
      `UPDATE channel_sync_state SET
         done_dirty_at = GREATEST(COALESCE(done_dirty_at, '-infinity'), COALESCE($2::timestamptz, '-infinity'::timestamptz)),
         last_run_at = NOW(), last_ok_at = NOW(), last_error = NULL,
         last_full_at = CASE WHEN $3 THEN NOW() ELSE last_full_at END,
         next_try_at = NOW() + make_interval(secs => $4), last_sent = $5
       WHERE property_id = $1`,
      [propertyId, st?.dirty_at || null, full, GAP_SECONDS, JSON.stringify({ ...result, mode, at: new Date().toISOString() })]);
    fails.delete(propertyId);
    if (result.nights_changed || full) {
      await logSend(propertyId, { at: new Date().toISOString(), mode, ok: true, nights: result.nights_changed,
        availability_ranges: result.availability_ranges, rate_ranges: result.rate_ranges,
        items: result.items, items_more: result.items_more, task_ids: result.task_ids, warnings: result.warnings.length });
    }
    await health.recovered(propertyId, 'send').catch(() => {});
    return result;
  } catch (err) {
    await db.query(
      `UPDATE channel_sync_state SET last_run_at = NOW(), last_error = $2, last_error_at = NOW(),
         next_try_at = NOW() + make_interval(secs => $3)
       WHERE property_id = $1`, [propertyId, String(err.message).slice(0, 2000), (() => {
        const n = (fails.get(propertyId) || 0) + 1;
        fails.set(propertyId, n);
        return RETRY_SECONDS[Math.min(n, RETRY_SECONDS.length) - 1];
      })()]);
    console.error('[CHANNEL SYNC]', propertyId, err.message);
    await logSend(propertyId, { at: new Date().toISOString(), mode, ok: false, error: String(err.message).slice(0, 300) });
    await health.failed(propertyId, 'send').catch(() => {});
    throw err;
  } finally {
    running.delete(propertyId);
  }
}

async function tick() {
  try {
    const { rows } = await db.query(`
      SELECT s.property_id FROM channel_sync_state s
        JOIN properties p ON p.id = s.property_id AND p.channex_property_id IS NOT NULL AND p.is_active = true
        JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'channel_manager' AND pm.is_enabled = true
       WHERE s.dirty_at > COALESCE(s.done_dirty_at, '-infinity')
         AND COALESCE(s.next_try_at, '-infinity') <= NOW()`);
    for (const r of rows) await runSync(r.property_id, 'change').catch(() => {});
  } catch (err) {
    console.error('[CHANNEL SYNC] tick', err.message);
  }
}

async function syncAllFull() {
  const { rows } = await db.query(
    `SELECT p.id FROM properties p
       JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'channel_manager' AND pm.is_enabled = true
      WHERE p.channex_property_id IS NOT NULL AND p.is_active = true`);
  for (const [i, r] of rows.entries()) {
    if (i) await sleep(5000);   // a few seconds between properties (Channex)
    await runSync(r.id, 'full').catch(() => {});
  }
}

// Started with the server when Channex is configured. A linked property with
// nothing sent yet gets a first run straight away.
async function start() {
  if (!channex.isConfigured() || timer) return;
  await db.query(`
    INSERT INTO channel_sync_state (property_id, dirty_at)
    SELECT id, NOW() FROM properties WHERE channex_property_id IS NOT NULL
    ON CONFLICT DO NOTHING`).catch(() => {});
  timer = setInterval(tick, TICK_MS);
}

async function status(propertyId) {
  const { rows: [s] } = await db.query(
    `SELECT dirty_at, done_dirty_at, last_run_at, last_ok_at, last_full_at, last_error, last_error_at, next_try_at, last_sent, send_log,
            (dirty_at > COALESCE(done_dirty_at, '-infinity')) AS waiting
       FROM channel_sync_state WHERE property_id = $1`, [propertyId]);
  return s ? { ...s, running: running.has(propertyId) } : null;
}

module.exports = { desiredValues, syncProperty, runSync, syncAllFull, start, status, SYNC_DAYS };
