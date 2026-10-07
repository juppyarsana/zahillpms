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
// Closed days (migration 102): once a day is closed its postings are kept in
// gl_closed_days and never rebuilt. A later change to that day (a line voided,
// a payment's date corrected, a night posted late…) shows up as the difference
// between the day rebuilt from today's data and what was kept; that difference
// is posted as "Corrections to closed days" in the next day that is closed.
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
  ['adjust', 'Corrections to closed days'],
];
const ENTRY_LABEL = Object.fromEntries(ENTRIES);
// Money received (the Daily Close's "collected"): the cash side of these entries.
const MONEY_ENTRIES = ['receipts', 'direct', 'agent_paid'];
const isMoney = p => MONEY_ENTRIES.includes(p.of_entry || p.entry) && p.key.startsWith('pay.');
const LOOKBACK_DAYS = 366;   // how far back closed days are checked for changes
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
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

// Every posting of the period, rebuilt from today's data: signed amounts
// (> 0 debit, < 0 credit) by mapping key. At most MAX_DAYS days.
async function collectPosts(propertyId, from, to) {
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
  const post = (date, entry, key, amount, ref, memo) => {
    const a = round2(amount);
    if (Math.abs(a) < 0.005) return;
    posts.push({ date, entry, key, amount: a, ref: ref || '', memo: memo || '' });
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
    post(p.day, 'receipts', `pay.${p.method || 'other'}`, num(p.amount), ref, memo);
    post(p.day, 'receipts', arrived ? 'ledger.guest' : 'ledger.deposits', -num(p.amount), ref, memo);
  }
  for (const p of groupPayments) {
    const ref = `Group · ${p.guest}`;
    const memo = [p.is_refund ? 'Group refund' : 'Group payment', p.reference].filter(Boolean).join(' · ');
    const arrived = p.arrival && p.day >= p.arrival;
    post(p.day, 'receipts', `pay.${p.method || 'other'}`, num(p.amount), ref, memo);
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
    post(s.day, 'direct', `pay.${s.payment_method}`, net + sc + tax, ref, s.description || 'Sale');
    if (s.on_folio) { post(s.day, 'direct', 'ledger.guest', -(net + sc + tax), ref, 'On the stay\'s folio'); continue; }
    for (const [k, v] of saleParts(net, itemsBySale.get(s.id), s.order_source)) post(s.day, 'direct', k, -v, ref, s.description || 'Sale');
    post(s.day, 'direct', 'tax.service', -sc, ref);
    post(s.day, 'direct', 'tax.pb1', -tax, ref);
  }
  for (const a of activityMoney) {
    post(a.day, 'direct', `pay.${a.payment_method}`, num(a.paid), a.guest, `Activity · ${a.name}`);
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
    post(p.day, 'agent_paid', `pay.${p.method || 'other'}`, num(p.amount), p.agent, p.reference);
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

  return { posts, mapping };
}

// Live postings for any span, in chunks of MAX_DAYS.
async function collectSpan(propertyId, from, to) {
  const posts = [];
  let mapping = null;
  for (let a = from; a <= to; a = addDays(a, MAX_DAYS)) {
    const b = addDays(a, MAX_DAYS - 1) < to ? addDays(a, MAX_DAYS - 1) : to;
    const r = await collectPosts(propertyId, a, b);
    posts.push(...r.posts); mapping = r.mapping;
  }
  return { posts, mapping: mapping || await loadMapping(propertyId) };
}

const side = amount => ({ debit: amount > 0 ? round2(amount) : 0, credit: amount < 0 ? round2(-amount) : 0 });

// Postings → days / entries / lines per account. A posting kept from a closed
// day carries the account it was closed with; a live one takes today's mapping.
function render(posts, mapping, closedDates) {
  const unmapped = new Map();
  const accountOf = p => {
    if (p.account) return p.account;
    const r = mapping.resolve(p.key);
    if (r.account) return { id: r.account.id, code: r.account.code, name: r.account.name, type: r.account.type };
    unmapped.set(p.key, r.label);
    return { id: `unmapped:${p.key}`, code: '—', name: `No account chosen: ${r.label}`, type: '', unmapped: true };
  };
  const lineSort = (a, b) => (b.debit > 0) - (a.debit > 0) || a.account_code.localeCompare(b.account_code);

  const dayMap = new Map();      // date → entry → account id → { account, amount }
  const trial = new Map();       // account id → { account, debit, credit }
  for (const p of posts) {
    const acc = accountOf(p);
    p.account = acc;
    const d = dayMap.get(p.date) || new Map(); dayMap.set(p.date, d);
    const e = d.get(p.entry) || new Map(); d.set(p.entry, e);
    const cell = e.get(acc.id) || { account: acc, amount: 0 }; e.set(acc.id, cell);
    cell.amount += p.amount;
  }
  const days = [];
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
    days.push({ date, closed: closedDates.has(date), entries, debit, credit, balanced: entries.every(e => e.balanced) });
  }
  return {
    days,
    totals: { debit: totalDebit, credit: totalCredit },
    balanced: days.every(d => d.balanced),
    accounts: [...trial.values()].sort((a, b) => a.account_code.localeCompare(b.account_code))
      .map(a => ({ ...a, net_debit: a.debit > a.credit ? round2(a.debit - a.credit) : 0, net_credit: a.credit > a.debit ? round2(a.credit - a.debit) : 0 })),
    unmapped: [...unmapped.values()],
  };
}

