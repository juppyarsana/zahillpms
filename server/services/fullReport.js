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
//   channels — by booking source
//   money    — received by method, service charge & tax, discounts, still
//              owed as of today (guests, agents)
// All revenue is NET (after discounts, before service charge and tax).

const EXTRA_CATEGORIES = {
  room_addon: 'Room add-ons', transport: 'Transport', laundry: 'Laundry',
  service: 'Services', merchandise: 'Merchandise', other: 'Other',
};

const r2 = n => round2(parseFloat(n) || 0);

async function buildFullReport(propertyId, from, to) {
  const { getReport, NIGHTS_CTE, ADDON_NIGHTS_SQL, ACTIVITY_SQL } = require('../routes/reports');   // lazy: route file
  const { collected } = require('./dailyClose');
  const { aging } = require('./agentStatementService');
  const P = [from, to, propertyId];
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

  const notComp = `NOT (s.payment_method = 'room_charge' AND s.booking_id IN (SELECT id FROM bookings WHERE complimentary_scope = 'all'))`;
  const [
    base, { rows: extraLines }, { rows: addonCats }, { rows: activities }, { rows: settingsRows },
    { rows: typeUnits }, { rows: byType }, { rows: byPlan }, { rows: byNat }, { rows: [arrivals] }, { rows: bySource },
    { rows: [disc] }, received, { rows: owedGuests }, agents,
  ] = await Promise.all([
    getReport(propertyId, from, to),
    // Hotel extras by category, on the day sold: the item part of every
    // non-F&B, non-per-night line (its breakfast part is F&B).
    db.query(`
      SELECT p.category, SUM(si.subtotal - si.meal_amount) AS amount, SUM(si.quantity) AS qty
      FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
      WHERE s.property_id = $3 AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $1::date AND $2::date
        AND s.confirmation_status IS DISTINCT FROM 'rejected' AND ${notComp}
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
    db.query(`
      ${NIGHTS_CTE}
      SELECT COALESCE(SUM(discount_per_night), 0) AS amount,
             COUNT(DISTINCT booking_id) FILTER (WHERE discount_per_night > 0) AS bookings
      FROM nights`, P),
    collected(propertyId, from, to),
    // Still owed as of today (not tied to the period): guests' deposit /
    // balance lines not received yet, split by where the stay is.
    db.query(`
      SELECT CASE WHEN b.status = 'checked_out' THEN 'checked_out'
                  WHEN b.status = 'checked_in' THEN 'in_house' ELSE 'upcoming' END AS stage,
             COUNT(DISTINCT b.id) AS bookings, COALESCE(SUM(p.amount), 0) AS amount
      FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.property_id = $1 AND p.status = 'pending' AND p.amount > 0
        AND b.status NOT IN ('cancelled', 'no_show') AND b.folio_status IS NULL
      GROUP BY 1`, [propertyId]),
    aging(propertyId),
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

  return {
    from, to, days,
    revenue, rooms, channels, money,
    daily: base.daily_revenue,
    expenses_total: base.expenses_total, net_income: base.net_income,
  };
}

module.exports = { buildFullReport, EXTRA_CATEGORIES };
