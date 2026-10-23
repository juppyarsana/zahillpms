// OTA price ladders (migration 137). For one meal plan linked to the channel
// manager, the owner types a price per room type for each tier of rooms sold
// in the whole hotel ("sold up to 16", "up to 20", …). channelSync counts the
// rooms sold each night and sends the price of the tier the NEXT room falls in
// — so a booking or a cancellation moves the OTA price within the usual ~20 s.
// Prices are per room per night, service & tax included, sent as typed. A fixed
// OTA price (channelRatePrices) still wins on its nights; PMS prices (New
// Booking, the bill) are never touched.
const db = require('../db');

const PROVIDER = 'channex';
const MAX_TIERS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message, code = 'BAD_REQUEST') {
  const e = new Error(message); e.status = 400; e.code = code; return e;
}

// The tier for a night with `sold` rooms already sold: the first "sold up to"
// that the next room (sold + 1) fits in; past the last tier, the last one.
// tiers = [{ up_to, price }] sorted by up_to.
function tierFor(tiers, sold) {
  if (!tiers?.length) return null;
  return tiers.find(t => sold + 1 <= t.up_to) || tiers[tiers.length - 1];
}

// Meal plans linked to the channel manager, each with its linked room types,
// and the ladder saved for it (if any).
async function get(propertyId) {
  const [{ rows: links }, { rows: rows }, { rows: [{ rooms }] }] = await Promise.all([
    db.query(
      `SELECT rp.id AS rate_plan_id, rp.name AS rate_plan_name, rp.code, rt.id AS room_type_id, rt.name AS room_type_name
         FROM channel_rate_plans c
         JOIN rate_plans rp ON rp.id = c.rate_plan_id AND rp.is_active = true
         JOIN room_types rt ON rt.id = c.room_type_id
        WHERE c.property_id = $1 AND c.provider = $2
        ORDER BY rp.sort_order, rp.name, rt.sort_order, rt.name`, [propertyId, PROVIDER]),
    db.query(
      `SELECT l.rate_plan_id, l.room_type_id, l.sold_up_to, l.price, l.updated_at, u.name AS updated_by_name
         FROM channel_price_ladders l LEFT JOIN users u ON u.id = l.updated_by
        WHERE l.property_id = $1 ORDER BY l.sold_up_to`, [propertyId]),
    db.query('SELECT count(*)::int AS rooms FROM units WHERE property_id = $1', [propertyId]),
  ]);
  const plans = [];
  for (const l of links) {
    let p = plans.find(x => x.rate_plan_id === l.rate_plan_id);
    if (!p) { p = { rate_plan_id: l.rate_plan_id, rate_plan_name: l.rate_plan_name, code: l.code, room_types: [], ladder: null }; plans.push(p); }
    p.room_types.push({ id: l.room_type_id, name: l.room_type_name });
  }
  for (const p of plans) {
    const mine = rows.filter(r => r.rate_plan_id === p.rate_plan_id);
    if (!mine.length) continue;
    const tiers = [...new Set(mine.map(r => r.sold_up_to))].sort((a, b) => a - b);
    const prices = {};
    for (const r of mine) (prices[r.room_type_id] ||= {})[r.sold_up_to] = Number(r.price);
    const last = mine.reduce((a, b) => (new Date(b.updated_at) > new Date(a.updated_at) ? b : a));
    p.ladder = { tiers, prices, updated_at: last.updated_at, updated_by_name: last.updated_by_name };
  }
  return { plans, hotel_rooms: rooms };
}

const toPrice = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[.,\s](?=\d{3}(\D|$))/g, '').replace(',', '.')) : Number(v);
  return n;
};

// body: { tiers: [16, 20, …], prices: { <room_type_id>: [price per tier | null] } }
// Replaces the whole ladder of that meal plan. A room type with every price
// empty is left off the ladder (it keeps the normal price on the OTAs).
async function save(propertyId, userId, ratePlanId, body) {
  if (!UUID.test(String(ratePlanId))) throw bad('Pick a meal plan');
  const { plans } = await get(propertyId);
  const plan = plans.find(p => p.rate_plan_id === ratePlanId);
  if (!plan) throw bad('This meal plan is not linked to the channel manager');

  const tiers = Array.isArray(body?.tiers) ? body.tiers.map(Number) : [];
  if (!tiers.length) throw bad('Add at least one tier');
  if (tiers.length > MAX_TIERS) throw bad(`At most ${MAX_TIERS} tiers`);
  tiers.forEach((t, i) => {
    if (!Number.isInteger(t) || t < 1 || t > 1000) throw bad(`Tier ${i + 1}: "sold up to" must be a whole number from 1`);
    if (i && t <= tiers[i - 1]) throw bad(`Tier ${i + 1}: "sold up to" must be higher than the tier above (${tiers[i - 1]})`);
  });

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
      if (Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) throw bad(`${rt.name}, sold up to ${t}: at most 2 decimals`);
      out.push({ room_type_id: rt.id, up_to: t, price: Math.round(v * 100) / 100 });
    });
  }
  if (!out.length) throw bad('Type the prices for at least one room type');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_price_ladders WHERE property_id = $1 AND rate_plan_id = $2', [propertyId, ratePlanId]);
    await client.query(
      `INSERT INTO channel_price_ladders (property_id, rate_plan_id, room_type_id, sold_up_to, price, updated_by)
       SELECT $1, $2, rt, n, p, $6 FROM unnest($3::uuid[], $4::int[], $5::numeric[]) AS t(rt, n, p)`,
      [propertyId, ratePlanId, out.map(o => o.room_type_id), out.map(o => o.up_to), out.map(o => o.price), userId || null]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { saved: out.length, room_types: new Set(out.map(o => o.room_type_id)).size, tiers: tiers.length };
}

// Remove a meal plan's ladder (the OTAs get the normal price again).
async function remove(propertyId, ratePlanId) {
  if (!UUID.test(String(ratePlanId))) throw bad('Pick a meal plan');
  const { rowCount } = await db.query('DELETE FROM channel_price_ladders WHERE property_id = $1 AND rate_plan_id = $2', [propertyId, ratePlanId]);
  if (!rowCount) { const e = new Error('No ladder for this meal plan'); e.status = 404; throw e; }
  return { removed: rowCount };
}

module.exports = { get, save, remove, tierFor };
