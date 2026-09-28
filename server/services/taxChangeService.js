const db = require('../db');
const { computeFolioTotals, round2 } = require('./folioService');
const { factor } = require('./priceBasis');
const roomCharge = require('./roomChargeService');

// Changing a property's service charge / tax rates (and "prices include
// service & tax", migration 079) — PUT /api/settings/tax.
//
// Everything is stored NET and the folio adds service + tax at the CURRENT
// rates. So when the rates change, every booking still open would suddenly
// cost the guest a different amount (e.g. 0% → 10% + 11%: +22% on a price
// already agreed). To keep each guest's price exactly as agreed, open
// bookings are re-split at the new rates: every NET amount × k, where
// k = old factor ÷ new factor, so NET × new factor = the same guest price.
//
// Re-split ("open"): bookings pending / deposit paid / confirmed / checked in
// that aren't on an agent invoice yet, and on each of them: room + meal
// revenue (folio nights re-posted), the room's extras (sale lines, per-night
// extras, their folio lines, stored service/tax of ones paid directly) and
// activities priced "added on top". Payments are never changed.
// Left alone: checked-out / cancelled / no-show stays (their bill is final),
// stays on an agent invoice (the invoice is issued), walk-in sales, and
// all-in / no-tax activities (they don't depend on the rates).
// Only the SPLIT changes — each change is noted in the booking's Edit History.

const OPEN_STATUSES = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
const pct = n => `${parseFloat(n) || 0}%`;

