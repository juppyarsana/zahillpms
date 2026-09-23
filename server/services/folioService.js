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

// Loads a booking's folio: charges, payments, and the derived money totals
// (subtotal → service charge → tax → total → balance_due). Shared by
// routes/folio.js (GET /:bookingId, GET /:bookingId/invoice, the group
// rollup) and services/agentBillingService.js (commission is a % of the
// folio total). Returns null when the booking isn't found / not this property.
//
// `booking` also carries the resolved booking source (source_payment_status,
// source_label, folio_status) via a LEFT JOIN so callers can decide whether
// to offer a "Bill to Agent" checkout without a second query.
async function loadFolio(bookingId, propertyId) {
  const bookingQ = db.query(
    `SELECT b.id, b.check_in_date, b.check_out_date, b.folio_status,
            g.name as guest_name, u.name as unit_name,
            bs.payment_status as source_payment_status, bs.label as source_label
     FROM bookings b
     JOIN guests g ON b.guest_id = g.id
     JOIN units u ON b.unit_id = u.id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  const chargesQ = db.query(
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, fc.service_date, u.name as posted_by_name,
            -- is_fnb: a 'sale' charge whose sale contains food/drinks reads as
            -- F&B on the folio/invoice; a hotel extra (extra bed, transfer —
            -- migration 067) groups under Other. Categories mirror
            -- salesService.FNB_CATEGORIES (not imported: circular require).
            EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                     WHERE si.sale_id = fc.sale_id AND p.category IN ('drinks', 'food')) AS is_fnb
     FROM folio_charges fc LEFT JOIN users u ON fc.posted_by = u.id
     WHERE fc.booking_id = $1 AND fc.is_voided = false
     ORDER BY fc.service_date NULLS LAST, fc.posted_at`,
    [bookingId]
  );
  const settingsQ = db.query(
    `SELECT tax_rate, service_charge_rate, property_name, property_address, property_phone, property_email, logo_url
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const paymentsQ = db.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY type', [bookingId]);

  const [{ rows: [booking] }, { rows: charges }, { rows: [settings] }, { rows: payments }] =
    await Promise.all([bookingQ, chargesQ, settingsQ, paymentsQ]);

  if (!booking) return null;

  const rawSubtotal = charges.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const { subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total } =
    computeFolioTotals(rawSubtotal, settings?.tax_rate, settings?.service_charge_rate);
  const receivedTotal = round2(payments.filter(p => p.status === 'received').reduce((sum, p) => sum + parseFloat(p.amount), 0));
  const balance_due = round2(total - receivedTotal);

  return {
    booking, charges, payments,
    subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due,
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
            b.room_revenue, b.fnb_revenue, b.rate_plan_id,
            g.name as guest_name, u.name as unit_name
     FROM bookings b
     JOIN guests g ON b.guest_id = g.id
     JOIN units u ON b.unit_id = u.id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  const extraChargesQ = db.query(
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, fc.service_date, u.name as posted_by_name,
            EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                     WHERE si.sale_id = fc.sale_id AND p.category IN ('drinks', 'food')) AS is_fnb
     FROM folio_charges fc LEFT JOIN users u ON fc.posted_by = u.id
     WHERE fc.booking_id = $1 AND fc.is_voided = false AND fc.type NOT IN ('room', 'fnb')
     ORDER BY fc.service_date NULLS LAST, fc.posted_at`,
    [bookingId]
  );
  const settingsQ = db.query(
    `SELECT tax_rate, service_charge_rate, property_name, property_address, property_phone, property_email, logo_url
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const paymentsQ = db.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY type', [bookingId]);

  const [{ rows: [booking] }, { rows: extraCharges }, { rows: [settings] }, { rows: payments }] =
    await Promise.all([bookingQ, extraChargesQ, settingsQ, paymentsQ]);

  if (!booking) return null;

  const nights = stayNights(booking.check_in_date, booking.check_out_date);
  const ratePlanCode = await ratePlanCodeFor(booking.rate_plan_id);
  const roomTotal = booking.room_revenue ?? booking.total_amount;
  const projectedCharges = [];
  for (let i = 0; i < nights.length; i++) {
    const roomAmt = nightlyAmount(roomTotal, nights.length, i);
    const mealAmt = nightlyAmount(booking.fnb_revenue, nights.length, i);
    if (roomAmt > 0) projectedCharges.push({ type: 'room', description: `Room — ${nights[i]}`, quantity: 1, unit_price: roomAmt, amount: roomAmt, service_date: nights[i] });
    if (mealAmt > 0) projectedCharges.push({ type: 'fnb', description: `Meal plan (${ratePlanCode}) — ${nights[i]}`, quantity: 1, unit_price: mealAmt, amount: mealAmt, service_date: nights[i] });
  }
  const charges = [...projectedCharges, ...extraCharges];

  const rawSubtotal = charges.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const { subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total } =
    computeFolioTotals(rawSubtotal, settings?.tax_rate, settings?.service_charge_rate);
  const receivedTotal = round2(payments.filter(p => p.status === 'received').reduce((sum, p) => sum + parseFloat(p.amount), 0));
  const balance_due = round2(total - receivedTotal);

  return {
    booking, charges, payments,
    subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due,
    property: settings || {},
    is_estimate: true,
  };
}

module.exports = { loadFolio, computeProforma, round2, computeFolioTotals, ymd, stayNights, nightlyAmount };
