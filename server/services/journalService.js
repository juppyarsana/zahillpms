// Accounting, step 1 (migration 101): the daily double-entry journal, built
// from what the PMS already records — nothing is stored.
//
// Revenue is booked night by night, as the folio is posted:
//   charges      every folio line on its day (a room / meal / extra-bed night
//                on that night, anything else on the day it was posted):
//                Dr Guest ledger · Cr Revenue, Service charge, Tax
//   direct       a sale / activity paid on the spot with no stay behind it:
//                Dr Cash · Cr Revenue, Service charge, Tax
//   pos          restaurant bills paid at the restaurant (POS sessions)
//   receipts     money received: Dr Cash / Bank · Cr Advance deposits (the
//                guest hasn't arrived yet) or Guest ledger (arrived)
//   deposits     on the day a guest checks in, what they paid ahead moves
//                from Advance deposits to the Guest ledger
//   agent_billed a stay billed to an agent at check-out: Dr Agent receivable ·
//                Cr Guest ledger;  agent_paid: Dr Cash · Cr Agent receivable
//   commission   Dr Commission cost · Cr Commission payable
//   expenses     Back Office expenses: Dr Expense · Cr Cash / Bank
//
// Service charge + tax on a stay are the folio's own figures: worked out on
// the stay's running total (as loadFolio does) and each day takes the
// difference, so a stay's days always add up to its bill to the cent.
//
// Known limits (session 2, "closed days"): a line voided, a payment corrected
// or a night posted late changes the journal of the day it belongs to, not of
// the day the change was made.
const db = require('../db');
const { PAID_AT_DESK_SQL, BILL_TAX_SQL, BILL_SC_SQL, billRates, computeFolioTotals, round2 } = require('./folioService');
const { loadMapping, EXTRA_CATEGORIES } = require('./accountingService');

const TZ = `'Asia/Makassar'`;
const dayOf = col => `(${col} AT TIME ZONE ${TZ})::date`;
const ymd = expr => `to_char(${expr}, 'YYYY-MM-DD')`;
const FNB = ['food', 'drinks'];
const num = v => parseFloat(v) || 0;

const ENTRIES = [
  ['charges', 'Guest charges posted'],
  ['direct', 'Sales & activities paid directly'],
  ['pos', 'Restaurant bills paid at the restaurant'],
  ['receipts', 'Money received from guests'],
  ['deposits', 'Advance deposits of guests who checked in'],
  ['agent_billed', 'Stays billed to agents at check-out'],
  ['agent_paid', 'Money received from agents'],
  ['commission', 'Agent commission'],
  ['expenses', 'Expenses'],
];
const MAX_DAYS = 92;

// A sold line's net amount by revenue key. `items` = the sale's lines
// (category, subtotal, meal) — per-night lines are left out, they post night
// by night. A restaurant bill from the POS has no lines: all F&B.
function saleParts(amount, items, orderSource) {
  if (orderSource === 'external_pos') return [['revenue.fnb_outlet', amount]];
  const parts = new Map();
  const add = (k, v) => { if (Math.abs(v) > 0.004) parts.set(k, (parts.get(k) || 0) + v); };
  for (const it of items || []) {
    if (FNB.includes(it.category)) add('revenue.fnb_outlet', num(it.subtotal));
    else {
      const cat = EXTRA_CATEGORIES.includes(it.category) ? it.category : 'other';
      add(`revenue.extra.${cat}`, num(it.subtotal) - num(it.meal));
      add('revenue.fnb_package', num(it.meal));
    }
  }
  const sum = [...parts.values()].reduce((s, v) => s + v, 0);
  if (!parts.size || Math.abs(sum) < 0.005) return [['revenue.extra.other', amount]];
  // The lines don't add up to the amount (a typed price, a night removed):
  // keep their proportions.
  return fit([...parts.entries()], amount);
}

// Scales [key, value] parts to add up to `total` exactly (last part takes the cent).
function fit(parts, total) {
  const sum = parts.reduce((s, [, v]) => s + v, 0);
  if (Math.abs(sum - total) < 0.005) return parts.map(([k, v]) => [k, round2(v)]);
  let left = round2(total);
  return parts.map(([k, v], i) => {
    const part = i === parts.length - 1 ? left : round2(total * v / sum);
    left = round2(left - part);
    return [k, part];
  });
}

