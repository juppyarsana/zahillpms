const db = require('../db');
const { loadFolio, round2, agentDue, billRates, AGENT_PREPAID_SQL, PAID_AT_DESK_SQL } = require('./folioService');
const { otaCollects } = require('./otaCollect');
const { ensureOtaAgent } = require('./agentService');

// Agent Accounts / Direct Billing — Slice B (see ROADMAP.md #13).
//
// Since migration 084 the billing terms live on the booking's AGENT
// (agents, bookings.agent_id) instead of its source; `payment_status` there
// decides who pays and when.
//   - city_ledger / city_ledger_payment → the guest pays the agent, so at
//     checkout the folio closes as billed-to-agent instead of collecting
//     from the guest (bookings.folio_status = 'pending_agent_invoice').
//   - commission / commission_and_city_ledger → the property owes the agent
//     a commission, posted to the agent_commissions ledger at checkout.
// Both can apply to the same source (commission_and_city_ledger).

const CITY_LEDGER = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'];
const COMMISSION = ['commission', 'commission_and_city_ledger'];

// The booking's agent (migration 084) with the commission that applies to
// this booking: the booking's own rate when set, else the agent's default.
async function resolveBookingAgent(client, propertyId, bookingId) {
  const { rows: [row] } = await client.query(
    `SELECT a.*, b.commission_type AS booking_commission_type, b.commission_value AS booking_commission_value
     FROM bookings b JOIN agents a ON a.id = b.agent_id AND a.property_id = b.property_id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  if (!row) return null;
  const own = row.booking_commission_type && row.booking_commission_value != null;
  return {
    ...row,
    commission_type: own ? row.booking_commission_type : row.commission_type,
    commission_value: own ? row.booking_commission_value : row.commission_value,
  };
}

// terms = { commission_type, commission_value } (an agent resolved above).
function computeCommission(terms, folioTotal) {
  const value = parseFloat(terms.commission_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (terms.commission_type === 'amount') return round2(value);
  if (terms.commission_type === 'percent') return round2(folioTotal * value / 100);
  return 0;
}

// Called from inside routes/checkin.js's checkout transaction — takes the
// caller's `client`, never opens its own BEGIN/COMMIT (mirrors
// activityBookingService.postFolioCharge). Returns { error } on a bad
// request so the caller can ROLLBACK + 400.
async function settleCheckout(client, { propertyId, bookingId, billToAgent, actorUserId }) {
  const { rows: [booking] } = await client.query(
    `SELECT b.id, b.source, b.agent_id, b.payment_collect, COALESCE(bs.is_ota, false) AS is_ota, bs.label AS source_label
     FROM bookings b LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  if (!booking) return { error: 'Booking not found' };

  let agent = await resolveBookingAgent(client, propertyId, bookingId);
  // The OTA pays the room (weekly payout, or a virtual card not charged in
  // full — migration 126): what is still owed goes onto the OTA's account in
  // Agent Billing, made / linked here when the booking has none. A booking
  // with another kind of agent (a travel agent) keeps its own rules.
  const otaPays = otaCollects(booking) && (!agent || agent.agent_type === 'ota');
  if (otaPays && !agent) {
    const ota = await ensureOtaAgent(client, propertyId, booking.source_label || booking.source);
    if (ota) {
      await client.query('UPDATE bookings SET agent_id = $1, updated_at = NOW() WHERE id = $2', [ota.id, bookingId]);
      agent = await resolveBookingAgent(client, propertyId, bookingId);
    }
  }
  // The guest pays at the hotel although the booking is on an OTA's account:
  // nothing goes to the OTA.
  const guestPaysOta = booking.payment_collect === 'property' && agent?.agent_type === 'ota';
  const paymentStatus = agent?.payment_status || 'normal';
  // billToAgent null = not chosen on screen: bill a city-ledger agent (or the OTA) by default.
  if (billToAgent === null || billToAgent === undefined) {
    billToAgent = otaPays ? !!agent : (!!agent && !guestPaysOta && CITY_LEDGER.includes(paymentStatus));
  }

  let folio_status = null;
  if (billToAgent) {
    if (!agent) return { error: 'This booking has no agent to bill' };
    if (!otaPays && !CITY_LEDGER.includes(paymentStatus)) {
      return { error: `${agent.name} is not set up to be billed (city ledger) — change it in Agent Billing` };
    }
    // Only what is still owed goes to the agent (folioService.agentDue): a
    // stay the agent already paid (usually before arrival, recorded on the
    // room) is not put on the agent's bill at all. Read through `client` —
    // the check-out's own transaction may just have posted the last nights.
    const { rows: [due] } = await client.query(
      `SELECT b.bill_tax_rate, b.bill_service_charge_rate, ps.tax_rate AS ps_tax_rate, ps.service_charge_rate AS ps_service_charge_rate,
              COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                        WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode = 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS charge_subtotal,
              COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                        WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode <> 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS untaxed_subtotal,
              ${AGENT_PREPAID_SQL} AS prepaid
       FROM bookings b LEFT JOIN property_settings ps ON ps.property_id = b.property_id
       WHERE b.id = $1`, [bookingId]);
    const rates = billRates(due, { tax_rate: due.ps_tax_rate, service_charge_rate: due.ps_service_charge_rate });
    if (agentDue(due, rates).due > 0.005) {
      await client.query(
        "UPDATE bookings SET folio_status = 'pending_agent_invoice', updated_at = NOW() WHERE id = $1 AND property_id = $2",
        [bookingId, propertyId]
      );
      folio_status = 'pending_agent_invoice';
      if (otaPays) {
        await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
          [bookingId, `Room money still owed by ${agent.name} put on ${agent.name}'s account in Agent Billing at check-out — paid by its payout.`, actorUserId || null]);
      }
    }
  }

  let commission_posted = false;
  if (agent && COMMISSION.includes(paymentStatus)) {
    // loadFolio reads via the pool, not `client` — fine here because folio
    // charges are always posted (and committed) during the stay, well before
    // checkout; nothing in the checkout transaction touches folio_charges.
    const folio = await loadFolio(bookingId, propertyId);
    // Commission base excludes extras the guest paid at the desk (migration
    // 067) — the agent didn't sell or bill those.
    const amount = computeCommission(agent, folio ? folio.agent_billable_total : 0);
    if (amount > 0) {
      const { rowCount } = await client.query(
        `INSERT INTO agent_commissions (property_id, booking_id, agent_id, source_id, amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (booking_id) DO NOTHING`,
        [propertyId, bookingId, agent.id, booking.source, amount]
      );
      commission_posted = rowCount > 0;
    }
  }

  return { folio_status, commission_posted };
}

