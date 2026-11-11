// The voucher document the guest receives: a landscape ticket (front) and a back
// with how to redeem, the rules and the terms — all printed from the snapshot
// taken when it was sold, so a later change to the voucher type never changes a
// voucher already out. The property name, address and colour come from the
// property's own settings.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDate = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const GOLD = '#D9B45E', GOLD_DARK = '#8A6A1F', CREAM = '#F6EFE2', INK = '#3A0F1B', MUTED = '#6B5A4A', GROUND = '#1E0A10';
const W = 841.89, H = 595.28;             // A4 landscape
const CX = 30, CY = 30, CW = W - 60, CH = H - 60;   // the ticket
const SPLIT = CX + 560;                   // where the stub starts

function colorOf(property) {
  const c = String(property.app_color || '');
  if (!/^#[0-9a-f]{6}$/i.test(c)) return '#5B1A2B';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#5B1A2B' : c;   // light colours can't carry cream text
}

function ground(doc) {
  doc.rect(0, 0, W, H).fill(GROUND);
}

async function renderVoucherPdf(res, { property, voucher, filename }) {
  property = property || {};
  const s = voucher.snapshot || {};
  const free = !!voucher.is_free;
  const maroon = colorOf(property);
  const hotel = String(property.property_name || 'Hotel');
  const qr = await QRCode.toBuffer(voucher.code, { type: 'png', margin: 1, width: 440 });

  const doc = new PDFDocument({ margin: 0, size: [W, H] });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // ───────── Front ─────────
  ground(doc);
  doc.save().roundedRect(CX, CY, CW, CH, 18).clip();
  doc.rect(CX, CY, CW, CH).fill(maroon);
  doc.rect(SPLIT, CY, CX + CW - SPLIT, CH).fill(CREAM);
  doc.restore();
  // faint rings behind the title
  doc.save().roundedRect(CX, CY, SPLIT - CX, CH, 18).clip();
  doc.lineWidth(0.6).strokeColor(GOLD).strokeOpacity(0.22);
  for (let r = 50; r <= 300; r += 50) doc.circle(SPLIT - 40, CY + 40, r).stroke();
  doc.restore();
  doc.strokeOpacity(1);
  // gold inner frame, perforation, notches
  doc.roundedRect(CX + 14, CY + 14, SPLIT - CX - 28, CH - 28, 10).lineWidth(0.7).strokeColor(GOLD).strokeOpacity(0.6).stroke().strokeOpacity(1);
  doc.moveTo(SPLIT, CY + 18).lineTo(SPLIT, CY + CH - 18).lineWidth(1).strokeColor('#5E1A2B').strokeOpacity(0.4).dash(5, { space: 4 }).stroke().undash().strokeOpacity(1);
  doc.circle(SPLIT, CY, 13).fill(GROUND);
  doc.circle(SPLIT, CY + CH, 13).fill(GROUND);

  const lx = CX + 44, lw = SPLIT - CX - 88;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GOLD)
    .text(hotel.toUpperCase(), lx, CY + 42, { width: lw * 0.7, characterSpacing: 2.6, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(CREAM).fillOpacity(0.85)
    .text(free ? 'COMPLIMENTARY VOUCHER' : 'STAY VOUCHER', lx, CY + 43, { width: lw, align: 'right', characterSpacing: 2.4, lineBreak: false }).fillOpacity(1);

  // the nights, large
  const nights = String(s.nights || 1);
  doc.font('Times-Roman').fontSize(138);
  const nw = doc.widthOfString(nights);
  doc.fillColor(GOLD).text(nights, lx - 2, CY + 100, { lineBreak: false });
  doc.font('Times-Italic').fontSize(23).fillColor(CREAM).fillOpacity(0.92)
    .text(`night${s.nights === 1 ? '' : 's'} of calm`, lx + nw + 18, CY + 183, { lineBreak: false }).fillOpacity(1);
  doc.font('Times-Bold').fontSize(s.room_type_name && s.room_type_name.length > 22 ? 30 : 36).fillColor(CREAM)
    .text(s.room_type_name || 'Your room', lx, CY + 262, { width: lw, lineBreak: false });
  if (s.name) doc.font('Helvetica').fontSize(10).fillColor(CREAM).fillOpacity(0.75).text(s.name, lx, CY + 308, { width: lw, lineBreak: false }).fillOpacity(1);

  // the facts row
  const fy = CY + CH - 112;
  doc.moveTo(lx, fy).lineTo(lx + lw, fy).lineWidth(0.7).strokeColor(GOLD).strokeOpacity(0.5).stroke().strokeOpacity(1);
  const who = voucher.recipient_name || voucher.buyer_name || '';
  const facts = [
    ['INCLUDES', s.rate_plan_name || 'Room only'],
    ['FOR', `Up to ${s.max_guests || 2} guest${s.max_guests === 1 ? '' : 's'}`],
    ['VALID UNTIL', fmtDate(voucher.expires_on)],
    [free ? 'GIVEN TO' : 'PREPARED FOR', who || '—'],
  ];
  const colW = [105, 95, 125, lw - 325];
  let fx = lx;
  facts.forEach(([k, v], i) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GOLD).text(k, fx, fy + 16, { width: colW[i] - 6, characterSpacing: 1.8, lineBreak: false });
    doc.font('Helvetica').fontSize(11.5).fillColor(CREAM).text(v, fx, fy + 32, { width: colW[i] - 8, height: 30, ellipsis: true });
    fx += colW[i];
  });

  // the stub
  const sx = SPLIT + 22, sw = CX + CW - SPLIT - 44, mid = SPLIT + (CX + CW - SPLIT) / 2;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DARK).text('YOUR CODE', sx, CY + 52, { width: sw, align: 'center', characterSpacing: 2.4, lineBreak: false });
  const qs = 132;
  doc.roundedRect(mid - qs / 2 - 8, CY + 100, qs + 16, qs + 16, 8).lineWidth(0.8).strokeColor('#C9A24B').fillAndStroke('#FFFFFF', '#C9A24B');
  doc.image(qr, mid - qs / 2, CY + 108, { width: qs });
  doc.font('Times-Bold').fontSize(17).fillColor(INK).text(voucher.pretty_code, SPLIT + 6, CY + 284, { width: CX + CW - SPLIT - 12, align: 'center', characterSpacing: 0.6, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(free ? 'Quote this code when you book.' : 'Quote this code when you book.', sx, CY + 322, { width: sw, align: 'center', lineBreak: false })
    .text(free ? 'Complimentary, no cash value.' : 'Use once, no cash value.', sx, CY + 336, { width: sw, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(voucher.voucher_label || '', sx, CY + CH - 40, { width: sw, align: 'center', lineBreak: false });

  // ───────── Back ─────────
  doc.addPage({ margin: 0, size: [W, H] });
  ground(doc);
  doc.roundedRect(CX, CY, CW, CH, 18).fill(CREAM);
  doc.roundedRect(CX + 14, CY + 14, CW - 28, CH - 28, 10).lineWidth(0.7).strokeColor('#C9A24B').stroke();

  const bx = CX + 44, bw = 250;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD_DARK).text('HOW TO REDEEM', bx, CY + 46, { width: bw, characterSpacing: 2.4, lineBreak: false });
  doc.font('Times-Bold').fontSize(26).fillColor(INK).text('Three steps to your stay', bx, CY + 66, { width: bw });
  const steps = [
    'Choose your dates within the validity period and contact our reservations team.',
    `Quote your voucher code. We confirm the booking${free ? '' : ', with nothing more to pay for the stay'}.`,
    'Arrive, check in and enjoy. Extras you add are paid as usual.',
  ];
  let sy = CY + 140;
  steps.forEach((t, i) => {
    doc.circle(bx + 14, sy + 14, 14).lineWidth(0.8).strokeColor('#C9A24B').stroke();
    doc.font('Times-Bold').fontSize(14).fillColor(INK).text(String(i + 1), bx + 14 - 10, sy + 7, { width: 20, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(t, bx + 42, sy + 2, { width: bw - 44, lineGap: 2 });
    sy = Math.max(doc.y, sy + 30) + 22;
  });
  if (free || voucher.price != null) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(free
      ? `Complimentary — ${{ room: 'the room is covered; meals and extras are paid by the guest', room_meals: 'the room and meals are covered; extras are paid by the guest', all: 'the room, meals and extras are all covered' }[voucher.free_scope] || 'covered'}.`
      : `Voucher value ${fmtIDR(voucher.price)}. The room and meal plan are fully covered.`, bx, Math.max(sy, CY + 380), { width: bw, lineGap: 1.5 });
  }

  const dx = bx + bw + 28;
  doc.moveTo(dx, CY + 46).lineTo(dx, CY + CH - 46).lineWidth(0.7).strokeColor('#C9A24B').stroke();
  const tx = dx + 28, tw = CX + CW - 44 - tx;

  const rules = [];
  if (s.min_notice_days > 0) rules.push(`Book at least ${s.min_notice_days} day${s.min_notice_days === 1 ? '' : 's'} before arrival.`);
  if (Array.isArray(s.allowed_weekdays) && s.allowed_weekdays.length) rules.push(`Check-in on ${s.allowed_weekdays.map(d => DAYS[d]).join(', ')} only.`);
  for (const b of s.blackout || []) rules.push(`Not valid ${b.label ? `${b.label}: ` : ''}${fmtDate(b.from)}${b.to !== b.from ? ` to ${fmtDate(b.to)}` : ''}.`);
  rules.push('Use the voucher once, for the whole stay. It can\'t be exchanged for cash or refunded.');
  if (free) rules.push('This voucher is a complimentary offer and has no cash value.');
  if (s.no_show_consumes) rules.push('A booking that is not honoured (no-show) uses up the voucher.');
  if (s.transferable === false) rules.push('The voucher is for the named guest only.');

  const termsText = s.terms ? String(s.terms).replace(/\r\n?/g, '\n') : '';
  const ruleText = rules.map(r => `•  ${r}`).join('\n');
  const availH = CH - 46 - 46 - 20 - 78;           // below the heading, above the footer
  let fs = 9.5;
  const hOf = size => {
    doc.font('Helvetica').fontSize(size);
    return doc.heightOfString(ruleText, { width: tw, lineGap: 1.5 }) + 34 + (termsText ? doc.heightOfString(termsText, { width: tw, lineGap: 1.2 }) + 30 : 0);
  };
  while (fs > 6.2 && hOf(fs) > availH) fs -= 0.3;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD_DARK).text('GOOD TO KNOW', tx, CY + 46, { width: tw, characterSpacing: 2.4, lineBreak: false });
  doc.font('Helvetica').fontSize(fs).fillColor('#4A3A32').text(ruleText, tx, CY + 64, { width: tw, lineGap: 1.5 });
  if (termsText) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD_DARK).text('TERMS & CONDITIONS', tx, doc.y + 16, { width: tw, characterSpacing: 2.4, lineBreak: false });
    doc.font('Helvetica').fontSize(fs).fillColor('#4A3A32').text(termsText, tx, doc.y + 6, { width: tw, lineGap: 1.2 });
  }

  // footer: the hotel
  const fyb = CY + CH - 80;
  doc.moveTo(tx, fyb).lineTo(tx + tw, fyb).lineWidth(0.7).strokeColor('#C9A24B').stroke();
  const contact = [property.property_address, [property.property_phone, property.property_email].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(contact, tx, fyb + 14, { width: tw * 0.5, lineGap: 2 });
  doc.font('Times-Bold').fontSize(11).fillColor(maroon).text(hotel.toUpperCase(), tx + tw * 0.45, fyb + 16, { width: tw * 0.55, align: 'right', characterSpacing: 0.8, lineBreak: false });

  doc.end();
}

module.exports = { renderVoucherPdf };
