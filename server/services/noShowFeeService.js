// No-show / late-cancellation fee (migration 166).
//
// A booking that is marked no-show or cancelled carries no revenue: its room
// nights are voided. When the hotel is entitled to a fee — the guest did not
// come, or cancelled too late, and the hotel (or the OTA that collected the
// money) pays for the room it held — the fee is ONE folio line of type
// 'noshow_fee':
//   · NET amount, like every folio line; service charge + tax are added on top
//     at the booking's own bill rates (stamped when the fee is posted);
//   · dated the arrival day for a no-show, the day it was cancelled for a
//     late cancellation;
//   · revenue on its own line (journal key revenue.noshow, account 400-11-002),
//     NOT a room night — occupancy and ADR do not move;
//   · paid like any extra: Record Payment → tick the line (a guest paying, or
//     an OTA's payout / virtual card); voided with a reason like any folio line.
// Payments, the room's own pending deposit / balance lines and the booking
// status are not touched.
//
// WHO PAYS: when an OTA collected the guest's money (or the booking is billed to
// an agent on city ledger) the fee is NOT the guest's to pay — it goes onto that
// OTA's / agent's account in Receivables (bookings.folio_status = 'pending_agent_invoice',
// agent made / linked if the booking has none), exactly like the room money still
// owed at check-out, and is settled by the OTA's payout. Otherwise (guest pays at
// the hotel) front desk takes it with Record Payment.
const db = require('../db');
const { round2, computeFolioTotals, stayNights, nightlyAmount, billRates } = require('./folioService');
const { roomNightAmounts, loadNightRates } = require('./nightRates');
const { basisFrom } = require('./priceBasis');
const { fitToGross } = require('./bookingPriceService');
const roomCharge = require('./roomChargeService');
const { otaCollects } = require('./otaCollect');
const { ensureOtaAgent } = require('./agentService');

const CITY_LEDGER = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'];

class FeeError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const KIND = {
  no_show: { label: 'No-show fee', short: 'no-show' },
  cancellation: { label: 'Late cancellation fee', short: 'late cancellation' },
};

// The booking with what the fee needs. `client` can be the pool or a transaction.
async function loadBooking(client, propertyId, bookingId, lock = false) {
  const { rows: [b] } = await client.query(
    `SELECT b.id, b.status, b.check_in_date, b.check_out_date, b.room_revenue, b.fnb_revenue, b.total_amount,
            b.complimentary_scope, b.bill_tax_rate, b.bill_service_charge_rate, b.payment_collect, b.source,
            b.reservation_group_id, b.folio_status,
            bs.is_ota, bs.label AS source_label,
            ps.tax_rate, ps.service_charge_rate, ps.prices_include_tax,
            ag.payment_status AS agent_billing, ag.agent_type, ag.name AS agent_name, b.agent_id, rg.group_billing,
            u.name AS unit_name, g.name AS guest_name
     FROM bookings b
     JOIN property_settings ps ON ps.property_id = b.property_id
     JOIN units u ON u.id = b.unit_id
     JOIN guests g ON g.id = b.guest_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     LEFT JOIN agents ag ON ag.id = b.agent_id
     LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
     WHERE b.id = $1 AND b.property_id = $2 ${lock ? 'FOR UPDATE OF b' : ''}`, [bookingId, propertyId]);
  if (b) {
    const { rows: [pv] } = await client.query('SELECT 1 FROM payments WHERE booking_id = $1 AND voucher_id IS NOT NULL LIMIT 1', [bookingId]);
    b.had_voucher = !!pv;
  }
  return b || null;
}

const ymd = d => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);

// First night, NET: the room's price for the first night + that night's meals.
async function firstNightNet(client, b) {
  const nights = stayNights(ymd(b.check_in_date), ymd(b.check_out_date));
  if (!nights.length) return 0;
  const roomTotal = b.room_revenue ?? b.total_amount;
  const room = roomNightAmounts(roomTotal, nights, await loadNightRates(client, b.id))[0] || 0;
  const meal = nightlyAmount(b.fnb_revenue, nights.length, 0);
  return round2(room + meal);
}

