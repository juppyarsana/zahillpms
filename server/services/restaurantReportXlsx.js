// Restaurant report as Excel (Restaurant → Report → Download Excel, and the
// Export / Print library): the page's summary + every day, bill, item, room /
// event charge and complimentary bill, for the accountant to check restaurant
// revenue. Built from services/restaurantReport.js (withDetail).
const ExcelJS = require('exceljs');

const RP = '#,##0;[Red]-#,##0';
const PCT = '0.0%';
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B1E2E' } };
const SUB = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3ECE4' } };
const TOT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6D9C8' } };
const WARN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E7' } };
const STATUS = { posted: 'On the bill', voided: 'Voided', missing: 'Not on the folio', not_in_pms: 'Not in the PMS' };

// Excel has no time zones: show WITA by shifting the moment 8 hours.
const wita = iso => (iso ? new Date(new Date(iso).getTime() + 8 * 3600e3) : null);
const day = d => (d ? new Date(d + 'T00:00:00Z') : null);

async function buildRestaurantReportXlsx(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PMS';
  const note = `${r.from} to ${r.to} · amounts in Rupiah · times WITA · from the sessions the POS sent to the PMS`;

  const style = (row, fill, bold) => row.eachCell({ includeEmpty: true }, c => { if (fill) c.fill = fill; if (bold) c.font = { bold: true }; });
  function sheet(name, title, cols, { xSplit = 0, filter = false } = {}) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4, xSplit }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.getCell('A1').value = `${r.property} — ${title}`; ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = note; ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
    const h = ws.getRow(4);
    cols.forEach((c, i) => {
      const cell = h.getCell(i + 1);
      cell.value = c.h; cell.fill = HEAD; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c.money ? 'right' : 'left' };
      const col = ws.getColumn(i + 1); col.width = c.w || 14;
      if (c.money) col.numFmt = RP; if (c.fmt) col.numFmt = c.fmt;
    });
    h.height = 32;
    if (filter) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
    return ws;
  }

  // ── Summary ──
  const s = wb.addWorksheet('Summary', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  [46, 18, 18, 18].forEach((w, i) => { s.getColumn(i + 1).width = w; });
  s.getCell('A1').value = `${r.property} — Restaurant report`; s.getCell('A1').font = { bold: true, size: 15 };
  s.getCell('A2').value = `${r.from} to ${r.to} · printed ${new Date().toISOString().slice(0, 10)} · from the sessions the POS sent`;
  s.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  const head = labels => { s.addRow([]); const row = s.addRow(labels); row.eachCell(c => { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; }); };
  const money = (row, cols) => cols.forEach(c => { row.getCell(c).numFmt = RP; });
  const grey = text => { s.addRow([text]).font = { italic: true, color: { argb: 'FF666666' } }; };

  head(['Revenue', 'Net (revenue)', 'Service + tax', 'Total (guest paid)']);
  const v = r.revenue;
  for (const [label, x] of [['Paid at the restaurant', v.outlet], ['Charged to rooms (on guest folios)', v.rooms], ['Charged to events (meeting room)', v.events]])
    money(s.addRow([`${label} · ${x.bills} bills`, x.net, x.service_tax, x.total]), [2, 3, 4]);
  const tr = s.addRow([`Total restaurant revenue · ${v.total.bills} bills`, v.total.net, v.total.service_tax, v.total.total]);
  money(tr, [2, 3, 4]); style(tr, TOT, true);
  grey('Net = what the PMS Reports and the journal count as F&B restaurant revenue.');
  grey('Room / event charges count on the day the PMS got them, only while still on the bill (voided ones are in "Room & event charges").');

  head(['Paid by (from the POS sessions)', 'Bills', 'Total', 'Share']);
  for (const m of r.methods) { const row = s.addRow([m.method, m.bills, m.total, m.share]); money(row, [3]); row.getCell(4).numFmt = PCT; }
  const mt = s.addRow(['Total', r.methods.reduce((a, m) => a + m.bills, 0), r.methods.reduce((a, m) => a + m.total, 0), r.methods.length ? 1 : 0]);
  money(mt, [3]); mt.getCell(4).numFmt = PCT; style(mt, TOT, true);

  head(['By session', 'Bills', 'Total takings', 'Average bill']);
  for (const x of r.sessions) money(s.addRow([`${x.label} (${x.sessions} sent)`, x.bills, x.total, x.average_bill]), [3, 4]);

  head(['Not revenue', 'Bills', 'Amount', 'Cost']);
  money(s.addRow(['Discounts given', null, r.not_revenue.discounts]), [3]);
  const cp = r.not_revenue.complimentary;
  money(s.addRow(['Complimentary (menu value)', cp.bills, cp.value, cp.cost]), [3, 4]);
  for (const d of cp.by_department) money(s.addRow([`   ${d.department}`, d.bills, d.value, d.cost]), [3, 4]);
  money(s.addRow(['Open bills not paid when the session was sent', null, r.not_revenue.open_bills]), [3]);

  head(['Breakfast (package)', 'Guests', '', '']);
  s.addRow(['Expected', r.breakfast.expected]); s.addRow(['Came', r.breakfast.came]);

  head(['Checks', 'Result', '', '']);
  const k = r.checks;
  const checks = [
    ['Sessions sent', `${k.sessions_sent} of ${k.sessions_expected}`, false],
    ['Sessions not sent', k.missing.length ? `${k.missing.length} — see Checks` : 'None', k.missing.length > 0],
    ["Sessions whose totals don't add up", k.bad_sessions.length ? `${k.bad_sessions.length} — see Checks` : 'None', k.bad_sessions.length > 0],
    ['Room & event charges POS vs PMS', k.charge_problems.length ? `${k.charge_problems.length} to look at — see Room & event charges` : 'All match', k.charge_problems.length > 0],
    ['Sessions sent more than once', k.resent ? `${k.resent} (the last send counts)` : 'None', false],
  ];
  for (const [a, b, bad] of checks) { const row = s.addRow([a, b]); if (bad) row.getCell(2).font = { bold: true, color: { argb: 'FFB91C1C' } }; }
  s.addRow([]);
  grey('Sheets: Daily by session · Bills · Items sold · Menu mix · Room & event charges · Complimentary · Checks');

  // ── Daily by session ──
  const methodCols = r.methods.map(m => m.method);
  const dCols = [
    { h: 'Date', w: 15, fmt: 'ddd dd mmm yyyy' }, { h: 'Session', w: 12 }, { h: 'Bills (all)', w: 8 },
    { h: 'Paid at restaurant — bills', w: 10 }, { h: 'Paid at restaurant — net', money: 1 }, { h: 'Service', money: 1 }, { h: 'Tax', money: 1 },
    { h: 'Paid at restaurant — total', money: 1 }, { h: 'Charged to rooms', money: 1 }, { h: 'Charged to events', money: 1 },
    { h: 'Total takings', money: 1, w: 15 }, ...methodCols.map(m => ({ h: m, money: 1 })),
    { h: 'Discounts', money: 1 }, { h: 'Complimentary (menu value)', money: 1 }, { h: 'Open bills not paid', money: 1 },
    { h: 'Breakfast expected', w: 9 }, { h: 'Breakfast came', w: 9 }, { h: 'Sent by', w: 12 }, { h: 'Sent at', w: 15, fmt: 'dd mmm hh:mm' }, { h: 'Times sent', w: 7 },
  ];
  const ds = sheet('Daily by session', 'Restaurant — daily by session', dCols, { xSplit: 2 });
  const zero = () => ({ bills: 0, ob: 0, net: 0, svc: 0, tax: 0, tot: 0, room: 0, ev: 0, take: 0, m: {}, disc: 0, comp: 0, open: 0, bfe: 0, bfc: 0 });
  const add = (a, x) => { for (const key of Object.keys(x)) if (key === 'm') for (const [mk, mv] of Object.entries(x.m)) a.m[mk] = (a.m[mk] || 0) + mv; else a[key] += x[key]; };
  const vals = (date, label, t, extra = []) => [date, label, t.bills, t.ob, t.net, t.svc, t.tax, t.tot, t.room, t.ev, t.take,
    ...methodCols.map(m => t.m[m] || 0), t.disc, t.comp, t.open, t.bfe || null, t.bfc || null, ...extra];
  const grand = zero();
  for (const d of r.days) {
    const dt = zero();
    for (const x of d.sessions) {
      const t = { bills: x.bills, ob: x.outlet_bills, net: x.outlet_net, svc: x.outlet_service, tax: x.outlet_tax, tot: x.outlet_total,
        room: x.room_total, ev: x.event_total, take: x.total, m: { ...x.methods }, disc: x.discounts, comp: x.comp_value, open: x.open_total,
        bfe: x.breakfast_expected || 0, bfc: x.breakfast_came || 0 };
      const row = ds.addRow(vals(day(d.date), x.label, t, [x.sent_by, wita(x.sent_at), x.send_count]));
      if (!x.check.ok) style(row, WARN);
      add(dt, t);
    }
    for (const m of d.missing) style(ds.addRow([day(d.date), `${m} — not sent`]), WARN);
    if (d.sessions.length) style(ds.addRow(vals(day(d.date), 'Day total', dt)), SUB, true);
    add(grand, dt);
  }
  style(ds.addRow(vals(null, 'PERIOD TOTAL', grand)), TOT, true);

  // ── Bills ──
  const bs = sheet('Bills', 'Restaurant — every bill', [
    { h: 'Date', w: 12, fmt: 'dd mmm yyyy' }, { h: 'Session', w: 10 }, { h: 'Bill no.', w: 17 }, { h: 'POS id', w: 18 },
    { h: 'Opened', w: 14, fmt: 'dd mmm hh:mm' }, { h: 'Paid', w: 14, fmt: 'dd mmm hh:mm' }, { h: 'Table', w: 11 }, { h: 'Room', w: 7 },
    { h: 'Guest', w: 22 }, { h: 'Paid by', w: 13 }, { h: 'Cashier', w: 11 }, { h: 'Subtotal', money: 1 }, { h: 'Discount', money: 1 },
    { h: 'Net', money: 1 }, { h: 'Service', money: 1 }, { h: 'Tax', money: 1 }, { h: 'Total', money: 1 }, { h: 'Discount reason', w: 18 },
  ], { xSplit: 3, filter: true });
  const bt = { sub: 0, disc: 0, net: 0, svc: 0, tax: 0, tot: 0 };
  const num = x => Number(x) || 0;
  for (const b of r.detail.bills) {
    const net = num(b.total) - num(b.service) - num(b.tax);
    bs.addRow([day(b.date), b.session, b.bill_no || '', b.id, wita(b.opened_at), wita(b.paid_at), b.table || '', b.room || '',
      String(b.guest || '').trim(), b.method, b.cashier, num(b.subtotal), num(b.discount), net, num(b.service), num(b.tax), num(b.total), b.discount_label || '']);
    bt.sub += num(b.subtotal); bt.disc += num(b.discount); bt.net += net; bt.svc += num(b.service); bt.tax += num(b.tax); bt.tot += num(b.total);
  }
  style(bs.addRow([null, 'TOTAL', `${r.detail.bills.length} bills`, '', '', '', '', '', '', '', '', bt.sub, bt.disc, bt.net, bt.svc, bt.tax, bt.tot]), TOT, true);

  // ── Items sold ──
  const is = sheet('Items sold', 'Restaurant — every item sold', [
    { h: 'Date', w: 12, fmt: 'dd mmm yyyy' }, { h: 'Session', w: 10 }, { h: 'Bill no.', w: 18 }, { h: 'Paid by', w: 13 },
    { h: 'Item', w: 32 }, { h: 'Add-ons / note', w: 28 }, { h: 'Qty', w: 6 }, { h: 'Unit price', money: 1 }, { h: 'Amount', money: 1 }, { h: 'Package breakfast', w: 10 },
  ], { filter: true });
  for (const b of r.detail.bills) for (const it of b.items || []) {
    const extra = [(it.addons || []).map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', '), it.note].filter(Boolean).join(' · ');
    is.addRow([day(b.date), b.session, b.bill_no || b.id, b.method, it.name, extra, num(it.qty), num(it.unit_price), num(it.amount), it.included ? 'Yes' : '']);
  }

  // ── Menu mix ──
  const ms = sheet('Menu mix', 'Restaurant — items by sales', [
    { h: 'Item', w: 34 }, { h: 'Qty sold', w: 9 }, { h: 'Breakfast', w: 9 }, { h: 'Lunch', w: 9 }, { h: 'Dinner', w: 9 },
    { h: 'Bills', w: 8 }, { h: 'Sales (before discount)', money: 1, w: 16 }, { h: 'Share', w: 8, fmt: PCT },
  ], { filter: true });
  for (const m of r.detail.menu) ms.addRow([m.name, m.qty, m.breakfast || null, m.lunch || null, m.dinner || null, m.bills, m.amount, m.share]);
  style(ms.addRow(['TOTAL', r.detail.menu.reduce((a, m) => a + m.qty, 0), null, null, null, null, r.detail.menu.reduce((a, m) => a + m.amount, 0), r.detail.menu.length ? 1 : 0]), TOT, true);
  ms.addRow([]); ms.addRow(['Package breakfasts (Rp 0 on the bill) are left out of this sheet.']).font = { italic: true };

  // ── Room & event charges ──
  const cs = sheet('Room & event charges', 'Restaurant — room & event charges: POS vs PMS', [
    { h: 'Date', w: 12, fmt: 'dd mmm yyyy' }, { h: 'Session', w: 10 }, { h: 'Charged to', w: 8 }, { h: 'Bill no.', w: 17 }, { h: 'POS id', w: 18 },
    { h: 'Room / event', w: 12 }, { h: 'Guest / event', w: 24 }, { h: 'POS total', money: 1 }, { h: 'PMS total (guest pays)', money: 1, w: 15 },
    { h: 'PMS net (revenue)', money: 1, w: 14 }, { h: 'In the PMS', w: 14 }, { h: 'Difference', money: 1 }, { h: 'Check', w: 40 },
  ], { filter: true });
  const ct = { pos: 0, pms: 0, net: 0 };
  for (const c of r.detail.charges) {
    const row = cs.addRow([day(c.date), c.session || '', c.kind === 'room' ? 'Room' : 'Event', c.bill_no || '', c.pos_bill, c.room || '', c.guest,
      c.pos_total, c.pms_total, c.pms_net, STATUS[c.status], c.difference, c.problem || 'OK']);
    if (c.problem) style(row, WARN);
    ct.pos += c.pos_total || 0; if (c.status === 'posted') { ct.pms += c.pms_total || 0; ct.net += c.pms_net || 0; }
  }
  style(cs.addRow([null, 'TOTAL', '', '', '', '', '', ct.pos, ct.pms, ct.net, 'on the bill only', null,
    r.checks.charge_problems.length ? `${r.checks.charge_problems.length} to look at` : 'All match']), TOT, true);

  // ── Complimentary ──
  const cm = sheet('Complimentary', 'Restaurant — complimentary bills (not revenue)', [
    { h: 'Date', w: 12, fmt: 'dd mmm yyyy' }, { h: 'Session', w: 10 }, { h: 'Time', w: 14, fmt: 'dd mmm hh:mm' }, { h: 'Department', w: 12 },
    { h: 'For', w: 20 }, { h: 'Reason', w: 20 }, { h: 'Items', w: 44 }, { h: 'Table', w: 10 }, { h: 'Cashier', w: 11 },
    { h: 'Menu value', money: 1 }, { h: 'Cost', money: 1 },
  ], { filter: true });
  for (const c of r.detail.complimentary)
    cm.addRow([day(c.date), c.session, wita(c.paid_at), c.department, c.for, c.reason, (c.items || []).map(i => `${i.qty} × ${i.name}`).join(', '),
      c.table || '', c.cashier, num(c.value), num(c.cost)]);
  style(cm.addRow([null, 'TOTAL', '', '', '', '', '', '', '', cp.value, cp.cost]), TOT, true);

  // ── Checks ──
  const ks = sheet('Checks', 'Restaurant — checks', [
    { h: 'Date', w: 15, fmt: 'ddd dd mmm yyyy' }, { h: 'Session', w: 10 }, { h: 'Bills listed — total', money: 1, w: 15 },
    { h: 'By payment method — total', money: 1, w: 15 }, { h: 'Restaurant + rooms + events', money: 1, w: 15 }, { h: 'Result', w: 52 },
  ]);
  for (const d of r.days) for (const x of d.sessions) {
    const row = ks.addRow([day(d.date), x.label, x.check.has_bill_list ? x.check.bills_total : null, x.check.methods_total, x.check.parts_total,
      x.check.ok ? 'OK' : "Totals don't add up — open this session on Restaurant → Sessions"]);
    if (!x.check.ok) style(row, WARN);
  }
  ks.addRow([]);
  style(ks.addRow(['Sessions not sent to the PMS']), null, true);
  if (!k.missing.length) ks.addRow(['None']);
  for (const m of k.missing) style(ks.addRow([day(m.date), m.label, null, null, null, 'Not sent (or the restaurant was closed) — POS → Transactions → Send to hotel']), WARN);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildRestaurantReportXlsx };
