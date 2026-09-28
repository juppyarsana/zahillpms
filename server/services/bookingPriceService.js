const ratePlanService = require('./ratePlanService');
const roomCharge = require('./roomChargeService');
const { computeFolioTotals, round2 } = require('./folioService');
const { recomputeBookingStatus } = require('./paymentStatusService');
const { priceBasis } = require('./priceBasis');

// Booking price maths shared by routes/bookings.js (booking creation, Edit
// Price, Change Room, Amend Dates) and routes/checkin.js (early departure).

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Gross-up factor F = (1 + service_charge_rate/100) * (1 + tax_rate/100),
// plus how prices are entered (divisor: F when they include tax, else 1 —
// migration 079; pass it to ratePlanService.mealNetPerNight).
async function grossFactor(client, propertyId) {
  const b = await priceBasis(propertyId, client);
  return { F: b.F, tax_rate: b.tax_rate, service_charge_rate: b.service_charge_rate, divisor: b.divisor, include: b.include };
}

// Split a stay's gross post-discount total into NET room + NET meal amounts.
// meal is rate-plan-derived and fixed; room absorbs the rest. With the rates
// given (tax_rate / service_charge_rate), the room part is nudged by the
// rounding cent so service + tax added back give EXACTLY the price typed —
// 3.000.000 ÷ 1.21 rounded back up otherwise lands on 2.999.999,99.
function splitRevenue({ grossNet, nights, ratePlan, numGuests, F, clientRoomRevenue, divisor = 1, tax_rate, service_charge_rate }) {
  const mealNet = round2(ratePlanService.mealNetPerNight(ratePlan, numGuests, divisor) * nights);
  let roomNet;
  if (clientRoomRevenue !== undefined && clientRoomRevenue !== null && clientRoomRevenue !== '') {
    roomNet = round2(parseFloat(clientRoomRevenue));
  } else {
    roomNet = round2(grossNet / F - mealNet);
    if (roomNet > 0 && tax_rate !== undefined) roomNet = fitToGross(roomNet, mealNet, grossNet, tax_rate, service_charge_rate);
  }
  if (roomNet < 0) roomNet = 0;
  return { roomNet, mealNet };
}

// The room NET (± a few cents) whose total with meals, service and tax is
// exactly `gross`. Gives up (keeps the closest) after a few steps.
function fitToGross(roomNet, mealNet, gross, taxRate, serviceChargeRate) {
  const target = round2(gross);
  const off = r => Math.abs(round2(target - computeFolioTotals(r + mealNet, taxRate, serviceChargeRate).total));
  let best = roomNet;
  for (let d = -3; d <= 3; d++) {
    const r = round2(roomNet + d * 0.01);
    if (r >= 0 && off(r) < off(best)) best = r;
  }
  return best;
}

// What the guest pays: the price typed, when service + tax on the net
// amounts land within a few cents of it (cent rounding can make the exact
// figure unreachable, e.g. 10% + 10% jumps from 2.999.999,99 to
// 3.000.000,01). Payment lines and the stored total use this.
function snapPayable(computed, typed) {
  const t = round2(parseFloat(typed));
  return Number.isFinite(t) && Math.abs(computed - t) <= 0.05 ? t : computed;
}

