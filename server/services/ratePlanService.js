const db = require('../db');
const { round2 } = require('./folioService');

// Rate plans ("arrangements") — RO / BB / HB / FB per property. `meal_price`
// is a flat NET per-person-per-night figure covering all included meals.

const CODE_RE = /^[A-Z0-9]{1,10}$/;

// NET meal charge per night for `numGuests`. Zero unless the plan includes a meal.
function mealNetPerNight(ratePlan, numGuests) {
  if (!ratePlan) return 0;
  const hasMeal = ratePlan.includes_breakfast || ratePlan.includes_lunch || ratePlan.includes_dinner;
  if (!hasMeal) return 0;
  const price = parseFloat(ratePlan.meal_price) || 0;
  return round2(price * (parseInt(numGuests) || 1));
}

async function listRatePlans(propertyId, { activeOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM rate_plans WHERE property_id = $1 ${activeOnly ? 'AND is_active = true' : ''}
     ORDER BY sort_order, code`,
    [propertyId]
  );
  return rows;
}

async function getRatePlan(propertyId, id) {
  const { rows: [row] } = await db.query(
    'SELECT * FROM rate_plans WHERE id = $1 AND property_id = $2', [id, propertyId]
  );
  return row || null;
}

// The property default (is_default), else the lowest-sort_order active plan.
async function getDefaultRatePlan(propertyId) {
  const { rows: [row] } = await db.query(
    `SELECT * FROM rate_plans
     WHERE property_id = $1 AND (is_active = true OR is_default = true)
     ORDER BY is_default DESC, sort_order, code
     LIMIT 1`,
    [propertyId]
  );
  return row || null;
}

// Resolve a plan for a booking: explicit id (must belong to the property) else the default.
async function resolveForBooking(propertyId, ratePlanId) {
  if (ratePlanId) {
    const plan = await getRatePlan(propertyId, ratePlanId);
    if (plan) return plan;
  }
  return getDefaultRatePlan(propertyId);
}

function parseBody(body) {
  const out = {};
  if (body.code !== undefined) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return { error: 'code must be 1–10 letters/digits' };
    out.code = code;
  }
  if (body.name !== undefined) {
    if (!String(body.name || '').trim()) return { error: 'name is required' };
    out.name = String(body.name).trim();
  }
  for (const f of ['includes_breakfast', 'includes_lunch', 'includes_dinner', 'is_active', 'is_default']) {
    if (body[f] !== undefined) out[f] = !!body[f];
  }
  if (body.meal_price !== undefined) {
    const n = parseFloat(body.meal_price);
    if (!Number.isFinite(n) || n < 0) return { error: 'meal_price must be a non-negative number' };
    out.meal_price = n;
  }
  if (body.sort_order !== undefined) {
    const n = parseInt(body.sort_order, 10);
    if (!Number.isInteger(n)) return { error: 'sort_order must be an integer' };
    out.sort_order = n;
  }
  return { values: out };
}

async function createRatePlan(propertyId, body) {
  const parsed = parseBody(body);
  if (parsed.error) return { error: parsed.error };
  const v = parsed.values;
  if (!v.code || !v.name) return { error: 'code and name are required' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (v.is_default) {
      await client.query('UPDATE rate_plans SET is_default = false WHERE property_id = $1', [propertyId]);
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO rate_plans
         (property_id, code, name, includes_breakfast, includes_lunch, includes_dinner, meal_price, is_active, is_default, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [propertyId, v.code, v.name, !!v.includes_breakfast, !!v.includes_lunch, !!v.includes_dinner,
        v.meal_price || 0, v.is_active !== false, !!v.is_default, v.sort_order || 0]
    );
    await client.query('COMMIT');
    return { ratePlan: row };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return { error: 'A rate plan with this code already exists' };
    throw err;
  } finally {
    client.release();
  }
}

async function updateRatePlan(propertyId, id, body) {
  const parsed = parseBody(body);
  if (parsed.error) return { error: parsed.error };
  const v = parsed.values;
  if (!Object.keys(v).length) return { error: 'nothing to update' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (v.is_default === true) {
      await client.query('UPDATE rate_plans SET is_default = false WHERE property_id = $1 AND id <> $2', [propertyId, id]);
    }
    const sets = [];
    const vals = [];
    for (const [k, val] of Object.entries(v)) { vals.push(val); sets.push(`${k} = $${vals.length}`); }
    sets.push('updated_at = NOW()');
    vals.push(id, propertyId);
    const { rows: [row] } = await client.query(
      `UPDATE rate_plans SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND property_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!row) { await client.query('ROLLBACK'); return { error: 'Rate plan not found' }; }
    await client.query('COMMIT');
    return { ratePlan: row };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return { error: 'A rate plan with this code already exists' };
    throw err;
  } finally {
    client.release();
  }
}

// Soft delete — bookings hold an FK to rate_plans; never hard-delete.
async function deactivateRatePlan(propertyId, id) {
  const { rows: [row] } = await db.query(
    `UPDATE rate_plans SET is_active = false, is_default = false, updated_at = NOW()
     WHERE id = $1 AND property_id = $2 RETURNING *`,
    [id, propertyId]
  );
  if (!row) return { error: 'Rate plan not found' };
  return { ratePlan: row };
}

module.exports = {
  mealNetPerNight, listRatePlans, getRatePlan, getDefaultRatePlan, resolveForBooking,
  createRatePlan, updateRatePlan, deactivateRatePlan,
};
