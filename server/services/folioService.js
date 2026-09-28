const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function ymd(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Every stay night: check_in .. check_out-1 (you don't pay for the day you leave).
// Shared by roomChargeService (real per-night posting) and computeProforma
// below (projected per-night posting) so both use the exact same night list.
function stayNights(checkIn, checkOut) {
  const start = new Date(ymd(checkIn) + 'T00:00:00Z');
  const end = new Date(ymd(checkOut) + 'T00:00:00Z');
  const out = [];
  for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

// Split a whole-stay NET total across `nights`; the last night absorbs the
// rounding remainder so the sum is exact and independent of post order.
function nightlyAmount(totalNet, nights, nightIndex) {
  const total = round2(parseFloat(totalNet) || 0);
  const n = Math.max(1, nights);
  if (total === 0) return 0;
  const per = round2(total / n);
  return nightIndex >= n - 1 ? round2(total - per * (n - 1)) : per;
}

async function ratePlanCodeFor(ratePlanId) {
  if (!ratePlanId) return 'RO';
  const { rows: [r] } = await db.query('SELECT code FROM rate_plans WHERE id = $1', [ratePlanId]);
  return r?.code || 'RO';
}

// The one place the folio money formula lives. Indonesian hotel practice:
// service charge on the subtotal, then VAT (PB1) on subtotal + service charge.
// Reused by loadFolio and by agentStatementService (per-booking agent AR).
function computeFolioTotals(subtotal, taxRate, serviceChargeRate) {
  const sub = round2(subtotal);
  const service_charge_rate = parseFloat(serviceChargeRate ?? 0);
  const tax_rate = parseFloat(taxRate ?? 0);
  const service_charge_amount = round2(sub * service_charge_rate / 100);
  const tax_amount = round2((sub + service_charge_amount) * tax_rate / 100);
  const total = round2(sub + service_charge_amount + tax_amount);
  return { subtotal: sub, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total };
}

// Folio totals over charge lines (migration 078): service charge + tax are
// added only to lines whose tax_mode is 'added' (rooms, meals, extras and
// most activities); an 'included'/'none' activity line is charged exactly its
// amount. `subtotal` is every line; service/tax are on the taxable part.
function chargeTotals(charges, taxRate, serviceChargeRate) {
  let taxable = 0, untaxed = 0;
  for (const c of charges) {
    if (c.tax_mode && c.tax_mode !== 'added') untaxed += parseFloat(c.amount);
    else taxable += parseFloat(c.amount);
  }
  const t = computeFolioTotals(taxable, taxRate, serviceChargeRate);
  return { ...t, subtotal: round2(taxable + untaxed), untaxed_subtotal: round2(untaxed), total: round2(t.total + untaxed) };
}

// Loads a booking's folio: charges, payments, and the derived money totals
// (subtotal → service charge → tax → total → balance_due). Shared by
// routes/folio.js (GET /:bookingId, GET /:bookingId/invoice, the group
// rollup) and services/agentBillingService.js (commission is a % of the
// folio total). Returns null when the booking isn't found / not this property.
//
// `booking` also carries the resolved booking source (source_payment_status,
// source_label, folio_status) via a LEFT JOIN so callers can decide whether
// to offer a "Bill to Agent" checkout without a second query.
// SQL predicate (folio_charges aliased `fc`): the charge is a sale the guest
// already paid at the front desk ("Pay now", migration 067). It sits on the
// folio so the stay's record is complete — offset there by its 'incidental'
// payment — but it was never on credit, so it must never be billed to an
// agent (statement, consolidated invoice, commission base). A room_charge
// sale (incl. a resto tab settled to the room) is still agent-billable.
// An activity paid directly (migration 078) is the same: its folio line is
// offset by its own 'incidental' payment. So is a line paid on its own from
// the Folio tab ("Pay selected", migration 082 — fc.paid_payment_id).
const PAID_AT_DESK_SQL = `(fc.paid_payment_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM sales s WHERE s.id = fc.sale_id AND s.payment_method NOT IN ('room_charge', 'unpaid'))
    OR EXISTS (SELECT 1 FROM activity_bookings ab WHERE ab.folio_charge_id = fc.id AND ab.payment_method <> 'room_charge'))`;
// How a paid-at-desk line was paid ("Cash", "QRIS"…), NULL when charged to
// the room — shown on the Folio tab and the invoice so it doesn't read as owed.
const PAID_METHOD_SQL = `COALESCE(
  (SELECT COALESCE(pm.label, p.method) FROM payments p
     JOIN bookings pb ON pb.id = p.booking_id
     LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = pb.property_id
    WHERE p.id = fc.paid_payment_id),
  (SELECT COALESCE(pm.label, s.payment_method) FROM sales s
     LEFT JOIN payment_methods pm ON pm.id = s.payment_method AND pm.property_id = s.property_id
    WHERE s.id = fc.sale_id AND s.payment_method NOT IN ('room_charge', 'unpaid')),
  (SELECT COALESCE(pm.label, ab.payment_method) FROM activity_bookings ab
     LEFT JOIN payment_methods pm ON pm.id = ab.payment_method AND pm.property_id = ab.property_id
    WHERE ab.folio_charge_id = fc.id AND ab.payment_method <> 'room_charge'))`;

// A stay complimentary for "everything" (migration 072): extras charged to
// the room are free too — flagged `complimentary` and left out of the totals.
// Room/meal nights need nothing here (they post at 0), and extras the guest
// paid at the desk stay as they are (already paid). Returns their NET value.
function markComplimentary(booking, charges) {
  if (booking?.complimentary_scope !== 'all') return 0;
  let value = 0;
  for (const c of charges) {
    if (['room', 'fnb'].includes(c.type) || c.paid_at_desk) continue;
    c.complimentary = true;
    value += parseFloat(c.amount);
  }
  return round2(value);
}

// The service charge / tax rates a booking is billed at: the ones stamped on
// it at checkout or when the rates changed (migration 081), else the
// property's current rates (a booking not billed yet).
function billRates(booking, settings) {
  return booking?.bill_tax_rate != null
    ? { tax_rate: booking.bill_tax_rate, service_charge_rate: booking.bill_service_charge_rate ?? 0 }
    : { tax_rate: settings?.tax_rate, service_charge_rate: settings?.service_charge_rate };
}
// Same rule in SQL (b = bookings, ps = property_settings).
const BILL_TAX_SQL = 'COALESCE(b.bill_tax_rate, ps.tax_rate)';
const BILL_SC_SQL = 'COALESCE(b.bill_service_charge_rate, ps.service_charge_rate)';

// The receipt a payment has, if any: 'lines' — specific folio items paid on
// their own (migration 082, GET /api/folio/payment/:id/receipt); 'sale' — an
// extra paid with Pay now at the Sales till (GET /api/sales/:sale_id/receipt);
// 'activity' — an activity paid directly (GET /api/activities/bookings/:id/receipt).
// Room deposit / balance payments have none (they're on the invoice).
const PAYMENTS_WITH_RECEIPT_SQL = `
  SELECT p.*, CASE
      WHEN EXISTS (SELECT 1 FROM folio_charges x WHERE x.paid_payment_id = p.id AND x.is_voided = false)
        OR EXISTS (SELECT 1 FROM booking_addons y WHERE y.paid_payment_id = p.id AND y.status = 'active') THEN 'lines'
      WHEN p.sale_id IS NOT NULL THEN 'sale'
      WHEN p.activity_booking_id IS NOT NULL THEN 'activity'
    END AS receipt_kind
  FROM payments p WHERE p.booking_id = $1 ORDER BY p.type`;

async function loadFolio(bookingId, propertyId) {
  const bookingQ = db.query(
    `SELECT b.id, b.check_in_date, b.check_out_date, b.folio_status, b.complimentary_scope,
            b.bill_tax_rate, b.bill_service_charge_rate,
            g.name as guest_name, u.name as unit_name,
            bs.payment_status as source_payment_status, bs.label as source_label,
            COALESCE(bs.publish_rate, true) AS publish_rate,
            rp.name AS rate_plan_name, rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner
     FROM bookings b
     JOIN guests g ON b.guest_id = g.id
     JOIN units u ON b.unit_id = u.id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  const chargesQ = db.query(
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, fc.service_date, fc.tax_mode, fc.paid_payment_id, u.name as posted_by_name,
            EXISTS (SELECT 1 FROM booking_addons ba WHERE ba.id = fc.addon_id AND ba.breakfasts > 0) AS addon_meal,
            -- is_fnb: a 'sale' charge whose sale contains food/drinks reads as
            -- F&B on the folio/invoice; a hotel extra (extra bed, transfer —
            -- migration 067) groups under Other. Categories mirror
            -- salesService.FNB_CATEGORIES (not imported: circular require).
            -- An external POS bill (no sale_items, migration 070) is F&B too.
            EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                     WHERE si.sale_id = fc.sale_id AND p.category IN ('drinks', 'food'))
            OR EXISTS (SELECT 1 FROM sales s WHERE s.id = fc.sale_id AND s.order_source = 'external_pos') AS is_fnb,
            ${PAID_AT_DESK_SQL} AS paid_at_desk, ${PAID_METHOD_SQL} AS paid_method
     FROM folio_charges fc LEFT JOIN users u ON fc.posted_by = u.id
     WHERE fc.booking_id = $1 AND fc.is_voided = false
     ORDER BY fc.service_date NULLS LAST, fc.posted_at`,
    [bookingId]
  );
  const settingsQ = db.query(
    `SELECT tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown, property_name, property_address, property_phone, property_email, logo_url
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const paymentsQ = db.query(PAYMENTS_WITH_RECEIPT_SQL, [bookingId]);

  const [{ rows: [booking] }, { rows: charges }, { rows: [settings] }, { rows: payments }] =
    await Promise.all([bookingQ, chargesQ, settingsQ, paymentsQ]);

  if (!booking) return null;

  const rates = billRates(booking, settings);
  const complimentary_extras = markComplimentary(booking, charges);
  const billable = charges.filter(c => !c.complimentary);
  const { subtotal, untaxed_subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total } =
    chargeTotals(billable, rates.tax_rate, rates.service_charge_rate);
  const receivedTotal = round2(payments.filter(p => p.status === 'received').reduce((sum, p) => sum + parseFloat(p.amount), 0));
  const balance_due = round2(total - receivedTotal);
  // What an agent can be billed / paid commission on: everything except
  // extras the guest already paid at the desk (see PAID_AT_DESK_SQL).
  const agent_billable_total = chargeTotals(
    billable.filter(c => !c.paid_at_desk), rates.tax_rate, rates.service_charge_rate
  ).total;

  return {
    booking, charges, payments,
    subtotal, untaxed_subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due, agent_billable_total,
    complimentary_extras,
    // Prices entered incl. service & tax (migration 079): show lines all-in.
    prices_include_tax: !!settings?.prices_include_tax,
    show_tax_breakdown: !!settings?.show_tax_breakdown,   // "Includes service … and tax …" (080)
    property: settings || {},
  };
}

// Projects what an invoice WOULD total if every remaining night were posted
// right now, for a guest who asks for "an invoice" before night audit / the
// checkout catch-up has actually posted the room+fnb charges (see
// roomChargeService.postStay — those only post nightly or at checkout, never
// at check-in). Uses the exact same per-night split (stayNights/nightlyAmount)
// real posting uses, so a night that HAS already posted for real projects to
// the identical amount here — this never contradicts the live invoice, it
// just fills in what isn't posted yet. Real non-room/fnb charges (extra
// sales, activities, misc) are pulled in as-is since they can't be predicted
// from the rate plan alone. Never writes to folio_charges — read-only.
async function computeProforma(bookingId, propertyId) {
  const bookingQ = db.query(
    `SELECT b.id, b.check_in_date, b.check_out_date, b.total_amount, b.discount_amount,
            b.room_revenue, b.fnb_revenue, b.rate_plan_id, b.complimentary_scope,
            b.bill_tax_rate, b.bill_service_charge_rate,
            g.name as guest_name, u.name as unit_name,
            rp.name AS rate_plan_name, rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner,
            bs.label AS source_label, COALESCE(bs.publish_rate, true) AS publish_rate
     FROM bookings b
     JOIN guests g ON b.guest_id = g.id
     JOIN units u ON b.unit_id = u.id
     LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  const extraChargesQ = db.query(
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, fc.service_date, fc.tax_mode, fc.paid_payment_id, u.name as posted_by_name,
            EXISTS (SELECT 1 FROM booking_addons ba WHERE ba.id = fc.addon_id AND ba.breakfasts > 0) AS addon_meal,
            EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                     WHERE si.sale_id = fc.sale_id AND p.category IN ('drinks', 'food'))
            OR EXISTS (SELECT 1 FROM sales s WHERE s.id = fc.sale_id AND s.order_source = 'external_pos') AS is_fnb,
            ${PAID_AT_DESK_SQL} AS paid_at_desk, ${PAID_METHOD_SQL} AS paid_method
     FROM folio_charges fc LEFT JOIN users u ON fc.posted_by = u.id
     WHERE fc.booking_id = $1 AND fc.is_voided = false AND fc.type NOT IN ('room', 'fnb', 'addon')
     ORDER BY fc.service_date NULLS LAST, fc.posted_at`,
    [bookingId]
  );
  // Per-night extras (extra bed, migration 074): every active night inside
  // the stay, posted or not — projected like the room nights.
  const addonsQ = db.query(
    `SELECT a.id, a.description, a.service_date, a.quantity, a.unit_price, a.meal_price, a.breakfasts, s.payment_method,
            COALESCE(pm.label, s.payment_method) AS payment_method_label, lp.label AS line_paid_label
     FROM booking_addons a
     JOIN bookings b ON b.id = a.booking_id
     LEFT JOIN sales s ON s.id = a.sale_id
     LEFT JOIN payment_methods pm ON pm.id = s.payment_method AND pm.property_id = s.property_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(pm2.label, pp.method) AS label FROM payments pp
       LEFT JOIN payment_methods pm2 ON pm2.id = pp.method AND pm2.property_id = b.property_id
       WHERE pp.id = COALESCE(a.paid_payment_id,
         (SELECT fx.paid_payment_id FROM folio_charges fx WHERE fx.addon_id = a.id AND fx.is_voided = false LIMIT 1))) lp ON true
     WHERE a.booking_id = $1 AND a.status = 'active'
       AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
     ORDER BY a.service_date`,
    [bookingId]
  );
  const settingsQ = db.query(
    `SELECT tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown, property_name, property_address, property_phone, property_email, logo_url
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const paymentsQ = db.query(PAYMENTS_WITH_RECEIPT_SQL, [bookingId]);

  const [{ rows: [booking] }, { rows: extraCharges }, { rows: [settings] }, { rows: payments }, { rows: addons }] =
    await Promise.all([bookingQ, extraChargesQ, settingsQ, paymentsQ, addonsQ]);

  if (!booking) return null;

  const nights = stayNights(booking.check_in_date, booking.check_out_date);
  const addonCharges = addons.map(a => {
    const amount = round2(parseFloat(a.unit_price) * a.quantity);
    return {
      type: 'addon', description: `${a.description} — ${ymd(a.service_date)}`, quantity: a.quantity,
      unit_price: a.unit_price, amount, service_date: ymd(a.service_date),
      paid_at_desk: !!a.line_paid_label || (!!a.payment_method && !['room_charge', 'unpaid'].includes(a.payment_method)),
      paid_method: a.line_paid_label || (a.payment_method && !['room_charge', 'unpaid'].includes(a.payment_method) ? a.payment_method_label : null),
      addon_meal: a.breakfasts > 0,
    };
  });
  const ratePlanCode = await ratePlanCodeFor(booking.rate_plan_id);
  const roomTotal = booking.room_revenue ?? booking.total_amount;
  const projectedCharges = [];
  for (let i = 0; i < nights.length; i++) {
    const roomAmt = nightlyAmount(roomTotal, nights.length, i);
    const mealAmt = nightlyAmount(booking.fnb_revenue, nights.length, i);
    if (roomAmt > 0) projectedCharges.push({ type: 'room', description: `Room — ${nights[i]}`, quantity: 1, unit_price: roomAmt, amount: roomAmt, service_date: nights[i] });
    if (mealAmt > 0) projectedCharges.push({ type: 'fnb', description: `Meal plan (${ratePlanCode}) — ${nights[i]}`, quantity: 1, unit_price: mealAmt, amount: mealAmt, service_date: nights[i] });
  }
  const charges = [...projectedCharges, ...addonCharges, ...extraCharges];
  const complimentary_extras = markComplimentary(booking, charges);

  const rates = billRates(booking, settings);
  const { subtotal, untaxed_subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total } =
    chargeTotals(charges.filter(c => !c.complimentary), rates.tax_rate, rates.service_charge_rate);
  const receivedTotal = round2(payments.filter(p => p.status === 'received').reduce((sum, p) => sum + parseFloat(p.amount), 0));
  const balance_due = round2(total - receivedTotal);

  return {
    booking, charges, payments,
    subtotal, untaxed_subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due,
    complimentary_extras,
    prices_include_tax: !!settings?.prices_include_tax,
    show_tax_breakdown: !!settings?.show_tax_breakdown,
    property: settings || {},
    is_estimate: true,
  };
}

module.exports = { PAID_AT_DESK_SQL, PAYMENTS_WITH_RECEIPT_SQL, BILL_TAX_SQL, BILL_SC_SQL, billRates, chargeTotals, loadFolio, computeProforma, round2, computeFolioTotals, ymd, stayNights, nightlyAmount };
