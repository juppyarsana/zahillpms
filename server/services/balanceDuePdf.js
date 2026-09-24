// Renders the Balance Due list (unpaid guests for one date, departing first)
// — the PDF twin of the Balance Due tab on client/src/pages/GuestLists.jsx,
// from the same routes/bookings.js loadBalanceDue() data. `doc` is a live A4
// portrait PDFDocument already positioned below drawDocumentHeader().

const LEFT = 50;
const RIGHT = 545;
const BOTTOM = 790;

// Column layout (total width 495pt).
const COLS = [
  { key: 'room',    label: 'Room',          x: 50,  w: 40 },
  { key: 'guest',   label: 'Guest',         x: 92,  w: 100 },
  { key: 'out',     label: 'Check-out',     x: 194, w: 44 },
  { key: 'room_m',  label: 'Room & meals',  x: 240, w: 58, align: 'right' },
  { key: 'extras',  label: 'Extras',        x: 300, w: 48, align: 'right' },
  { key: 'tax',     label: 'Service/tax',   x: 350, w: 46, align: 'right' },
  { key: 'paid',    label: 'Paid',          x: 398, w: 58, align: 'right' },
  { key: 'due',     label: 'Balance due',   x: 458, w: 87, align: 'right' },
];

function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtShort(s) { return parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function num(n) { return Math.round(Number(n) || 0).toLocaleString('id-ID'); }

function note(r) {
  if (r.agent_billed) return 'Billed to agent — not collected at desk';
  if (r.status === 'checked_out') return 'Already checked out — left unpaid';
  if (r.status !== 'checked_in' && r.section === 'staying') return 'Not checked in yet';
  if (r.is_ota) return `${r.source_label} booking — check if prepaid to OTA`;
  return '';
}

function cells(r) {
  return {
    room: [r.unit_name, r.unit_type].filter(Boolean).join('\n'),
    guest: [r.guest_name, [r.source_label, note(r)].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    out: fmtShort(r.check_out_date),
    room_m: num(r.room_and_meals),
    extras: num(r.extras),
    tax: num(r.service_and_tax),
    paid: num(r.paid),
    due: fmtIDR(r.balance_due),
  };
}

function drawTableHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555');
  // Some labels wrap to two lines in their narrow column — size the row to
  // the tallest one so the divider never runs through the text.
  const h = Math.max(...COLS.map(c => doc.heightOfString(c.label.toUpperCase(), { width: c.w })));
  for (const c of COLS) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align || 'left' });
  doc.moveTo(LEFT, y + h + 2).lineTo(RIGHT, y + h + 2).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.fillColor('#000');
  return y + h + 6;
}

function rowHeight(doc, c) {
  doc.font('Helvetica').fontSize(8);
  return Math.max(...COLS.map(col => doc.heightOfString(c[col.key], { width: col.w }))) + 6;
}

function drawSection(doc, y, { title, rows, total, empty }) {
  if (y > BOTTOM - 60) { doc.addPage(); y = 50; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title, LEFT, y);
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`${rows.length} guest${rows.length === 1 ? '' : 's'} owing`, 300, y + 1, { width: RIGHT - 300, align: 'right' });
  doc.fillColor('#000');
  y += 18;

  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777').text(empty, LEFT, y);
    doc.fillColor('#000');
    return y + 24;
  }

  y = drawTableHeader(doc, y);
  for (const r of rows) {
    const c = cells(r);
    const h = rowHeight(doc, c);
    if (y + h > BOTTOM) { doc.addPage(); y = drawTableHeader(doc, 50); }
    for (const col of COLS) {
      if (col.key === 'room' || col.key === 'guest') {
        const [first, ...rest] = c[col.key].split('\n');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000').text(first, col.x, y, { width: col.w });
        if (rest.length) doc.font('Helvetica').fontSize(7).fillColor('#666').text(rest.join('\n'), col.x, doc.y, { width: col.w });
      } else if (col.key === 'due') {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(r.agent_billed ? '#777' : '#B91C1C')
          .text(c.due, col.x, y, { width: col.w, align: 'right' });
      } else {
        doc.font('Helvetica').fontSize(8).fillColor('#000').text(c[col.key], col.x, y, { width: col.w, align: col.align || 'left' });
      }
    }
    doc.fillColor('#000');
    y += h;
    doc.moveTo(LEFT, y - 2).lineTo(RIGHT, y - 2).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
    .text('To collect', 350, y + 2, { width: 106, align: 'right' })
    .text(fmtIDR(total), 458, y + 2, { width: 87, align: 'right' });
  return y + 26;
}

function renderBalanceDue(doc, data) {
  let y = doc.y;
  const all = data.departing.length + data.overdue.length + data.staying.length;

  // Headline: what front desk needs to collect.
  doc.rect(LEFT, y, RIGHT - LEFT, 38).strokeColor('#ddd').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#777').text('TO COLLECT FROM DEPARTING GUESTS', LEFT + 8, y + 7, { width: 240 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#B91C1C').text(fmtIDR(data.totals.departing + data.totals.overdue), LEFT + 8, y + 18, { width: 240 });
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#777').text('TOTAL OUTSTANDING (ALL LISTED)', 300, y + 7, { width: RIGHT - 308, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(fmtIDR(data.totals.all), 300, y + 18, { width: RIGHT - 308, align: 'right' });
  y += 50;

  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text('Balance = the whole stay (all nights + extras charged to the room + service/tax) minus payments received — same as the Pro Forma on the booking\'s Folio tab. Guests with nothing to pay are not listed.', LEFT, y, { width: RIGHT - LEFT });
  y = doc.y + 12;
  doc.fillColor('#000');

  y = drawSection(doc, y, { title: 'Departing', rows: data.departing, total: data.totals.departing, empty: 'No departing guests owe anything.' });
  if (data.is_today) {
    y = drawSection(doc, y, { title: 'Overdue departures (still checked in)', rows: data.overdue, total: data.totals.overdue, empty: 'No overdue guests owe anything.' });
  }
  y = drawSection(doc, y, { title: 'Staying', rows: data.staying, total: data.totals.staying, empty: 'No staying guests owe anything.' });

  if (!all) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#15803D').text('Nothing outstanding on this date.', LEFT, y);
    y = doc.y + 10;
  }
  if (y > BOTTOM - 20) { doc.addPage(); y = 50; }
  doc.font('Helvetica').fontSize(7).fillColor('#999')
    .text(`Printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Makassar' })} (WITA)`, LEFT, y, { width: RIGHT - LEFT, align: 'center' });
}

module.exports = { renderBalanceDue };