// Standalone (own pool query) — called from the credit-check GET route, not
// from within another transaction. AR outstanding for an agent = derived sum
// over folios across that agent's still-active bookings. Folio charges are
// stored NET, so they are grossed up by the property's service charge + VAT
// (matching folioService.computeFolioTotals, approximated as a single
// factor) before subtracting the received (gross) payments.
async function getAgentOutstanding(propertyId, agentId) {
  const { rows: [row] } = await db.query(
    `SELECT COALESCE(SUM(GREATEST(0,
       ROUND(
         (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE booking_id = b.id AND is_voided = false AND tax_mode = 'added')
         -- the booking's own bill rates when stamped (migration 081)
         * (1 + COALESCE(b.bill_service_charge_rate, ps.service_charge_rate, 0) / 100.0)
         * (1 + COALESCE(b.bill_tax_rate, ps.tax_rate, 0) / 100.0)
         -- activity lines priced tax-included / no tax (migration 078) aren't grossed up
         + (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE booking_id = b.id AND is_voided = false AND tax_mode <> 'added')
       , 2)
       - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = b.id AND status = 'received')
     )), 0) AS outstanding
     FROM bookings b
     JOIN property_settings ps ON ps.property_id = b.property_id
     WHERE b.property_id = $1 AND b.agent_id = $2
       AND b.status NOT IN ('cancelled', 'no_show')`,
    [propertyId, agentId]
  );
  return round2(parseFloat(row.outstanding));
}

// A booking's price was corrected after checkout (PUT /api/bookings/:id/price):
// re-derive its commission from the re-posted folio. Only an 'unpaid'
// commission changes — one already paid out to the agent is left as it was.
// Runs after the price correction commits, since loadFolio reads via the pool.
async function recomputeCommission(propertyId, bookingId) {
  const { rows: [row] } = await db.query(
    "SELECT id FROM agent_commissions WHERE booking_id = $1 AND property_id = $2 AND status = 'unpaid'",
    [bookingId, propertyId]
  );
  if (!row) return null;
  const agent = await resolveBookingAgent(db, propertyId, bookingId);
  if (!agent) return null;
  const folio = await loadFolio(bookingId, propertyId);
  const amount = computeCommission(agent, folio ? folio.agent_billable_total : 0);
  await db.query('UPDATE agent_commissions SET amount = $1, computed_at = NOW() WHERE id = $2', [amount, row.id]);
  return amount;
}

module.exports = { settleCheckout, recomputeCommission, getAgentOutstanding, resolveBookingAgent, computeCommission, CITY_LEDGER, COMMISSION };
