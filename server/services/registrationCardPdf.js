// Renders the guest registration card guests sign at check-in — front
// desk previously kept this as a hand-typed Word doc; this generates it
// from real booking/guest data instead, branded per property, as a
// bordered form (each field its own boxed cell) so it reads clearly and
// still has real writable space for whatever isn't on file yet.
// `doc` is a live PDFDocument already positioned below the shared
// drawDocumentHeader() block.
//
// Deliberately simplified vs. the original paper form: no First/Last
// name split (the system only ever stores one guests.name), no
// ETA/ETD (arrival/departure *time* isn't tracked anywhere — only the
// date is).

function fmtIDR(n) {
  // Fixed 2 decimals — see routes/folio.js's fmtIDR for why the bare
  // toLocaleString('id-ID') is inconsistent (trims trailing zeros unevenly).
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB'); // dd/mm/yyyy, matches the sample form
}

// Draws one row of bordered cells (a real ruled table, like the paper
// form) at doc.x=50..545. Each cell gets its own rect + a small label
// top-left + the value (if known) below it — left genuinely blank, not
// a '—', when a field isn't on file yet, so there's real writable space
// inside the box for staff/guest to fill in by hand.
function gridRow(doc, { x = 50, width = 495, height = 38, cells }) {
  const y = doc.y;
  const totalWeight = cells.reduce((sum, c) => sum + (c.weight || 1), 0);
  let cx = x;
  cells.forEach(cell => {
    const w = width * (cell.weight || 1) / totalWeight;
    doc.lineWidth(0.75).strokeColor('#000').rect(cx, y, w, height).stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(cell.label.toUpperCase() + ' :', cx + 6, y + 6, { width: w - 12 });
    if (cell.value) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
        .text(cell.value, cx + 6, y + 19, { width: w - 12, height: height - 23, ellipsis: true });
    }
    cx += w;
  });
  doc.x = x;
  doc.y = y + height;
}

function renderRegistrationCard(doc, { property, data }) {
  const title = "'WELCOME - SELAMAT DATANG'";
  const titleY = doc.y;
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
    .text(title, 50, titleY, { width: 495, align: 'center' });
  doc.y = titleY + doc.heightOfString(title, { width: 495 }) + 10;

  // Room Rate / Deposit are hidden for a booking source with
  // publish_rate=false (OTA/travel-agent — migration 065): the rate the
  // hotel actually nets differs from what the guest paid the channel,
  // and isn't something to print on a guest-facing document. Shown as
  // a plain note instead of the numbers, naming the actual source
  // rather than a generic placeholder.
  const showRate = data.publish_rate !== false;
  const rateHiddenNote = `Arranged by ${data.source_label || 'Agent'}`;

  // ── Guest & stay details ──────────────────────────────────────────
  gridRow(doc, {
    height: 38,
    cells: [
      { label: 'Guest Name', value: data.guest_name, weight: 2 },
      { label: 'No. of Guests', value: data.num_guests != null ? String(data.num_guests) : '', weight: 1 },
    ],
  });
  gridRow(doc, {
    cells: [
      { label: 'Arrival Date', value: fmtDate(data.check_in_date) },
      { label: 'Departure Date', value: fmtDate(data.check_out_date) },
    ],
  });
  gridRow(doc, {
    height: 48,
    cells: [
      { label: 'Home Address', value: data.address },
      { label: 'Email', value: data.email },
    ],
  });
  gridRow(doc, {
    cells: [
      { label: 'Passport / ID Card Number', value: data.id_number },
      { label: 'Nationality', value: data.nationality },
    ],
  });
  gridRow(doc, {
    cells: [
      { label: 'Mobile No.', value: data.mobile },
      { label: 'Payment Method', value: data.payment_method_label },
    ],
  });
  gridRow(doc, { cells: [{ label: 'Membership', value: data.membership }] });

  doc.y += 12;

  // ── House rules (plain text, not boxed — matches the original) ────
  if (property.registration_notice) {
    if (doc.y > 600) doc.addPage();
    const headingY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
      .text('PLEASE NOTE', 50, headingY, { width: 495 });
    const bodyY = headingY + doc.heightOfString('PLEASE NOTE', { width: 495 }) + 4;
    doc.font('Helvetica').fontSize(8).fillColor('#333')
      .text(property.registration_notice, 50, bodyY, { width: 495, lineGap: 2 });
    const bodyHeight = doc.heightOfString(property.registration_notice, { width: 495, lineGap: 2 });
    doc.fillColor('#000');
    doc.y = bodyY + bodyHeight + 16;
  }

  if (doc.y > 660) doc.addPage();
  doc.font('Helvetica').fontSize(9).fillColor('#000')
    .text('GUEST SIGNATURE :', 50, doc.y);
  doc.y += 32;
  doc.moveTo(50, doc.y).lineTo(260, doc.y).strokeColor('#000').stroke();
  doc.y += 20;

  // ── Room & booking details ─────────────────────────────────────────
  if (doc.y > 700) doc.addPage();
  gridRow(doc, {
    cells: [
      { label: 'Room Number', value: data.unit_name },
      { label: 'Source of Booking', value: data.source_label },
      { label: 'Room Rate (per night)', value: showRate ? (data.room_rate != null ? fmtIDR(data.room_rate) : '') : rateHiddenNote },
    ],
  });
  gridRow(doc, {
    cells: [
      { label: 'Type', value: data.room_type_name },
      { label: 'Purpose of Stay', value: data.purpose_of_stay },
      { label: 'Deposit', value: showRate ? (data.deposit_amount != null ? fmtIDR(data.deposit_amount) : '') : rateHiddenNote },
    ],
  });
  gridRow(doc, {
    height: 44,
    cells: [
      { label: 'Checked In By', value: data.checked_in_by },
      { label: 'Escorted By', value: '' },
      { label: 'Checked By', value: '' },
    ],
  });
}

module.exports = { renderRegistrationCard };
