const path = require('path');
const fs = require('fs');

function fmtIDR(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

// Consolidated agent invoice — one line per booking. Layout mirrors the
// per-booking folio invoice in routes/folio.js; kept as its own renderer so
// that working code stays untouched. `doc` is a live PDFDocument already
// piped to the response.
function renderAgentInvoice(doc, { property, agent, invoice, lines, total, paid, balance }) {
  if (property.logo_url) {
    try {
      const logoPath = path.join(__dirname, '../uploads/property-logos', path.basename(property.logo_url));
      if (fs.existsSync(logoPath)) doc.image(logoPath, 480, 45, { fit: [70, 70] });
    } catch (_) {
      // missing/corrupt logo — text header only
    }
  }

  doc.fontSize(18).font('Helvetica-Bold').text(property.property_name || 'Zahill', { continued: false });
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  if (property.property_address) doc.text(property.property_address);
  const contactLine = [property.property_phone, property.property_email].filter(Boolean).join('  ·  ');
  if (contactLine) doc.text(contactLine);
  doc.fillColor('#000');

  doc.moveDown(1);
  doc.fontSize(14).font('Helvetica-Bold').text('Agent Invoice', { align: 'right' });
  doc.fontSize(9).font('Helvetica').text(invoice.invoice_number, { align: 'right' });
  doc.text(`Issued ${String(invoice.issued_on).slice(0, 10)}`, { align: 'right' });
  if (invoice.period_start || invoice.period_end) {
    doc.text(`Period ${String(invoice.period_start || '').slice(0, 10)} – ${String(invoice.period_end || '').slice(0, 10)}`, { align: 'right' });
  }

  doc.moveDown(1.5);
  doc.fontSize(10).font('Helvetica-Bold').text('Bill To');
  doc.font('Helvetica').text(agent.label || '');
  if (agent.billing_address) doc.text(agent.billing_address);
  if (agent.tax_id) doc.text(`NPWP: ${agent.tax_id}`);
  const agentContact = [agent.contact_name, agent.contact_email, agent.contact_phone].filter(Boolean).join('  ·  ');
  if (agentContact) doc.text(agentContact);

  doc.moveDown(1.5);
  const tableTop = doc.y;
  const colX = { desc: 50, amount: 460 };
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Booking', colX.desc, tableTop);
  doc.text('Amount', colX.amount, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(10);
  for (const l of lines) {
    if (y > 720) { doc.addPage(); y = 50; }
    const ref = l.booking_id.slice(0, 8).toUpperCase();
    doc.text(`#${ref} · ${l.guest_name} · ${l.unit_name}`, colX.desc, y, { width: 380 });
    doc.text(fmtIDR(l.amount), colX.amount, y, { width: 90, align: 'right' });
    y += 14;
    doc.fillColor('#888').fontSize(8).text(`${l.check_in_date} → ${l.check_out_date}`, colX.desc, y, { width: 380 });
    doc.fillColor('#000').fontSize(10);
    y += 16;
  }
  if (!lines.length) {
    doc.fillColor('#888').text('No bookings on this invoice', colX.desc, y);
    doc.fillColor('#000');
    y += 18;
  }

  doc.moveTo(50, y + 4).lineTo(550, y + 4).strokeColor('#ccc').stroke();
  y += 14;

  function totalsLine(label, value, opts = {}) {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
    doc.text(label, colX.amount - 150, y, { width: 150, align: 'right' });
    doc.text(value, colX.amount, y, { width: 90, align: 'right' });
    y += opts.bold ? 20 : 16;
  }

  totalsLine('Total', fmtIDR(total), { bold: true });
  if (paid > 0) {
    totalsLine('Payments Received', fmtIDR(paid));
    totalsLine('Balance Due', fmtIDR(balance), { bold: true });
  }

  if (invoice.notes) {
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#555').font('Helvetica').text(invoice.notes, 50, undefined, { width: 500 });
    doc.fillColor('#000');
  }

  doc.moveDown(3);
  doc.fontSize(9).fillColor('#888').font('Helvetica').text('Payable per agreed credit terms.', 50, undefined, { align: 'center', width: 500 });
}

module.exports = { renderAgentInvoice };
