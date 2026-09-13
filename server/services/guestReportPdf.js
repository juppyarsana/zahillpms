const path = require('path');
const fs = require('fs');

// Daily/ranged guest list for the local police report (STPM/lapor tamu)
// Bali properties are required to submit — one row per booking with the
// fields typically asked for: name, nationality, ID/passport number, room,
// and stay dates. `doc` is a live PDFDocument already piped to the response.
function renderGuestReport(doc, { property, dateLabel, rows }) {
  // Header: logo (if any) sits top-right; the title block is pinned to a
  // fixed y BELOW the logo's bottom edge rather than following the
  // auto-flowing cursor, so it can never collide with the logo regardless of
  // how many lines the property name/address block above takes. Same fix as
  // routes/folio.js's invoice header.
  const headerTop = doc.y;
  const LOGO_SIZE = 65;
  const LOGO_X = 545 - LOGO_SIZE;

  if (property.logo_url) {
    try {
      const logoPath = path.join(__dirname, '../uploads/property-logos', path.basename(property.logo_url));
      if (fs.existsSync(logoPath)) doc.image(logoPath, LOGO_X, headerTop, { fit: [LOGO_SIZE, LOGO_SIZE] });
    } catch (_) {
      // missing/corrupt logo — text header only
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
  doc.fontSize(14).font('Helvetica-Bold').text('Guest Report', 350, rightColTop, { width: 200, align: 'right' });
  doc.fontSize(9).font('Helvetica').text(dateLabel, 350, doc.y, { width: 200, align: 'right' });
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, 350, doc.y, { width: 200, align: 'right' });

  doc.x = 50;
  doc.y = Math.max(leftColBottom, doc.y) + 20;
  const colX = { name: 50, nationality: 210, idNumber: 300, room: 400, checkIn: 445, checkOut: 500 };
  const colW = { name: 155, nationality: 85, idNumber: 95, room: 40, checkIn: 50, checkOut: 50 };

  function drawHeader(y) {
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Guest Name', colX.name, y, { width: colW.name });
    doc.text('Nationality', colX.nationality, y, { width: colW.nationality });
    doc.text('ID / Passport No.', colX.idNumber, y, { width: colW.idNumber });
    doc.text('Room', colX.room, y, { width: colW.room });
    doc.text('Check-in', colX.checkIn, y, { width: colW.checkIn });
    doc.text('Check-out', colX.checkOut, y, { width: colW.checkOut });
    doc.moveTo(50, y + 14).lineTo(550, y + 14).strokeColor('#ccc').stroke();
    return y + 20;
  }

  let y = drawHeader(doc.y);
  doc.font('Helvetica').fontSize(9);
  for (const r of rows) {
    if (y > 730) { doc.addPage(); y = drawHeader(50); doc.font('Helvetica').fontSize(9); }
    doc.text(r.guest_name || '', colX.name, y, { width: colW.name });
    doc.text(r.nationality || '—', colX.nationality, y, { width: colW.nationality });
    doc.text(r.id_number || '—', colX.idNumber, y, { width: colW.idNumber });
    doc.text(r.unit_name || '', colX.room, y, { width: colW.room });
    doc.text(String(r.check_in_date).slice(0, 10), colX.checkIn, y, { width: colW.checkIn });
    doc.text(String(r.check_out_date).slice(0, 10), colX.checkOut, y, { width: colW.checkOut });
    y += 16;
  }

  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#888').text('No guests match this filter.', 50, y);
  }

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#888').text(`${rows.length} guest${rows.length !== 1 ? 's' : ''} listed`, 50, doc.y);
}

module.exports = { renderGuestReport };
