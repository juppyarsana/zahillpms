// Cashier closing (migration 093) — every payment received on a day, line by
// line, by method and by the user who took it, for checking against the EDC
// slips, the transfers and the cash drawer.
//
// The lines are the same money as dailyClose.collected() (Daily Close,
// Reports → Money, the night audit's "Money received"): received payments,
// extras / activities paid directly that have no payment row, and agent
// payments — so all users' closings for a day add up to that figure.
// Stays billed to an agent at check-out are the last group, "Agent ledger"
// (as FO's old closing had it): they settle the guest's bill, so they are in
// the grand total, but nothing was received — `money_total` leaves them out.
const db = require('../db');
const { PAID_AT_DESK_SQL, billRates, computeFolioTotals, round2 } = require('./folioService');

const TZ = `'Asia/Makassar'`;
const LEDGER = 'Agent ledger';
const WHAT = { deposit: 'Room deposit', balance: 'Room balance', incidental: 'Extras', group: 'Group payment' };

async function load(propertyId, date, { userId = null } = {}) {
  const { rows } = await db.query(`
    WITH money AS (
      SELECT p.method, p.amount, p.reference, p.notes, p.type AS kind,
             p.recorded_at AS at, p.received_by AS user_id,
             b.id AS booking_id, u.name AS room, g.name AS guest, NULL::uuid AS group_id
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN units u ON u.id = b.unit_id
      JOIN guests g ON g.id = b.guest_id
      WHERE b.property_id = $1 AND p.status = 'received'
        AND (p.received_at AT TIME ZONE ${TZ})::date = $2::date
      UNION ALL
      SELECT s.payment_method, s.total_amount + COALESCE(s.service_charge_amount, 0) + COALESCE(s.tax_amount, 0),
             NULL, COALESCE(s.description, (SELECT string_agg(COALESCE(si.description, pr.name), ', ')
                                            FROM sale_items si LEFT JOIN products pr ON pr.id = si.product_id WHERE si.sale_id = s.id)),
             'sale', s.created_at, s.served_by, s.booking_id, su.name, COALESCE(sg.name, 'Walk-in'), NULL
      FROM sales s
      LEFT JOIN bookings sb ON sb.id = s.booking_id
      LEFT JOIN units su ON su.id = sb.unit_id
      LEFT JOIN guests sg ON sg.id = sb.guest_id
      WHERE s.property_id = $1
        AND s.payment_method NOT IN ('room_charge', 'unpaid')
        AND s.confirmation_status IS DISTINCT FROM 'rejected'
        AND (s.created_at AT TIME ZONE ${TZ})::date = $2::date
        AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.sale_id = s.id)
      UNION ALL
      SELECT ab.payment_method,
             ab.total_amount + CASE WHEN ab.tax_mode = 'added'
                                    THEN COALESCE(ab.service_charge_amount, 0) + COALESCE(ab.tax_amount, 0) ELSE 0 END,
             NULL, a.name, 'activity', ab.created_at, ab.created_by, ab.booking_id, au.name,
             COALESCE(ag.name, ab.guest_name, 'Walk-in'), NULL
      FROM activity_bookings ab
      JOIN activities a ON a.id = ab.activity_id
      LEFT JOIN bookings abk ON abk.id = ab.booking_id
      LEFT JOIN units au ON au.id = abk.unit_id
      LEFT JOIN guests ag ON ag.id = abk.guest_id
      WHERE ab.property_id = $1 AND ab.payment_method IS NOT NULL AND ab.payment_method <> 'room_charge'
        AND ab.status <> 'cancelled'
        AND (ab.created_at AT TIME ZONE ${TZ})::date = $2::date
        AND NOT EXISTS (SELECT 1 FROM payments p3 WHERE p3.activity_booking_id = ab.id)
      UNION ALL
      SELECT ap.method, ap.amount, ap.reference, ap.notes, 'agent', ap.created_at, ap.created_by,
             NULL, NULL, COALESCE(agn.name, 'Agent'), NULL
      FROM agent_payments ap
      LEFT JOIN agents agn ON agn.id = ap.agent_id
      WHERE ap.property_id = $1 AND ap.received_on = $2::date
      UNION ALL
      -- A payment from a group billed as a whole (migration 097): one line,
      -- its rooms listed, the booker as the guest.
      SELECT gp.method, gp.amount, gp.reference, gp.notes, 'group', gp.recorded_at, gp.received_by,
             NULL, (SELECT 'Group · ' || string_agg(gu.name, ', ' ORDER BY gu.name) FROM bookings gb JOIN units gu ON gu.id = gb.unit_id
                    WHERE gb.reservation_group_id = gp.group_id AND gb.status NOT IN ('cancelled', 'no_show')),
             gg.name, gp.group_id
      FROM group_payments gp
      JOIN reservation_groups rg ON rg.id = gp.group_id
      JOIN guests gg ON gg.id = rg.primary_guest_id
      WHERE gp.property_id = $1 AND NOT gp.is_voided
        AND (gp.received_at AT TIME ZONE ${TZ})::date = $2::date
    )
    SELECT money.*, COALESCE(pm.label, money.method, 'Other') AS method_label,
           us.name AS user_name,
           to_char(money.at AT TIME ZONE ${TZ}, 'HH24:MI') AS time,
           to_char(money.at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS recorded_on
    FROM money
    LEFT JOIN payment_methods pm ON pm.id = money.method AND pm.property_id = $1
    LEFT JOIN users us ON us.id = money.user_id
    WHERE money.amount > 0
    ORDER BY method_label, money.at NULLS FIRST, room
  `, [propertyId, date]);

  const all = rows.map(r => ({
    method: r.method_label,
    // the time is only shown when the payment was recorded on this same day
    time: r.kind === 'agent' ? null : (r.recorded_on === date ? r.time : null),
    recorded_on: r.recorded_on && r.recorded_on !== date && r.kind !== 'agent' ? r.recorded_on : null,
    room: r.room, guest: r.guest, booking_id: r.booking_id, group_id: r.group_id || null,
    what: WHAT[r.kind] || (r.kind === 'sale' ? 'Sale' : r.kind === 'activity' ? 'Activity' : 'Agent payment'),
    reference: r.reference || null,
    notes: r.notes || null,
    amount: parseFloat(r.amount),
    user_id: r.user_id, user_name: r.user_name || '—',
  }));

  // Billed to an agent at check-out that day: the bill is settled on the
  // agent's ledger — a line of the closing of whoever checked the guest out.
  const { rows: [settings] } = await db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]);
  const { rows: billed } = await db.query(`
    SELECT b.id AS booking_id, b.bill_tax_rate, b.bill_service_charge_rate, u.name AS room, g.name AS guest,
           COALESCE(a.name, 'No agent') AS agent, ai.invoice_number,
           cr.checkout_by AS user_id, us.name AS user_name,
           to_char(cr.checkout_time AT TIME ZONE ${TZ}, 'HH24:MI') AS time,
           COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                     WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode = 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS charge_subtotal,
           COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                     WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode <> 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS untaxed_subtotal
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    JOIN guests g ON g.id = b.guest_id
    JOIN checkin_records cr ON cr.booking_id = b.id
    LEFT JOIN agents a ON a.id = b.agent_id
    LEFT JOIN agent_invoices ai ON ai.id = b.agent_invoice_id
    LEFT JOIN users us ON us.id = cr.checkout_by
    WHERE b.property_id = $1 AND b.folio_status IS NOT NULL AND b.status = 'checked_out'
      AND (cr.checkout_time AT TIME ZONE ${TZ})::date = $2::date
    ORDER BY cr.checkout_time`, [propertyId, date]);
  for (const r of billed) {
    const rates = billRates(r, settings || {});
    const amount = round2(computeFolioTotals(parseFloat(r.charge_subtotal), rates.tax_rate, rates.service_charge_rate).total + parseFloat(r.untaxed_subtotal));
    if (!(amount > 0.005)) continue;
    all.push({
      method: LEDGER, ledger: true, time: r.time, recorded_on: null,
      room: r.room, guest: r.guest, booking_id: r.booking_id,
      what: 'Billed to agent', reference: r.agent, notes: r.invoice_number ? `Invoice ${r.invoice_number}` : null,
      amount, user_id: r.user_id, user_name: r.user_name || '—',
    });
  }

  // Everyone who took money or checked out an agent stay that day — the
  // picker, and the per-user totals.
  const byUser = new Map();
  for (const l of all) {
    const k = l.user_id || '';
    const u = byUser.get(k) || { id: l.user_id, name: l.user_name, total: 0, count: 0 };
    u.total = round2(u.total + l.amount); u.count += 1;
    byUser.set(k, u);
  }

  const lines = userId ? all.filter(l => l.user_id === userId) : all;
  const groups = [];
  for (const l of lines) {
    let g = groups[groups.length - 1];
    if (!g || g.method !== l.method) { g = { method: l.method, ledger: !!l.ledger, lines: [], subtotal: 0 }; groups.push(g); }
    g.lines.push(l);
    g.subtotal = round2(g.subtotal + l.amount);
  }
  const sum = (arr, f = () => true) => round2(arr.filter(f).reduce((s, l) => s + l.amount, 0));

  const picked = userId ? [...byUser.values()].find(u => u.id === userId) : null;
  return {
    date,
    user_id: userId,
    user_name: userId ? (picked?.name || null) : null,
    users: [...byUser.values()].filter(u => u.id).sort((a, b) => a.name.localeCompare(b.name)),
    by_user: [...byUser.values()].sort((a, b) => b.total - a.total),
    groups,
    by_method: groups.map(g => ({ method: g.method, ledger: g.ledger, amount: g.subtotal, count: g.lines.length })),
    count: lines.length,
    total: sum(lines),                          // grand total, agent ledger included
    money_total: sum(lines, l => !l.ledger),    // money actually received (= Daily Close "collected" for all users)
    ledger_total: sum(lines, l => l.ledger),
    day_total: sum(all),
  };
}

module.exports = { load };