// Sets a booking's price (total_amount: the gross, tax-included figure New
// Booking takes, before discount) and recomputes everything derived from it
// the way booking creation does: discount, the net room/F&B split (reports,
// dashboard, night audit, reg card, yield), the folio's posted room/F&B
// nights (repostStay), the pending deposit/balance lines and the booking
// status. Received payments are never touched unless receivedWasTypo === true
// (the received amount was typed from the same wrong price) — then they're
// trimmed newest-first down to the new price. Shared by Edit Price (PUT
// /:id/price) and Change Room (PUT /:id/change-room). Runs inside the
// caller's transaction; `before` is the booking row, locked FOR UPDATE.
//   keepDiscount — keep the booking's current discount amount as-is instead
//     of re-deriving it (Change Room: an upgrade charge isn't discounted, and
//     a group room's discount is its prorated share of the group discount).
//   receivedWasTypo — required (true/false) when more has been received than
//     the new price; undefined then → { error: RECEIVED_EXCEEDS_PRICE }.
//   balanceNote — note on a new pending balance line, if one is needed.
//   split — { roomNet, mealNet }: set the NET room/meal amounts exactly
//     instead of deriving them from newTotal (complimentary stays: room free,
//     meals still paid). The discount becomes 0; newTotal is ignored.
async function applyBookingPrice(client, { propertyId, before, newTotal, userId, keepDiscount = false, receivedWasTypo, balanceNote = 'Price correction — additional amount due', split = null }) {
  const reqBody = { received_was_typo: receivedWasTypo };
  const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, propertyId);
  let discountAmount = 0;
  let roomNet, mealNet;
  if (split) {
    roomNet = round2(Math.max(0, split.roomNet));
    mealNet = round2(Math.max(0, split.mealNet));
  } else {
    // Same derivation as POST / (booking creation).
    const dValue = parseFloat(before.discount_value || 0);
    if (keepDiscount)                               discountAmount = Math.min(parseFloat(before.discount_amount || 0), newTotal);
    else if (before.discount_type === 'fixed')      discountAmount = Math.min(dValue, newTotal);
    else if (before.discount_type === 'percentage') discountAmount = Math.round(newTotal * dValue / 100);
    const ratePlan = await ratePlanService.resolveForBooking(propertyId, before.rate_plan_id || null);
    ({ roomNet, mealNet } = splitRevenue({
      grossNet: newTotal - discountAmount,
      nights: Math.max(1, parseInt(before.nights, 10) || 1),
      ratePlan,
      numGuests: Math.max(1, parseInt(before.num_guests, 10) || 1),
      F, divisor, tax_rate, service_charge_rate,
    }));
  }
  const payable = split ? computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total
    : snapPayable(computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total, newTotal - discountAmount);
  const storedTotal = round2(payable + discountAmount);

  // Room payment lines: keep received ones, reshape the pending ones so
  // they add up to what's still owed.
  const { rows: lines } = await client.query(
    // Deposit first, always: a booking's deposit and balance lines are created
    // at the same instant, so ordering by time alone let the balance line go
    // first at random — it took the whole price and the deposit dropped to 0.
    `SELECT * FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance')
     ORDER BY (type = 'deposit') DESC, created_at, id FOR UPDATE`,
    [before.id]
  );
  let received = round2(lines.filter(l => l.status === 'received').reduce((s, l) => s + parseFloat(l.amount), 0));
  let depositAmount = parseFloat(before.deposit_amount || 0);

  // More recorded as received than the new price: was the received amount a
  // typo too, or did the guest really pay more? Only the owner knows.
  const receivedFixes = [];
  if (received > payable) {
    if (typeof reqBody.received_was_typo !== 'boolean') {
      return { status: 400, error: {
        error: 'More has been recorded as received than the new price — say whether the received amount was a typo',
        code: 'RECEIVED_EXCEEDS_PRICE', received, new_total: payable,
      } };
    }
    if (reqBody.received_was_typo) {
      // Trim received lines, newest first, until they add up to the new price.
      let excess = round2(received - payable);
      for (const l of lines.filter(x => x.status === 'received').reverse()) {
        if (excess <= 0) break;
        const oldAmt = parseFloat(l.amount);
        const cut = round2(Math.min(excess, oldAmt));
        const amt = round2(oldAmt - cut);
        await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [amt, l.id]);
        receivedFixes.push(`${l.type} ${fmtIDR(oldAmt)} → ${fmtIDR(amt)}`);
        if (l.type === 'deposit') depositAmount = amt;
        l.amount = amt;
        excess = round2(excess - cut);
      }
      received = payable;
    }
  }
  let remaining = round2(payable - received);
  for (const l of lines.filter(x => x.status === 'pending')) {
    let amt;
    if (l.type === 'deposit') {
      amt = round2(Math.max(0, Math.min(parseFloat(l.amount), remaining)));
      depositAmount = amt;
    } else {
      amt = round2(Math.max(0, remaining));
    }
    remaining = round2(remaining - amt);
    if (amt !== parseFloat(l.amount)) {
      await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [amt, l.id]);
    }
  }
  if (remaining > 0) {
    // Everything owed was already on received lines — add the difference.
    await client.query(
      "INSERT INTO payments (booking_id, type, amount, notes) VALUES ($1, 'balance', $2, $3)",
      [before.id, remaining, balanceNote]
    );
  }
  const credit = remaining < 0 ? round2(-remaining) : 0;

  const { rows: [after] } = await client.query(
    `UPDATE bookings SET total_amount = $1, discount_amount = $2, room_revenue = $3, fnb_revenue = $4,
                         deposit_amount = $5, updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [storedTotal, discountAmount, roomNet, mealNet, depositAmount, before.id]
  );
  await roomCharge.repostStay(client, after, userId);
  await recomputeBookingStatus(client, before.id);

  return { after, payable, storedTotal, received, credit, receivedFixes, discountAmount };
}

module.exports = { grossFactor, splitRevenue, applyBookingPrice, snapPayable };
