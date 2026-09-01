const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, fc.service_date, u.name as posted_by_name
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

module.exports = { loadFolio, round2, computeFolioTotals };