async function buildJournal(propertyId, from, to, { withDetail = false } = {}) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (!(days >= 1) || days > MAX_DAYS) return { error: `Choose a period of 1 to ${MAX_DAYS} days` };
  const P = [from, to, propertyId];
  const inRange = d => d >= from && d <= to;
  const chargeDay = `COALESCE(fc.service_date, ${dayOf('fc.posted_at')})`;
  const arrivalSql = bookingCol => `(SELECT MIN(${dayOf('cr.checkin_time')}) FROM checkin_records cr WHERE cr.booking_id = ${bookingCol})`;
  const groupArrivalSql = groupCol => `(SELECT MIN(${dayOf('cr.checkin_time')}) FROM checkin_records cr
     JOIN bookings gb ON gb.id = cr.booking_id WHERE gb.reservation_group_id = ${groupCol})`;

  const [
    mapping, { rows: [settings] }, { rows: charges }, { rows: payments }, { rows: transfers },
    { rows: groupPayments }, { rows: groupTransfers }, { rows: directSales }, { rows: activityMoney },
    { rows: activityRevenue }, { rows: posSessions }, { rows: agentPayments }, { rows: billed },
    { rows: commissions }, { rows: expenses },
  ] = await Promise.all([
    loadMapping(propertyId),
    db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]),
    // Every folio line, up to the end of the period, of each stay with a line
    // in the period (the earlier ones are needed for the running total).
    db.query(`
      WITH touched AS (
        SELECT DISTINCT fc.booking_id FROM folio_charges fc JOIN bookings b ON b.id = fc.booking_id
        WHERE b.property_id = $3 AND fc.is_voided = false AND ${chargeDay} BETWEEN $1::date AND $2::date
      )
      SELECT fc.id, fc.booking_id, fc.type, fc.amount, COALESCE(fc.tax_mode, 'added') AS tax_mode, fc.sale_id,
             ${ymd(chargeDay)} AS day, b.complimentary_scope,
             ${BILL_TAX_SQL} AS tax_rate, ${BILL_SC_SQL} AS sc_rate,
             u.name AS room, g.name AS guest, ${PAID_AT_DESK_SQL} AS paid_at_desk, s.order_source,
             COALESCE(ab.service_charge_amount, 0) AS ab_sc, COALESCE(ab.tax_amount, 0) AS ab_tax,
             LEAST(ba.breakfasts * ba.meal_price, ba.quantity * ba.unit_price) AS addon_meal, pa.category AS addon_category
      FROM folio_charges fc
      JOIN touched t ON t.booking_id = fc.booking_id
      JOIN bookings b ON b.id = fc.booking_id
      JOIN property_settings ps ON ps.property_id = b.property_id
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      LEFT JOIN sales s ON s.id = fc.sale_id
      LEFT JOIN activity_bookings ab ON ab.folio_charge_id = fc.id
      LEFT JOIN booking_addons ba ON ba.id = fc.addon_id
      LEFT JOIN products pa ON pa.id = ba.product_id
      WHERE fc.is_voided = false AND ${chargeDay} <= $2::date
      ORDER BY fc.booking_id, ${chargeDay}, fc.posted_at`, P),
    db.query(`
      SELECT p.amount, p.method, p.type, p.reference, ${ymd(dayOf('p.received_at'))} AS day,
             u.name AS room, g.name AS guest, ${ymd(arrivalSql('b.id'))} AS arrival
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      WHERE b.property_id = $3 AND p.status = 'received' AND p.amount <> 0
        AND ${dayOf('p.received_at')} BETWEEN $1::date AND $2::date`, P),
    // Guests who checked in during the period: what they had paid before that day.
    db.query(`
      SELECT u.name AS room, g.name AS guest, ${ymd('x.arrival')} AS day, SUM(p.amount) AS amount
      FROM bookings b
      JOIN LATERAL (SELECT ${arrivalSql('b.id')} AS arrival) x ON true
      JOIN payments p ON p.booking_id = b.id AND p.status = 'received' AND ${dayOf('p.received_at')} < x.arrival
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      WHERE b.property_id = $3 AND x.arrival BETWEEN $1::date AND $2::date
      GROUP BY b.id, u.name, g.name, x.arrival HAVING SUM(p.amount) <> 0`, P),
    // A group billed as a whole (migration 097): its payments, and its first arrival.
    db.query(`
      SELECT gp.amount, gp.method, gp.is_refund, gp.reference, ${ymd(dayOf('gp.received_at'))} AS day,
             gg.name AS guest, ${ymd(groupArrivalSql('gp.group_id'))} AS arrival
      FROM group_payments gp
      JOIN reservation_groups rg ON rg.id = gp.group_id
      JOIN guests gg ON gg.id = rg.primary_guest_id
      WHERE gp.property_id = $3 AND NOT gp.is_voided AND gp.amount <> 0
        AND ${dayOf('gp.received_at')} BETWEEN $1::date AND $2::date`, P),
    db.query(`
      SELECT gg.name AS guest, ${ymd('x.arrival')} AS day, SUM(gp.amount) AS amount
      FROM reservation_groups rg
      JOIN LATERAL (SELECT ${groupArrivalSql('rg.id')} AS arrival) x ON true
      JOIN group_payments gp ON gp.group_id = rg.id AND NOT gp.is_voided AND ${dayOf('gp.received_at')} < x.arrival
      JOIN guests gg ON gg.id = rg.primary_guest_id
      WHERE rg.property_id = $3 AND x.arrival BETWEEN $1::date AND $2::date
      GROUP BY rg.id, gg.name, x.arrival HAVING SUM(gp.amount) <> 0`, P),
    // Sales paid directly that have no payment row (same rule as dailyClose.collected).
    db.query(`
      SELECT s.id, s.payment_method, s.total_amount, COALESCE(s.service_charge_amount, 0) AS sc, COALESCE(s.tax_amount, 0) AS tax,
             s.order_source, s.description, ${ymd(dayOf('s.created_at'))} AS day, u.name AS room, COALESCE(g.name, 'Walk-in') AS guest,
             EXISTS (SELECT 1 FROM folio_charges fc WHERE fc.sale_id = s.id AND fc.is_voided = false) AS on_folio
      FROM sales s
      LEFT JOIN bookings b ON b.id = s.booking_id
      LEFT JOIN units u ON u.id = b.unit_id
      LEFT JOIN guests g ON g.id = b.guest_id
      WHERE s.property_id = $3 AND s.payment_method NOT IN ('room_charge', 'unpaid')
        AND s.confirmation_status IS DISTINCT FROM 'rejected'
        AND ${dayOf('s.created_at')} BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.sale_id = s.id)`, P),
    // Activities paid directly with no payment row: the money, on the day booked.
    db.query(`
      SELECT ab.payment_method, a.name, COALESCE(ab.guest_name, 'Walk-in') AS guest, ${ymd(dayOf('ab.created_at'))} AS day,
             ab.total_amount + CASE WHEN ab.tax_mode = 'added'
                                    THEN COALESCE(ab.service_charge_amount, 0) + COALESCE(ab.tax_amount, 0) ELSE 0 END AS paid,
             (ab.folio_charge_id IS NOT NULL) AS on_folio
      FROM activity_bookings ab JOIN activities a ON a.id = ab.activity_id
      WHERE ab.property_id = $3 AND ab.payment_method IS NOT NULL AND ab.payment_method <> 'room_charge'
        AND ab.status <> 'cancelled'
        AND ${dayOf('ab.created_at')} BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM payments p3 WHERE p3.activity_booking_id = ab.id)`, P),
    // …and their revenue, on the day the activity takes place.
    db.query(`
      SELECT a.name, COALESCE(ab.guest_name, 'Walk-in') AS guest, ${ymd('ab.scheduled_date')} AS day, ab.tax_mode, ab.total_amount,
             COALESCE(ab.service_charge_amount, 0) AS sc, COALESCE(ab.tax_amount, 0) AS tax
      FROM activity_bookings ab JOIN activities a ON a.id = ab.activity_id
      WHERE ab.property_id = $3 AND ab.payment_method IS NOT NULL AND ab.payment_method <> 'room_charge'
        AND ab.folio_charge_id IS NULL AND ab.status IN ('confirmed', 'completed')
        AND ab.scheduled_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM payments p3 WHERE p3.activity_booking_id = ab.id)`, P),
    db.query(`
      SELECT ${ymd('business_date')} AS day, COALESCE(label, session_key) AS session,
             outlet_net, outlet_service, outlet_tax, outlet_total
      FROM pos_sessions WHERE property_id = $3 AND business_date BETWEEN $1::date AND $2::date`, P),
    db.query(`
      SELECT ap.amount, ap.method, ap.reference, ${ymd('ap.received_on')} AS day, COALESCE(ag.name, 'Agent') AS agent
      FROM agent_payments ap LEFT JOIN agents ag ON ag.id = ap.agent_id
      WHERE ap.property_id = $3 AND NOT ap.is_voided AND ap.received_on BETWEEN $1::date AND $2::date`, P),
    // Billed to an agent at check-out (same amount as the Cashier Closing's "Agent ledger").
    db.query(`
      SELECT b.bill_tax_rate, b.bill_service_charge_rate, u.name AS room, g.name AS guest, COALESCE(a.name, 'No agent') AS agent,
             ${ymd(dayOf('cr.checkout_time'))} AS day,
             COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                       WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode = 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS charge_subtotal,
             COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                       WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode <> 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS untaxed_subtotal
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      JOIN checkin_records cr ON cr.booking_id = b.id
      LEFT JOIN agents a ON a.id = b.agent_id
      WHERE b.property_id = $3 AND b.folio_status IS NOT NULL AND b.status = 'checked_out'
        AND ${dayOf('cr.checkout_time')} BETWEEN $1::date AND $2::date`, P),
    db.query(`
      SELECT ac.amount, ${ymd(dayOf('ac.computed_at'))} AS day, COALESCE(ag.name, 'Agent') AS agent, u.name AS room, g.name AS guest
      FROM agent_commissions ac
      JOIN bookings b ON b.id = ac.booking_id
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      LEFT JOIN agents ag ON ag.id = ac.agent_id
      WHERE ac.property_id = $3 AND ac.amount <> 0 AND ${dayOf('ac.computed_at')} BETWEEN $1::date AND $2::date`, P),
    db.query(`
      SELECT e.category, e.amount, e.payment_method, e.description, e.reference, ${ymd('e.incurred_on')} AS day
      FROM expenses e
      WHERE e.property_id = $3 AND e.is_voided = false AND e.incurred_on BETWEEN $1::date AND $2::date`, P),
  ]);

  const saleIds = [...new Set([...charges.filter(c => c.sale_id).map(c => c.sale_id), ...directSales.map(s => s.id)])];
  const itemsBySale = new Map();
  if (saleIds.length) {
    const { rows } = await db.query(`
      SELECT si.sale_id, p.category, SUM(si.subtotal) AS subtotal, SUM(si.meal_amount) AS meal
      FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = ANY($1) AND NOT si.per_night GROUP BY 1, 2`, [saleIds]);
    for (const r of rows) itemsBySale.set(r.sale_id, [...(itemsBySale.get(r.sale_id) || []), r]);
  }

  // Signed postings: amount > 0 is a debit, < 0 a credit.
  const posts = [];
  const post = (date, entry, key, amount, ref, memo, money = false) => {
    const a = round2(amount);
    if (Math.abs(a) < 0.005) return;
    posts.push({ date, entry, key, amount: a, ref: ref || '', memo: memo || '', money });
  };
  const who = (room, guest) => [room, guest].filter(Boolean).join(' · ');

  // ── Guest charges, stay by stay ──
  const byBooking = new Map();
  for (const c of charges) byBooking.set(c.booking_id, [...(byBooking.get(c.booking_id) || []), c]);
  for (const lines of byBooking.values()) {
    const first = lines[0];
    const rates = billRates({ bill_tax_rate: first.tax_rate, bill_service_charge_rate: first.sc_rate }, {});
    const billable = lines.filter(c => !(first.complimentary_scope === 'all' && !['room', 'fnb'].includes(c.type) && !c.paid_at_desk));
    const ref = who(first.room, first.guest);
    let taxable = 0, prevSc = 0, prevTax = 0;
    for (const day of [...new Set(billable.map(c => c.day))]) {
      const credits = new Map();
      const add = (k, v) => credits.set(k, (credits.get(k) || 0) + v);
      let inclSc = 0, inclTax = 0;
      for (const c of billable.filter(x => x.day === day)) {
        const amount = num(c.amount);
        let net = amount;
        if (c.tax_mode === 'added') taxable += amount;
        else if (c.tax_mode === 'included') { inclSc += num(c.ab_sc); inclTax += num(c.ab_tax); net = amount - num(c.ab_sc) - num(c.ab_tax); }
        let parts;
        if (c.type === 'room') parts = [['revenue.room', net]];
        else if (c.type === 'fnb') parts = [['revenue.fnb_package', net]];
        else if (c.type === 'activity') parts = [['revenue.activities', net]];
        else if (c.type === 'addon') {
          const meal = Math.min(num(c.addon_meal), net);
          const cat = EXTRA_CATEGORIES.includes(c.addon_category) ? c.addon_category : 'room_addon';
          parts = [[`revenue.extra.${cat}`, net - meal], ['revenue.fnb_package', meal]];
        } else if (c.type === 'sale') parts = saleParts(net, itemsBySale.get(c.sale_id), c.order_source);
        else parts = [['revenue.extra.other', net]];
        for (const [k, v] of parts) add(k, v);
      }
      const t = computeFolioTotals(taxable, rates.tax_rate, rates.service_charge_rate);
      const sc = round2(t.service_charge_amount - prevSc + inclSc);
      const tax = round2(t.tax_amount - prevTax + inclTax);
      prevSc = t.service_charge_amount; prevTax = t.tax_amount;
      if (!inRange(day)) continue;
      let total = 0;
      for (const [k, v] of credits) { const a = round2(v); total += a; post(day, 'charges', k, -a, ref); }
      post(day, 'charges', 'tax.service', -sc, ref);
      post(day, 'charges', 'tax.pb1', -tax, ref);
      post(day, 'charges', 'ledger.guest', round2(total + sc + tax), ref);
    }
  }

  // ── Money received from guests ──
  const WHAT = { deposit: 'Room deposit', balance: 'Room balance', incidental: 'Extras', refund: 'Refund' };
  for (const p of payments) {
    const ref = who(p.room, p.guest);
    const memo = [WHAT[p.type] || p.type, p.reference].filter(Boolean).join(' · ');
    const arrived = p.arrival && p.day >= p.arrival;
    post(p.day, 'receipts', `pay.${p.method || 'other'}`, num(p.amount), ref, memo, true);
    post(p.day, 'receipts', arrived ? 'ledger.guest' : 'ledger.deposits', -num(p.amount), ref, memo);
  }
  for (const p of groupPayments) {
    const ref = `Group · ${p.guest}`;
    const memo = [p.is_refund ? 'Group refund' : 'Group payment', p.reference].filter(Boolean).join(' · ');
    const arrived = p.arrival && p.day >= p.arrival;
    post(p.day, 'receipts', `pay.${p.method || 'other'}`, num(p.amount), ref, memo, true);
    post(p.day, 'receipts', arrived ? 'ledger.guest' : 'ledger.deposits', -num(p.amount), ref, memo);
  }
  for (const t of [...transfers.map(x => ({ ...x, ref: who(x.room, x.guest) })), ...groupTransfers.map(x => ({ ...x, ref: `Group · ${x.guest}` }))]) {
    post(t.day, 'deposits', 'ledger.deposits', num(t.amount), t.ref, 'Paid before arrival');
    post(t.day, 'deposits', 'ledger.guest', -num(t.amount), t.ref, 'Paid before arrival');
  }

  // ── Paid directly, no payment row ──
  for (const s of directSales) {
    const ref = who(s.room, s.guest);
    const net = num(s.total_amount), sc = num(s.sc), tax = num(s.tax);
    post(s.day, 'direct', `pay.${s.payment_method}`, net + sc + tax, ref, s.description || 'Sale', true);
    if (s.on_folio) { post(s.day, 'direct', 'ledger.guest', -(net + sc + tax), ref, 'On the stay\'s folio'); continue; }
    for (const [k, v] of saleParts(net, itemsBySale.get(s.id), s.order_source)) post(s.day, 'direct', k, -v, ref, s.description || 'Sale');
    post(s.day, 'direct', 'tax.service', -sc, ref);
    post(s.day, 'direct', 'tax.pb1', -tax, ref);
  }
  for (const a of activityMoney) {
    post(a.day, 'direct', `pay.${a.payment_method}`, num(a.paid), a.guest, `Activity · ${a.name}`, true);
    post(a.day, 'direct', a.on_folio ? 'ledger.guest' : 'ledger.deposits', -num(a.paid), a.guest, `Activity · ${a.name}`);
  }
  for (const a of activityRevenue) {
    const total = num(a.total_amount), sc = num(a.sc), tax = num(a.tax);
    const mode = a.tax_mode || 'added';
    const net = mode === 'included' ? total - sc - tax : total;
    const scPart = mode === 'none' ? 0 : sc, taxPart = mode === 'none' ? 0 : tax;
    const memo = `Activity · ${a.name}`;
    post(a.day, 'direct', 'ledger.deposits', net + scPart + taxPart, a.guest, memo);
    post(a.day, 'direct', 'revenue.activities', -net, a.guest, memo);
    post(a.day, 'direct', 'tax.service', -scPart, a.guest, memo);
    post(a.day, 'direct', 'tax.pb1', -taxPart, a.guest, memo);
  }

  // ── Restaurant sessions from the POS ──
  for (const s of posSessions) {
    const total = num(s.outlet_total), service = num(s.outlet_service), tax = num(s.outlet_tax);
    post(s.day, 'pos', 'pos.takings', total, s.session, 'Paid at the restaurant');
    post(s.day, 'pos', 'revenue.fnb_outlet', -(total - service - tax), s.session);   // rounding inside the POS stays in revenue
    post(s.day, 'pos', 'tax.service', -service, s.session);
    post(s.day, 'pos', 'tax.pb1', -tax, s.session);
  }

  // ── Agents ──
  for (const r of billed) {
    const rates = billRates(r, settings || {});
    const amount = round2(computeFolioTotals(num(r.charge_subtotal), rates.tax_rate, rates.service_charge_rate).total + num(r.untaxed_subtotal));
    const ref = who(r.room, r.guest);
    post(r.day, 'agent_billed', 'ledger.agent', amount, ref, r.agent);
    post(r.day, 'agent_billed', 'ledger.guest', -amount, ref, r.agent);
  }
  for (const p of agentPayments) {
    post(p.day, 'agent_paid', `pay.${p.method || 'other'}`, num(p.amount), p.agent, p.reference, true);
    post(p.day, 'agent_paid', 'ledger.agent', -num(p.amount), p.agent, p.reference);
  }
  for (const c of commissions) {
    const ref = who(c.room, c.guest);
    post(c.day, 'commission', 'commission.expense', num(c.amount), ref, c.agent);
    post(c.day, 'commission', 'commission.payable', -num(c.amount), ref, c.agent);
  }

  // ── Expenses ──
  for (const e of expenses) {
    const memo = [e.description, e.reference].filter(Boolean).join(' · ');
    post(e.day, 'expenses', `expense.${e.category}`, num(e.amount), '', memo);
    post(e.day, 'expenses', `pay.${e.payment_method || 'other'}`, -num(e.amount), '', memo);
  }

  // ── Into accounts ──
  const unmapped = new Map();
  const accountOf = key => {
    const r = mapping.resolve(key);
    if (r.account) return { id: r.account.id, code: r.account.code, name: r.account.name, type: r.account.type };
    unmapped.set(key, r.label);
    return { id: `unmapped:${key}`, code: '—', name: `No account chosen: ${r.label}`, type: '', unmapped: true };
  };
  const side = amount => ({ debit: amount > 0 ? round2(amount) : 0, credit: amount < 0 ? round2(-amount) : 0 });
  const lineSort = (a, b) => (b.debit > 0) - (a.debit > 0) || a.account_code.localeCompare(b.account_code);

  const dayMap = new Map();      // date → entry → account id → { account, amount }
  const trial = new Map();       // account id → { account, debit, credit }
  for (const p of posts) {
    const acc = accountOf(p.key);
    p.account = acc;
    const d = dayMap.get(p.date) || new Map(); dayMap.set(p.date, d);
    const e = d.get(p.entry) || new Map(); d.set(p.entry, e);
    const cell = e.get(acc.id) || { account: acc, amount: 0 }; e.set(acc.id, cell);
    cell.amount += p.amount;
  }
  const outDays = [];
  let totalDebit = 0, totalCredit = 0;
  for (const date of [...dayMap.keys()].sort()) {
    const entries = [];
    for (const [code, label] of ENTRIES) {
      const cells = dayMap.get(date).get(code);
      if (!cells) continue;
      const lines = [...cells.values()].map(c => ({
        account_id: c.account.id, account_code: c.account.code, account_name: c.account.name, unmapped: !!c.account.unmapped, ...side(round2(c.amount)),
      })).filter(l => l.debit || l.credit).sort(lineSort);
      if (!lines.length) continue;
      for (const l of lines) {
        const t = trial.get(l.account_id) || { account_code: l.account_code, account_name: l.account_name, type: cells.get(l.account_id).account.type, debit: 0, credit: 0 };
        t.debit = round2(t.debit + l.debit); t.credit = round2(t.credit + l.credit);
        trial.set(l.account_id, t);
      }
      const debit = round2(lines.reduce((s, l) => s + l.debit, 0)), credit = round2(lines.reduce((s, l) => s + l.credit, 0));
      entries.push({ code, label, lines, debit, credit, balanced: Math.abs(debit - credit) < 0.005 });
    }
    const debit = round2(entries.reduce((s, e) => s + e.debit, 0)), credit = round2(entries.reduce((s, e) => s + e.credit, 0));
    totalDebit = round2(totalDebit + debit); totalCredit = round2(totalCredit + credit);
    outDays.push({ date, entries, debit, credit, balanced: entries.every(e => e.balanced) });
  }

  // ── Checks against the rest of the PMS ──
  const { collected } = require('./dailyClose');
  const { getReport } = require('../routes/reports');   // lazy: route file
  const [pmsMoney, report] = await Promise.all([collected(propertyId, from, to), getReport(propertyId, from, to)]);
  const journalMoney = round2(posts.filter(p => p.money).reduce((s, p) => s + p.amount, 0));
  const credited = test => round2(-posts.filter(p => test(p.key)).reduce((s, p) => s + p.amount, 0));
  const revenueRows = [
    ['Room', credited(k => k === 'revenue.room'), report.room_revenue],
    ['F&B', credited(k => k.startsWith('revenue.fnb')), report.fnb_revenue],
    ['Extras', credited(k => k.startsWith('revenue.extra.')), report.ancillary_revenue],
    ['Activities', credited(k => k === 'revenue.activities'), report.activity_revenue],
  ].map(([label, journal, reports]) => ({ label, journal, reports: round2(reports), difference: round2(journal - reports) }));

  const result = {
    from, to, days: outDays,
    totals: { debit: totalDebit, credit: totalCredit },
    balanced: outDays.every(d => d.balanced),
    accounts: [...trial.values()].sort((a, b) => a.account_code.localeCompare(b.account_code))
      .map(a => ({ ...a, net_debit: a.debit > a.credit ? round2(a.debit - a.credit) : 0, net_credit: a.credit > a.debit ? round2(a.credit - a.debit) : 0 })),
    unmapped: [...unmapped.values()],
    checks: {
      money: { journal: journalMoney, pms: round2(pmsMoney.total), difference: round2(journalMoney - pmsMoney.total) },
      revenue: revenueRows,
    },
  };
  if (withDetail) {
    const label = Object.fromEntries(ENTRIES);
    const order = Object.fromEntries(ENTRIES.map(([c], i) => [c, i]));
    result.detail = posts
      .sort((a, b) => a.date.localeCompare(b.date) || order[a.entry] - order[b.entry] || a.ref.localeCompare(b.ref) || b.amount - a.amount)
      .map(p => ({ date: p.date, entry: label[p.entry], ref: p.ref, memo: p.memo, account_code: p.account.code, account_name: p.account.name, ...side(p.amount) }));
  }
  return result;
}

module.exports = { buildJournal, MAX_DAYS };
