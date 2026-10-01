// Cashier closing PDF — the printed twin of client/src/pages/CashierClosing.jsx,
// from services/cashierClosing.js. `doc` is a live A4 portrait PDFDocument
// already below drawDocumentHeader().

const LEFT = 50;
const RIGHT = 545;
const BOTTOM = 780;
const num = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtIDR = n => 'Rp ' + num(n);

const COLS = [
  { label: 'Time', w: 34 }, { label: 'Room', w: 38 }, { label: 'Guest', w: 112 }, { label: 'For', w: 68 },
  { label: 'Reference', w: 105 }, { label: 'By', w: 62 }, { label: 'Amount', w: 76, align: 'right' },
];

function renderCashierClosing(doc, d) {
  const xs = [];
  let x = LEFT;
  for (const c of COLS) { xs.push(x); x += c.w; }
  let y = doc.y + 4;

  const head = yy => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555');
    COLS.forEach((c, i) => doc.text(c.label.toUpperCase(), xs[i], yy, { width: c.w - 4, align: c.align || 'left' }));
    doc.moveTo(LEFT, yy + 11).lineTo(RIGHT, yy + 11).strokeColor('#999').lineWidth(0.6).stroke();
    doc.fillColor('#000');
    return yy + 15;
  };
  const room = need => { if (y + need > BOTTOM) { doc.addPage(); y = head(50); } };

  doc.font('Helvetica').fontSize(9.5).fillColor('#000')
    .text(`User: ${d.user_id ? (d.user_name || '—') : 'All users'}   ·   ${d.count} line${d.count === 1 ? '' : 's'}`, LEFT, y);
  y += 18;
  y = head(y);

  if (!d.groups.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777').text('No payments received.', LEFT, y);
    doc.fillColor('#000');
    y += 22;
  }
  for (const g of d.groups) {
    room(40);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(g.method, LEFT, y);
    y += 13;
    for (const l of g.lines) {
      const cells = [
        l.time || (l.recorded_on ? l.recorded_on.slice(5).split('-').reverse().join('/') : ''),
        l.room || '', l.guest || '', l.what,
        [l.reference, l.notes && l.notes !== l.reference ? l.notes : null].filter(Boolean).join(' · '),
        l.user_name, num(l.amount),
      ];
      doc.font('Helvetica').fontSize(8.5);
      const h = Math.max(...COLS.map((c, i) => doc.heightOfString(String(cells[i]), { width: c.w - 4 }))) + 4;
      room(h);
      COLS.forEach((c, i) => doc.font('Helvetica').fontSize(8.5).fillColor('#000')
        .text(String(cells[i]), xs[i], y, { width: c.w - 4, align: c.align || 'left' }));
      y += h;
    }
    room(18);
    doc.moveTo(xs[4], y).lineTo(RIGHT, y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5)
      .text('Sub total', xs[4], y + 3, { width: COLS[4].w + COLS[5].w - 4, align: 'right' })
      .text(num(g.subtotal), xs[6], y + 3, { width: COLS[6].w - 4, align: 'right' });
    y += 20;
  }

  room(40);
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#000').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(10.5)
    .text('Grand total', LEFT, y + 5)
    .text(fmtIDR(d.total), 300, y + 5, { width: RIGHT - 300 - 4, align: 'right' });
  y += 22;
  if (d.ledger_total > 0) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#555')
      .text(`Money received ${fmtIDR(d.money_total)}   ·   Agent ledger ${fmtIDR(d.ledger_total)} (billed to agents at check-out — not received)`, LEFT, y, { width: RIGHT - LEFT });
    doc.fillColor('#000');
    y += 14;
  }
  y += 6;

  if (d.by_method.length) {
    room(20 + d.by_method.length * 13);
    doc.font('Helvetica-Bold').fontSize(9).text('Summary of payment', LEFT, y);
    y += 14;
    for (const m of d.by_method) {
      doc.font('Helvetica').fontSize(9).text(m.method, LEFT + 10, y, { width: 200 })
        .text(num(m.amount), LEFT + 210, y, { width: 100, align: 'right' });
      y += 13;
    }
    y += 8;
  }

  // Signatures
  if (y + 90 > BOTTOM) { doc.addPage(); y = 50; }
  y += 24;
  const colW = (RIGHT - LEFT) / 2;
  ['Cashier', 'Checked by'].forEach((label, i) => {
    const sx = LEFT + i * colW;
    doc.font('Helvetica').fontSize(9).fillColor('#000').text(label, sx, y, { width: colW, align: 'center' });
    doc.moveTo(sx + 50, y + 58).lineTo(sx + colW - 50, y + 58).strokeColor('#999').lineWidth(0.6).stroke();
    if (i === 0 && d.user_id && d.user_name) doc.font('Helvetica').fontSize(8.5).text(d.user_name, sx, y + 62, { width: colW, align: 'center' });
  });
}

module.exports = { renderCashierClosing };
