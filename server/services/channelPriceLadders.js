// OTA price ladders (migration 137). For one meal plan linked to the channel
// manager, the owner types a price per room type for each tier of rooms sold
// in the whole hotel ("sold up to 16", "up to 20", …). channelSync counts the
// rooms sold each night and sends the price of the tier the NEXT room falls in
// — so a booking or a cancellation moves the OTA price within the usual ~20 s.
// Prices are per room per night, service & tax included, sent as typed. A fixed
// OTA price (channelRatePrices) still wins on its nights; PMS prices (New
// Booking, the bill) are never touched.
//
// Seasons (migration 150): a named run of nights with its own ladders. Inside a
// season a meal plan + room type uses the season's ladder, without one there
// its All year ladder. Seasons of one property never overlap.
const db = require('../db');
const { TODAY_WITA_SQL } = require('./occupancySql');

const PROVIDER = 'channex';
const MAX_TIERS = 20;
const MAX_DAYS_AHEAD = 5 * 366;   // as OTA prices
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message, code = 'BAD_REQUEST', status = 400) {
  const e = new Error(message); e.status = status; e.code = code; return e;
}

const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const validYmd = s => YMD.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && addDays(s, 0) === s;

// The tier for a night with `sold` rooms already sold: the first "sold up to"
// that the next room (sold + 1) fits in; past the last tier, the last one.
// tiers = [{ up_to, price }] sorted by up_to.
function tierFor(tiers, sold) {
  if (!tiers?.length) return null;
  return tiers.find(t => sold + 1 <= t.up_to) || tiers[tiers.length - 1];
}

// One saved ladder from its rows: tiers, prices per room type, the % per tier.
function ladderFrom(mine) {
  const tiers = [...new Set(mine.map(r => r.sold_up_to))].sort((a, b) => a - b);
  const prices = {};
  const pct = new Map();
  for (const r of mine) {
    (prices[r.room_type_id] ||= {})[r.sold_up_to] = Number(r.price);
    if (r.increase_pct != null) pct.set(r.sold_up_to, Number(r.increase_pct));
  }
  const last = mine.reduce((a, b) => (new Date(b.updated_at) > new Date(a.updated_at) ? b : a));
  return { tiers, prices, increases: tiers.map(t => pct.get(t) ?? null), updated_at: last.updated_at, updated_by_name: last.updated_by_name };
}

// Meal plans linked to the channel manager, each with its linked room types, its
// All year ladder (if any) and its ladder per season; and the seasons.
async function get(propertyId) {
  const [{ rows: links }, { rows }, { rows: [{ rooms }] }, { rows: seasons }, { rows: [{ today }] }] = await Promise.all([
    db.query(
      `SELECT rp.id AS rate_plan_id, rp.name AS rate_plan_name, rp.code, rt.id AS room_type_id, rt.name AS room_type_name
         FROM channel_rate_plans c
         JOIN rate_plans rp ON rp.id = c.rate_plan_id AND rp.is_active = true
         JOIN room_types rt ON rt.id = c.room_type_id
        WHERE c.property_id = $1 AND c.provider = $2
        ORDER BY rp.sort_order, rp.name, rt.sort_order, rt.name`, [propertyId, PROVIDER]),
    db.query(
      `SELECT l.rate_plan_id, l.room_type_id, l.season_id, l.sold_up_to, l.price, l.increase_pct, l.updated_at, u.name AS updated_by_name
         FROM channel_price_ladders l LEFT JOIN users u ON u.id = l.updated_by
        WHERE l.property_id = $1 ORDER BY l.sold_up_to`, [propertyId]),
    db.query('SELECT count(*)::int AS rooms FROM units WHERE property_id = $1', [propertyId]),
    db.query(
      `SELECT id, name, to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to
         FROM channel_ladder_seasons WHERE property_id = $1 ORDER BY date_from`, [propertyId]),
    db.query(`SELECT to_char(${TODAY_WITA_SQL}, 'YYYY-MM-DD') AS today`),
  ]);
  const plans = [];
  for (const l of links) {
    let p = plans.find(x => x.rate_plan_id === l.rate_plan_id);
    if (!p) { p = { rate_plan_id: l.rate_plan_id, rate_plan_name: l.rate_plan_name, code: l.code, room_types: [], ladder: null, season_ladders: {} }; plans.push(p); }
    p.room_types.push({ id: l.room_type_id, name: l.room_type_name });
  }
  for (const p of plans) {
    const mine = rows.filter(r => r.rate_plan_id === p.rate_plan_id);
    const allYear = mine.filter(r => !r.season_id);
    if (allYear.length) p.ladder = ladderFrom(allYear);
    for (const s of seasons) {
      const inSeason = mine.filter(r => r.season_id === s.id);
      if (inSeason.length) p.season_ladders[s.id] = ladderFrom(inSeason);
    }
  }
  return { plans, seasons: seasons.map(s => ({ ...s, ended: s.date_to < today })), hotel_rooms: rooms, today };
}

