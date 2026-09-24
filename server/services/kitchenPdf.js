// Renders the Kitchen List (breakfast that morning, dinner that night, room
// by room) — the PDF twin of the Kitchen tab on client/src/pages/GuestLists.jsx,
// from the same routes/bookings.js loadKitchen() data. `doc` is a live A4
// portrait PDFDocument already positioned below drawDocumentHeader().

const LEFT = 50;
const RIGHT = 545;
const BOTTOM = 790;

const COLS = [
  { key: 'room',  label: 'Room',     x: 50,  w: 55 },
  { key: 'guest', label: 'Guest',    x: 107, w: 150 },
  { key: 'pax',   label: 'Pax',      x: 259, w: 28, align: 'right' },
  { key: 'plan',  label: 'Plan',     x: 295, w: 30 },
  { key: 'note',  label: 'Special requests', x: 330, w: 170 },
  { key: 'tick',  label: 'Served',   x: 505, w: 40, align: 'center' },
];

function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtShort(s) { return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }

function drawTableHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555');
  for (const c of COLS) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align || 'left' });
  doc.moveTo(LEFT, y + 11).lineTo(RIGHT, y + 11).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.fillColor('#000');
  return y + 15;
}

function drawMeal(doc, y, { title, meal, empty, withoutLabel }) {
  if (y > BOTTOM - 70) { doc.addPage(); y = 50; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(title, LEFT, y);
  doc.font('Helvetica-Bold').fontSize(12).text(`${meal.pax} pax`, 300, y, { width: RIGHT - 300, align: 'right' });
  y += 16;
  doc.font('Helvetica').fontSize(8.5).fillColor('#555')
    .text(`${plural(meal.rooms, 'room')}${meal.without.pax > 0 ? `  ·  ${withoutLabel}: ${meal.without.pax} pax in ${plural(meal.without.rooms, 'room')}` : ''}`, LEFT, y, { width: RIGHT - LEFT });
  doc.fillColor('#000');
  y += 16;

  if (!meal.rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777').text(empty, LEFT, y);
    doc.fillColor('#000');
    return y + 26;
  }
  y = drawTableHeader(doc, y);
  for (const r of meal.rows) {
    const cells = {
      room: [r.unit_name, r.unit_type].filter(Boolean).join('\n'),
      guest: r.guest_name + (r.status !== 'checked_in' && r.status !== 'checked_out' ? '\n(not checked in yet)' : ''),
      pax: String(r.num_guests ?? ''),
      plan: r.rate_plan_code || '—',
      note: r.special_requests || '—',
      tick: '',
    };
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(...COLS.map(c => doc.heightOfString(cells[c.key] || ' ', { width: c.w }))) + 8;
    if (y + h > BOTTOM) { doc.addPage(); y = drawTableHeader(doc, 50); }
    for (const c of COLS) {
      if (c.key === 'tick') {
        doc.rect(c.x + c.w / 2 - 5, y, 10, 10).strokeColor('#999').lineWidth(0.7).stroke();
        continue;
      }
      const [first, ...rest] = cells[c.key].split('\n');
      const bold = c.key === 'room' || c.key === 'guest' || c.key === 'pax';
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.key === 'pax' ? 10 : 8.5).fillColor('#000')
        .text(first, c.x, y, { width: c.w, align: c.align || 'left' });
      if (rest.length) doc.font('Helvetica').fontSize(7).fillColor('#666').text(rest.join('\n'), c.x, doc.y, { width: c.w });
    }
    doc.fillColor('#000');
    y += h;
    doc.moveTo(LEFT, y - 3).lineTo(RIGHT, y - 3).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  doc.font('Helvetica-Bold').fontSize(9).text(`Total: ${meal.pax} pax`, 300, y + 2, { width: RIGHT - 300, align: 'right' });
  return y + 28;
}

function renderKitchen(doc, data) {
  let y = doc.y;
  doc.font('Helvetica').fontSize(8.5).fillColor('#555')
    .text('From each booking\'s meal plan (BB = breakfast, HB = breakfast + dinner, FB = all meals), counted in guests. Breakfast = guests who slept here the night before; dinner = guests sleeping here that night.', LEFT, y, { width: RIGHT - LEFT });
  doc.fillColor('#000');
  y = doc.y + 14;
  y = drawMeal(doc, y, { title: `Breakfast — ${fmtShort(data.date)} morning`, meal: data.breakfast, empty: 'No guests with breakfast included.', withoutLabel: 'In house without breakfast' });
  y = drawMeal(doc, y, { title: `Dinner — ${fmtShort(data.date)} night`, meal: data.dinner, empty: 'No guests with dinner included.', withoutLabel: 'In house without dinner' });
  if (y > BOTTOM - 20) { doc.addPage(); y = 50; }
  doc.font('Helvetica').fontSize(7).fillColor('#999')
    .text(`Printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Makassar' })} (WITA) — numbers change if bookings change; reprint if needed.`, LEFT, y, { width: RIGHT - LEFT, align: 'center' });
}

module.exports = { renderKitchen };
