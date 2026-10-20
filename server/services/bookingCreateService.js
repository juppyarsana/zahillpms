// Creating a booking / a group booking — the one place that decides the price
// split, the payment lines and the group billing. Used by POST /api/bookings
// and POST /api/bookings/group (routes/bookings.js) and by the VHP reservation
// import (maintenance/importVhpReservations.js).
//
// Both functions run INSIDE the caller's transaction (no BEGIN / COMMIT here)
// and send nothing: the routes send the confirmation email and the Telegram
// alert after COMMIT, the import sends neither.
// They return { booking, unit, guest } / { group, bookings } on success, or
// { status, error } (error = the JSON body to answer with) when refused —
// the caller then rolls back.
const { computeFolioTotals, round2, stayNights: stayNightList } = require('./folioService');
const ratePlanService = require('./ratePlanService');
const { grossFactor, splitRevenue, snapPayable } = require('./bookingPriceService');
const nightRatesSvc = require('./nightRates');
const agentService = require('./agentService');
const agentBilling = require('./agentBillingService');
const { occupiedUntilSql } = require('./occupancySql');

const BED_PREFS = ['double', 'twin', 'twin_or_double', 'other'];

// Children on a reservation (migration 114): a count next to the adults
// (num_guests) and whether the hotel covers their breakfast. null = bad input.
function parseChildren(input) {
  const raw = input.children;
  const children = raw === undefined || raw === null || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(children) || children < 0 || children > 20) return null;
  return { children, kidsFree: children > 0 && !!input.kids_free_breakfast };
}
async function saveChildren(client, bookingId, kids) {
  if (!kids.children) return;
  await client.query('UPDATE bookings SET children = $1, kids_free_breakfast = $2 WHERE id = $3', [kids.children, kids.kidsFree, bookingId]);
}
const fail = (status, error) => ({ status, error: typeof error === 'string' ? { error } : error });

