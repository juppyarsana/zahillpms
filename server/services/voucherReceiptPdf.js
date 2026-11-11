// The receipt for a voucher bought and paid for (not a free one, not one charged to a
// room — that is on the guest's invoice). One receipt covers a whole purchase: every
// voucher sold together (migration 170) is a line. Same family as the sale / activity
// receipts: the shared header, who bought it, a table, the total paid.
const PDFDocument = require('pdfkit');
const { drawDocumentHeader } = require('./pdfHeader');

const fmtIDR = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const colX = { desc: 50, qty: 300, price: 360, amount: 460 };

// vouchers: shaped rows (voucher_label, name, price, fee_amount, fee_label, ...), at least one.
function renderVoucherReceipt(res, { property, vouchers, filename }) {
  const first = vouchers[0];
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  const receiptNo = `R-${first.voucher_label}`;
  drawDocumentHeader(doc, property || {}, { title: 'Receipt', refLine: receiptNo, dateLine: fmtDate(first.sold_on) });

  doc.moveDown(0.8);
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Voucher Receipt', 50, doc.y, { width: 495 });
  doc.fontSize(9).font('Helvetica').fillColor('#777').text('Payment received for stay vouchers.', 50, doc.y, { width: 495 });
  doc.fillColor('#000').moveDown(1);

  doc.fontSize(10).font('Helvetica-Bold').text('Bought by');
  doc.font('Helvetica').text(first.buyer_name || 'Guest');
  if (first.buyer_email) doc.fontSize(9).fillColor('#777').text(first.buyer_email).fillColor('#000').fontSize(10);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').text('Paid');
  doc.font('Helvetica').text(`${first.payment_label || first.payment_method || ''} · ${fmtDate(first.sold_on)}${first.reference ? ` · ref ${first.reference}` : ''}`);
  doc.moveDown(1.5);

  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Description', colX.desc, top);
  doc.text('Qty', colX.qty, top, { width: 50, align: 'right' });
  doc.text('Unit Price', colX.price, top, { width: 90, align: 'right' });
  doc.text('Amount', colX.amount, top, { width: 90, align: 'right' });
  doc.moveTo(50, top + 15).lineTo(550, top + 15).strokeColor('#ccc').stroke();

  let y = top + 22, total = 0;
  const row = (text, price) => {
    const h = doc.heightOfString(text, { width: 240 });
    if (y + h > 740) { doc.addPage(); y = 60; }
    doc.font('Helvetica').fontSize(10).fillColor('#000').text(text, colX.desc, y, { width: 240 });
    doc.text('1', colX.qty, y, { width: 50, align: 'right' });
    doc.text(fmtIDR(price), colX.price, y, { width: 90, align: 'right' });
    doc.text(fmtIDR(price), colX.amount, y, { width: 90, align: 'right' });
    y += Math.max(20, h + 6);
    total += Number(price);
  };
  for (const v of vouchers) {
    row(`${v.voucher_label} — ${v.name}${v.recipient_name ? ` (for ${v.recipient_name})` : ''}`, v.sold_total || v.price);
    if (Number(v.fee_amount) > 0) row(`${v.fee_label || 'Fee'} on ${v.voucher_label}`, v.fee_amount);
  }
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
  y += 10;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
  doc.text('Total Paid', colX.price - 150, y, { width: 150, align: 'right' });
  doc.text(fmtIDR(total), colX.amount, y, { width: 90, align: 'right' });
  y += 30;
  doc.font('Helvetica').fontSize(9).fillColor('#777').text(
    'A voucher carries no service charge or tax. The stay is covered when the voucher is used. This receipt confirms payment only; it is not a voucher and not an invoice.',
    50, y, { width: 495 });
  doc.end();
}

module.exports = { renderVoucherReceipt };
