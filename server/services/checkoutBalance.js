// What the GUEST still owes the hotel at checkout — one rule for the
// Check-in / out list, the checkout guard and Quick Check-in.
//
//   • Whole-stay figure, same as the Balance Due page and the pro forma
//     (folioService.computeProforma: every night + extras charged to the room +
//     service & tax − payments received).
//   • An agent that pays the hotel (city ledger) and is being billed: the agent
//     owes it, not the guest → 0 for the guest (`agent_billed`).
//   • An OTA stay: the room's pending deposit / balance lines are the OTA's
//     money, not the guest's — only what's owed beyond them (extras charged to
//     the room) counts.
const db = require('../db');
const { computeProforma, round2 } = require('./folioService');
const { CITY_LEDGER } = require('./agentBillingService');

const OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];   // same as routes/checkin.js

// billToAgent: the checkout choice when sent (BookingDetail); undefined = the
// default (a city-ledger agent is billed).
async function guestBalance(bookingId, propertyId, { billToAgent } = {}) {
  const { rows: [b] } = await db.query(
    `SELECT b.id, b.source, b.folio_status, COALESCE(bs.is_ota, false) AS is_ota,
            ag.name AS agent_name, ag.payment_status AS agent_payment_status
       FROM bookings b
       LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
       LEFT JOIN agents ag ON ag.id = b.agent_id
      WHERE b.id = $1 AND b.property_id = $2`, [bookingId, propertyId]);
  if (!b) return null;
  const cityLedger = CITY_LEDGER.includes(b.agent_payment_status);
  const alreadyBilled = ['pending_agent_invoice', 'invoiced', 'paid'].includes(b.folio_status);
  if (alreadyBilled || (cityLedger && billToAgent !== false)) {
    return { owed: 0, agent_billed: true, agent_name: b.agent_name || null, ota: false };
  }
  const pf = await computeProforma(bookingId, propertyId);
  if (!pf) return null;
  const ota = OTA_SOURCES.includes(b.source) || b.is_ota;
  let owed = pf.balance_due;
  if (ota) {
    const roomPending = pf.payments
      .filter(p => p.status !== 'received' && ['deposit', 'balance'].includes(p.type))
      .reduce((s, p) => s + parseFloat(p.amount), 0);
    owed -= roomPending;
  }
  owed = round2(owed);
  return { owed: owed >= 1 ? owed : 0, agent_billed: false, agent_name: b.agent_name || null, ota };
}

module.exports = { guestBalance };