const toPrice = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[.,\s](?=\d{3}(\D|$))/g, '').replace(',', '.')) : Number(v);
  return n;
};

// body: { season_id?, tiers: [16, 20, …], increases?: [% per tier | null], prices: { <room_type_id>: [price per tier | null] } }
// Replaces the whole ladder of that meal plan in that season (none = All year).
// A room type with every price empty is left off it: in a season it then uses
// its All year ladder, in All year the normal price.
async function save(propertyId, userId, ratePlanId, body) {
  if (!UUID.test(String(ratePlanId))) throw bad('Pick a meal plan');
  const { plans } = await get(propertyId);
  const plan = plans.find(p => p.rate_plan_id === ratePlanId);
  if (!plan) throw bad('This meal plan is not linked to the channel manager');
  const season = await seasonOf(propertyId, body?.season_id);

  const tiers = Array.isArray(body?.tiers) ? body.tiers.map(Number) : [];
  if (!tiers.length) throw bad('Add at least one tier');
  if (tiers.length > MAX_TIERS) throw bad(`At most ${MAX_TIERS} tiers`);
  tiers.forEach((t, i) => {
    if (!Number.isInteger(t) || t < 1 || t > 1000) throw bad(`Tier ${i + 1}: "sold up to" must be a whole number from 1`);
    if (i && t <= tiers[i - 1]) throw bad(`Tier ${i + 1}: "sold up to" must be higher than the tier above (${tiers[i - 1]})`);
  });

  const increases = tiers.map((t, i) => {
    const raw = Array.isArray(body?.increases) ? body.increases[i] : null;
    if (i === 0 || raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < -90 || n > 500) throw bad(`Sold up to ${t}: the increase must be between -90% and 500%`);
    return Math.round(n * 100) / 100;
  });

  const { rows: mins } = await db.query('SELECT room_type_id, price FROM channel_min_prices WHERE property_id = $1', [propertyId]);
  const minimums = new Map(mins.map(m => [m.room_type_id, Number(m.price)]));
  const out = [];
  const prices = body?.prices || {};
  for (const rt of plan.room_types) {
    const list = Array.isArray(prices[rt.id]) ? prices[rt.id].map(toPrice) : [];
    const filled = list.filter(v => v !== null);
    if (!filled.length) continue;
    tiers.forEach((t, i) => {
      const v = list[i] ?? null;
      if (v === null) throw bad(`${rt.name}: fill in every tier, or leave the whole column empty`);
      if (!Number.isFinite(v) || v <= 0) throw bad(`${rt.name}, sold up to ${t}: type a price above 0`);
      if (v >= 1e12) throw bad(`${rt.name}, sold up to ${t}: price too high`);
      const min = minimums.get(rt.id);
      if (min != null && v < min) throw bad(`${rt.name}, sold up to ${t}: below the minimum of Rp ${Math.round(min).toLocaleString('id-ID')}`, 'BELOW_MIN');
      if (Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) throw bad(`${rt.name}, sold up to ${t}: at most 2 decimals`);
      out.push({ room_type_id: rt.id, up_to: t, price: Math.round(v * 100) / 100, pct: increases[i] });
    });
  }
  if (!out.length) throw bad('Type the prices for at least one room type');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM channel_price_ladders WHERE property_id = $1 AND rate_plan_id = $2 AND season_id IS NOT DISTINCT FROM $3::uuid',
      [propertyId, ratePlanId, season?.id || null]);
    await client.query(
      `INSERT INTO channel_price_ladders (property_id, rate_plan_id, room_type_id, sold_up_to, price, increase_pct, season_id, updated_by)
       SELECT $1, $2, rt, n, p, pc, $7, $8 FROM unnest($3::uuid[], $4::int[], $5::numeric[], $6::numeric[]) AS t(rt, n, p, pc)`,
      [propertyId, ratePlanId, out.map(o => o.room_type_id), out.map(o => o.up_to), out.map(o => o.price), out.map(o => o.pct), season?.id || null, userId || null]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { saved: out.length, room_types: new Set(out.map(o => o.room_type_id)).size, tiers: tiers.length, plan_name: plan.rate_plan_name, season_name: season?.name || null };
}

// Remove a meal plan's ladder in that season (none = All year): the nights go
// back to the All year ladder, or for All year to the normal price.
async function remove(propertyId, ratePlanId, seasonId) {
  if (!UUID.test(String(ratePlanId))) throw bad('Pick a meal plan');
  const season = await seasonOf(propertyId, seasonId);
  const { rowCount } = await db.query(
    'DELETE FROM channel_price_ladders WHERE property_id = $1 AND rate_plan_id = $2 AND season_id IS NOT DISTINCT FROM $3::uuid',
    [propertyId, ratePlanId, season?.id || null]);
  if (!rowCount) throw bad('No ladder for this meal plan', 'NOT_FOUND', 404);
  return { removed: rowCount, season_name: season?.name || null };
}

