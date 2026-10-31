// Discounts given (accountant, 2026-10-30): revenue stays net in the books, and
// this shows what was taken off to get there. Nothing stored, nothing posted.
//
//   Rooms       bookings.discount_amount, shared evenly over the stay's nights
//               and counted per night in the period (the Reports page's rule).
//               Entered incl. service & tax; net = ÷ the booking's bill rates.
//   Restaurant  each bill's discount in the POS session summaries, on the
//               session's business date. A session sent without a bill list
//               only gives a total.
const db = require('../db');
const reports = () => require('../routes/reports');   // lazy: the route file loads services too
const { BILL_TAX_SQL, BILL_SC_SQL, round2 } = require('./folioService');

const num = v => parseFloat(v) || 0;
const ymd = col => `to_char(${col}, 'YYYY-MM-DD')`;
const SESSION_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

async function roomDiscounts(propertyId, from, to) {
  const { rows } = await db.query(`
    ${reports().NIGHTS_CTE}
    SELECT b.id, g.name AS guest, u.name AS room, COALESCE(bs.label, b.source) AS source, a.name AS agent,
           ${ymd('b.check_in_date')} AS check_in, ${ymd('b.check_out_date')} AS check_out, b.nights,
           b.discount_type, b.discount_value, b.discount_amount, b.reservation_group_id AS group_id, gg.name AS group_booker,
           cu.name AS created_by, COUNT(*)::int AS nights_in_period, SUM(n.discount_per_night) AS amount,
           ${BILL_TAX_SQL} AS tax_rate, ${BILL_SC_SQL} AS service_rate
    FROM nights n
    JOIN bookings b ON b.id = n.booking_id
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    JOIN property_settings ps ON ps.property_id = b.property_id
    LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
    LEFT JOIN agents a ON a.id = b.agent_id
    LEFT JOIN reservation_groups rg ON rg.id = b.reservation_group_id
    LEFT JOIN guests gg ON gg.id = rg.primary_guest_id
    LEFT JOIN users cu ON cu.id = b.created_by
    WHERE n.discount_per_night > 0
    GROUP BY b.id, g.name, u.name, bs.label, a.name, gg.name, cu.name, ps.tax_rate, ps.service_charge_rate
    ORDER BY SUM(n.discount_per_night) DESC, g.name`, [from, to, propertyId]);
  return rows.map(r => {
    const factor = (1 + num(r.service_rate) / 100) * (1 + num(r.tax_rate) / 100);
    const amount = round2(num(r.amount));
    return {
      id: r.id, guest: r.guest, room: r.room, source: r.source, agent: r.agent, check_in: r.check_in, check_out: r.check_out,
      nights: r.nights, nights_in_period: r.nights_in_period, group_id: r.group_id, group_booker: r.group_booker, created_by: r.created_by,
      rule: r.discount_type === 'percentage' ? `${num(r.discount_value)}%` : 'Fixed amount',
      whole_stay: round2(num(r.discount_amount)), amount, net: round2(amount / factor),
    };
  });
}

async function restaurantDiscounts(propertyId, from, to) {
  const { rows } = await db.query(
    `SELECT ${ymd('business_date')} AS day, session_key, summary FROM pos_sessions
     WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date ORDER BY business_date, session_key`, [propertyId, from, to]);
  const bills = [];
  let total = 0, withoutDetail = 0;
  for (const s of rows) {
    const summary = s.summary || {};
    total += num(summary.discounts);
    const list = Array.isArray(summary.bill_list) ? summary.bill_list : null;
    if (!list) { if (num(summary.discounts)) withoutDetail += num(summary.discounts); continue; }
    for (const b of list) {
      const amount = num(b.discount);
      if (amount <= 0) continue;
      // A tax-included bill's discount carries its share of service and tax.
      const after = num(b.subtotal) - amount, net = num(b.total) - num(b.service) - num(b.tax);
      bills.push({
        day: s.day, session: SESSION_LABEL[s.session_key] || s.session_key, id: b.id, bill_no: b.bill_no || null,
        where: b.room ? `Room ${b.room}` : (b.table || null), guest: b.guest || null, method: b.method || null, cashier: b.cashier || null,
        label: b.discount_label || null, before: num(b.subtotal), amount: round2(amount),
        net: round2(b.tax_included && after > 0 ? amount * net / after : amount),
      });
    }
  }
  return { bills, total: round2(total), without_detail: round2(withoutDetail), sessions: rows.length };
}

