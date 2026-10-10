const db = require('../db');
const { round2, computeFolioTotals } = require('./folioService');

// The full owner report for a period — the Reports page's sections and (later)
// its Excel / PDF exports. Built on routes/reports.js's getReport() and its
// SQL building blocks, so every figure matches the Dashboard, Daily Close,
// Weekly and Monthly reports. Sections:
//   revenue  — rooms, F&B (rate plan / breakfast in extras / restaurant & POS),
//              extras by category, activities by activity, complimentary
//   rooms    — occupancy, ADR, RevPAR, by room type, by rate plan, guests,
//              by nationality
//   channels — by booking source; agents — by agent / company (migration 084)
//   money    — received by method, service charge & tax, discounts, still
//              owed as of today (guests, agents)
//   bookings — reservations made / cancelled / no-shows in the period
//   costs    — Back Office expenses by category (→ net income)
// All revenue is NET (after discounts, before service charge and tax).

const EXTRA_CATEGORIES = {
  room_addon: 'Room add-ons', transport: 'Transport', laundry: 'Laundry',
  service: 'Services', merchandise: 'Merchandise', minibar: 'Minibar', other: 'Other',
};

const EXPENSE_CATEGORIES = {
  utilities: 'Utilities', laundry: 'Laundry', maintenance: 'Maintenance', staff: 'Staff',
  supplies: 'Supplies', marketing: 'Marketing', admin_fees: 'Admin & Bank Fees', other: 'Other',
};

const r2 = n => round2(parseFloat(n) || 0);

