// PDFs for an event (migration 106), each drawn on a live PDFDocument already
// positioned below the shared pdfHeader.drawDocumentHeader() block:
//   renderEventBill     — pro forma / invoice: the event's lines, service &
//                         tax, payments, balance; and, when the event is
//                         linked to a group booking, that group's balance and
//                         the total due for both.
//   renderFunctionSheet — for operations (kitchen, housekeeping, FO): who,
//                         when, how many, set-up notes, every meal. No prices.
const { MEAL_KINDS, whenText } = require('./eventService');

const fmtDay = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtShort = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const L = 50, R = 545, W = R - L;
const col = { desc: 50, qty: 320, price: 365, amount: 455 };

function room(doc, need) {
  if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function eventBlock(doc, e) {
  const top = doc.y;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Billed to', L, top);
  doc.font('Helvetica').text(e.customer || '—', L, doc.y, { width: 235 });
  if (e.contact_name && e.contact_name !== e.customer) doc.text(e.contact_name, { width: 235 });
  const contact = [e.contact_phone, e.contact_email].filter(Boolean).join(' · ');
  if (contact) doc.fontSize(9).fillColor('#555').text(contact, { width: 235 });
  const leftEnd = doc.y;

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Event', 310, top);
  doc.font('Helvetica').text(e.name, 310, doc.y, { width: 235 });
  doc.fontSize(9).fillColor('#555')
    .text(`${e.venue_name} · ${e.pax} people`, 310, doc.y, { width: 235 })
    .text(whenText(e), 310, doc.y, { width: 235 });
  doc.fillColor('#000').fontSize(10);
  doc.y = Math.max(leftEnd, doc.y) + 16;
}

// title: 'Pro Forma Invoice' | 'Invoice'. bill: eventService.eventBill().
// group: eventService.linkedGroup() or null. showBreakdown: print service &
// tax inside an all-in total (property_settings.show_tax_breakdown).
function renderEventBill(doc, { bill, group, showBreakdown = false, proforma = false }) {
  const e = bill.event;
  // A pro forma is what the client is asked to pay: it also lists the meals
  // agreed with them that the restaurant has not rung up yet. An invoice
  // carries only what is on the bill.
  const quoted = proforma ? (bill.quoted || []) : [];
  const fig = quoted.length ? (() => {
    const { computeFolioTotals } = require('./folioService');
    const t = computeFolioTotals(bill.subtotal + quoted.reduce((s, q) => s + q.amount, 0), bill.tax_rate, bill.service_charge_rate);
    const total = bill.expected_total;
    return { subtotal: t.subtotal, service_charge_amount: t.service_charge_amount, tax_amount: Math.round((total - t.subtotal - t.service_charge_amount) * 100) / 100, total };
  })() : { subtotal: bill.subtotal, service_charge_amount: bill.service_charge_amount, tax_amount: bill.tax_amount, total: bill.total };
  const allIn = !!bill.prices_include_tax;
  // All-in amounts are whole rupiah; "++" amounts keep their cents.
  const money = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', allIn
    ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  eventBlock(doc, e);

  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Description', col.desc, top);
  doc.text('Qty', col.qty, top, { width: 40, align: 'right' });
  doc.text(allIn ? 'Price' : 'Price (net)', col.price, top, { width: 85, align: 'right' });
  doc.text('Amount', col.amount, top, { width: 90, align: 'right' });
  doc.moveTo(L, top + 15).lineTo(R, top + 15).strokeColor('#ccc').stroke();
  let y = top + 22;
  doc.font('Helvetica').fontSize(10);
  if (!bill.charges.length && !quoted.length) {
    doc.fillColor('#777').text('No charges yet.', col.desc, y); doc.fillColor('#000');
    y += 18;
  }
  for (const c of bill.charges) {
    const label = `${c.description}${c.type === 'pos' ? ' (restaurant)' : ''} · ${fmtShort(c.service_date)}`;
    const h = Math.max(14, doc.heightOfString(label, { width: 260 }));
    if (y + h > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.y; }
    const amount = allIn ? c.total : c.amount;
    doc.text(label, col.desc, y, { width: 260 });
    doc.text(String(Number(c.quantity)), col.qty, y, { width: 40, align: 'right' });
    doc.text(money(amount / (Number(c.quantity) || 1)), col.price, y, { width: 85, align: 'right' });
    doc.text(money(amount), col.amount, y, { width: 90, align: 'right' });
    y += h + 5;
  }
  for (const q of quoted) {
    const label = `${q.description} · ${fmtShort(q.service_date)}${q.service_time ? ' ' + q.service_time : ''}`;
    const h = Math.max(14, doc.heightOfString(label, { width: 260 }));
    if (y + h > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.y; }
    const amount = allIn ? q.total : q.amount;
    doc.text(label, col.desc, y, { width: 260 });
    doc.text(String(q.pax), col.qty, y, { width: 40, align: 'right' });
    doc.text(money(amount / (q.pax || 1)), col.price, y, { width: 85, align: 'right' });
    doc.text(money(amount), col.amount, y, { width: 90, align: 'right' });
    y += h + 5;
  }
  doc.moveTo(L, y).lineTo(R, y).strokeColor('#ccc').stroke();
  y += 8;
  doc.y = y;

  const row = (label, value, { bold = false, color = '#000' } = {}) => {
    room(doc, 18);
    const yy = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(color);
    doc.text(label, 300, yy, { width: 150, align: 'right' });
    doc.text(value, col.amount, yy, { width: 90, align: 'right' });
    doc.fillColor('#000');
    doc.y = yy + (bold ? 18 : 15);
  };
  const taxed = fig.service_charge_amount > 0 || fig.tax_amount > 0;
  if (!allIn && taxed) {
    row('Subtotal', money(fig.subtotal));
    if (fig.service_charge_amount > 0) row(`Service charge (${bill.service_charge_rate}%)`, money(fig.service_charge_amount));
    if (fig.tax_amount > 0) row(`Tax (${bill.tax_rate}%)`, money(fig.tax_amount));
  }
  row('Total', money(fig.total), { bold: true });
  if (allIn && taxed && showBreakdown) {
    doc.font('Helvetica').fontSize(8).fillColor('#777')
      .text(`Includes service charge ${money(fig.service_charge_amount)} and tax ${money(fig.tax_amount)}`, L, doc.y, { width: W, align: 'right' });
    doc.fillColor('#000'); doc.moveDown(0.6);
  }

  const paid = bill.payments.filter(p => !p.is_voided);
  if (paid.length) {
    room(doc, 30 + paid.length * 14);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(10).text('Payments received', L, doc.y);
    doc.font('Helvetica').fontSize(9);
    for (const p of paid) {
      const yy = doc.y;
      const what = `${p.is_refund ? 'Refund' : 'Payment'} · ${p.method_label} · ${fmtDay(new Date(new Date(p.received_at).getTime() + 8 * 3600e3).toISOString())}${p.reference ? ` · ref ${p.reference}` : ''}`;
      doc.text(what, L, yy, { width: 380 });
      doc.text(money(p.amount), col.amount, yy, { width: 90, align: 'right' });
      doc.y = Math.max(doc.y, yy + 13);
    }
    doc.moveDown(0.4);
  }
  const dueRaw = Math.round((fig.total - bill.received) * 100) / 100;
  const due = Math.abs(dueRaw) <= 0.05 ? 0 : dueRaw;
  row(due < 0 ? 'Credit' : 'Balance due', money(Math.abs(due)), { bold: true, color: due > 0 ? '#B91C1C' : '#000' });
  if (!proforma && (bill.quoted || []).length) {
    room(doc, 26);
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#777')
      .text(`${bill.quoted.length} meal${bill.quoted.length === 1 ? '' : 's'} agreed for this event (${money(bill.quoted_total)}) ${bill.quoted.length === 1 ? 'is' : 'are'} not on this invoice yet: the restaurant has not rung ${bill.quoted.length === 1 ? 'it' : 'them'} up.`, L, doc.y, { width: W, align: 'right' });
    doc.fillColor('#000');
  }

  if (group) {
    room(doc, 80);
    doc.moveDown(0.8);
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10).text('Rooms for this event', L, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Group booking of ${group.booker || '—'} · ${group.rooms} room${group.rooms === 1 ? '' : 's'} · ${fmtDay(group.check_in_date)} – ${fmtDay(group.check_out_date)}. The rooms are on the group's own invoice.`, L, doc.y, { width: W });
    doc.fillColor('#000');
    if (group.balance_due != null) {
      doc.moveDown(0.4);
      row('Rooms — balance due', money(group.balance_due));
      row('Event — balance due', money(due));
      row('Total due', money(group.balance_due + due), { bold: true });
    }
  }
  if (e.status !== 'confirmed') {
    room(doc, 30);
    doc.moveDown(1);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777')
      .text(e.status === 'cancelled' ? 'This event is cancelled.' : 'Not confirmed yet — the venue is not reserved until the event is confirmed.', L, doc.y, { width: W });
    doc.fillColor('#000');
  }
}

function renderFunctionSheet(doc, { event: e, meals, group }) {
  const field = (label, value) => {
    if (!value) return;
    room(doc, 20);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#555').text(label, L, y, { width: 110 });
    doc.font('Helvetica').fontSize(11).fillColor('#000').text(String(value), L + 115, y, { width: W - 115 });
    doc.y = Math.max(doc.y, y + 16) + 3;
  };
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(e.name, L, doc.y, { width: W });
  doc.moveDown(0.5);
  field('Status', e.status.toUpperCase());
  field('For', e.customer);
  field('Contact', [e.contact_name, e.contact_phone].filter(Boolean).join(' · '));
  field('Venue', e.venue_name);
  field('When', whenText(e));
  field('People', e.pax);
  if (group) field('Rooms', `${group.rooms} room${group.rooms === 1 ? '' : 's'}, ${fmtDay(group.check_in_date)} – ${fmtDay(group.check_out_date)} (group of ${group.booker || '—'})`);
  field('Notes / set-up', e.notes);

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Meals', L, doc.y);
  doc.moveDown(0.3);
  const live = meals.filter(m => m.status !== 'cancelled');
  if (!live.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#777').text('No meals asked for.', L, doc.y);
    doc.fillColor('#000');
  } else {
    const top = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#555');
    doc.text('Day', L, top); doc.text('Time', 150, top); doc.text('What', 200, top); doc.text('People', 320, top, { width: 45, align: 'right' }); doc.text('Notes', 380, top);
    doc.moveTo(L, top + 13).lineTo(R, top + 13).strokeColor('#ccc').stroke();
    let y = top + 19;
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    for (const m of live) {
      const h = Math.max(14, doc.heightOfString(m.note || '', { width: R - 380 }));
      if (y + h > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.y; }
      doc.text(fmtShort(m.service_date), L, y, { width: 95 });
      doc.text(m.service_time || '—', 150, y, { width: 45 });
      doc.text(MEAL_KINDS[m.kind], 200, y, { width: 115 });
      doc.text(String(m.pax), 320, y, { width: 45, align: 'right' });
      doc.text(m.note || '', 380, y, { width: R - 380 });
      y += h + 6;
    }
    doc.y = y;
  }
  room(doc, 40);
  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(8).fillColor('#777')
    .text(`Event #${e.event_no} · function sheet · meals are rung up in the restaurant and charged to the event.`, L, doc.y, { width: W });
  doc.fillColor('#000');
}

module.exports = { renderEventBill, renderFunctionSheet };