async function closedRows(propertyId, from, to) {
  const { rows } = await db.query(
    `SELECT ${ymd('business_date')} AS date, postings FROM gl_closed_days
     WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date ORDER BY business_date`, [propertyId, from, to]);
  return rows;
}
const storedPosts = row => row.postings.map(p => ({ ...p, date: row.date }));

// The journal of a period: closed days as they were kept, open days rebuilt
// from today's data.
async function buildJournal(propertyId, from, to, { withDetail = false } = {}) {
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (!(span >= 1) || span > MAX_DAYS) return { error: `Choose a period of 1 to ${MAX_DAYS} days` };
  const closed = await closedRows(propertyId, from, to);
  const closedDates = new Set(closed.map(r => r.date));
  const allClosed = closedDates.size === span;
  const live = allClosed ? { posts: [], mapping: await loadMapping(propertyId) } : await collectPosts(propertyId, from, to);
  const posts = [...closed.flatMap(storedPosts), ...live.posts.filter(p => !closedDates.has(p.date))];
  const out = render(posts, live.mapping, closedDates);

  // ── Checks against the rest of the PMS ──
  const { collected } = require('./dailyClose');
  const { getReport } = require('../routes/reports');   // lazy: route file
  const [pmsMoney, report] = await Promise.all([collected(propertyId, from, to), getReport(propertyId, from, to)]);
  const journalMoney = round2(posts.filter(isMoney).reduce((s, p) => s + p.amount, 0));
  const credited = test => round2(-posts.filter(p => test(p.key)).reduce((s, p) => s + p.amount, 0));
  const revenueRows = [
    ['Room', credited(k => k === 'revenue.room'), report.room_revenue],
    ['F&B', credited(k => k.startsWith('revenue.fnb')), report.fnb_revenue],
    ['Extras', credited(k => k.startsWith('revenue.extra.')), report.ancillary_revenue],
    ['Activities', credited(k => k === 'revenue.activities'), report.activity_revenue],
  ].map(([label, journal, reports]) => ({ label, journal, reports: round2(reports), difference: round2(journal - reports) }));

  const result = {
    from, to, ...out,
    closed_days: closedDates.size,
    has_corrections: posts.some(p => p.entry === 'adjust'),
    checks: {
      money: { journal: journalMoney, pms: round2(pmsMoney.total), difference: round2(journalMoney - pmsMoney.total) },
      revenue: revenueRows,
    },
  };
  if (withDetail) {
    const order = Object.fromEntries(ENTRIES.map(([c], i) => [c, i]));
    result.detail = posts
      .sort((a, b) => a.date.localeCompare(b.date) || order[a.entry] - order[b.entry] || (a.ref || '').localeCompare(b.ref || '') || b.amount - a.amount)
      .map(p => ({ date: p.date, entry: ENTRY_LABEL[p.entry], ref: p.ref, memo: p.memo, account_code: p.account.code, account_name: p.account.name, ...side(p.amount) }));
  }
  return result;
}

// ── Closing days ──────────────────────────────────────────────────────────

const SEP = '\u0001';

// Changes made to closed days since they were closed: per closed day, the day
// rebuilt from today's data minus what was kept minus corrections already
// posted for it — by entry, mapping key and room / guest.
async function pendingCorrections(propertyId, q = db) {
  const { rows: [range] } = await q.query(
    `SELECT ${ymd('MAX(business_date)')} AS last, ${ymd('MIN(business_date)')} AS first FROM gl_closed_days WHERE property_id = $1`, [propertyId]);
  if (!range.last) return { first: null, last: null, posts: [] };
  const lookback = addDays(range.last, -(LOOKBACK_DAYS - 1));
  const since = lookback > range.first ? lookback : range.first;
  const { rows } = await q.query(
    `SELECT ${ymd('business_date')} AS date, postings FROM gl_closed_days WHERE property_id = $1 ORDER BY business_date`, [propertyId]);
  const kept = new Map();   // day | entry | key | ref → amount already in the books for that day
  const bump = (map, day, entry, key, ref, amount) => {
    const k = [day, entry, key, ref || ''].join(SEP);
    map.set(k, (map.get(k) || 0) + amount);
  };
  const closedDates = new Set();
  for (const row of rows) {
    if (row.date >= since) closedDates.add(row.date);
    for (const p of row.postings) {
      if (p.entry === 'adjust') bump(kept, p.for_date, p.of_entry, p.key, p.ref, p.amount);
      else bump(kept, row.date, p.entry, p.key, p.ref, p.amount);
    }
  }
  const { posts: live } = await collectSpan(propertyId, since, range.last);
  const now = new Map();
  for (const p of live) if (closedDates.has(p.date)) bump(now, p.date, p.entry, p.key, p.ref, p.amount);

  // A change of room or guest name only moves an amount from one "room ·
  // guest" to another: nothing changed for the account, so it is no correction.
  const perKey = new Map();
  const all = new Set([...kept.keys(), ...now.keys()]);
  for (const k of all) {
    const [day, entry, key] = k.split(SEP);
    const g = [day, entry, key].join(SEP);
    perKey.set(g, (perKey.get(g) || 0) + (now.get(k) || 0) - (kept.get(k) || 0));
  }
  const posts = [];
  for (const k of all) {
    const [day, entry, key, ref] = k.split(SEP);
    if (!closedDates.has(day)) continue;
    if (Math.abs(perKey.get([day, entry, key].join(SEP))) < 0.005) continue;
    const diff = round2((now.get(k) || 0) - (kept.get(k) || 0));
    if (Math.abs(diff) < 0.005) continue;
    posts.push({ entry: 'adjust', of_entry: entry, for_date: day, key, amount: diff, ref, memo: `Correction of ${day} · ${ENTRY_LABEL[entry] || entry}` });
  }
  posts.sort((a, b) => a.for_date.localeCompare(b.for_date) || a.ref.localeCompare(b.ref) || b.amount - a.amount);
  return { first: range.first, last: range.last, posts };
}