// ── Seasons ──────────────────────────────────────────────────

async function seasonOf(propertyId, seasonId) {
  if (seasonId === null || seasonId === undefined || seasonId === '') return null;
  if (!UUID.test(String(seasonId))) throw bad('Pick a season');
  const { rows: [s] } = await db.query('SELECT id, name FROM channel_ladder_seasons WHERE id = $1 AND property_id = $2', [seasonId, propertyId]);
  if (!s) throw bad('This season no longer exists', 'NOT_FOUND', 404);
  return s;
}

function cleanSeason(body, today, { isNew }) {
  const name = String(body?.name || '').trim();
  if (!name) throw bad('Give the season a name');
  if (name.length > 80) throw bad('The name is too long');
  if (!validYmd(body?.date_from) || !validYmd(body?.date_to)) throw bad('Pick the first and last night');
  if (body.date_to < body.date_from) throw bad('The last night is before the first');
  if (isNew && body.date_from < today) throw bad('The first night is in the past');
  if (body.date_to < today) throw bad('The last night is in the past');
  const last = addDays(today, MAX_DAYS_AHEAD);
  if (body.date_to > last) throw bad(`The last night can be ${last} at the latest`);
  return { name, date_from: body.date_from, date_to: body.date_to };
}

// Inside the caller's transaction: one at a time per property, so two saves
// can't both pass, then a named refusal when another season holds these nights.
async function refuseClash(client, propertyId, season, exceptId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ladder-seasons:' + propertyId]);
  const { rows: [other] } = await client.query(
    `SELECT name FROM channel_ladder_seasons
      WHERE property_id = $1 AND date_from <= $3::date AND date_to >= $2::date AND id IS DISTINCT FROM $4::uuid LIMIT 1`,
    [propertyId, season.date_from, season.date_to, exceptId || null]);
  if (other) throw bad(`These dates overlap the season "${other.name}"`, 'SEASON_OVERLAP', 409);
  const { rows: [same] } = await client.query(
    'SELECT 1 FROM channel_ladder_seasons WHERE property_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3::uuid',
    [propertyId, season.name, exceptId || null]);
  if (same) throw bad(`There is already a season called "${season.name}"`, 'SEASON_NAME', 409);
}

async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const todayIn = async () => (await db.query(`SELECT to_char(${TODAY_WITA_SQL}, 'YYYY-MM-DD') AS today`)).rows[0].today;

// body: { name, date_from, date_to, copy_all_year? }. copy_all_year starts every
// meal plan's ladder as a copy of its All year ladder.
async function createSeason(propertyId, userId, body) {
  const season = cleanSeason(body, await todayIn(), { isNew: true });
  return inTransaction(async client => {
    await refuseClash(client, propertyId, season);
    const { rows: [row] } = await client.query(
      `INSERT INTO channel_ladder_seasons (property_id, name, date_from, date_to, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [propertyId, season.name, season.date_from, season.date_to, userId || null]);
    if (body.copy_all_year) {
      await client.query(
        `INSERT INTO channel_price_ladders (property_id, rate_plan_id, room_type_id, sold_up_to, price, increase_pct, season_id, updated_by)
         SELECT property_id, rate_plan_id, room_type_id, sold_up_to, price, increase_pct, $2, $3
           FROM channel_price_ladders WHERE property_id = $1 AND season_id IS NULL`,
        [propertyId, row.id, userId || null]);
    }
    return { id: row.id, ...season };
  });
}

async function updateSeason(propertyId, seasonId, body) {
  const existing = await seasonOf(propertyId, seasonId);
  if (!existing) throw bad('Pick a season');
  const season = cleanSeason(body, await todayIn(), { isNew: false });
  return inTransaction(async client => {
    await refuseClash(client, propertyId, season, existing.id);
    await client.query(
      'UPDATE channel_ladder_seasons SET name = $2, date_from = $3, date_to = $4 WHERE id = $1',
      [existing.id, season.name, season.date_from, season.date_to]);
    return { id: existing.id, ...season };
  });
}

// The nights go back to the All year ladder.
async function removeSeason(propertyId, seasonId) {
  const existing = await seasonOf(propertyId, seasonId);
  if (!existing) throw bad('Pick a season');
  await db.query('DELETE FROM channel_ladder_seasons WHERE id = $1', [existing.id]);
  return { removed: true, name: existing.name };
}

module.exports = { get, save, remove, tierFor, createSeason, updateSeason, removeSeason };