async function openBookings(client, propertyId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM bookings WHERE property_id = $1 AND status = ANY($2)
       AND COALESCE(folio_status, '') NOT IN ('invoiced', 'paid')
     ORDER BY check_in_date ${lock ? 'FOR UPDATE' : ''}`,
    [propertyId, OPEN_STATUSES]
  );
  return rows;
}

// What a change would touch — for the confirm step on the Settings page.
async function preview(propertyId, next) {
  const { rows: [cur] } = await db.query(
    'SELECT tax_rate, service_charge_rate, prices_include_tax FROM property_settings WHERE property_id = $1', [propertyId]);
  const oldF = factor(cur?.tax_rate, cur?.service_charge_rate);
  const newF = factor(next.tax_rate ?? cur?.tax_rate, next.service_charge_rate ?? cur?.service_charge_rate);
  const ratesChange = Math.abs(oldF - newF) > 1e-9;
  let bookings = 0, extras = 0, activities = 0, agentInvoiced = 0;
  if (ratesChange) {
    const open = await openBookings(db, propertyId);
    bookings = open.length;
    const ids = open.map(b => b.id);
    const [{ rows: [e] }, { rows: [a] }, { rows: [ag] }] = await Promise.all([
      db.query(`SELECT COUNT(*) AS n FROM sales WHERE booking_id = ANY($1) AND confirmation_status IS DISTINCT FROM 'rejected'`, [ids]),
      db.query(`SELECT COUNT(*) AS n FROM activity_bookings WHERE booking_id = ANY($1) AND COALESCE(tax_mode, 'added') = 'added'
                  AND status NOT IN ('cancelled', 'no_show')`, [ids]),
      db.query(`SELECT COUNT(*) AS n FROM bookings WHERE property_id = $1 AND status = ANY($2) AND folio_status IN ('invoiced', 'paid')`,
        [propertyId, OPEN_STATUSES]),
    ]);
    extras = parseInt(e.n); activities = parseInt(a.n); agentInvoiced = parseInt(ag.n);
  }
  return {
    current: { tax_rate: parseFloat(cur?.tax_rate) || 0, service_charge_rate: parseFloat(cur?.service_charge_rate) || 0, prices_include_tax: !!cur?.prices_include_tax },
    rates_change: ratesChange,
    bookings, extras, activities, agent_invoiced: agentInvoiced,
  };
}

// NET room / meal amounts at the new rates that total exactly `target`
// (the guest's price at the old rates): both × k, then the rounding cent
// nudged onto the larger part.
function resplit(room, meal, k, target, newRates) {
  let r = round2(room * k), m = round2(meal * k);
  const total = () => computeFolioTotals(r + m, newRates.tax_rate, newRates.service_charge_rate).total;
  for (let i = 0; i < 8; i++) {
    const diff = round2(target - total());
    if (Math.abs(diff) < 0.005) break;
    const step = diff > 0 ? 0.01 : -0.01;
    if (r >= m && r + step >= 0) r = round2(r + step); else if (m + step >= 0) m = round2(m + step); else break;
  }
  return { room: r, meal: m };
}

async function apply(propertyId, next, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [cur] } = await client.query(
      'SELECT tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown FROM property_settings WHERE property_id = $1 FOR UPDATE', [propertyId]);
    if (!cur) { await client.query('ROLLBACK'); return { status: 404, error: 'Property settings not found' }; }
    const oldRates = { tax_rate: parseFloat(cur.tax_rate) || 0, service_charge_rate: parseFloat(cur.service_charge_rate) || 0 };
    const newRates = {
      tax_rate: next.tax_rate ?? oldRates.tax_rate,
      service_charge_rate: next.service_charge_rate ?? oldRates.service_charge_rate,
    };
    const include = next.prices_include_tax ?? cur.prices_include_tax;
    const showBreakdown = next.show_tax_breakdown ?? cur.show_tax_breakdown;
    await client.query(
      'UPDATE property_settings SET tax_rate = $1, service_charge_rate = $2, prices_include_tax = $3, show_tax_breakdown = $4 WHERE property_id = $5',
      [newRates.tax_rate, newRates.service_charge_rate, !!include, !!showBreakdown, propertyId]);

    const oldF = factor(oldRates.tax_rate, oldRates.service_charge_rate);
    const newF = factor(newRates.tax_rate, newRates.service_charge_rate);
    const result = { bookings: 0, extras: 0, activities: 0 };
    if (Math.abs(oldF - newF) > 1e-9) {
      const k = oldF / newF;
      const scaled = v => (v == null ? v : round2(parseFloat(v) * k));
      const note = `Service charge / tax changed from ${pct(oldRates.service_charge_rate)} / ${pct(oldRates.tax_rate)} to ${pct(newRates.service_charge_rate)} / ${pct(newRates.tax_rate)} — the guest's price stays the same; the amounts inside it were re-split at the new rates.`;

      for (const b of await openBookings(client, propertyId, { lock: true })) {
        // Room + meals
        const room = parseFloat(b.room_revenue ?? 0), meal = parseFloat(b.fnb_revenue ?? 0);
        if (room + meal > 0) {
          const target = computeFolioTotals(room + meal, oldRates.tax_rate, oldRates.service_charge_rate).total;
          const s = resplit(room, meal, k, target, newRates);
          const { rows: [after] } = await client.query(
            `UPDATE bookings SET room_revenue = $1, fnb_revenue = $2,
                    complimentary_night_value = $3, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [s.room, s.meal, scaled(b.complimentary_night_value), b.id]);
          await roomCharge.repostStay(client, after, userId);
        }

        // Extras charged to / paid on this stay
        const { rows: sales } = await client.query(
          `SELECT id, total_amount, service_charge_amount, tax_amount, shown_total FROM sales
           WHERE booking_id = $1 AND confirmation_status IS DISTINCT FROM 'rejected' FOR UPDATE`, [b.id]);
        for (const s of sales) {
          const { rowCount: lines } = await client.query(
            `UPDATE sale_items SET unit_price = ROUND(unit_price * $1, 2), subtotal = ROUND(subtotal * $1, 2),
                    meal_amount = ROUND(meal_amount * $1, 2) WHERE sale_id = $2`, [k, s.id]);
          const { rows: [t] } = await client.query(
            lines ? 'SELECT COALESCE(SUM(subtotal), 0) AS total FROM sale_items WHERE sale_id = $1'
                  : 'SELECT ROUND(total_amount * $2, 2) AS total FROM sales WHERE id = $1',
            lines ? [s.id] : [s.id, k]);
          const total = round2(parseFloat(t.total));
          // Paid directly: its stored service + tax at the new rates.
          const taxes = s.service_charge_amount != null ? computeFolioTotals(total, newRates.tax_rate, newRates.service_charge_rate) : null;
          // Prices now incl. tax: Sales History shows the price the guest
          // agreed (the old all-in total), not the re-split net.
          const oldGross = s.service_charge_amount != null
            ? round2(parseFloat(s.total_amount) + parseFloat(s.service_charge_amount) + parseFloat(s.tax_amount || 0))
            : computeFolioTotals(parseFloat(s.total_amount), oldRates.tax_rate, oldRates.service_charge_rate).total;
          const shownTotal = include ? (s.shown_total != null ? s.shown_total : oldGross) : s.shown_total;
          await client.query(
            'UPDATE sales SET total_amount = $1, service_charge_amount = $2, tax_amount = $3, shown_total = $4 WHERE id = $5',
            [total, taxes ? taxes.service_charge_amount : null, taxes ? taxes.tax_amount : null, shownTotal, s.id]);
          result.extras++;
        }
        await client.query(
          'UPDATE booking_addons SET unit_price = ROUND(unit_price * $1, 2), meal_price = ROUND(meal_price * $1, 2) WHERE booking_id = $2',
          [k, b.id]);

        // Activities priced "added on top"
        const { rows: acts } = await client.query(
          `SELECT id, total_amount, service_charge_amount FROM activity_bookings
           WHERE booking_id = $1 AND COALESCE(tax_mode, 'added') = 'added' AND status NOT IN ('cancelled', 'no_show') FOR UPDATE`, [b.id]);
        for (const a of acts) {
          const total = scaled(a.total_amount);
          const taxes = a.service_charge_amount != null ? computeFolioTotals(total, newRates.tax_rate, newRates.service_charge_rate) : null;
          await client.query(
            `UPDATE activity_bookings SET total_amount = $1, unit_price = ROUND(unit_price * $2, 2),
                    service_charge_amount = COALESCE($3, service_charge_amount), tax_amount = COALESCE($4, tax_amount) WHERE id = $5`,
            [total, k, taxes ? taxes.service_charge_amount : null, taxes ? taxes.tax_amount : null, a.id]);
          result.activities++;
        }

        // Their folio lines (room / meal nights were re-posted above)
        await client.query(
          `UPDATE folio_charges SET amount = ROUND(amount * $1, 2), unit_price = ROUND(unit_price * $1, 2)
           WHERE booking_id = $2 AND is_voided = false AND type NOT IN ('room', 'fnb')
             AND COALESCE(tax_mode, 'added') = 'added'`, [k, b.id]);

        await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [b.id, note, userId || null]);
        result.bookings++;
      }
    }
    await client.query('COMMIT');
    return { ok: true, ...result, tax_rate: newRates.tax_rate, service_charge_rate: newRates.service_charge_rate, prices_include_tax: !!include, show_tax_breakdown: !!showBreakdown };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { preview, apply };
