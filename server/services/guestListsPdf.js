// Renders the Guest Lists morning briefing (Arriving / In-House / Departing
// for one date) — the PDF twin of client/src/pages/GuestLists.jsx, from the
// same routes/bookings.js loadGuestLists() data. `doc` is a live A4 portrait
// PDFDocument already positioned below the shared drawDocumentHeader() block.

const LEFT = 50;
const RIGHT = 545;
const BOTTOM = 790;

// Column layout (total width 495pt).
const COLS = [
  { key: 'room',     label: 'Room',     x: 50,  w: 42 },
  { key: 'guest',    label: 'Guest',    x: 94,  w: 108 },
  { key: 'pax',      label: 'Pax',      x: 204, w: 22, align: 'right' },
  { key: 'stay',     label: 'Stay',     x: 232, w: 78 },
  { key: 'plan',     label: 'Plan',     x: 312, w: 26 },
  { key: 'status',   label: 'Status',   x: 340, w: 62 },
  { key: 'balance',  label: 'Balance',  x: 404, w: 56, align: 'right' },
  { key: 'requests', label: 'Requests', x: 466, w: 79 },
];

const BED_LABEL = { double: 'Double bed', twin: 'Twin beds', twin_or_double: 'Twin or double', other: 'Other bed setup' };

function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtShort(s) { return parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtLongDate(s) { return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }

// Same status wording as the page.
function statusText(list, r, isToday) {
  if (list === 'arrivals') {
    const s = (r.status === 'checked_in' || r.status === 'checked_out') ? 'Arrived'
      : r.late_arrival ? `Late (due ${fmtShort(r.check_in_date)})` : 'Expected';
    return isToday && r.housekeeping_status === 'dirty' ? `${s} · Needs cleaning` : s;
  }
  if (list === 'in_house') {
    return r.status === 'checked_in' ? 'In house' : r.status === 'checked_out' ? 'Checked out' : 'Booked';
  }
  if (r.status === 'checked_out') return 'Checked out';
  return r.overdue ? `Overdue (due ${fmtShort(r.check_out_date)})` : 'Due out';
}

function cells(list, r, isToday) {
  const due = parseFloat(r.balance_due) || 0;
  return {
    room: [r.unit_name, r.unit_type].filter(Boolean).join('\n'),
    guest: [r.guest_name, [r.nationality, r.source_label, r.reservation_group_id && 'Group'].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    pax: String(r.num_guests ?? ''),
    // Standard PDF Helvetica has no arrow glyph — a dash renders everywhere.
    stay: `${fmtShort(r.check_in_date)} – ${fmtShort(r.check_out_date)}\n${r.nights} night${r.nights === 1 ? '' : 's'}`,
    plan: r.rate_plan_code || '—',
    status: statusText(list, r, isToday),
    balance: due > 0 ? fmtIDR(due) + (r.is_ota ? ' (OTA)' : '') : 'Paid',
    requests: [r.bed_preference && BED_LABEL[r.bed_preference], r.special_requests].filter(Boolean).join(' · ') || '—',
  };
}

function drawTableHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555');
  for (const c of COLS) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align || 'left' });
  doc.moveTo(LEFT, y + 11).lineTo(RIGHT, y + 11).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.fillColor('#000');
  return y + 15;
}

function rowHeight(doc, c) {
  doc.font('Helvetica').fontSize(8);
  return Math.max(...COLS.map(col => doc.heightOfString(c[col.key], { width: col.w }))) + 6;
}

function drawSection(doc, y, { title, list, rows, summary, empty, isToday }) {
  if (y > BOTTOM - 60) { doc.addPage(); y = 50; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title, LEFT, y);
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`${summary.rooms} room${summary.rooms === 1 ? '' : 's'} · ${summary.pax} guest${summary.pax === 1 ? '' : 's'}`, 300, y + 1, { width: RIGHT - 300, align: 'right' });
  doc.fillColor('#000');
  y += 18;

  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777').text(empty, LEFT, y);
    doc.fillColor('#000');
    return y + 24;
  }

  y = drawTableHeader(doc, y);
  for (const r of rows) {
    const c = cells(list, r, isToday);
    const h = rowHeight(doc, c);
    if (y + h > BOTTOM) { doc.addPage(); y = drawTableHeader(doc, 50); }
    doc.font('Helvetica').fontSize(8).fillColor('#000');
    for (const col of COLS) {
      const bold = col.key === 'room' || col.key === 'guest';
      // First line bold for room/guest, the rest (type / nationality) grey.
      if (bold) {
        const [first, ...rest] = c[col.key].split('\n');
        doc.font('Helvetica-Bold').fillColor('#000').text(first, col.x, y, { width: col.w });
        if (rest.length) doc.font('Helvetica').fontSize(7).fillColor('#666').text(rest.join('\n'), col.x, doc.y, { width: col.w });
        doc.fontSize(8).fillColor('#000');
      } else {
        const alert = (col.key === 'status' && /Overdue|Late|Needs cleaning/.test(c.status))
          || (col.key === 'balance' && c.balance !== 'Paid');
        doc.font(alert ? 'Helvetica-Bold' : 'Helvetica').fillColor(alert ? '#B91C1C' : '#000')
          .text(c[col.key], col.x, y, { width: col.w, align: col.align || 'left' });
        doc.fillColor('#000');
      }
    }
    y += h;
    doc.moveTo(LEFT, y - 2).lineTo(RIGHT, y - 2).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  return y + 14;
}

function renderGuestLists(doc, data) {
  const s = data.summary;
  let y = doc.y;

  // Summary strip
  const boxes = [
    ['Arrivals', `${plural(s.arrivals.rooms, 'room')} · ${s.arrivals.pax} pax`],
    ['In-House', `${plural(s.in_house.rooms, 'room')} · ${s.in_house.pax} pax`],
    ['Departures', `${plural(s.departures.rooms, 'room')} · ${s.departures.pax} pax`],
    ['Breakfast', `${s.breakfast_pax} pax this morning`],
    ['Dinner', `${s.dinner_pax} pax tonight`],
  ];
  const bw = (RIGHT - LEFT) / boxes.length;
  doc.rect(LEFT, y, RIGHT - LEFT, 34).strokeColor('#ddd').lineWidth(0.5).stroke();
  boxes.forEach(([label, value], i) => {
    const x = LEFT + i * bw + 6;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#777').text(label.toUpperCase(), x, y + 6, { width: bw - 12 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(value, x, y + 17, { width: bw - 12 });
  });
  y += 48;

  y = drawSection(doc, y, { title: 'Arriving', list: 'arrivals', rows: data.arrivals, summary: s.arrivals, empty: 'No arrivals on this date.', isToday: data.is_today });
  y = drawSection(doc, y, { title: 'In-House (staying over)', list: 'in_house', rows: data.in_house, summary: s.in_house, empty: 'No guests staying over on this date.', isToday: data.is_today });
  y = drawSection(doc, y, { title: 'Departing', list: 'departures', rows: data.departures, summary: s.departures, empty: 'No departures on this date.', isToday: data.is_today });

  if (y > BOTTOM - 20) { doc.addPage(); y = 50; }
  doc.font('Helvetica').fontSize(7).fillColor('#999')
    .text(`Printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Makassar' })} (WITA)`, LEFT, y, { width: RIGHT - LEFT, align: 'center' });
}

module.exports = { renderGuestLists, fmtLongDate };
