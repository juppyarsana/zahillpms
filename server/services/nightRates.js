// A price per night (migration 090). bookings.room_revenue is still the room's
// NET total for the stay; booking_night_rates says how it is shared between
// the nights. The rows are used as WEIGHTS, and only when there is exactly one
// per night of the stay — so anything that changes the total without touching
// them (discount, room change, tax-rate change, complimentary) keeps the same
// proportions, and anything that changes the dates falls back to the even
// split. Meals (fnb_revenue) are always spread evenly.
//
// One rule, two forms: roomNightAmounts() for the folio (night audit, checkout
// catch-up, pro forma) and roomRevPerNightSql() for the reports.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
const ymd = d => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

// Map 'YYYY-MM-DD' -> net room amount. `q` is db or a transaction client.
async function loadNightRates(q, bookingId) {
  const { rows } = await q.query(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night, room_net FROM booking_night_rates WHERE booking_id = $1`, [bookingId]);
  return new Map(rows.map(r => [r.night, parseFloat(r.room_net)]));
}

// True when the rows cover the stay's nights exactly.
function ratesApply(nights, rates) {
  if (!rates || !nights.length || rates.size !== nights.length) return false;
  let sum = 0;
  for (const n of nights) {
    if (!rates.has(n)) return false;
    sum += rates.get(n);
  }
  return sum > 0;
}

// The room's NET amount for each night of `nights` (the whole stay, in
// order), adding up exactly to roomTotal: by the night rates when they apply,
// else evenly. The last night takes the rounding cent, as before.
function roomNightAmounts(roomTotal, nights, rates) {
  const total = round2(parseFloat(roomTotal) || 0);
  const n = nights.length;
  if (!n) return [];
  if (total === 0) return nights.map(() => 0);
  let parts;
  if (ratesApply(nights, rates)) {
    const sum = nights.reduce((s, d) => s + rates.get(d), 0);
    parts = nights.map(d => round2(total * rates.get(d) / sum));
  } else {
    parts = nights.map(() => round2(total / n));
  }
  parts[n - 1] = round2(total - parts.slice(0, n - 1).reduce((s, v) => s + v, 0));
  return parts;
}

// SQL for one night's share of a booking's room revenue. `b` = the bookings
// alias, `nightExpr` = the night (a date expression).
function roomRevPerNightSql(b, nightExpr) {
  return `(COALESCE(${b}.room_revenue, ${b}.total_amount) * CASE
    WHEN COALESCE((SELECT COUNT(*) = ${b}.nights AND MIN(r.night) = ${b}.check_in_date
                          AND MAX(r.night) = ${b}.check_out_date - 1 AND SUM(r.room_net) > 0
                     FROM booking_night_rates r WHERE r.booking_id = ${b}.id), false)
    THEN (SELECT r.room_net FROM booking_night_rates r WHERE r.booking_id = ${b}.id AND r.night = (${nightExpr})::date)
         / (SELECT SUM(r.room_net) FROM booking_night_rates r WHERE r.booking_id = ${b}.id)
    ELSE 1.0 / NULLIF(${b}.nights, 0) END)`;
}

// Replace a booking's night rates. `shares` = one fraction of the stay's
// price per night (adding up to 1), or null to go back to the even split.
// Each night's room part = its share of (room + meals) minus that night's
// meals — the meal plan costs the same every night.
// Returns { error } when a night would be below its meals.
async function saveNightRates(client, { bookingId, nights, shares, roomNet, mealNet }) {
  await client.query('DELETE FROM booking_night_rates WHERE booking_id = $1', [bookingId]);
  if (!shares) return { saved: false };
  const n = nights.length;
  const mealPer = (parseFloat(mealNet) || 0) / n;
  const stay = (parseFloat(roomNet) || 0) + (parseFloat(mealNet) || 0);
  const parts = shares.map(s => round2(stay * s - mealPer));
  if (parts.some(p => p < -0.005)) return { error: 'NIGHT_BELOW_MEALS' };
  // Same every night (within a rupiah) → nothing to store.
  if (Math.max(...parts) - Math.min(...parts) < 1) return { saved: false };
  parts[n - 1] = round2(Math.max(0, (parseFloat(roomNet) || 0) - parts.slice(0, n - 1).reduce((s, v) => s + v, 0)));
  for (let i = 0; i < n; i++) {
    await client.query('INSERT INTO booking_night_rates (booking_id, night, room_net) VALUES ($1, $2, $3)',
      [bookingId, nights[i], Math.max(0, parts[i])]);
  }
  return { saved: true };
}

// For the booking page: each night's price as entered (its share of
// total_amount — tax included, before discount), or [] when the stay is
// priced the same every night.
function nightPrices(booking, nights, rates) {
  if (!ratesApply(nights, rates)) return [];
  const room = roomNightAmounts(booking.room_revenue ?? booking.total_amount, nights, rates);
  const mealPer = (parseFloat(booking.fnb_revenue) || 0) / nights.length;
  const stay = room.reduce((s, v) => s + v, 0) + mealPer * nights.length;
  const total = parseFloat(booking.total_amount) || 0;
  if (!(stay > 0)) return [];
  const out = nights.map((d, i) => ({ date: d, price: Math.round(total * (room[i] + mealPer) / stay) }));
  out[out.length - 1].price = Math.round(total - out.slice(0, -1).reduce((s, v) => s + v.price, 0));
  return out;
}

// night_prices from a request ([{ date, amount }] — each night's price, tax
// included, before discount) checked against the stay's nights.
// → null (none sent) | { error, code } | { total, shares (null when total 0), byDate }
function parseNightPrices(input, nights) {
  if (!Array.isArray(input) || !input.length) return null;
  if (input.some(n => !Number.isFinite(parseFloat(n?.amount)) || parseFloat(n.amount) < 0)) {
    return { error: 'Each night needs a price of 0 or more', code: 'NIGHT_PRICE_INVALID' };
  }
  const byDate = new Map(input.map(n => [String(n.date || '').slice(0, 10), parseFloat(n.amount)]));
  if (byDate.size !== nights.length || nights.some(d => !byDate.has(d))) {
    return { error: 'Give one price for each night of the stay', code: 'NIGHTS_MISMATCH' };
  }
  const total = round2(nights.reduce((s, d) => s + byDate.get(d), 0));
  return { total, byDate, shares: total > 0 ? nights.map(d => byDate.get(d) / total) : null };
}

// A stay's night prices carried onto new dates: a night that stays keeps its
// own price, a night that is added takes the average of the old ones.
// `prices` = nightPrices() of the stay before the change ([] → null: the stay
// was priced the same every night, nothing to carry).
// → { weights: [per new night], sum } in the same money as `prices`.
function carryPrices(prices, newNights) {
  if (!prices || !prices.length || !newNights.length) return null;
  const old = new Map(prices.map(p => [p.date, p.price]));
  const avg = prices.reduce((s, p) => s + p.price, 0) / prices.length;
  const weights = newNights.map(d => (old.has(d) ? old.get(d) : avg));
  const sum = weights.reduce((s, v) => s + v, 0);
  return sum > 0 ? { weights, sum, shares: weights.map(w => w / sum), oldSum: prices.reduce((s, p) => s + p.price, 0) } : null;
}

module.exports = { parseNightPrices, carryPrices, ymd, loadNightRates, ratesApply, roomNightAmounts, roomRevPerNightSql, saveNightRates, nightPrices };