function ratesOf(b) {
  return billRates(b, { tax_rate: b.tax_rate, service_charge_rate: b.service_charge_rate });
}

// What the fee window shows: the first night and the whole stay, all-in.
async function quote(propertyId, bookingId) {
  const b = await loadBooking(db, propertyId, bookingId);
  if (!b) throw new FeeError(404, 'Booking not found');
  const rates = ratesOf(b);
  const allIn = net => computeFolioTotals(net, rates.tax_rate, rates.service_charge_rate).total;
  const first = await firstNightNet(db, b);
  const stay = round2(parseFloat(b.room_revenue ?? b.total_amount ?? 0) + parseFloat(b.fnb_revenue || 0));
  const basis = basisFrom({ tax_rate: rates.tax_rate, service_charge_rate: rates.service_charge_rate, prices_include_tax: b.prices_include_tax });
  return {
    status: b.status,
    first_night: { net: first, all_in: allIn(first) },
    whole_stay: { net: stay, all_in: allIn(stay) },
    prices_include_tax: !!b.prices_include_tax,
    typed_as: basis.include ? 'all_in' : 'before_tax',
    ota_collects: otaCollects(b),
    source_label: b.source_label || null,
    // The fee goes onto this account in Receivables instead of the guest's folio balance.
    billed_to: accountOf(b) ? (b.agent_name || b.source_label || 'the OTA') : null,
    can_charge: !refusal(b),
    blocked_reason: refusal(b),
  };
}

// The fee goes on an account in Receivables (not the guest's balance): an OTA that collected
// the money, or an agent billed on city ledger — unless the guest pays at the hotel.
function accountOf(b) {
  const guestPaysOta = b.payment_collect === 'property' && b.agent_type === 'ota';
  if (guestPaysOta) return false;
  const otaPays = otaCollects(b) && (!b.agent_id || b.agent_type === 'ota');
  return otaPays || (!!b.agent_id && CITY_LEDGER.includes(b.agent_billing));
}

// Why a fee can't be posted on this booking (null = fine).
function refusal(b) {
  if (b.had_voucher) return 'This booking was paid with a voucher — no fee applies';
  if (b.complimentary_scope) return 'This stay is complimentary — there is nothing to charge';
  if (b.group_billing) return 'This room is on a group bill — put the fee on the group another way';
  return null;
}