async function build(propertyId, from, to) {
  const [rooms, restaurant, report] = await Promise.all([
    roomDiscounts(propertyId, from, to), restaurantDiscounts(propertyId, from, to), reports().getReport(propertyId, from, to),
  ]);
  const sum = (list, k) => round2(list.reduce((t, r) => t + r[k], 0));
  const roomNet = round2(num(report.room_revenue) + num(report.fnb_breakdown?.rate_plan));
  const restNet = round2(num(report.fnb_breakdown?.outlets));
  const roomDisc = sum(rooms, 'net');
  const restDisc = round2(sum(restaurant.bills, 'net') + restaurant.without_detail);
  const line = (key, label, net, discount, entered) => ({
    key, label, net, discount, entered, before: round2(net + discount),
    pct: net + discount > 0 ? Math.round(discount / (net + discount) * 1000) / 10 : null,
  });
  const lines = [
    line('rooms', 'Rooms & meal plans', roomNet, roomDisc, sum(rooms, 'amount')),
    line('restaurant', 'Restaurant', restNet, restDisc, restaurant.total),
  ];
  return {
    from, to, lines, rooms, restaurant,
    total: { net: round2(roomNet + restNet), discount: round2(roomDisc + restDisc), before: round2(roomNet + restNet + roomDisc + restDisc) },
  };
}

async function buildXlsx(d, propertyName) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  const IDR = '#,##0;[Red]-#,##0';
  const sheet = (name, title, columns, rows) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.getCell('A1').value = `${propertyName} · ${title}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = `${d.from} to ${d.to}. Revenue in the books is after these discounts.`;
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.money) col.numFmt = IDR;
      const h = ws.getCell(3, i + 1);
      h.value = c.header;
      h.font = { bold: true };
      h.border = { bottom: { style: 'thin' } };
    });
    for (const r of rows) ws.addRow(columns.map(c => r[c.key] ?? ''));
    const total = {};
    columns.forEach(c => { if (c.sum) total[c.key] = round2(rows.reduce((t, r) => t + (r[c.key] || 0), 0)); });
    if (Object.keys(total).length && rows.length) {
      const row = ws.addRow(columns.map((c, i) => (i === 0 ? 'Total' : total[c.key] ?? '')));
      row.font = { bold: true };
      row.eachCell(cell => { cell.border = { top: { style: 'thin' } }; });
    }
    return ws;
  };
  sheet('Summary', 'Discounts given', [
    { header: '', key: 'label', width: 24 }, { header: 'Before discount', key: 'before', money: true, sum: true, width: 18 },
    { header: 'Discount', key: 'discount', money: true, sum: true, width: 16 }, { header: 'Revenue (net)', key: 'net', money: true, sum: true, width: 16 },
    { header: 'Discount %', key: 'pct', width: 12 },
  ], d.lines);
  sheet('Rooms', 'Room discounts', [
    { header: 'Guest', key: 'guest', width: 26 }, { header: 'Group', key: 'group_booker', width: 22 }, { header: 'Room', key: 'room', width: 9 },
    { header: 'Source', key: 'source', width: 16 }, { header: 'Agent', key: 'agent', width: 22 }, { header: 'Check-in', key: 'check_in', width: 12 },
    { header: 'Check-out', key: 'check_out', width: 12 }, { header: 'Nights in period', key: 'nights_in_period', width: 10 }, { header: 'Discount', key: 'rule', width: 13 },
    { header: 'Whole stay, incl. tax', key: 'whole_stay', money: true, width: 15 }, { header: 'In period, incl. tax', key: 'amount', money: true, sum: true, width: 15 },
    { header: 'In period, net', key: 'net', money: true, sum: true, width: 15 }, { header: 'Booked by', key: 'created_by', width: 18 },
  ], d.rooms);
  sheet('Restaurant', 'Restaurant discounts', [
    { header: 'Day', key: 'day', width: 12 }, { header: 'Session', key: 'session', width: 11 }, { header: 'Bill', key: 'bill_no', width: 18 },
    { header: 'Table / room', key: 'where', width: 16 }, { header: 'Guest', key: 'guest', width: 22 }, { header: 'Reason', key: 'label', width: 22 },
    { header: 'Paid by', key: 'method', width: 14 }, { header: 'Cashier', key: 'cashier', width: 16 }, { header: 'Bill before discount', key: 'before', money: true, width: 15 },
    { header: 'Discount', key: 'amount', money: true, sum: true, width: 14 }, { header: 'Discount, net', key: 'net', money: true, sum: true, width: 14 },
  ], d.restaurant.bills);
  return wb.xlsx.writeBuffer();
}

module.exports = { build, buildXlsx };
