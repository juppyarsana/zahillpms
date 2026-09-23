// Renders a payment receipt for a front-desk ancillary sale paid directly
// (cash/QRIS/etc) — the PMS Sales page's "Pay now" path. A room_charge sale
// isn't receipted here: it's posted to the guest's folio and appears on the
// room Invoice instead. `doc` is a live PDFDocument already positioned below
// the shared drawDocumentHeader() block.
//
// Same family as services/activityReceiptPdf.js (Guest block, then a
// Description/Qty/Unit Price/Amount table with the invoice's column
// positions). Item prices are before tax: a sale taxed at sale time
// (sales.tax_amount set, migration 067) gets Subtotal / Service Charge / Tax
// lines above the total paid. Older sales (tax_amount NULL) were charged the
// plain item sum and print without them.

function fmtIDR(n) {
  // Fixed 2 decimals — see routes/folio.js's fmtIDR for why.
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const colX = { desc: 50, qty: 300, price: 360, amount: 460 };

function renderSaleReceipt(doc, { sale, items }) {
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Sales Receipt', 50, doc.y, { width: 495 });
  doc.fontSize(9).font('Helvetica').fillColor('#777').text('Payment received — paid directly, not charged to a room.', 50, doc.y, { width: 495 });
  doc.fillColor('#000');
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica-Bold').text('Guest');
  doc.font('Helvetica').text(sale.guest_name || 'Walk-in guest');
  if (sale.unit_name) {
    doc.fontSize(9).fillColor('#777').text(`Room ${sale.unit_name} (reference only — not charged to this room)`);
    doc.fillColor('#000').fontSize(10);
  }
  doc.moveDown(1.5);

  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Description', colX.desc, tableTop);
  doc.text('Qty', colX.qty, tableTop, { width: 50, align: 'right' });
  doc.text('Unit Price', colX.price, tableTop, { width: 90, align: 'right' });
  doc.text('Amount', colX.amount, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  for (const it of items) {
    const h = doc.heightOfString(it.name, { width: 240 });
    doc.text(it.name, colX.desc, y, { width: 240 });
    doc.text(String(it.quantity), colX.qty, y, { width: 50, align: 'right' });
    doc.text(fmtIDR(it.unit_price), colX.price, y, { width: 90, align: 'right' });
    doc.text(fmtIDR(it.subtotal), colX.amount, y, { width: 90, align: 'right' });
    y += Math.max(20, h + 6);
  }

  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
  y += 10;

  const taxed = sale.tax_amount != null;
  const sc = parseFloat(sale.service_charge_amount || 0);
  const tax = parseFloat(sale.tax_amount || 0);
  const totalPaid = parseFloat(sale.total_amount) + sc + tax;
  if (taxed) {
    const line = (label, amount) => {
      doc.font('Helvetica').fontSize(10);
      doc.text(label, colX.price - 150, y, { width: 150, align: 'right' });
      doc.text(fmtIDR(amount), colX.amount, y, { width: 90, align: 'right' });
      y += 16;
    };
    line('Subtotal', sale.total_amount);
    if (sc > 0) line('Service Charge', sc);
    if (tax > 0) line('Tax', tax);
    y += 4;
  }

  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Total Paid', colX.price - 150, y, { width: 150, align: 'right' });
  doc.text(fmtIDR(totalPaid), colX.amount, y, { width: 90, align: 'right' });
  y += 26;

  doc.font('Helvetica-Bold').fontSize(10).text('Payment Received', colX.desc, y);
  y += 16;
  doc.font('Helvetica').text(`${sale.payment_method_label}  ·  ${fmtDateTime(sale.created_at)}`, colX.desc, y, { width: 240 });
  doc.text(fmtIDR(totalPaid), colX.amount, y, { width: 90, align: 'right' });
  y += 20;

  doc.x = 50;
  doc.y = y;
  doc.moveDown(2);
  doc.fontSize(8).font('Helvetica').fillColor('#888')
    .text(`Served by ${sale.served_by_name || 'staff'} · printed ${new Date().toLocaleString('id-ID')}`, 50, doc.y, { width: 495, align: 'center' });
}

module.exports = { renderSaleReceipt };
