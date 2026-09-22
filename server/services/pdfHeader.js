const path = require('path');
const fs = require('fs');

// Draws the header block shared by every pdfkit document in this app:
// logo top-right, property name/address/contact top-left, and a
// right-aligned title block (e.g. "Invoice" / "Pro Forma Invoice" /
// "Registration Card") pinned to a fixed y BELOW the logo's bottom edge
// rather than following the auto-flowing cursor, so it can never collide
// with the logo regardless of how many lines the address block takes.
// Leaves doc.y positioned to start the body content right after it.
//
// Extracted out of routes/folio.js (where invoice/pro-forma originated)
// so routes/checkin.js's registration card can reuse it without
// duplicating the layout math.
function drawDocumentHeader(doc, property, { title, refLine }) {
  const headerTop = doc.y;
  const LOGO_SIZE = 65;
  const LOGO_X = 545 - LOGO_SIZE;

  if (property.logo_url) {
    try {
      const logoPath = path.join(__dirname, '../uploads/property-logos', path.basename(property.logo_url));
      if (fs.existsSync(logoPath)) doc.image(logoPath, LOGO_X, headerTop, { fit: [LOGO_SIZE, LOGO_SIZE] });
    } catch (_) {
      // Corrupt/missing logo file — fall back to text-only header below.
    }
  }

  doc.fontSize(18).font('Helvetica-Bold').text(property.property_name || 'Zahill', 50, headerTop, { width: 300 });
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  if (property.property_address) doc.text(property.property_address, 50, doc.y, { width: 300 });
  const contactLine = [property.property_phone, property.property_email].filter(Boolean).join('  ·  ');
  if (contactLine) doc.text(contactLine, 50, doc.y, { width: 300 });
  doc.fillColor('#000');
  const leftColBottom = doc.y;

  const rightColTop = headerTop + LOGO_SIZE + 10;
  doc.fontSize(14).font('Helvetica-Bold').text(title, 300, rightColTop, { width: 250, align: 'right' });
  doc.fontSize(9).font('Helvetica').text(refLine, 300, doc.y, { width: 250, align: 'right' });
  doc.text(new Date().toLocaleDateString('id-ID'), 300, doc.y, { width: 250, align: 'right' });

  doc.x = 50;
  doc.y = Math.max(leftColBottom, doc.y) + 20;
}

module.exports = { drawDocumentHeader };
