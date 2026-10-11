// Forecast PDF — the printed twin of client/src/pages/Forecast.jsx, from
// services/forecast.js. `doc` is a live A4 PDFDocument (portrait, or landscape
// when there are many columns) already below drawDocumentHeader().
//   opts.byType — add rooms sold per room type
// Revenue and ADR print only when the data carries them (with_money).

const LEFT = 50;
const num = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const dash = n => (n ? String(n) : '–');
const pair = (rooms, guests) => (rooms ? `${rooms} · ${guests}` : '–');

function dayParts(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return {
    day: t.toLocaleDateString('en-GB', { weekday: 'short' }),
    date: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    weekend: t.getDay() === 0 || t.getDay() === 6,
  };
}

function columns(d, { byType }) {
  const cols = [
    { label: 'Arriving', get: r => pair(r.arrivals, r.arrival_guests), total: t => pair(t.arrivals, t.arrival_guests) },
    { label: 'Departing', get: r => pair(r.departures, r.departure_guests), total: t => pair(t.departures, t.departure_guests) },
    { label: 'Staying', get: r => dash(r.stayovers) },
    { label: 'Sold', get: r => String(r.sold), total: t => String(t.sold), bold: true },
  ];
  if (byType) for (const rt of d.room_types) {
    cols.push({ label: rt, get: r => dash(r.by_type[rt]), total: () => String(d.rows.reduce((s, r) => s + r.by_type[rt], 0)) });
  }
  cols.push(
    { label: 'Free', get: r => String(r.free), total: t => String(t.free) },
    { label: 'Occ.', get: r => `${r.occupancy}%`, total: t => `${t.occupancy}%` },
    { label: 'Guests', get: r => (r.guests ? `${r.guests}${r.extra_beds ? ` +${r.extra_beds}` : ''}` : '–'), total: t => String(t.guests) },
    { label: 'Breakfast', get: r => dash(r.breakfast), total: t => String(t.breakfast), bold: true },
  );
  if (d.has_lunch) cols.push({ label: 'Lunch', get: r => dash(r.lunch), total: t => String(t.lunch) });
  if (d.has_dinner) cols.push({ label: 'Dinner', get: r => dash(r.dinner), total: t => String(t.dinner) });
  cols.push({ label: 'Not paid', get: r => dash(r.unpaid) });
  if (d.with_money) {
    cols.push(
      { label: 'Revenue', weight: 1.9, get: r => (r.revenue ? num(r.revenue) : '–'), total: t => num(t.revenue) },
      { label: 'ADR', weight: 1.6, get: r => (r.adr ? num(r.adr) : '–'), total: t => num(t.adr) },
    );
  }
  return cols;
}

// Portrait holds the plain table; revenue or per-type columns need landscape.
function forecastLayout(d, { byType } = {}) {
  return d.with_money || (byType && d.room_types.length > 1) ? 'landscape' : 'portrait';
}

function renderForecast(doc, d, { byType = false } = {}) {
  const RIGHT = doc.page.width - 50;
  const BOTTOM = doc.page.height - 60;
  const DAY_W = 104;
  const cols = columns(d, { byType: byType && d.room_types.length > 1 });
  const unit = (RIGHT - LEFT - DAY_W) / cols.reduce((s, c) => s + (c.weight || 1), 0);
  let x = LEFT + DAY_W;
  for (const c of cols) { c.x = x; c.w = unit * (c.weight || 1); x += c.w; }
  let y = doc.y + 4;

  const head = yy => {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#555');
    doc.text('DAY', LEFT, yy, { width: DAY_W - 4 });
    // A heading never wraps: it is drawn smaller when its column is narrow.
    cols.forEach(c => {
      const label = c.label.toUpperCase();
      const fit = Math.min(7, 7 * (c.w - 6) / doc.fontSize(7).widthOfString(label));
      doc.fontSize(fit).text(label, c.x, yy + (7 - fit) * 0.6, { width: c.w - 4, align: 'right', lineBreak: false });
    });
    doc.moveTo(LEFT, yy + 11).lineTo(RIGHT, yy + 11).strokeColor('#999').lineWidth(0.6).stroke();
    doc.fillColor('#000');
    return yy + 15;
  };

  const t = d.totals;
  doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(
    `Occupancy ${t.occupancy}%   ·   ${t.sold} room-nights sold, ${t.free} free   ·   ${t.arrivals} arrivals, ${t.departures} departures   ·   ${t.breakfast} breakfasts`,
    LEFT, y, { width: RIGHT - LEFT });
  y = doc.y + 3;
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#555')
    .text('Reservations on the books when printed. Nothing is projected.', LEFT, y, { width: RIGHT - LEFT });
  doc.fillColor('#000');
  y = doc.y + 10;
  y = head(y);

  for (const r of d.rows) {
    const p = dayParts(r.date);
    const h = r.holiday ? 26 : 17;
    if (y + h > BOTTOM) { doc.addPage(); y = head(50); }
    if (p.weekend) doc.rect(LEFT, y - 3, RIGHT - LEFT, h).fill('#F3F3F3').fillColor('#000');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(p.day, LEFT + 2, y, { width: 26, lineBreak: false });
    doc.font('Helvetica').fontSize(9).text(p.date + (r.date === d.today ? '  (today)' : ''), LEFT + 28, y, { width: DAY_W - 32, lineBreak: false });
    if (r.holiday) {
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#A00')
        .text(r.holiday, LEFT + 2, y + 11, { width: DAY_W + cols[0].w + cols[1].w, lineBreak: false, ellipsis: true });
      doc.fillColor('#000');
    }
    cols.forEach(c => doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000')
      .text(c.get(r), c.x, y, { width: c.w - 4, align: 'right', lineBreak: false }));
    y += h;
    doc.moveTo(LEFT, y - 4).lineTo(RIGHT, y - 4).strokeColor('#E2E2E2').lineWidth(0.4).stroke();
  }

  if (y + 40 > BOTTOM) { doc.addPage(); y = 50; }
  doc.moveTo(LEFT, y - 3).lineTo(RIGHT, y - 3).strokeColor('#000').lineWidth(0.9).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(`${d.days} days`, LEFT + 2, y + 2, { width: DAY_W - 4 });
  cols.forEach(c => { if (c.total) doc.text(c.total(t), c.x, y + 2, { width: c.w - 4, align: 'right', lineBreak: false }); });
  y += 22;

  const out = d.rows[0]?.out_of_order || 0;
  doc.font('Helvetica').fontSize(7.5).fillColor('#555').text(
    'Arriving and Departing: rooms · guests. Breakfast is for that morning (the guests of the night before, extra beds included); the other columns are for that night. '
    + 'Guests "+n": extra beds. Not paid: rooms booked with nothing paid yet. Every booking counts except cancelled and no-show. '
    + `${d.total_rooms} rooms${out ? `, ${out} out of order` : ''}.`
    + (d.with_money ? ' Revenue and ADR in Rupiah, net (before service & tax), room + meal plan.' : ''),
    LEFT, y, { width: RIGHT - LEFT });
  doc.fillColor('#000');
}

module.exports = { renderForecast, forecastLayout };