async function buildFullReport(propertyId, from, to) {
  const { getReport, NIGHTS_CTE, ADDON_NIGHTS_SQL, ACTIVITY_SQL, SALE_OFF_BILL_SQL } = require('../routes/reports');   // lazy: route file
  const { collected } = require('./dailyClose');
  const { aging } = require('./agentStatementService');
  const { bookingsMade } = require('./bookingPickup');
  const P = [from, to, propertyId];
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

  const notComp = `NOT (s.payment_method = 'room_charge' AND s.booking_id IN (SELECT id FROM bookings WHERE complimentary_scope = 'all'))`;
  const [
    base, { rows: extraLines }, { rows: addonCats }, { rows: activities }, { rows: settingsRows },
    { rows: typeUnits }, { rows: byType }, { rows: byPlan }, { rows: byNat }, { rows: [arrivals] }, { rows: bySource }, { rows: byAgent },
    { rows: [disc] }, received, { rows: owedGuests }, agents,
    pickup, { rows: [noShow] }, { rows: expenseCats },
  ] = await Promise.all([
    getReport(propertyId, from, to),
    // Hotel extras by category, on the day sold: the item part of every
    // non-F&B, non-per-night line (its breakfast part is F&B).
    db.query(`
      SELECT p.category, SUM(si.subtotal - si.meal_amount) AS amount, SUM(si.quantity) AS qty
      FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
      WHERE s.property_id = $3 AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date
        AND s.confirmation_status IS DISTINCT FROM 'rejected' AND ${notComp}
        AND NOT ${SALE_OFF_BILL_SQL}
        AND NOT si.per_night AND p.category NOT IN ('food', 'drinks')
      GROUP BY p.category`, P),
    // Per-night extras (extra bed) by category, night by night.
    db.query(`
      WITH x AS (${ADDON_NIGHTS_SQL})
      SELECT p.category, SUM(x.extra) AS amount, COUNT(*) AS qty
      FROM x JOIN products p ON p.id = x.product_id WHERE NOT x.comp GROUP BY p.category`, P),
    db.query(`
      WITH x AS (${ACTIVITY_SQL})
      SELECT name, tax_mode, comp, COUNT(*) AS bookings, SUM(num_participants) AS pax, SUM(net) AS net,
             SUM(CASE WHEN tax_mode = 'included' THEN sc_part ELSE 0 END) AS sc_included,
             SUM(CASE WHEN tax_mode = 'included' THEN tax_part ELSE 0 END) AS tax_included
      FROM x GROUP BY name, tax_mode, comp`, P),
    db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query(`
      SELECT COALESCE(rt.name, u.type, 'Other') AS room_type, MIN(COALESCE(rt.sort_order, 999)) AS sort,
             COUNT(*) FILTER (WHERE u.status <> 'out_of_order') AS sellable, COUNT(*) AS rooms
      FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
      WHERE u.property_id = $1 GROUP BY 1`, [propertyId]),
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(rt.name, u.type, 'Other') AS room_type,
             COUNT(*) AS nights, COUNT(*) FILTER (WHERE NOT n.comp) AS paid_nights,
             COALESCE(SUM(n.room_rev_per_night), 0) AS room_revenue
      FROM nights n JOIN units u ON u.id = n.unit_id LEFT JOIN room_types rt ON rt.id = u.room_type_id
      GROUP BY 1`, P),
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(rp.name, 'No rate plan') AS rate_plan, rp.code, MIN(COALESCE(rp.sort_order, 999)) AS sort,
             COUNT(*) AS nights, COUNT(*) FILTER (WHERE NOT n.comp) AS paid_nights, SUM(n.num_guests) AS guest_nights,
             COALESCE(SUM(n.room_rev_per_night), 0) AS room_revenue, COALESCE(SUM(n.fnb_rev_per_night), 0) AS meal_revenue
      FROM nights n LEFT JOIN rate_plans rp ON rp.id = n.rate_plan_id
      GROUP BY rp.name, rp.code`, P),
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(NULLIF(TRIM(g.nationality), ''), 'Not recorded') AS nationality,
             COUNT(DISTINCT n.booking_id) AS bookings, COUNT(*) AS room_nights, SUM(n.num_guests) AS guest_nights,
             COALESCE(SUM(n.room_rev_per_night + n.fnb_rev_per_night), 0) AS revenue
      FROM nights n JOIN guests g ON g.id = n.guest_id
      GROUP BY 1`, P),
    db.query(`
      SELECT COUNT(*) AS bookings, COALESCE(SUM(num_guests), 0) AS guests
      FROM bookings WHERE property_id = $3 AND status NOT IN ('cancelled', 'no_show')
        AND check_in_date BETWEEN $1::date AND $2::date`, P),
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(bs.label, n.source, 'Unspecified') AS source,
             COUNT(DISTINCT n.booking_id) AS bookings, COUNT(*) AS nights, COUNT(*) FILTER (WHERE NOT n.comp) AS paid_nights,
             COALESCE(SUM(n.room_rev_per_night), 0) AS room_revenue, COALESCE(SUM(n.fnb_rev_per_night), 0) AS meal_revenue
      FROM nights n LEFT JOIN booking_sources bs ON bs.id = n.source AND bs.property_id = $3
      GROUP BY 1`, P),
    // By agent (migration 084): stays in the period with an agent + the
    // commission posted in the period (at check-out, WITA day).
    db.query(`
      ${NIGHTS_CTE}
      SELECT a.id AS agent_id, a.name AS agent, a.agent_type,
             COUNT(DISTINCT n.booking_id) AS bookings, COUNT(*) AS nights, COUNT(*) FILTER (WHERE NOT n.comp) AS paid_nights,
             COALESCE(SUM(n.room_rev_per_night), 0) AS room_revenue, COALESCE(SUM(n.fnb_rev_per_night), 0) AS meal_revenue,
             (SELECT COALESCE(SUM(ac.amount), 0) FROM agent_commissions ac
               WHERE ac.agent_id = a.id AND ac.property_id = $3
                 AND (ac.computed_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date) AS commission
      FROM nights n JOIN bookings b ON b.id = n.booking_id JOIN agents a ON a.id = b.agent_id
      GROUP BY a.id, a.name, a.agent_type`, P),
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(SUM(discount_per_night), 0) AS amount,
             COUNT(DISTINCT booking_id) FILTER (WHERE discount_per_night > 0) AS bookings
      FROM nights`, P),
    collected(propertyId, from, to),
    // Still owed as of today (not tied to the period): guests' deposit /
    // balance lines not received yet, split by where the stay is.
    // A group billed as a whole (migration 097) has no lines: what it still
    // owes for its rooms (rooms' prices − group payments), counted as one.
    db.query(`
      WITH owed AS (
        SELECT CASE WHEN b.status = 'checked_out' THEN 'checked_out'
                    WHEN b.status = 'checked_in' THEN 'in_house' ELSE 'upcoming' END AS stage,
               b.id::text AS ref, p.amount
        FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE b.property_id = $1 AND p.status = 'pending' AND p.amount > 0
          AND b.status NOT IN ('cancelled', 'no_show') AND b.folio_status IS NULL
        UNION ALL
        SELECT CASE WHEN bool_and(b.status = 'checked_out') THEN 'checked_out'
                    WHEN bool_or(b.status IN ('checked_in', 'checked_out')) THEN 'in_house' ELSE 'upcoming' END,
               rg.id::text,
               SUM(b.total_amount - COALESCE(b.discount_amount, 0))
                 - COALESCE((SELECT SUM(gp.amount) FROM group_payments gp WHERE gp.group_id = rg.id AND NOT gp.is_voided), 0)
        FROM reservation_groups rg JOIN bookings b ON b.reservation_group_id = rg.id
        WHERE rg.property_id = $1 AND rg.group_billing AND b.status NOT IN ('cancelled', 'no_show')
        GROUP BY rg.id
      )
      SELECT stage, COUNT(DISTINCT ref) AS bookings, COALESCE(SUM(amount), 0) AS amount
      FROM owed WHERE amount >= 1 GROUP BY 1`, [propertyId]),
    aging(propertyId),
    // Reservations made / cancelled in the period (by the day it happened) —
    // the Dashboard's and Daily Close's definition.
    bookingsMade(propertyId, from, to),
    // No-shows: due in during the period and never arrived (Daily Close rule).
    db.query(`
      SELECT COUNT(DISTINCT COALESCE(b.reservation_group_id, b.id)) AS bookings, COUNT(*) AS rooms,
             COALESCE(SUM(b.nights), 0) AS nights,
             COALESCE(SUM(COALESCE(b.room_revenue + b.fnb_revenue, b.total_amount - COALESCE(b.discount_amount, 0))), 0) AS value
      FROM bookings b WHERE b.property_id = $3 AND b.status = 'no_show'
        AND b.check_in_date BETWEEN $1::date AND $2::date`, P),
    // Costs by expense category (same rule as the Expenses total).
    db.query(`
      SELECT category, COUNT(*) AS entries, SUM(amount) AS amount
      FROM expenses WHERE property_id = $3 AND is_voided = false
        AND incurred_on BETWEEN $1::date AND $2::date
      GROUP BY category`, P),
  ]);

  // ── Revenue ──
  const catMap = new Map();
  for (const r of [...extraLines, ...addonCats]) {
    const key = EXTRA_CATEGORIES[r.category] ? r.category : 'other';
    const cur = catMap.get(key) || { category: key, label: EXTRA_CATEGORIES[key], amount: 0, qty: 0 };
    cur.amount += parseFloat(r.amount) || 0; cur.qty += parseInt(r.qty) || 0;
    catMap.set(key, cur);
  }
  // Anything not itemised (older sales with no lines) → Other, so the
  // categories always add up to the Extras total.
  const listed = [...catMap.values()].reduce((sum, c) => sum + c.amount, 0);
  if (base.ancillary_revenue - listed > 0.5) {
    const o = catMap.get('other') || { category: 'other', label: 'Other', amount: 0, qty: 0 };
    o.amount += base.ancillary_revenue - listed; catMap.set('other', o);
  }
  const extrasByCategory = [...catMap.values()].filter(c => Math.abs(c.amount) > 0.004)
    .map(c => ({ ...c, amount: r2(c.amount) })).sort((a, b) => b.amount - a.amount);

  const actMap = new Map();
  let actSc = 0, actTax = 0, actAddedNet = 0;
  for (const a of activities) {
    if (a.comp) continue;
    const cur = actMap.get(a.name) || { name: a.name, bookings: 0, pax: 0, amount: 0 };
    cur.bookings += parseInt(a.bookings); cur.pax += parseInt(a.pax) || 0; cur.amount += parseFloat(a.net);
    actMap.set(a.name, cur);
    if (a.tax_mode === 'added') actAddedNet += parseFloat(a.net);
    actSc += parseFloat(a.sc_included); actTax += parseFloat(a.tax_included);
  }
  const activitiesByName = [...actMap.values()].map(a => ({ ...a, amount: r2(a.amount) })).sort((a, b) => b.amount - a.amount);

  const revenue = {
    room: r2(base.room_revenue),
    fnb: { total: r2(base.fnb_revenue), ...base.fnb_breakdown },
    extras: { total: r2(base.ancillary_revenue), by_category: extrasByCategory },
    activities: { total: r2(base.activity_revenue), bookings: base.activity_count, by_activity: activitiesByName },
    total: r2(base.total_revenue),
    complimentary: { nights: base.comp_nights, value: r2(base.comp_value) },
  };

  // ── Rooms ──
  const sellable = typeUnits.reduce((s, t) => s + parseInt(t.sellable), 0);
  const available = sellable * days;
  const typeByName = new Map(byType.map(t => [t.room_type, t]));
  const roomTypes = typeUnits.map(t => {
    const x = typeByName.get(t.room_type) || { nights: 0, paid_nights: 0, room_revenue: 0 };
    const avail = parseInt(t.sellable) * days;
    const nights = parseInt(x.nights);
    return {
      room_type: t.room_type, rooms: parseInt(t.rooms), sellable: parseInt(t.sellable), sort: parseInt(t.sort),
      nights, available: avail, occupancy: avail ? Math.round((nights / avail) * 1000) / 10 : 0,
      revenue: r2(x.room_revenue), adr: parseInt(x.paid_nights) ? r2(x.room_revenue / x.paid_nights) : 0,
      revpar: avail ? r2(x.room_revenue / avail) : 0,
    };
  }).sort((a, b) => a.sort - b.sort || a.room_type.localeCompare(b.room_type));
  // A booking on a room whose type no longer exists still shows.
  for (const t of byType) if (!typeUnits.some(u => u.room_type === t.room_type)) {
    roomTypes.push({ room_type: t.room_type, rooms: 0, sellable: 0, nights: parseInt(t.nights), available: 0, occupancy: 0,
      revenue: r2(t.room_revenue), adr: parseInt(t.paid_nights) ? r2(t.room_revenue / t.paid_nights) : 0, revpar: 0 });
  }
  const guestNights = byPlan.reduce((s, p) => s + (parseInt(p.guest_nights) || 0), 0);
  const nat = byNat.map(n => ({ nationality: n.nationality, bookings: parseInt(n.bookings), room_nights: parseInt(n.room_nights),
    guest_nights: parseInt(n.guest_nights) || 0, revenue: r2(n.revenue) })).sort((a, b) => b.guest_nights - a.guest_nights);
  const rooms = {
    sellable_rooms: sellable, days, available_nights: available,
    nights_sold: base.total_nights, paid_nights: base.paid_nights, comp_nights: base.comp_nights,
    occupancy: available ? Math.round((base.total_nights / available) * 1000) / 10 : 0,
    adr: base.paid_nights ? r2(base.room_revenue / base.paid_nights) : 0,
    revpar: available ? r2(base.room_revenue / available) : 0,
    guest_nights: guestNights,
    arrivals: { bookings: parseInt(arrivals.bookings), guests: parseInt(arrivals.guests) },
    by_room_type: roomTypes,
    by_rate_plan: byPlan.map(p => ({ rate_plan: p.rate_plan, code: p.code, nights: parseInt(p.nights), guest_nights: parseInt(p.guest_nights) || 0,
      room_revenue: r2(p.room_revenue), meal_revenue: r2(p.meal_revenue),
      adr: parseInt(p.paid_nights) ? r2(p.room_revenue / p.paid_nights) : 0, sort: parseInt(p.sort) }))
      .sort((a, b) => a.sort - b.sort || b.nights - a.nights),
    by_nationality: nat,
  };

  // ── Channels ──
  const stayTotal = bySource.reduce((s, r) => s + parseFloat(r.room_revenue) + parseFloat(r.meal_revenue), 0);
  const channels = bySource.map(r => {
    const rev = parseFloat(r.room_revenue) + parseFloat(r.meal_revenue);
    return { source: r.source, bookings: parseInt(r.bookings), nights: parseInt(r.nights), revenue: r2(rev),
      room_revenue: r2(r.room_revenue), adr: parseInt(r.paid_nights) ? r2(r.room_revenue / r.paid_nights) : 0,
      share: stayTotal ? Math.round((rev / stayTotal) * 1000) / 10 : 0 };
  }).sort((a, b) => b.revenue - a.revenue);
  // Agents (084): share of all stay revenue (room + rate-plan meals), like channels.
  const agents_rows = byAgent.map(r => {
    const rev = parseFloat(r.room_revenue) + parseFloat(r.meal_revenue);
    return { agent: r.agent, agent_id: r.agent_id, agent_type: r.agent_type, bookings: parseInt(r.bookings), nights: parseInt(r.nights),
      revenue: r2(rev), adr: parseInt(r.paid_nights) ? r2(r.room_revenue / r.paid_nights) : 0,
      commission: r2(r.commission), share: stayTotal ? Math.round((rev / stayTotal) * 1000) / 10 : 0 };
  }).sort((a, b) => b.revenue - a.revenue);

  // ── Money ──
  // Service charge + tax on this period's revenue, at today's rates: every
  // net line the folio taxes (rooms, F&B, extras, activities priced before
  // tax) + the parts inside tax-included activities. An estimate — a rate
  // changed mid-period isn't re-applied, and extras paid directly were
  // taxed at the rate of their sale day.
  const ps = settingsRows[0] || {};
  const taxableNet = base.room_revenue + base.fnb_revenue + base.ancillary_revenue + actAddedNet;
  const t = computeFolioTotals(taxableNet, ps.tax_rate, ps.service_charge_rate);
  const pendingBy = Object.fromEntries(owedGuests.map(g => [g.stage, { bookings: parseInt(g.bookings), amount: r2(g.amount) }]));
  const agentRows = agents.filter(a => a.total_outstanding > 0.004 || a.unpaid_commission > 0.004)
    .map(a => ({ agent: a.source_label, open_bookings: a.open_count, outstanding: a.total_outstanding,
      current: a.current, overdue: r2(a.d1_30 + a.d31_60 + a.d61_90 + a.d90_plus), over_60: r2(a.d61_90 + a.d90_plus),
      unpaid_commission: a.unpaid_commission }))
    .sort((a, b) => b.outstanding - a.outstanding);
  const money = {
    received: { total: r2(received.total), by_method: received.by_method.map(m => ({ ...m, amount: r2(m.amount) })) },
    service_tax: {
      service_charge_rate: parseFloat(ps.service_charge_rate) || 0, tax_rate: parseFloat(ps.tax_rate) || 0,
      taxable_revenue: r2(taxableNet),
      service_charge: r2(t.service_charge_amount + actSc), tax: r2(t.tax_amount + actTax),
      included_in_activities: { service_charge: r2(actSc), tax: r2(actTax) },
    },
    discounts: { amount: r2(disc.amount), bookings: parseInt(disc.bookings) },
    owed_now: {
      guests: {
        checked_out: pendingBy.checked_out || { bookings: 0, amount: 0 },
        in_house: pendingBy.in_house || { bookings: 0, amount: 0 },
        upcoming: pendingBy.upcoming || { bookings: 0, amount: 0 },
      },
      agents: {
        total: r2(agentRows.reduce((s, a) => s + a.outstanding, 0)),
        overdue: r2(agentRows.reduce((s, a) => s + a.overdue, 0)),
        rows: agentRows,
      },
    },
  };

  // ── Reservations activity ──
  const pick = x => ({ bookings: x.bookings, rooms: x.rooms, nights: x.nights, value: r2(x.value) });
  const bookings = {
    made: pick(pickup.made),
    cancelled: pick(pickup.cancelled),
    no_shows: { bookings: parseInt(noShow.bookings), rooms: parseInt(noShow.rooms), nights: parseInt(noShow.nights), value: r2(noShow.value) },
  };

  // ── Costs (Back Office expenses) ──
  const expTotal = r2(base.expenses_total);
  const costs = {
    total: expTotal,
    by_category: expenseCats.map(c => ({
      category: c.category, label: EXPENSE_CATEGORIES[c.category] || c.category,
      entries: parseInt(c.entries), amount: r2(c.amount),
      share: expTotal > 0 ? r2(parseFloat(c.amount) / expTotal * 100) : 0,
    })).sort((a, b) => b.amount - a.amount),
  };

  return {
    from, to, days,
    revenue, rooms, channels, agents: agents_rows, money, bookings, costs,
    daily: base.daily_revenue,
    expenses_total: base.expenses_total, net_income: base.net_income,
  };
}

// Row-level detail for the Excel export (not the page — it can be thousands
// of rows): one row per room per night, and one row per reservation with a
// night in the period. Same booking rule and per-night money as the report
// (NIGHTS_CTE), so the night rows add up to the Rooms / meals totals.
const bookingRef = id => String(id).slice(0, 8).toUpperCase();

async function buildDetailRows(propertyId, from, to) {
  const { NIGHTS_CTE } = require('../routes/reports');
  const P = [from, to, propertyId];
  const [{ rows: nights }, { rows: reservations }] = await Promise.all([
    db.query(`
      ${NIGHTS_CTE}
      SELECT to_char(n.night, 'YYYY-MM-DD') AS night, n.booking_id, u.name AS room, COALESCE(rt.name, u.type) AS room_type,
             g.name AS guest, NULLIF(TRIM(g.nationality), '') AS nationality,
             COALESCE(bs.label, n.source) AS source, rp.name AS rate_plan, n.num_guests, b.status,
             n.room_rev_per_night AS room_revenue, n.fnb_rev_per_night AS meal_revenue, n.comp,
             COALESCE(ad.units, 0) AS extra_units, COALESCE(ad.amount, 0) AS extra_amount, ad.items AS extra_items
      FROM nights n
      JOIN bookings b ON b.id = n.booking_id
      JOIN units u ON u.id = n.unit_id
      LEFT JOIN room_types rt ON rt.id = u.room_type_id
      JOIN guests g ON g.id = n.guest_id
      LEFT JOIN booking_sources bs ON bs.id = n.source AND bs.property_id = $3
      LEFT JOIN rate_plans rp ON rp.id = n.rate_plan_id
      LEFT JOIN LATERAL (
        SELECT SUM(a.quantity) AS units, SUM(a.quantity * a.unit_price) AS amount, string_agg(DISTINCT a.description, ', ') AS items
        FROM booking_addons a WHERE a.booking_id = n.booking_id AND a.service_date = n.night AND a.status = 'active'
      ) ad ON true
      ORDER BY n.night, u.name`, P),
    db.query(`
      SELECT b.id, g.name AS guest, NULLIF(TRIM(g.nationality), '') AS nationality, u.name AS room, COALESCE(rt.name, u.type) AS room_type,
             to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in, to_char(b.check_out_date, 'YYYY-MM-DD') AS check_out, b.nights,
             (LEAST(b.check_out_date, $2::date + 1) - GREATEST(b.check_in_date, $1::date)) AS nights_in_period,
             b.num_guests, COALESCE(bs.label, b.source) AS source, rp.name AS rate_plan, b.status,
             b.total_amount, COALESCE(b.discount_amount, 0) AS discount, COALESCE(b.room_revenue, b.total_amount) AS room_revenue,
             COALESCE(b.fnb_revenue, 0) AS meal_revenue, b.complimentary_scope,
             to_char((b.created_at AT TIME ZONE 'Asia/Makassar')::date, 'YYYY-MM-DD') AS booked_on,
             pg.name AS group_booker, b.folio_status,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'received' AND p.type IN ('deposit', 'balance')), 0) AS paid,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'pending' AND p.type IN ('deposit', 'balance')), 0) AS pending
      FROM bookings b
      JOIN guests g ON g.id = b.guest_id
      JOIN units u ON u.id = b.unit_id
      LEFT JOIN room_types rt ON rt.id = u.room_type_id
      LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
      LEFT JOIN guests pg ON pg.id = rg.primary_guest_id
      WHERE b.property_id = $3 AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date <= $2::date AND b.check_out_date > $1::date
      ORDER BY b.check_in_date, u.name`, P),
  ]);
  return {
    room_nights: nights.map(n => ({
      date: n.night, ref: bookingRef(n.booking_id), room: n.room, room_type: n.room_type, guest: n.guest, nationality: n.nationality,
      source: n.source, rate_plan: n.rate_plan, guests: parseInt(n.num_guests) || 0, status: n.status,
      room_revenue: r2(n.room_revenue), meal_revenue: r2(n.meal_revenue),
      extra_bed: parseInt(n.extra_units) ? `${n.extra_units} × ${n.extra_items}` : '', extra_amount: r2(n.extra_amount),
      complimentary: n.comp ? 'Yes' : '',
    })),
    reservations: reservations.map(b => ({
      ref: bookingRef(b.id), guest: b.guest, nationality: b.nationality, room: b.room, room_type: b.room_type,
      check_in: b.check_in, check_out: b.check_out, nights: parseInt(b.nights), nights_in_period: parseInt(b.nights_in_period),
      guests: parseInt(b.num_guests) || 0, source: b.source, rate_plan: b.rate_plan, status: b.status,
      price: r2(b.total_amount), discount: r2(b.discount), room_revenue: r2(b.room_revenue), meal_revenue: r2(b.meal_revenue),
      paid: r2(b.paid), pending: r2(b.pending),
      billing: b.complimentary_scope ? 'Complimentary' : b.folio_status ? 'Agent billed' : '',
      group: b.group_booker || '', booked_on: b.booked_on,
    })),
  };
}

module.exports = { buildFullReport, buildDetailRows, EXTRA_CATEGORIES };