// Posts the fee inside the caller's transaction. `kind`: 'no_show' | 'cancellation'.
// mode: 'first_night' | 'whole_stay' | 'custom' (custom = `amount`, typed the
// way the property types prices). Returns { id, description, net, all_in }.
async function postFee(client, propertyId, bookingId, { mode, amount, kind, userId, reason }) {
  const b = await loadBooking(client, propertyId, bookingId, true);
  if (!b) throw new FeeError(404, 'Booking not found');
  const wanted = b.status === 'no_show' ? 'no_show' : b.status === 'cancelled' ? 'cancellation' : null;
  if (!wanted) throw new FeeError(409, 'A fee can only be put on a booking that is marked no-show or cancelled', 'NOT_DEAD');
  const k = KIND[kind || wanted];
  const why = refusal(b);
  if (why) throw new FeeError(409, why, 'FEE_NOT_ALLOWED');
  const { rows: [existing] } = await client.query(
    "SELECT id FROM folio_charges WHERE booking_id = $1 AND type = 'noshow_fee' AND is_voided = false LIMIT 1", [bookingId]);
  if (existing) throw new FeeError(409, 'This booking already has a fee — void it first to charge another one', 'FEE_EXISTS');

  const rates = ratesOf(b);
  let net, what;
  if (mode === 'first_night') { net = await firstNightNet(client, b); what = 'first night'; }
  else if (mode === 'whole_stay') {
    net = round2(parseFloat(b.room_revenue ?? b.total_amount ?? 0) + parseFloat(b.fnb_revenue || 0)); what = 'whole stay';
  } else if (mode === 'custom') {
    const typed = round2(parseFloat(amount));
    if (!(typed > 0) || typed > 1e11) throw new FeeError(400, 'Type the fee amount', 'BAD_AMOUNT');
    const basis = basisFrom({ tax_rate: rates.tax_rate, service_charge_rate: rates.service_charge_rate, prices_include_tax: b.prices_include_tax });
    // Typed all-in (nett property): the NET whose total with service + tax is exactly what was typed.
    net = basis.include ? fitToGross(round2(typed / basis.F), 0, typed, rates.tax_rate, rates.service_charge_rate) : typed;
    what = 'agreed amount';
  } else throw new FeeError(400, 'Choose the fee: first night, whole stay or an amount', 'BAD_MODE');
  if (!(net > 0)) throw new FeeError(400, 'The fee would be Rp 0 — this booking has no price', 'ZERO_FEE');

  // The day it counts: the arrival day for a no-show, the day it was cancelled otherwise.
  const day = (kind || wanted) === 'no_show' ? ymd(b.check_in_date) : roomCharge.todayWITA();
  const description = `${k.label} — ${what}`;
  const { rows: [line] } = await client.query(
    `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, service_date, tax_mode, posted_by)
     VALUES ($1, 'noshow_fee', $2, 1, $3, $3, $4, 'added', $5) RETURNING id`,
    [bookingId, description, net, day, userId || null]);
  // The bill keeps the rates the fee was priced at (a later rate change never re-prices it).
  await client.query(
    `UPDATE bookings SET bill_tax_rate = COALESCE(bill_tax_rate, $2), bill_service_charge_rate = COALESCE(bill_service_charge_rate, $3), updated_at = NOW() WHERE id = $1`,
    [bookingId, rates.tax_rate, rates.service_charge_rate]);
  const allIn = computeFolioTotals(net, rates.tax_rate, rates.service_charge_rate).total;
  // Onto the OTA's / agent's account in Receivables when it is theirs to pay.
  let billedTo = null;
  if (accountOf(b)) {
    let agentId = b.agent_id, agentName = b.agent_name;
    if (!agentId) {   // an OTA collected the money and the booking has no agent yet: make / link the OTA's account
      const ota = await ensureOtaAgent(client, propertyId, b.source_label || b.source);
      if (ota) { agentId = ota.id; agentName = ota.name; await client.query('UPDATE bookings SET agent_id = $1 WHERE id = $2', [ota.id, bookingId]); }
    }
    if (agentId) {
      await client.query("UPDATE bookings SET folio_status = 'pending_agent_invoice', updated_at = NOW() WHERE id = $1 AND folio_status IS NULL", [bookingId]);
      billedTo = agentName;
    }
  }
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [
    bookingId,
    `${k.label} charged: ${what}, Rp ${Math.round(allIn).toLocaleString('id-ID')} incl. service & tax (dated ${day}).${billedTo ? ` Put on ${billedTo}'s account in Receivables — paid by its payout, not by the guest.` : ''}${reason ? ` Reason: ${reason}` : ''}`.slice(0, 1000),
    userId || null]);
  return { id: line.id, description, net, all_in: allIn, day, billed_to: billedTo };
}

// A booking that is live again (no-show undone, cancellation reinstated) must not keep
// its fee: the live fee lines are voided and a note says so. A payment already taken for
// the fee stays on the booking as a credit — it is refunded by hand (Refund).
async function voidLiveFees(client, bookingId, userId, why) {
  const { rows } = await client.query(
    `UPDATE folio_charges SET is_voided = true, voided_by = $2, voided_at = NOW()
     WHERE booking_id = $1 AND type = 'noshow_fee' AND is_voided = false
     RETURNING description, amount, paid_payment_id`, [bookingId, userId || null]);
  // A live booking is not billed to an agent yet (check-out does that): take the mark the fee put there off.
  if (rows.length) await client.query("UPDATE bookings SET folio_status = NULL, updated_at = NOW() WHERE id = $1 AND folio_status = 'pending_agent_invoice'", [bookingId]);
  for (const f of rows) {
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [
      bookingId,
      `${f.description} taken off — ${why}.${f.paid_payment_id ? ' It had been paid: that payment stays on the booking as a credit — refund it if needed.' : ''}`.slice(0, 1000),
      userId || null]);
  }
  return rows.length;
}

module.exports = { quote, postFee, voidLiveFees, FeeError, KIND };
