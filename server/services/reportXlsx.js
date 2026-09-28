const ExcelJS = require('exceljs');

// Excel (.xlsx) version of the Reports page (services/fullReport.js): one sheet
// per section — Revenue, Rooms, Channels, Money — plus Daily (one row per day,
// adding up to the Revenue sheet). Numbers are real numbers (Rupiah format),
// so an accountant can sum / pivot them. Same figures as the page.

const IDR = '#,##0';
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`;
const PCT = '0.0"%"';   // values are already percentages (e.g. 12.5)
const INT = '#,##0';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const GROUP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };

function periodLabel(from, to) {
  const f = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
}

// Title block at the top of every sheet; returns the next free row.
function titleBlock(ws, title, meta) {
  ws.addRow([meta.property]).font = { bold: true, size: 14 };
  ws.addRow([`${title} — ${periodLabel(meta.from, meta.to)}`]).font = { bold: true, size: 12 };
  ws.addRow([meta.note]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
}

// A table: heading line, header row, data rows, optional total row.
// cols = [{ header, key, width, fmt, align }]; rows = objects (+ _bold, _group, _indent).
function table(ws, heading, cols, rows, total, note, { filter = false } = {}) {
  if (heading) ws.addRow([heading]).font = { bold: true, size: 11 };
  if (note) ws.addRow([note]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  const h = ws.addRow(cols.map(c => c.header));
  h.font = { bold: true, size: 10 };
  h.eachCell(c => { c.fill = HEAD_FILL; c.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }; });
  cols.forEach((c, i) => { if (c.align) h.getCell(i + 1).alignment = { horizontal: c.align }; });
  if (filter && rows.length) ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number + rows.length, column: cols.length } };
  if (!rows.length) ws.addRow(['Nothing in this period.']).font = { italic: true, color: { argb: 'FF9CA3AF' } };
  for (const r of rows) {
    const row = ws.addRow(cols.map(c => r[c.key] ?? null));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.fmt && (typeof cell.value === 'number' || cell.value instanceof Date)) cell.numFmt = c.fmt;
      if (i === 0 && r._indent) cell.alignment = { indent: 2 };
    });
    if (r._bold || r._group) row.font = { bold: true };
    if (r._group) row.eachCell({ includeEmpty: true }, c => { c.fill = GROUP_FILL; });
  }
  if (total) {
    const row = ws.addRow(cols.map(c => total[c.key] ?? null));
    row.font = { bold: true };
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.fmt && typeof cell.value === 'number') cell.numFmt = c.fmt;
      cell.border = { top: { style: 'thin', color: { argb: 'FF111827' } } };
    });
  }
  ws.addRow([]);
}

function widths(ws, list) { list.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }

// 'YYYY-MM-DD' → a real Excel date (UTC midnight, so no timezone shift).
const xlDate = s => (s ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))) : null);
const DATE = 'dd mmm yyyy';

async function buildReportXlsx(report, { propertyName, detail } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  wb.created = new Date();
  const meta = {
    property: propertyName || 'Property', from: report.from, to: report.to,
    note: 'Amounts in Rupiah, net: after discounts, before service charge and tax. Same figures as the Reports page.',
  };
  const { revenue: rev, rooms, channels, agents = [], money, bookings: bk, costs } = report;
  const total = rev.total || 0;
  const share = n => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // ── Revenue ──
  const ws1 = wb.addWorksheet('Revenue', { views: [{ state: 'frozen', ySplit: 4 }] });
  titleBlock(ws1, 'Revenue', meta);
  const revRows = [
    { item: 'Rooms', detail: plural(rooms.nights_sold, 'room-night'), amount: rev.room, _group: true },
    { item: 'Food & beverage', detail: '', amount: rev.fnb.total, _group: true },
    { item: 'Meals in the rate plan', detail: 'breakfast / half / full board', amount: rev.fnb.rate_plan, _indent: true },
    { item: 'Breakfast in extras', detail: 'e.g. extra bed with breakfast', amount: rev.fnb.extras, _indent: true },
    { item: 'Restaurant & POS', detail: 'resto app, room dining, external POS', amount: rev.fnb.outlets, _indent: true },
    { item: 'Extras', detail: 'Sales items', amount: rev.extras.total, _group: true },
    ...rev.extras.by_category.map(c => ({ item: c.label, detail: plural(c.qty, 'unit'), amount: c.amount, _indent: true })),
    { item: 'Activities', detail: plural(rev.activities.bookings, 'booking'), amount: rev.activities.total, _group: true },
    ...rev.activities.by_activity.map(a => ({ item: a.name, detail: `${plural(a.bookings, 'booking')} · ${a.pax} pax`, amount: a.amount, _indent: true })),
  ].map(r => ({ ...r, share: share(r.amount) }));
  table(ws1, 'Revenue breakdown', [
    { header: 'Item', key: 'item' }, { header: 'Detail', key: 'detail' },
    { header: 'Amount (Rp)', key: 'amount', fmt: IDR, align: 'right' }, { header: 'Share of revenue', key: 'share', fmt: PCT, align: 'right' },
  ], revRows, { item: 'Total revenue', amount: total, share: total ? 100 : 0 });
  if (rev.complimentary.nights > 0 || rev.complimentary.value > 0) {
    table(ws1, 'Complimentary (given away — not in revenue)', [
      { header: 'Nights', key: 'nights', fmt: INT }, { header: 'Value (Rp, net)', key: 'value', fmt: IDR },
    ], [{ nights: rev.complimentary.nights, value: rev.complimentary.value }]);
  }
  table(ws1, 'Net income', [{ header: 'Item', key: 'item' }, { header: 'Amount (Rp)', key: 'amount', fmt: IDR, align: 'right' }], [
    { item: 'Total revenue', amount: total }, { item: 'Expenses (Back Office)', amount: -(report.expenses_total || 0) },
  ], { item: 'Net income', amount: report.net_income });
  widths(ws1, [34, 36, 18, 18]);

  // ── Rooms ──
  const ws2 = wb.addWorksheet('Rooms', { views: [{ state: 'frozen', ySplit: 4 }] });
  titleBlock(ws2, 'Rooms', meta);
  table(ws2, 'Key figures', [{ header: 'Figure', key: 'k' }, { header: 'Value', key: 'v', align: 'right' }, { header: 'How it is worked out', key: 'n' }], [
    { k: 'Rooms in service', v: rooms.sellable_rooms, n: 'not out of order today' },
    { k: 'Days', v: rooms.days, n: '' },
    { k: 'Room-nights available', v: rooms.available_nights, n: 'rooms in service × days' },
    { k: 'Room-nights sold', v: rooms.nights_sold, n: 'incl. complimentary' },
    { k: 'Occupancy (%)', v: rooms.occupancy, n: 'sold ÷ available' },
    { k: 'ADR (Rp)', v: rooms.adr, n: 'room revenue ÷ paid nights' },
    { k: 'RevPAR (Rp)', v: rooms.revpar, n: 'room revenue ÷ room-nights available' },
    { k: 'Guest-nights', v: rooms.guest_nights, n: 'people × nights' },
    { k: 'Arrivals (bookings)', v: rooms.arrivals.bookings, n: `${plural(rooms.arrivals.guests, 'guest')} checking in` },
    { k: 'Complimentary nights', v: rooms.comp_nights, n: 'in occupancy, not in ADR' },
  ].map(r => ({ ...r })));
  // number formats for the key-figure values
  ws2.eachRow(row => { const v = row.getCell(2).value; if (typeof v === 'number') row.getCell(2).numFmt = /Occupancy/.test(row.getCell(1).value) ? PCT : IDR; });
  table(ws2, 'By room type', [
    { header: 'Room type', key: 'room_type' }, { header: 'Rooms in service', key: 'sellable', fmt: INT, align: 'right' },
    { header: 'Nights sold', key: 'nights', fmt: INT, align: 'right' }, { header: 'Occupancy (%)', key: 'occupancy', fmt: PCT, align: 'right' },
    { header: 'Room revenue (Rp)', key: 'revenue', fmt: IDR, align: 'right' }, { header: 'ADR (Rp)', key: 'adr', fmt: IDR, align: 'right' },
    { header: 'RevPAR (Rp)', key: 'revpar', fmt: IDR, align: 'right' },
  ], rooms.by_room_type, { room_type: 'All rooms', sellable: rooms.sellable_rooms, nights: rooms.nights_sold, occupancy: rooms.occupancy,
    revenue: rev.room, adr: rooms.adr, revpar: rooms.revpar });
  table(ws2, 'By rate plan', [
    { header: 'Rate plan', key: 'rate_plan' }, { header: 'Code', key: 'code' },
    { header: 'Nights', key: 'nights', fmt: INT, align: 'right' }, { header: 'Guest-nights', key: 'guest_nights', fmt: INT, align: 'right' },
    { header: 'Room revenue (Rp)', key: 'room_revenue', fmt: IDR, align: 'right' }, { header: 'Meals (Rp)', key: 'meal_revenue', fmt: IDR, align: 'right' },
    { header: 'ADR (Rp)', key: 'adr', fmt: IDR, align: 'right' },
  ], rooms.by_rate_plan);
  table(ws2, 'By nationality', [
    { header: 'Nationality', key: 'nationality' }, { header: 'Bookings', key: 'bookings', fmt: INT, align: 'right' },
    { header: 'Room-nights', key: 'room_nights', fmt: INT, align: 'right' }, { header: 'Guest-nights', key: 'guest_nights', fmt: INT, align: 'right' },
    { header: 'Room & meals (Rp)', key: 'revenue', fmt: IDR, align: 'right' },
  ], rooms.by_nationality);
  widths(ws2, [26, 18, 14, 16, 20, 16, 16]);

  // ── Channels ──
  const ws3 = wb.addWorksheet('Channels', { views: [{ state: 'frozen', ySplit: 4 }] });
  titleBlock(ws3, 'Channels', meta);
  const chTotal = channels.reduce((s, c) => s + c.revenue, 0);
  table(ws3, 'By booking source', [
    { header: 'Source', key: 'source' }, { header: 'Bookings', key: 'bookings', fmt: INT, align: 'right' },
    { header: 'Nights', key: 'nights', fmt: INT, align: 'right' }, { header: 'Revenue (Rp)', key: 'revenue', fmt: IDR, align: 'right' },
    { header: 'ADR (Rp)', key: 'adr', fmt: IDR, align: 'right' }, { header: 'Share (%)', key: 'share', fmt: PCT, align: 'right' },
  ], channels, { source: 'Total', bookings: channels.reduce((s, c) => s + c.bookings, 0), nights: channels.reduce((s, c) => s + c.nights, 0),
    revenue: chTotal, share: chTotal ? 100 : 0 },
  'Revenue = room + meals in the rate plan for the nights in this period.');
  if (agents.length) {
    table(ws3, 'By agent / company', [
      { header: 'Agent', key: 'agent' }, { header: 'Bookings', key: 'bookings', fmt: INT, align: 'right' },
      { header: 'Nights', key: 'nights', fmt: INT, align: 'right' }, { header: 'Revenue (Rp)', key: 'revenue', fmt: IDR, align: 'right' },
      { header: 'ADR (Rp)', key: 'adr', fmt: IDR, align: 'right' }, { header: 'Share (%)', key: 'share', fmt: PCT, align: 'right' },
      { header: 'Commission (Rp)', key: 'commission', fmt: IDR, align: 'right' },
    ], agents, { agent: 'Total', bookings: agents.reduce((s, a) => s + a.bookings, 0), nights: agents.reduce((s, a) => s + a.nights, 0),
      revenue: agents.reduce((s, a) => s + a.revenue, 0), share: agents.reduce((s, a) => s + a.share, 0), commission: agents.reduce((s, a) => s + a.commission, 0) },
    'Stays with an agent on the booking. Share = of all stay revenue. Commission = posted at check-out in this period.');
  }
  table(ws3, 'Reservations in this period', [
    { header: '', key: 'k' }, { header: 'Bookings', key: 'bookings', fmt: INT, align: 'right' },
    { header: 'Rooms', key: 'rooms', fmt: INT, align: 'right' }, { header: 'Nights', key: 'nights', fmt: INT, align: 'right' },
    { header: 'Value (Rp)', key: 'value', fmt: IDR, align: 'right' },
  ], [
    { k: 'Made', ...bk.made }, { k: 'Cancelled', ...bk.cancelled }, { k: 'No-shows', ...bk.no_shows },
  ], null, 'Made = by the day entered (a group = 1 booking). Cancelled = by the day cancelled. No-shows = due in during the period, never arrived. Net values.');
  widths(ws3, [28, 12, 12, 20, 16, 12, 18]);

  // ── Money ──
  const ws4 = wb.addWorksheet('Money', { views: [{ state: 'frozen', ySplit: 4 }] });
  titleBlock(ws4, 'Money', meta);
  const recTotal = money.received.total;
  table(ws4, 'Received by payment method', [
    { header: 'Method', key: 'method' }, { header: 'Amount (Rp)', key: 'amount', fmt: IDR, align: 'right' }, { header: 'Share (%)', key: 'share', fmt: PCT, align: 'right' },
  ], money.received.by_method.map(m => ({ ...m, share: recTotal ? Math.round((m.amount / recTotal) * 1000) / 10 : 0 })),
  { method: 'Total received', amount: recTotal, share: recTotal ? 100 : 0 },
  'Payments received in this period: guests, extras & activities paid at the desk, agents.');
  const st = money.service_tax;
  table(ws4, 'Service charge & tax (estimate)', [{ header: 'Item', key: 'k' }, { header: 'Amount (Rp)', key: 'v', fmt: IDR, align: 'right' }], [
    { k: `Revenue it applies to`, v: st.taxable_revenue },
    { k: `Service charge (${st.service_charge_rate}%)`, v: st.service_charge },
    { k: `Tax (${st.tax_rate}%)`, v: st.tax },
    { k: 'of which inside tax-included activities', v: st.included_in_activities.service_charge + st.included_in_activities.tax },
  ], { k: 'Service charge + tax', v: st.service_charge + st.tax },
  "At today's rates, on this period's revenue. An estimate for setting money aside — check the filing with your accountant.");
  table(ws4, 'Discounts given', [{ header: 'Bookings', key: 'bookings', fmt: INT }, { header: 'Amount (Rp, as entered incl. tax)', key: 'amount', fmt: IDR, align: 'right' }],
    [money.discounts]);
  const g = money.owed_now.guests;
  table(ws4, `Still owed by guests — as of ${new Date().toLocaleDateString('en-GB')}`, [
    { header: 'Stays', key: 'k' }, { header: 'Bookings', key: 'bookings', fmt: INT, align: 'right' }, { header: 'Amount (Rp)', key: 'amount', fmt: IDR, align: 'right' },
  ], [
    { k: 'Guests who left', ...g.checked_out }, { k: 'Guests in house', ...g.in_house }, { k: 'Upcoming stays', ...g.upcoming },
  ], { k: 'Total', bookings: g.checked_out.bookings + g.in_house.bookings + g.upcoming.bookings, amount: g.checked_out.amount + g.in_house.amount + g.upcoming.amount },
  'Room deposit / balance lines not received yet (agent-billed stays are under agents). Not tied to the period.');
  const ag = money.owed_now.agents;
  table(ws4, 'Still owed by agents — as of today', [
    { header: 'Agent', key: 'agent' }, { header: 'Open bookings', key: 'open_bookings', fmt: INT, align: 'right' },
    { header: 'Owed (Rp)', key: 'outstanding', fmt: IDR, align: 'right' }, { header: 'Not due yet (Rp)', key: 'current', fmt: IDR, align: 'right' },
    { header: 'Overdue (Rp)', key: 'overdue', fmt: IDR, align: 'right' }, { header: 'Over 60 days (Rp)', key: 'over_60', fmt: IDR, align: 'right' },
  ], ag.rows, { agent: 'Total', outstanding: ag.total, overdue: ag.overdue });
  table(ws4, 'Costs by category', [
    { header: 'Category', key: 'label' }, { header: 'Entries', key: 'entries', fmt: INT, align: 'right' },
    { header: 'Amount (Rp)', key: 'amount', fmt: IDR, align: 'right' }, { header: 'Share (%)', key: 'share', fmt: PCT, align: 'right' },
  ], costs.by_category, { label: 'Total costs', entries: costs.by_category.reduce((s, c) => s + c.entries, 0), amount: costs.total, share: costs.total ? 100 : 0 },
  'Back Office → Expenses logged in this period.');
  widths(ws4, [40, 16, 18, 18, 16, 18]);

  // ── Daily ──
  const ws5 = wb.addWorksheet('Daily', { views: [{ state: 'frozen', ySplit: 5 }] });
  titleBlock(ws5, 'Daily breakdown', meta);
  const daily = (report.daily || []).map(d => ({
    date: String(d.date).slice(0, 10), room: +d.room_revenue, fnb: +d.fnb_revenue, extras: +d.ancillary_revenue,
    activities: +(d.activity_revenue || 0), total: +d.total_revenue, nights: +d.nights_sold, expenses: +(d.expenses || 0),
  }));
  const sum = k => daily.reduce((s, d) => s + d[k], 0);
  table(ws5, null, [
    { header: 'Date', key: 'date' }, { header: 'Rooms (Rp)', key: 'room', fmt: IDR, align: 'right' },
    { header: 'F&B (Rp)', key: 'fnb', fmt: IDR, align: 'right' }, { header: 'Extras (Rp)', key: 'extras', fmt: IDR, align: 'right' },
    { header: 'Activities (Rp)', key: 'activities', fmt: IDR, align: 'right' }, { header: 'Total (Rp)', key: 'total', fmt: IDR, align: 'right' },
    { header: 'Room-nights', key: 'nights', fmt: INT, align: 'right' }, { header: 'Expenses (Rp)', key: 'expenses', fmt: IDR, align: 'right' },
  ], daily, { date: 'Total', room: sum('room'), fnb: sum('fnb'), extras: sum('extras'), activities: sum('activities'), total: sum('total'),
    nights: sum('nights'), expenses: sum('expenses') });
  widths(ws5, [14, 18, 16, 16, 16, 18, 13, 16]);

  // ── Room nights / Reservations (row-level detail) ──
  if (detail) {
    const rn = detail.room_nights;
    const ws6 = wb.addWorksheet('Room nights', { views: [{ state: 'frozen', ySplit: 6, xSplit: 2 }] });
    titleBlock(ws6, 'Room nights', meta);
    const rsum = k => rn.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    table(ws6, null, [
      { header: 'Date', key: 'date', fmt: DATE }, { header: 'Room', key: 'room' }, { header: 'Room type', key: 'room_type' },
      { header: 'Booking', key: 'ref' }, { header: 'Guest', key: 'guest' }, { header: 'Nationality', key: 'nationality' },
      { header: 'Source', key: 'source' }, { header: 'Rate plan', key: 'rate_plan' }, { header: 'Guests', key: 'guests', fmt: INT, align: 'right' },
      { header: 'Status', key: 'status' }, { header: 'Room revenue (Rp)', key: 'room_revenue', fmt: IDR, align: 'right' },
      { header: 'Meals (Rp)', key: 'meal_revenue', fmt: IDR, align: 'right' }, { header: 'Extra bed', key: 'extra_bed' },
      { header: 'Extra bed (Rp)', key: 'extra_amount', fmt: IDR, align: 'right' }, { header: 'Complimentary', key: 'complimentary' },
    ], rn.map(r => ({ ...r, date: xlDate(r.date), status: r.status.replace('_', ' ') })),
    { date: 'Total', guests: rsum('guests'), room_revenue: rsum('room_revenue'), meal_revenue: rsum('meal_revenue'), extra_amount: rsum('extra_amount') },
    "One row per room per night sold (every booking except cancelled / no-show). Room revenue and meals are that night's share, net — they add up to the Revenue sheet. Use the filter buttons to pick a room, date or source.",
    { filter: true });
    widths(ws6, [13, 10, 14, 11, 24, 14, 16, 18, 8, 12, 16, 13, 22, 14, 13]);

    const rs = detail.reservations;
    const ws7 = wb.addWorksheet('Reservations', { views: [{ state: 'frozen', ySplit: 6, xSplit: 2 }] });
    titleBlock(ws7, 'Reservations', meta);
    const bsum = k => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    table(ws7, null, [
      { header: 'Booking', key: 'ref' }, { header: 'Guest', key: 'guest' }, { header: 'Nationality', key: 'nationality' },
      { header: 'Room', key: 'room' }, { header: 'Room type', key: 'room_type' },
      { header: 'Check-in', key: 'check_in', fmt: DATE }, { header: 'Check-out', key: 'check_out', fmt: DATE },
      { header: 'Nights', key: 'nights', fmt: INT, align: 'right' }, { header: 'Nights in period', key: 'nights_in_period', fmt: INT, align: 'right' },
      { header: 'Guests', key: 'guests', fmt: INT, align: 'right' }, { header: 'Source', key: 'source' }, { header: 'Rate plan', key: 'rate_plan' },
      { header: 'Status', key: 'status' }, { header: 'Price as booked (Rp, incl. tax)', key: 'price', fmt: IDR, align: 'right' },
      { header: 'Discount (Rp)', key: 'discount', fmt: IDR, align: 'right' }, { header: 'Room, net (Rp)', key: 'room_revenue', fmt: IDR, align: 'right' },
      { header: 'Meals, net (Rp)', key: 'meal_revenue', fmt: IDR, align: 'right' }, { header: 'Room payments received (Rp)', key: 'paid', fmt: IDR, align: 'right' },
      { header: 'Room payments pending (Rp)', key: 'pending', fmt: IDR, align: 'right' }, { header: 'Billing', key: 'billing' },
      { header: 'Group (booked by)', key: 'group' }, { header: 'Booked on', key: 'booked_on', fmt: DATE },
    ], rs.map(r => ({ ...r, check_in: xlDate(r.check_in), check_out: xlDate(r.check_out), booked_on: xlDate(r.booked_on), status: r.status.replace('_', ' ') })),
    { ref: 'Total', nights: bsum('nights'), nights_in_period: bsum('nights_in_period'), guests: bsum('guests'), price: bsum('price'), discount: bsum('discount'),
      room_revenue: bsum('room_revenue'), meal_revenue: bsum('meal_revenue'), paid: bsum('paid'), pending: bsum('pending') },
    "One row per reservation with at least one night in the period (not cancelled / no-show). Amounts are for the whole stay, which can run outside the period; payments are the room's deposit / balance lines (extras are on each folio).",
    { filter: true });
    widths(ws7, [11, 24, 14, 10, 14, 13, 13, 8, 10, 8, 16, 18, 12, 18, 14, 16, 15, 18, 18, 14, 22, 13]);
  }

  for (const ws of wb.worksheets) ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb.xlsx.writeBuffer();
}

module.exports = { buildReportXlsx };