// One room. `input` = the POST /api/bookings body.
async function createBooking(client, { propertyId, userId, input }) {
  const { guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, special_requests, internal_notes, status, discount_type, discount_value, rate_plan_id, bed_preference, room_revenue } = input;
  if (!guest_id || !unit_id || !check_in_date || !check_out_date) {
    return fail(400, 'guest_id, unit_id, check_in_date, check_out_date required');
  }
  const commission = agentService.parseBookingCommission(input);
  if (commission.error) return fail(400, commission.error);
  const kids = parseChildren(input);
  if (!kids) return fail(400, 'children must be a whole number from 0 to 20');
  if (bed_preference && !BED_PREFS.includes(bed_preference)) {
    return fail(400, `bed_preference must be one of ${BED_PREFS.join(', ')}`);
  }

  const { rows: unitRows } = await client.query('SELECT id, name FROM units WHERE id = $1 AND property_id = $2', [unit_id, propertyId]);
  if (!unitRows[0]) return fail(404, 'Unit not found');
  const { rows: guestRows } = await client.query('SELECT id, name FROM guests WHERE id = $1 AND property_id = $2', [guest_id, propertyId]);
  if (!guestRows[0]) return fail(404, 'Guest not found');
  const agentPick = await agentService.agentForBooking(client, propertyId, { agentId: input.agent_id, source: source || 'direct' });
  if (agentPick.error) return fail(404, agentPick.error);

  // Check availability
  const conflict = await client.query(`
    SELECT id FROM bookings
    WHERE unit_id = $1
      AND property_id = $4
      AND status NOT IN ('cancelled','no_show')
      AND check_in_date < $3
      AND ${occupiedUntilSql('')} > $2
  `, [unit_id, check_in_date, check_out_date, propertyId]);
  if (conflict.rows.length > 0) return fail(409, 'Unit is not available for the selected dates');

  // A price per night (migration 090): the total is then the nights' sum.
  const nightPrices = nightRatesSvc.parseNightPrices(input.night_prices, stayNightList(check_in_date, check_out_date));
  if (nightPrices?.error) return fail(400, nightPrices);
  const total = nightPrices ? nightPrices.total : parseFloat(total_amount || 0);

  // Compute discount
  const dType  = discount_type || null;
  const dValue = parseFloat(discount_value || 0);
  let discountAmount = 0;
  if (dType === 'fixed')      discountAmount = Math.min(dValue, total);
  if (dType === 'percentage') discountAmount = Math.round(total * dValue / 100);

  // Rate plan + room/F&B net split
  const nights = Math.max(1, Math.round((new Date(check_out_date) - new Date(check_in_date)) / 86400000));
  const guests = Math.max(1, parseInt(num_guests, 10) || 1);
  const ratePlan = await ratePlanService.resolveForBooking(propertyId, rate_plan_id || null);
  const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, propertyId);
  const { roomNet, mealNet } = splitRevenue({
    grossNet: total - discountAmount, nights, ratePlan, numGuests: guests, F, divisor, clientRoomRevenue: room_revenue,
    tax_rate, service_charge_rate,
  });
  // Store total_amount consistently with the split (pre-discount gross rack);
  // the price typed when the split lands within a few cents of it.
  const payable = room_revenue != null && room_revenue !== ''
    ? computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total
    : snapPayable(computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total, total - discountAmount);
  const storedTotal = round2(payable + discountAmount);

  const net = payable;
  const depositAmount = deposit_amount !== undefined
    ? Math.min(parseFloat(deposit_amount), net)
    : Math.round(net * 0.5); // default deposit 50% (same as New Booking)
  const balanceAmount = round2(net - depositAmount);

  const { rows } = await client.query(
    `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue, agent_id, commission_type, commission_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
    [guest_id, unit_id, check_in_date, check_out_date, num_guests || 1, source || 'direct', storedTotal, depositAmount, dType, dValue, discountAmount, special_requests, internal_notes, status || 'pending', userId, propertyId, ratePlan?.id || null, bed_preference || null, roomNet, mealNet,
     agentPick.agentId, agentPick.agentId ? commission.values.commission_type ?? null : null, agentPick.agentId ? commission.values.commission_value ?? null : null]
  );
  const booking = rows[0];
  await saveChildren(client, booking.id, kids);
  if (kids.children) Object.assign(booking, { children: kids.children, kids_free_breakfast: kids.kidsFree });
  if (nightPrices?.shares) {
    const saved = await nightRatesSvc.saveNightRates(client, {
      bookingId: booking.id, nights: stayNightList(check_in_date, check_out_date), shares: nightPrices.shares, roomNet, mealNet });
    if (saved.error) return fail(400, { error: 'A night is priced below its meals — raise that night or change the rate plan', code: saved.error });
  }
  if (depositAmount > 0) {
    await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'deposit', depositAmount]);
  }
  if (balanceAmount > 0) {
    await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'balance', balanceAmount]);
  }
  return { booking, unit: unitRows[0], guest: guestRows[0] };
}

// 2+ rooms under one guest. `input` = the POST /api/bookings/group body.
// A group's dates are the span of its rooms (first arrival → last
// departure), since each room can have its own dates.
async function createGroup(client, { propertyId, userId, input }) {
  const {
    guest_id, check_in_date, check_out_date, source, status,
    special_requests, internal_notes,
    group_discount_type, group_discount_value, group_deposit_amount,
  } = input;
  const rooms = Array.isArray(input.rooms) ? input.rooms.map(r => ({ ...r })) : null;

  if (!guest_id || !check_in_date || !check_out_date || !rooms || rooms.length < 2) {
    return fail(400, 'guest_id, check_in_date, check_out_date, and at least 2 rooms are required');
  }
  const commission = agentService.parseBookingCommission(input);
  if (commission.error) return fail(400, commission.error);
  const unitIds = rooms.map(r => r.unit_id);
  if (unitIds.some(id => !id) || new Set(unitIds).size !== unitIds.length) {
    return fail(400, 'Each room needs a unit_id, and units must not repeat');
  }
  // Each room can have its own dates (check_in_date / check_out_date on the
  // room); without them it takes the group's.
  const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of rooms) {
    r.ci = r.check_in_date || check_in_date;
    r.co = r.check_out_date || check_out_date;
    if (!ymdRe.test(String(r.ci)) || !ymdRe.test(String(r.co)) || r.co <= r.ci) {
      return fail(400, 'Every room needs a check-out date after its check-in date');
    }
  }

  const { rows: guestRows } = await client.query('SELECT id FROM guests WHERE id = $1 AND property_id = $2', [guest_id, propertyId]);
  if (!guestRows[0]) return fail(404, 'Guest not found');
  // A room may name its own guest (the import does; New Booking doesn't).
  const roomGuestIds = [...new Set(rooms.map(r => r.guest_id).filter(Boolean))];
  if (roomGuestIds.length) {
    const { rows: found } = await client.query('SELECT id FROM guests WHERE id = ANY($1::uuid[]) AND property_id = $2', [roomGuestIds, propertyId]);
    if (found.length !== roomGuestIds.length) return fail(404, 'Guest not found');
  }
  // One agent for the whole group (and its commission, per room)
  const agentPick = await agentService.agentForBooking(client, propertyId, { agentId: input.agent_id, source: source || 'direct' });
  if (agentPick.error) return fail(404, agentPick.error);

  const { rows: unitRows } = await client.query('SELECT id, name FROM units WHERE id = ANY($1::uuid[]) AND property_id = $2', [unitIds, propertyId]);
  if (unitRows.length !== unitIds.length) return fail(404, 'One or more units not found');

  for (const r of rooms) {
    const conflict = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1 AND property_id = $4
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $3 AND ${occupiedUntilSql('')} > $2
    `, [r.unit_id, r.ci, r.co, propertyId]);
    if (conflict.rows.length > 0) {
      const unitName = unitRows.find(u => u.id === r.unit_id)?.name || r.unit_id;
      return fail(409, `Room ${unitName} is not available for ${r.ci} to ${r.co}`);
    }
  }

  if (rooms.some(r => !parseChildren(r))) return fail(400, 'children must be a whole number from 0 to 20');
  if (rooms.some(r => r.bed_preference && !BED_PREFS.includes(r.bed_preference))) {
    return fail(400, `bed_preference must be one of ${BED_PREFS.join(', ')}`);
  }

  const nightsOf = r => Math.max(1, Math.round((new Date(r.co) - new Date(r.ci)) / 86400000));
  const spanIn = rooms.reduce((m, r) => (r.ci < m ? r.ci : m), rooms[0].ci);
  const spanOut = rooms.reduce((m, r) => (r.co > m ? r.co : m), rooms[0].co);
  const { F, tax_rate, service_charge_rate, divisor } = await grossFactor(client, propertyId);

  // A price per night for a room (migration 090): its total is the nights' sum.
  for (const r of rooms) {
    const np = nightRatesSvc.parseNightPrices(r.night_prices, stayNightList(r.ci, r.co));
    if (np?.error) return fail(400, np);
    if (np) { r.total_amount = np.total; r.nightShares = np.shares; }
  }
  const groupTotal = rooms.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);

  const gdType = group_discount_type || null;
  const gdValue = parseFloat(group_discount_value || 0);
  let groupDiscountAmount = 0;
  if (gdType === 'fixed')      groupDiscountAmount = Math.min(gdValue, groupTotal);
  if (gdType === 'percentage') groupDiscountAmount = Math.round(groupTotal * gdValue / 100);
  const groupNet = groupTotal - groupDiscountAmount;
  const groupDepositAmount = Math.min(parseFloat(group_deposit_amount || 0), groupNet);

  // Prorate discount/deposit per room by each room's share of the group total.
  // The last room absorbs the rounding remainder so both sums stay exact.
  let discountRemaining = groupDiscountAmount;
  let depositRemaining = groupDepositAmount;
  const shares = rooms.map((room, i) => {
    const isLast = i === rooms.length - 1;
    const roomTotal = parseFloat(room.total_amount || 0);
    const discountShare = isLast ? discountRemaining : Math.round(groupDiscountAmount * roomTotal / (groupTotal || 1));
    discountRemaining -= discountShare;
    const roomNet = roomTotal - discountShare;
    return { room, roomTotal, discountShare, roomNet, isLast };
  });
  // Second pass for deposit share, since it's proportional to roomNet / groupNet
  shares.forEach(s => {
    s.depositShare = s.isLast ? depositRemaining : Math.round(groupDepositAmount * s.roomNet / (groupNet || 1));
    depositRemaining -= s.depositShare;
    s.balanceShare = s.roomNet - s.depositShare;
  });

  // Billed as a whole (migration 097): one bill and one payment record for
  // the group, no deposit / balance lines on its rooms — except a group
  // billed to a city-ledger agent, which keeps per-room agent billing.
  // The caller can ask for room-by-room payment (group_billing: false) — the
  // channel manager does for OTA reservations, whose room money comes from the OTA.
  let groupBilled = input.group_billing !== false;
  if (groupBilled && agentPick.agentId) {
    const { rows: [ag] } = await client.query('SELECT payment_status FROM agents WHERE id = $1', [agentPick.agentId]);
    if (agentBilling.CITY_LEDGER.includes(ag?.payment_status)) groupBilled = false;
  }
  const billingMode = input.billing_mode === 'everything' ? 'everything' : 'room_meals';

  const { rows: [group] } = await client.query(
    `INSERT INTO reservation_groups (property_id, primary_guest_id, check_in_date, check_out_date, group_discount_type, group_discount_value, group_discount_amount, group_deposit_amount, special_requests, internal_notes, created_by, group_billing, billing_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [propertyId, guest_id, spanIn, spanOut, gdType, gdValue, groupDiscountAmount, groupDepositAmount, special_requests, internal_notes, userId, groupBilled, billingMode]
  );

  const bookings = [];
  for (const s of shares) {
    // Child bookings store the GROUP's discount_type/discount_value verbatim
    // (so BookingDetail.jsx's existing discount box renders unchanged) but
    // their own prorated discount_amount/deposit_amount — that amount won't
    // self-reconcile if recomputed against this one room's total in
    // isolation, which is intentional, not a bug to "fix" later.
    const roomGuests = Math.max(1, parseInt(s.room.num_guests, 10) || 1);
    const roomPlan = await ratePlanService.resolveForBooking(propertyId, s.room.rate_plan_id || null);
    const { roomNet: roomRevNet, mealNet } = splitRevenue({
      grossNet: s.roomNet, nights: nightsOf(s.room), ratePlan: roomPlan, numGuests: roomGuests, F, divisor, tax_rate, service_charge_rate,
    });
    const roomStoredTotal = round2(snapPayable(computeFolioTotals(roomRevNet + mealNet, tax_rate, service_charge_rate).total, s.roomNet) + s.discountShare);

    const { rows: [booking] } = await client.query(
      `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, reservation_group_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue, agent_id, commission_type, commission_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [s.room.guest_id || guest_id, s.room.unit_id, s.room.ci, s.room.co, s.room.num_guests || 1, source || 'direct', roomStoredTotal, groupBilled ? 0 : s.depositShare, gdType, gdValue, s.discountShare, s.room.special_requests ?? special_requests, s.room.internal_notes ?? internal_notes, status || 'pending', userId, propertyId, group.id, roomPlan?.id || null, s.room.bed_preference || null, roomRevNet, mealNet,
       agentPick.agentId, agentPick.agentId ? commission.values.commission_type ?? null : null, agentPick.agentId ? commission.values.commission_value ?? null : null]
    );
    await saveChildren(client, booking.id, parseChildren(s.room));
    if (s.room.nightShares) {
      const saved = await nightRatesSvc.saveNightRates(client, {
        bookingId: booking.id, nights: stayNightList(s.room.ci, s.room.co), shares: s.room.nightShares, roomNet: roomRevNet, mealNet });
      if (saved.error) return fail(400, { error: 'A night is priced below its meals — raise that night or change the rate plan', code: saved.error });
    }
    if (!groupBilled && s.depositShare > 0) {
      await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'deposit', s.depositShare]);
    }
    if (!groupBilled && s.balanceShare > 0) {
      await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'balance', s.balanceShare]);
    }
    bookings.push(booking);
  }
  return { group, bookings };
}

module.exports = { createBooking, createGroup, BED_PREFS };
