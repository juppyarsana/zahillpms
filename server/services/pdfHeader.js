const path = require('path');
const fs = require('fs');

// The header band shared by every pdfkit document in this app (invoice, pro
// forma, registration card, receipts, guest/kitchen/balance lists, agent
// invoice, guest report): property details left, logo centred on the page,
// title block right. Leaves doc.y positioned to start the body content.
//
// refLine: the line under the title (booking ref, date shown, …).
// extraLines: optional further lines under it (e.g. an agent invoice's period).
// dateLine: defaults to today's date; pass null to leave it out.
function drawDocumentHeader(doc, property, { title, refLine, extraLines = [], dateLine }) {
  return drawCompactHeader(doc, property, {
    title,
    lines: [refLine, ...extraLines, dateLine === undefined ? new Date().toLocaleDateString('id-ID') : dateLine].filter(Boolean),
    headerTop: doc.y,
  });
}

function drawCompactHeader(doc, property, { title, lines, headerTop }) {
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

  // Right: title, then ref/date lines.
  const rightW = pageW - 50 - rightX;
  doc.fontSize(15).font('Helvetica-Bold');
  const titleH = doc.heightOfString(title, { width: rightW });
  doc.fontSize(9).font('Helvetica');
  const rightH = titleH + lines.reduce((h, l) => h + doc.heightOfString(l, { width: rightW }), 0);

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
  doc.fontSize(9).font('Helvetica');
  for (const l of lines) doc.text(l, rightX, doc.y, { width: rightW, align: 'right' });

  doc.x = 50;
  doc.y = Math.max(leftBottom, doc.y, headerTop + bandH) + 14;
}

module.exports = { drawDocumentHeader };