// What the Accounting page shows about closing: how far the books are closed
// and the corrections waiting for the next close.
async function closingStatus(propertyId) {
  const [pending, mapping] = await Promise.all([pendingCorrections(propertyId), loadMapping(propertyId)]);
  const byDay = new Map();
  for (const p of pending.posts) byDay.set(p.for_date, [...(byDay.get(p.for_date) || []), p]);
  const corrections = [...byDay.entries()].map(([date, posts]) => ({
    date,
    items: posts.map(p => {
      const r = mapping.resolve(p.key);
      return { ref: p.ref, what: ENTRY_LABEL[p.of_entry] || p.of_entry, account_code: r.account?.code || '—', account_name: r.account?.name || r.label, ...side(p.amount) };
    }),
  }));
  return { closed_from: pending.first, closed_through: pending.last, corrections };
}

// Closes every day from the day after the last closed one (or `start`, the
// first time) up to `upTo`. Corrections to earlier closed days go into the
// last day closed. Returns { error } or { closed, from, through, corrections }.
async function closeDays(propertyId, upTo, userId, { start = null, today } = {}) {
  if (upTo >= today) return { error: 'A day can be closed from the next day on — today is still changing' };
  const client = await db.pool.connect();
  const fail = async error => { await client.query('ROLLBACK'); return { error }; };
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gl_close:${propertyId}`]);
    const pending = await pendingCorrections(propertyId, client);
    const from = pending.last ? addDays(pending.last, 1) : start;
    if (!from) return await fail('Choose the first day of the books');
    if (upTo < from) return await fail(pending.last ? `The books are already closed through ${pending.last}` : 'The last day must be on or after the first day');
    const span = Math.round((Date.parse(upTo) - Date.parse(from)) / 86400000) + 1;
    if (span > MAX_DAYS) return await fail(`Close at most ${MAX_DAYS} days at a time`);

    const { posts, mapping } = await collectPosts(propertyId, from, upTo);
    if ([...posts, ...pending.posts].some(p => !mapping.resolve(p.key).account)) {
      return await fail('Some amounts have no account yet — choose one on the Accounts tab before closing');
    }
    // Each posting is kept with the account it has today; the row holds the date.
    const stamp = ({ date, ...p }) => {
      const a = mapping.resolve(p.key).account;
      return { ...p, account: { id: a.id, code: a.code, name: a.name, type: a.type } };
    };
    const byDay = new Map();
    for (const p of posts) byDay.set(p.date, [...(byDay.get(p.date) || []), stamp(p)]);
    for (let d = from; d <= upTo; d = addDays(d, 1)) {
      const rows = byDay.get(d) || [];
      if (d === upTo) rows.push(...pending.posts.map(stamp));
      await client.query(
        'INSERT INTO gl_closed_days (property_id, business_date, closed_by, postings) VALUES ($1, $2, $3, $4)',
        [propertyId, d, userId || null, JSON.stringify(rows)]);
    }
    await client.query('COMMIT');
    return { closed: span, from, through: upTo, corrections: pending.posts.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return { error: 'Those days were just closed by someone else — reload the page' };
    throw err;
  } finally {
    client.release();
  }
}

// Opens the last closed day again (a close made too early). Only the last
// one, so the closed days stay an unbroken run.
async function reopenLastDay(propertyId) {
  const { rows: [row] } = await db.query(
    `DELETE FROM gl_closed_days WHERE property_id = $1
       AND business_date = (SELECT MAX(business_date) FROM gl_closed_days WHERE property_id = $1)
     RETURNING ${ymd('business_date')} AS date`, [propertyId]);
  return row ? { reopened: row.date } : { error: 'No day is closed' };
}

module.exports = { buildJournal, closingStatus, closeDays, reopenLastDay, MAX_DAYS };
