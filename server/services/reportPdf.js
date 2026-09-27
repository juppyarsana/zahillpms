const PDFDocument = require('pdfkit');
const { drawDocumentHeader } = require('./pdfHeader');

// PDF version of the Reports page (services/fullReport.js), same sections as
// the page and the Excel file: Revenue, Rooms, Channels, Money, Net income,
// and a daily breakdown for multi-day periods. A4 portrait, the shared
// document header (logo, property details), tables that continue onto the
// next page with their column headings repeated, page numbers.

const L = 45, R = 550, W = R - L;   // page margins / usable width
const BOTTOM = 790;                   // last y for content (footer below)
const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = n => (Number(n) || 0).toLocaleString('id-ID');
const pct = n => `${(Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const plural = (n, w) => `${num(n)} ${w}${Number(n) === 1 ? '' : 's'}`;

function periodLabel(from, to) {
  const f = (d, o) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', o);
  if (from === to) return f(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${f(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${f(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function buildReportPdf(report, property) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: L, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { revenue: rev, rooms, channels, money } = report;
    const total = rev.total || 0;
    const share = n => (total ? (Number(n) / total) * 100 : 0);
    const label = periodLabel(report.from, report.to);

    drawDocumentHeader(doc, property || {}, { title: 'Report', refLine: label });
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
      .text('Amounts in Rupiah, net: after discounts, before service charge and tax. Same figures as the Reports page.', L, doc.y + 2, { width: W });
    doc.fillColor('#000');
    doc.y += 6;

    const ensure = h => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 45; } };
    const heading = (t, sub) => {
      ensure(60);
      doc.y += 10;
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(t, L, doc.y);
      if (sub) doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280').text(sub, L, doc.y + 1, { width: W });
      doc.moveTo(L, doc.y + 3).lineTo(R, doc.y + 3).lineWidth(1).strokeColor('#111827').stroke();
      doc.fillColor('#000');
      doc.y += 9;
    };
    // rows: the table that follows — a short one (≤ 12 rows) moves to the
    // next page together with its heading instead of splitting.
    const subheading = (t, note, rows = 0) => {
      ensure(46 + (rows && rows <= 12 ? (rows + 2) * 16 : 0));
      doc.y += 4;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(t, L, doc.y);
      if (note) doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(note, L, doc.y + 1, { width: W });
      doc.fillColor('#000');
      doc.y += 4;
    };

    // cols: [{ label, w (fraction of width), align, key | get }]; rows may carry _group / _indent / _bold.
    const table = (cols, rows, { total: totalRow, size = 8.5, empty = 'Nothing in this period.' } = {}) => {
      const xs = []; let x = L;
      for (const c of cols) { xs.push(x); x += c.w * W; }
      const cell = (c, r) => (c.get ? c.get(r) : r[c.key]);
      const drawRow = (r, { head = false, bold = false, fill = null, rule = null } = {}) => {
        doc.font(head || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? size - 1 : size);
        const texts = cols.map(c => String(head ? c.label : (cell(c, r) ?? '')));
        const h = Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: cols[i].w * W - 8 }))) + 6;
        if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 45; if (!head) drawRow(null, { head: true }); }
        const y = doc.y;
        if (fill) doc.rect(L, y, W, h).fill(fill);
        doc.fillColor(head ? '#6B7280' : '#111827');
        texts.forEach((t, i) => {
          const indent = !head && i === 0 && r?._indent ? 10 : 0;
          doc.text(t, xs[i] + 4 + indent, y + 3, { width: cols[i].w * W - 8 - indent, align: cols[i].align || 'left' });
        });
        doc.y = y + h;
        doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(rule ? 0.8 : 0.4).strokeColor(rule || '#E5E7EB').stroke();
        doc.fillColor('#000');
      };
      ensure(40);
      drawRow(null, { head: true, fill: '#F3F4F6' });
      if (!rows.length) {
        doc.font('Helvetica-Oblique').fontSize(size).fillColor('#9CA3AF').text(empty, L + 4, doc.y + 4);
        doc.fillColor('#000'); doc.y += 6;
      }
      for (const r of rows) drawRow(r, { bold: r._group || r._bold, fill: r._group ? '#F9FAFB' : null });
      if (totalRow) drawRow(totalRow, { bold: true, rule: '#111827' });
      doc.y += 8;
    };

    // ── Revenue ──
    heading('Revenue', label);
    // Summary boxes
    const boxes = [['Rooms', rev.room], ['Food & beverage', rev.fnb.total], ['Extras', rev.extras.total], ['Activities', rev.activities.total], ['Total revenue', total]];
    ensure(56);
    const bw = (W - 4 * 6) / 5, by = doc.y;
    boxes.forEach(([t, v], i) => {
      const bx = L + i * (bw + 6), dark = i === 4;
      doc.roundedRect(bx, by, bw, 48, 4).fill(dark ? '#111827' : '#F9FAFB');
      doc.font('Helvetica').fontSize(7).fillColor(dark ? '#D1D5DB' : '#6B7280').text(t.toUpperCase(), bx + 7, by + 7, { width: bw - 14 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark ? '#FFFFFF' : '#111827').text(fmtIDR(v), bx + 7, by + 19, { width: bw - 14 });
      doc.font('Helvetica').fontSize(7).fillColor(dark ? '#9CA3AF' : '#6B7280').text(dark ? 'net, before tax' : `${pct(share(v))} of revenue`, bx + 7, by + 34, { width: bw - 14 });
    });
    doc.fillColor('#000'); doc.y = by + 58;

    subheading('Revenue breakdown', null, 6 + rev.extras.by_category.length + rev.activities.by_activity.length);
    table([
      { label: 'Item', w: 0.34, key: 'item' }, { label: '', w: 0.3, key: 'detail' },
      { label: 'Amount', w: 0.2, align: 'right', get: r => fmtIDR(r.amount) }, { label: 'Share', w: 0.16, align: 'right', get: r => pct(share(r.amount)) },
    ], [
      { item: 'Rooms', detail: plural(rooms.nights_sold, 'room-night'), amount: rev.room, _group: true },
      { item: 'Food & beverage', detail: '', amount: rev.fnb.total, _group: true },
      { item: 'Meals in the rate plan', detail: 'breakfast / half / full board', amount: rev.fnb.rate_plan, _indent: true },
      { item: 'Breakfast in extras', detail: 'e.g. extra bed with breakfast', amount: rev.fnb.extras, _indent: true },
      { item: 'Restaurant & POS', detail: 'resto app, room dining, external POS', amount: rev.fnb.outlets, _indent: true },
      { item: 'Extras', detail: 'Sales items', amount: rev.extras.total, _group: true },
      ...rev.extras.by_category.map(c => ({ item: c.label, detail: plural(c.qty, 'unit'), amount: c.amount, _indent: true })),
      { item: 'Activities', detail: plural(rev.activities.bookings, 'booking'), amount: rev.activities.total, _group: true },
      ...rev.activities.by_activity.map(a => ({ item: a.name, detail: `${plural(a.bookings, 'booking')} · ${num(a.pax)} pax`, amount: a.amount, _indent: true })),
    ], { total: { item: 'Total revenue', amount: total } });
    if (rev.complimentary.nights > 0 || rev.complimentary.value > 0) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
        .text(`Complimentary: ${plural(rev.complimentary.nights, 'night')} and extras worth ${fmtIDR(rev.complimentary.value)} (net) were given away — not included in revenue.`, L, doc.y, { width: W });
      doc.fillColor('#000'); doc.y += 6;
    }

    // ── Rooms ──
    ensure(60 + 8 * 16);
    heading('Rooms', `${rooms.sellable_rooms} rooms in service × ${plural(rooms.days, 'day')} = ${num(rooms.available_nights)} room-nights available (rooms in service = not out of order today)`);
    table([
      { label: 'Figure', w: 0.3, key: 'k' }, { label: 'Value', w: 0.22, align: 'right', key: 'v' }, { label: 'How it is worked out', w: 0.48, key: 'n' },
    ], [
      { k: 'Occupancy', v: pct(rooms.occupancy), n: `${num(rooms.nights_sold)} of ${num(rooms.available_nights)} room-nights sold` },
      { k: 'ADR', v: fmtIDR(rooms.adr), n: rooms.comp_nights > 0 ? 'room revenue ÷ paid nights' : 'room revenue ÷ nights sold' },
      { k: 'RevPAR', v: fmtIDR(rooms.revpar), n: 'room revenue ÷ room-nights available' },
      { k: 'Guest-nights', v: num(rooms.guest_nights), n: 'people × nights' },
      { k: 'Arrivals', v: plural(rooms.arrivals.bookings, 'booking'), n: `${plural(rooms.arrivals.guests, 'guest')} checking in` },
      ...(rooms.comp_nights > 0 ? [{ k: 'Complimentary nights', v: num(rooms.comp_nights), n: 'counted in occupancy, not in ADR' }] : []),
    ]);
    subheading('By room type', null, rooms.by_room_type.length + 1);
    table([
      { label: 'Room type', w: 0.22, key: 'room_type' }, { label: 'Rooms', w: 0.08, align: 'right', get: r => num(r.sellable) },
      { label: 'Nights sold', w: 0.11, align: 'right', get: r => num(r.nights) }, { label: 'Occupancy', w: 0.11, align: 'right', get: r => pct(r.occupancy) },
      { label: 'Room revenue', w: 0.18, align: 'right', get: r => fmtIDR(r.revenue) }, { label: 'ADR', w: 0.15, align: 'right', get: r => fmtIDR(r.adr) },
      { label: 'RevPAR', w: 0.15, align: 'right', get: r => fmtIDR(r.revpar) },
    ], rooms.by_room_type, { total: { room_type: 'All rooms', sellable: rooms.sellable_rooms, nights: rooms.nights_sold, occupancy: rooms.occupancy, revenue: rev.room, adr: rooms.adr, revpar: rooms.revpar } });
    subheading('By rate plan', null, rooms.by_rate_plan.length);
    table([
      { label: 'Rate plan', w: 0.3, get: r => (r.code ? `${r.rate_plan} (${r.code})` : r.rate_plan) },
      { label: 'Nights', w: 0.1, align: 'right', get: r => num(r.nights) }, { label: 'Guest-nights', w: 0.13, align: 'right', get: r => num(r.guest_nights) },
      { label: 'Room revenue', w: 0.17, align: 'right', get: r => fmtIDR(r.room_revenue) }, { label: 'Meals', w: 0.15, align: 'right', get: r => fmtIDR(r.meal_revenue) },
      { label: 'ADR', w: 0.15, align: 'right', get: r => fmtIDR(r.adr) },
    ], rooms.by_rate_plan);
    // Nationalities: the top 15, the rest together.
    const nat = rooms.by_nationality;
    const natRows = nat.slice(0, 15);
    if (nat.length > 15) {
      const rest = nat.slice(15);
      natRows.push({ nationality: `${rest.length} other nationalities`, bookings: rest.reduce((s, n) => s + n.bookings, 0), room_nights: rest.reduce((s, n) => s + n.room_nights, 0),
        guest_nights: rest.reduce((s, n) => s + n.guest_nights, 0), revenue: rest.reduce((s, n) => s + n.revenue, 0) });
    }
    subheading('By nationality', null, natRows.length);
    table([
      { label: 'Nationality', w: 0.32, key: 'nationality' }, { label: 'Bookings', w: 0.12, align: 'right', get: r => num(r.bookings) },
      { label: 'Room-nights', w: 0.14, align: 'right', get: r => num(r.room_nights) }, { label: 'Guest-nights', w: 0.14, align: 'right', get: r => num(r.guest_nights) },
      { label: 'Room & meals', w: 0.28, align: 'right', get: r => fmtIDR(r.revenue) },
    ], natRows);

    // ── Channels ──
    ensure(60 + Math.min(channels.length + 2, 12) * 16);
    heading('Channels', 'Where the stays in this period were booked. Revenue = room + meals in the rate plan for the nights in this period.');
    const chTotal = channels.reduce((s, c) => s + c.revenue, 0);
    table([
      { label: 'Source', w: 0.3, key: 'source' }, { label: 'Bookings', w: 0.11, align: 'right', get: r => num(r.bookings) },
      { label: 'Nights', w: 0.1, align: 'right', get: r => num(r.nights) }, { label: 'Revenue', w: 0.19, align: 'right', get: r => fmtIDR(r.revenue) },
      { label: 'ADR', w: 0.17, align: 'right', get: r => (r.adr === '' ? '' : fmtIDR(r.adr)) }, { label: 'Share', w: 0.13, align: 'right', get: r => (r.share === '' ? '' : pct(r.share)) },
    ], channels, { total: { source: 'Total', bookings: channels.reduce((s, c) => s + c.bookings, 0), nights: channels.reduce((s, c) => s + c.nights, 0), revenue: chTotal, adr: '', share: '' } });

    // ── Money ──
    heading('Money');
    const recTotal = money.received.total;
    subheading('Received by payment method', 'Payments received in this period: guests, extras & activities paid at the desk, agents.', money.received.by_method.length + 1);
    table([
      { label: 'Method', w: 0.5, key: 'method' }, { label: 'Amount', w: 0.3, align: 'right', get: r => fmtIDR(r.amount) },
      { label: 'Share', w: 0.2, align: 'right', get: r => (r.amount === undefined || r._total ? '' : pct(recTotal ? (r.amount / recTotal) * 100 : 0)) },
    ], money.received.by_method, { total: { method: 'Total received', amount: recTotal, _total: true }, empty: 'No payments received in this period.' });

    const st = money.service_tax;
    const insideAct = st.included_in_activities.service_charge + st.included_in_activities.tax;
    subheading('Service charge & tax (estimate)', "At today's rates, on this period's revenue — for setting money aside. Check the filing with your accountant.", 5);
    if (!st.service_charge_rate && !st.tax_rate && !insideAct) {
      doc.font('Helvetica').fontSize(8.5).text('Your service charge and tax rates are 0% (Property Details), so none is added.', L, doc.y, { width: W });
      doc.y += 8;
    } else {
      table([{ label: 'Item', w: 0.6, key: 'k' }, { label: 'Amount', w: 0.4, align: 'right', get: r => fmtIDR(r.v) }], [
        { k: 'Revenue it applies to', v: st.taxable_revenue },
        { k: `Service charge (${st.service_charge_rate}%)`, v: st.service_charge },
        { k: `Tax (${st.tax_rate}%)`, v: st.tax },
        ...(insideAct ? [{ k: 'of which inside tax-included activities', v: insideAct, _indent: true }] : []),
      ], { total: { k: 'Service charge + tax', v: st.service_charge + st.tax } });
    }

    subheading('Discounts given', null, 1);
    table([{ label: 'Bookings', w: 0.3, get: r => num(r.bookings) }, { label: 'Amount (as entered, incl. tax)', w: 0.7, align: 'right', get: r => fmtIDR(r.amount) }],
      [money.discounts]);

    const g = money.owed_now.guests;
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    subheading(`Still owed by guests — as of ${today}`, 'Room deposit / balance lines not received yet (agent-billed stays are under agents). Not tied to the period.', 4);
    table([{ label: 'Stays', w: 0.5, key: 'k' }, { label: 'Bookings', w: 0.2, align: 'right', get: r => num(r.bookings) }, { label: 'Amount', w: 0.3, align: 'right', get: r => fmtIDR(r.amount) }], [
      { k: 'Guests who left', ...g.checked_out }, { k: 'Guests in house', ...g.in_house }, { k: 'Upcoming stays', ...g.upcoming },
    ], { total: { k: 'Total', bookings: g.checked_out.bookings + g.in_house.bookings + g.upcoming.bookings, amount: g.checked_out.amount + g.in_house.amount + g.upcoming.amount } });

    const ag = money.owed_now.agents;
    subheading(`Still owed by agents — as of ${today}`, null, ag.rows.length + 1);
    table([
      { label: 'Agent', w: 0.28, key: 'agent' }, { label: 'Open', w: 0.08, align: 'right', get: r => (r.open_bookings === undefined ? '' : num(r.open_bookings)) },
      { label: 'Owed', w: 0.16, align: 'right', get: r => fmtIDR(r.outstanding) }, { label: 'Not due yet', w: 0.16, align: 'right', get: r => (r.current === undefined ? '' : fmtIDR(r.current)) },
      { label: 'Overdue', w: 0.16, align: 'right', get: r => fmtIDR(r.overdue) }, { label: 'Over 60 days', w: 0.16, align: 'right', get: r => (r.over_60 === undefined ? '' : fmtIDR(r.over_60)) },
    ], ag.rows, { total: { agent: 'Total', outstanding: ag.total, overdue: ag.overdue }, empty: 'No agent owes anything.' });

    subheading('Net income', null, 3);
    table([{ label: 'Item', w: 0.6, key: 'k' }, { label: 'Amount', w: 0.4, align: 'right', get: r => fmtIDR(r.v) }], [
      { k: 'Total revenue', v: total }, { k: 'Expenses (Back Office)', v: -(report.expenses_total || 0) },
    ], { total: { k: 'Net income', v: report.net_income } });

    // ── Daily breakdown (multi-day periods) ──
    const daily = report.daily || [];
    if (daily.length > 1) {
      doc.addPage(); doc.y = 45;
      heading('Daily breakdown', label);
      const sum = k => daily.reduce((s, d) => s + (Number(d[k]) || 0), 0);
      table([
        { label: 'Date', w: 0.14, get: r => r._label || new Date(`${String(r.date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) },
        { label: 'Rooms', w: 0.15, align: 'right', get: r => fmtIDR(r.room_revenue) }, { label: 'F&B', w: 0.13, align: 'right', get: r => fmtIDR(r.fnb_revenue) },
        { label: 'Extras', w: 0.12, align: 'right', get: r => fmtIDR(r.ancillary_revenue) }, { label: 'Activities', w: 0.12, align: 'right', get: r => fmtIDR(r.activity_revenue) },
        { label: 'Total', w: 0.16, align: 'right', get: r => fmtIDR(r.total_revenue) }, { label: 'Room-nights', w: 0.09, align: 'right', get: r => num(r.nights_sold) },
        { label: 'Expenses', w: 0.09, align: 'right', get: r => (Number(r.expenses) ? fmtIDR(r.expenses) : '—') },
      ], daily, {
        size: 7.5,
        total: { _label: 'Total', room_revenue: sum('room_revenue'), fnb_revenue: sum('fnb_revenue'), ancillary_revenue: sum('ancillary_revenue'),
          activity_revenue: sum('activity_revenue'), total_revenue: sum('total_revenue'), nights_sold: sum('nights_sold'), expenses: sum('expenses') },
      });
    }

    // Footer on every page: period · page x of y.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;   // the footer sits below the content area — don't let it start a new page
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
        .text(`${(property && property.property_name) || ''} · Report ${label} · printed ${new Date().toLocaleDateString('en-GB')} · page ${i + 1} of ${range.count}`,
          L, 815, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { buildReportPdf };
