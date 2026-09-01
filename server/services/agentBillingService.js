const db = require('../db');
const { loadFolio, round2 } = require('./folioService');

// Agent Accounts / Direct Billing — Slice B (see ROADMAP.md #13).
//
// Two payment-behaviour axes live on the booking's source (booking_sources,
// migration 041): `payment_status` decides who pays and when.
//   - city_ledger / city_ledger_payment → the guest pays the agent, so at
//     checkout the folio closes as billed-to-agent instead of collecting
//     from the guest (bookings.folio_status = 'pending_agent_invoice').
//   - commission / commission_and_city_ledger → the property owes the agent
//     a commission, posted to the agent_commissions ledger at checkout.
// Both can apply to the same source (commission_and_city_ledger).

const CITY_LEDGER = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'];
const COMMISSION = ['commission', 'commission_and_city_ledger'];

async function resolveSource(client, propertyId, sourceId) {
  if (!sourceId) return null;
  const { rows: [source] } = await client.query(
    'SELECT * FROM booking_sources WHERE id = $1 AND property_id = $2',
    [sourceId, propertyId]
  );
  return source || null;
}

function computeCommission(source, folioTotal) {
  const value = parseFloat(source.commission_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (source.commission_type === 'amount') return round2(value);
  if (source.commission_type === 'percent') return round2(folioTotal * value / 100);
  return 0;
}

// Called from inside routes/checkin.js's checkout transaction — takes the
// caller's `client`, never opens its own BEGIN/COMMIT (mirrors
// activityBookingService.postFolioCharge). Returns { error } on a bad
// request so the caller can ROLLBACK + 400.
async function settleCheckout(client, { propertyId, bookingId, billToAgent, actorUserId }) {
  const { rows: [booking] } = await client.query(
    'SELECT id, source FROM bookings WHERE id = $1 AND property_id = $2',
    [bookingId, propertyId]
  );
  if (!booking) return { error: 'Booking not found' };

  const source = await resolveSource(client, propertyId, booking.source);
  const paymentStatus = source?.payment_status || 'normal';

  let folio_status = null;
  if (billToAgent) {
    if (!CITY_LEDGER.includes(paymentStatus)) {
      return { error: 'This booking\'s source is not set up for agent (city-ledger) billing' };
    }
    await client.query(
      "UPDATE bookings SET folio_status = 'pending_agent_invoice', updated_at = NOW() WHERE id = $1 AND property_id = $2",
      [bookingId, propertyId]
    );
    folio_status = 'pending_agent_invoice';
  }

  let commission_posted = false;
  if (source && COMMISSION.includes(paymentStatus)) {
    // loadFolio reads via the pool, not `client` — fine here because folio
    // charges are always posted (and committed) during the stay, well before
    // checkout; nothing in the checkout transaction touches folio_charges.
    const folio = await loadFolio(bookingId, propertyId);
    const amount = computeCommission(source, folio ? folio.total : 0);
    if (amount > 0) {
      const { rowCount } = await client.query(
        `INSERT INTO agent_commissions (property_id, booking_id, source_id, amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (booking_id) DO NOTHING`,
        [propertyId, bookingId, source.id, amount]
      );
      commission_posted = rowCount > 0;
    }
  }

  return { folio_status, commission_posted };
}

// Standalone (own pool query) — called from the credit-check GET route, not
// from within another transaction. AR outstanding for a source = derived sum
// over folios across that source's still-active bookings. Folio charges are
// stored NET, so they are grossed up by the property's service charge + VAT
// (matching folioService.computeFolioTotals, approximated as a single
// factor) before subtracting the received (gross) payments.
async function getSourceOutstanding(propertyId, sourceId) {
  const { rows: [row] } = await db.query(
    `SELECT COALESCE(SUM(GREATEST(0,
       ROUND(
         (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE booking_id = b.id AND is_voided = false)
         * (1 + COALESCE(ps.service_charge_rate, 0) / 100.0)
         * (1 + COALESCE(ps.tax_rate, 0) / 100.0)
       , 2)
       - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = b.id AND status = 'received')
     )), 0) AS outstanding
     FROM bookings b
     JOIN property_settings ps ON ps.property_id = b.property_id
     WHERE b.property_id = $1 AND b.source = $2
       AND b.status NOT IN ('cancelled', 'no_show')`,
    [propertyId, sourceId]
  );
  return round2(parseFloat(row.outstanding));
}

module.exports = { settleCheckout, getSourceOutstanding, resolveSource, computeCommission, CITY_LEDGER, COMMISSION };
