// OTA prices for one meal plan (migration 125). The owner types, for a room
// type + meal plan linked to the channel manager, a price per room per night
// for a run of nights. It goes to the OTAs exactly as typed (service & tax
// included), replacing the worked-out price for those nights; the PMS's own
// prices (New Booking, the folio) are not touched. Several lines saved in one
// go are one transaction, so the worker sends them to Channex in one call
// (channelSync.desiredValues reads this table). The last line saved wins
// where two cover the same night; removing a line brings the earlier price back.
const db = require('../db');
const { TODAY_WITA_SQL } = require('./occupancySql');
const { SYNC_DAYS } = require('./channelSync');

const PROVIDER = 'channex';
const MAX_LINES = 50;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message, code = 'BAD_REQUEST') {
  const e = new Error(message); e.status = 400; e.code = code; return e;
}

const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const validYmd = s => YMD.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && addDays(s, 0) === s;

// What can be priced: every linked room type with its linked, active meal plans.
async function options(propertyId) {
  const { rows } = await db.query(
    `SELECT rt.id AS room_type_id, rt.name AS room_type_name, rp.id AS rate_plan_id, rp.name AS rate_plan_name, rp.code
       FROM channel_rate_plans c
       JOIN room_types rt ON rt.id = c.room_type_id
       JOIN rate_plans rp ON rp.id = c.rate_plan_id AND rp.is_active = true
      WHERE c.property_id = $1 AND c.provider = $2
      ORDER BY rt.sort_order, rt.name, rp.name`, [propertyId, PROVIDER]);
  return rows;
}

// Lines whose last night is today or later, newest first.
async function list(propertyId) {
  const { rows } = await db.query(
    `SELECT o.id, o.room_type_id, rt.name AS room_type_name, o.rate_plan_id, rp.name AS rate_plan_name,
            to_char(o.date_from, 'YYYY-MM-DD') AS date_from, to_char(o.date_to, 'YYYY-MM-DD') AS date_to,
            o.price, o.batch_id, o.created_at, u.name AS created_by_name,
            EXISTS (SELECT 1 FROM channel_rate_plans c WHERE c.property_id = o.property_id AND c.provider = $2
                       AND c.room_type_id = o.room_type_id AND c.rate_plan_id = o.rate_plan_id) AS linked
       FROM channel_rate_prices o
       JOIN room_types rt ON rt.id = o.room_type_id
       JOIN rate_plans rp ON rp.id = o.rate_plan_id
       LEFT JOIN users u ON u.id = o.created_by
      WHERE o.property_id = $1 AND o.date_to >= ${TODAY_WITA_SQL}
      ORDER BY o.created_at DESC, o.id`, [propertyId, PROVIDER]);
  return rows.map(r => ({ ...r, price: Number(r.price) }));
}

// lines: [{ room_type_id, rate_plan_id, date_from, date_to, price }] — all saved or none.
async function save(propertyId, userId, lines) {
  if (!Array.isArray(lines) || !lines.length) throw bad('Add at least one line');
  if (lines.length > MAX_LINES) throw bad(`At most ${MAX_LINES} lines at a time`);
  const { rows: [{ today }] } = await db.query(`SELECT to_char(${TODAY_WITA_SQL}, 'YYYY-MM-DD') AS today`);
  const last = addDays(today, SYNC_DAYS - 1);
  const allowed = new Set((await options(propertyId)).map(o => `${o.room_type_id}|${o.rate_plan_id}`));

  const clean = lines.map((l, i) => {
    const n = `Line ${i + 1}: `;
    if (!allowed.has(`${l?.room_type_id}|${l?.rate_plan_id}`)) throw bad(n + 'pick a room type and meal plan linked to the channel manager');
    if (!validYmd(l.date_from) || !validYmd(l.date_to)) throw bad(n + 'pick the first and last night');
    if (l.date_to < l.date_from) throw bad(n + 'the last night is before the first');
    if (l.date_from < today) throw bad(n + 'the first night is in the past');
    if (l.date_to > last) throw bad(n + `the last night can be ${last} at the latest`);
    const price = typeof l.price === 'string' ? Number(l.price.replace(',', '.')) : Number(l.price);
    if (!Number.isFinite(price) || price <= 0) throw bad(n + 'type a price above 0');
    if (Math.round(price * 100) !== Math.round(price * 100 * 1e6) / 1e6) throw bad(n + 'at most 2 decimals');
    if (price >= 1e12) throw bad(n + 'price too high');
    return { room_type_id: l.room_type_id, rate_plan_id: l.rate_plan_id, date_from: l.date_from, date_to: l.date_to, price: Math.round(price * 100) / 100 };
  });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ id: batchId }] } = await client.query('SELECT uuid_generate_v4() AS id');
    for (const l of clean) {
      await client.query(
        `INSERT INTO channel_rate_prices (property_id, room_type_id, rate_plan_id, date_from, date_to, price, batch_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [propertyId, l.room_type_id, l.rate_plan_id, l.date_from, l.date_to, l.price, batchId, userId || null]);
    }
    await client.query('COMMIT');
    return { batch_id: batchId, saved: clean.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Remove lines (the worked-out price, or an earlier line, comes back on their nights).
async function remove(propertyId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !UUID.test(String(id)))) throw bad('Nothing to remove');
  const { rowCount } = await db.query(
    'DELETE FROM channel_rate_prices WHERE property_id = $1 AND id = ANY($2::uuid[])', [propertyId, ids]);
  if (!rowCount) { const e = new Error('Not found'); e.status = 404; throw e; }
  return { removed: rowCount };
}

module.exports = { options, list, save, remove };
