// Renders a payment receipt for a single activity booking paid directly
// (cash/QRIS/etc) — separate from the guest's room Invoice/Pro Forma,
// which only ever carries activity charges billed as Room Charge. `doc`
// is a live PDFDocument already positioned below the shared
// drawDocumentHeader() block.
//
// Layout deliberately mirrors routes/folio.js's invoice (Guest/Stay info
// blocks, then a Description/Qty/Unit Price/Amount table with the same
// column positions) so this reads as the same family of document,
// scaled down to one line item and no tax/service-charge section —
// activity pricing has no tax model in this codebase, so a fabricated
// 0% tax/service-charge line would misrepresent the property's real
// rates rather than just omitting what doesn't apply here.

function fmtIDR(n) {
  // Fixed 2 decimals — see routes/folio.js's fmtIDR for why the bare
  // toLocaleString('id-ID') is inconsistent (trims trailing zeros unevenly).
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB');
}

const colX = { desc: 50, qty: 300, price: 360, amount: 460 };

function renderActivityReceipt(doc, { property, data }) {
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Activity Receipt', 50, doc.y, { width: 495 });
  doc.fontSize(9).font('Helvetica').fillColor('#777').text('Payment received — this activity was paid directly, not charged to a room.', 50, doc.y, { width: 495 });
  doc.fillColor('#000');
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica-Bold').text('Guest');
  doc.font('Helvetica').text(data.guest_phone ? `${data.guest_name}  ·  ${data.guest_phone}` : data.guest_name);
  if (data.unit_name) {
    doc.fontSize(9).fillColor('#777').text(`Room ${data.unit_name} (reference only — not charged to this room)`);
    doc.fillColor('#000').fontSize(10);
  }
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').text('Activity');
  doc.font('Helvetica').text(
    `${data.activity_name}  ·  ${fmtDate(data.scheduled_date)}${data.scheduled_time ? `  ${String(data.scheduled_time).slice(0, 5)}` : ''}`
  );
  if (data.pickup_location) doc.fontSize(9).fillColor('#777').text(`Pickup: ${data.pickup_location}`).fillColor('#000').fontSize(10);

  doc.moveDown(1.5);

  // ── Line-item table — same column layout as routes/folio.js's invoice ──
  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Description', colX.desc, tableTop);
  doc.text('Qty', colX.qty, tableTop, { width: 50, align: 'right' });
  doc.text('Unit Price', colX.price, tableTop, { width: 90, align: 'right' });
  doc.text('Amount', colX.amount, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text(data.activity_name, colX.desc, y, { width: 240 });
  doc.text(String(data.num_participants), colX.qty, y, { width: 50, align: 'right' });
  doc.text(fmtIDR(data.unit_price), colX.price, y, { width: 90, align: 'right' });
  doc.text(fmtIDR(data.total_amount), colX.amount, y, { width: 90, align: 'right' });
  y += 20;

  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
  y += 10;

  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Total Paid', colX.price - 150, y, { width: 150, align: 'right' });
  doc.text(fmtIDR(data.total_amount), colX.amount, y, { width: 90, align: 'right' });
  y += 26;

  doc.font('Helvetica-Bold').fontSize(10).text('Payment Received', colX.desc, y);
  y += 16;
  doc.font('Helvetica').text(`${data.payment_method_label}  ·  ${fmtDate(new Date())}`, colX.desc, y, { width: 240 });
  doc.text(fmtIDR(data.total_amount), colX.amount, y, { width: 90, align: 'right' });
  y += 20;

  doc.x = 50;
  doc.y = y;

  if (data.notes) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Notes');
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(data.notes, { width: 495 });
    doc.fillColor('#000');
  }

  doc.moveDown(2);
  doc.fontSize(8).font('Helvetica').fillColor('#888')
    .text(`Issued by ${data.issued_by || 'staff'} on ${new Date().toLocaleString('id-ID')}`, 50, doc.y, { width: 495, align: 'center' });
}

module.exports = { renderActivityReceipt };
