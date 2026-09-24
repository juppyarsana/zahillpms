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
//
// compact: a single short band instead — property details left, logo
// centred, title block right. Used by the
// registration card, which needs the page space for the guest to sign.
function drawDocumentHeader(doc, property, { title, refLine, compact = false }) {
  const headerTop = doc.y;
  if (compact) return drawCompactHeader(doc, property, { title, refLine, headerTop });
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

function drawCompactHeader(doc, property, { title, refLine, headerTop }) {
  // Three columns in one band: property details left, logo centred on the
  // page, title block right. Logos are trimmed to their artwork on upload
  // (services/logoImage.js), so this is roughly the size the mark prints at.
  const LOGO_SIZE = 72;
  const pageW = doc.page.width;
  const logoX = (pageW - LOGO_SIZE) / 2;
  const colW = logoX - 50 - 12;          // each side column stops short of the logo
  const rightX = logoX + LOGO_SIZE + 12;

  let hasLogo = false;
  if (property.logo_url) {
    try {
      const logoPath = path.join(__dirname, '../uploads/property-logos', path.basename(property.logo_url));
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, logoX, headerTop, { fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center' });
        hasLogo = true;
      }
    } catch (_) {
      // Corrupt/missing logo file — text-only header.
    }
  }
  const bandH = hasLogo ? LOGO_SIZE : 0;

  // Left: property name + address + phone + email (each on its own line so
  // nothing wraps awkwardly in the narrower column).
  const name = property.property_name || 'Zahill';
  const leftLines = [property.property_address, property.property_phone, property.property_email].filter(Boolean);
  doc.fontSize(15).font('Helvetica-Bold');
  const nameH = doc.heightOfString(name, { width: colW });
  doc.fontSize(8.5).font('Helvetica');
  const detailsH = leftLines.reduce((h, l) => h + doc.heightOfString(l, { width: colW }), 0);
  const leftH = nameH + 2 + detailsH;

  // Right: title, booking ref, date.
  const dateStr = new Date().toLocaleDateString('id-ID');
  const rightW = pageW - 50 - rightX;
  doc.fontSize(15).font('Helvetica-Bold');
  const titleH = doc.heightOfString(title, { width: rightW });
  doc.fontSize(9).font('Helvetica');
  const rightH = titleH + doc.heightOfString(refLine, { width: rightW }) + doc.heightOfString(dateStr, { width: rightW });

  // Both side blocks share one top line (property name and title level with
  // each other), centred as a group on the logo's height.
  const blockTop = headerTop + Math.max(0, (bandH - Math.max(leftH, rightH)) / 2);

  doc.fontSize(15).font('Helvetica-Bold').fillColor('#000').text(name, 50, blockTop, { width: colW });
  doc.y += 2;
  doc.fontSize(8.5).font('Helvetica').fillColor('#555');
  for (const l of leftLines) doc.text(l, 50, doc.y, { width: colW });
  doc.fillColor('#000');
  const leftBottom = doc.y;

  doc.fontSize(15).font('Helvetica-Bold').text(title, rightX, blockTop, { width: rightW, align: 'right' });
  doc.fontSize(9).font('Helvetica').text(refLine, rightX, doc.y, { width: rightW, align: 'right' });
  doc.text(dateStr, rightX, doc.y, { width: rightW, align: 'right' });

  doc.x = 50;
  doc.y = Math.max(leftBottom, doc.y, headerTop + bandH) + 14;
}

module.exports = { drawDocumentHeader };
