// Night Audit report PDF — the printed twin of the detail window on
// client/src/pages/NightAudit.jsx, from services/nightAuditDetail.js.
// `doc` is a live A4 portrait PDFDocument already below drawDocumentHeader().

const LEFT = 50;
const RIGHT = 545;
const BOTTOM = 780;

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
function fmtShort(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function ensure(doc, y, need) {
  if (y + need > BOTTOM) { doc.addPage(); return 50; }
  return y;
}

function heading(doc, y, title, right) {
  y = ensure(doc, y, 50);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title, LEFT, y);
  if (right) doc.font('Helvetica').fontSize(8.5).fillColor('#666').text(right, 300, y + 2, { width: RIGHT - 300, align: 'right' });
  doc.fillColor('#000');
  return y + 17;
}

function empty(doc, y, text) {
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#777').text(text, LEFT, y);
  doc.fillColor('#000');
  return y + 20;
}

// cols: [{ label, w, align }] summing to 495; rows: arrays of strings.
// opts.total: array of strings drawn bold under a line.
function table(doc, y, cols, rows, opts = {}) {
  const xs = [];
  let x = LEFT;
  for (const c of cols) { xs.push(x); x += c.w; }
  const head = yy => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555');
    cols.forEach((c, i) => doc.text(c.label.toUpperCase(), xs[i], yy, { width: c.w - 4, align: c.align || 'left' }));
    doc.moveTo(LEFT, yy + 11).lineTo(RIGHT, yy + 11).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.fillColor('#000');
    return yy + 15;
  };
  const noHead = cols.every(c => !c.label);
  y = ensure(doc, y, 30);
  if (!noHead) y = head(y);
  for (const r of rows) {
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(String(r[i] ?? ''), { width: c.w - 4 }))) + 5;
    if (y + h > BOTTOM) { doc.addPage(); y = noHead ? 50 : head(50); }
    cols.forEach((c, i) => doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000')
      .text(String(r[i] ?? ''), xs[i], y, { width: c.w - 4, align: c.align || 'left' }));
    y += h;
    doc.moveTo(LEFT, y - 2).lineTo(RIGHT, y - 2).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  if (opts.total) {
    y = ensure(doc, y, 16);
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#999').lineWidth(0.7).stroke();
    cols.forEach((c, i) => doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000')
      .text(String(opts.total[i] ?? ''), xs[i], y + 4, { width: c.w - 4, align: c.align || 'left' }));
    y += 18;
  }
  return y + 10;
}

function boxes(doc, y, items) {
  const w = (RIGHT - LEFT - (items.length - 1) * 6) / items.length;
  items.forEach((it, i) => {
    const x = LEFT + i * (w + 6);
    doc.rect(x, y, w, 40).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#777').text(it.label.toUpperCase(), x + 6, y + 6, { width: w - 12 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(it.value, x + 6, y + 17, { width: w - 12 });
    if (it.sub) doc.font('Helvetica').fontSize(6.5).fillColor('#777').text(it.sub, x + 6, y + 30, { width: w - 12 });
  });
  doc.fillColor('#000');
  return y + 50;
}

function renderNightAudit(doc, d, { run } = {}) {
  let y = doc.y;
  const s = d.summary;

  if (!d.snapshot) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#B45309')
      .text('This audit ran before details were saved — this report is rebuilt from the data as it is now, so later changes (price edits, cancellations) are included.', LEFT, y, { width: RIGHT - LEFT });
    y = doc.y + 8;
  }
  if (run) {
    doc.font('Helvetica').fontSize(8).fillColor('#666')
      .text(`Audit run ${new Date(run.run_at).toLocaleString('en-GB', { timeZone: 'Asia/Makassar' })} (WITA) · ${String(run.triggered_by || '').startsWith('manual') ? 'run by hand' : 'automatic'}`, LEFT, y);
    y = doc.y + 8;
  }

  // 1. The day
  y = heading(doc, y, 'The day');
  y = boxes(doc, y, [
    { label: 'Rooms sold', value: `${s.rooms_sold} / ${s.sellable}`, sub: `${s.occupancy}% occupancy` },
    { label: 'ADR', value: fmtIDR(s.adr), sub: s.comp_nights ? `excl. ${s.comp_nights} free night(s)` : 'paid nights' },
    { label: 'RevPAR', value: fmtIDR(s.revpar) },
    { label: 'Total revenue (net)', value: fmtIDR(s.total) },
  ]);
  y = table(doc, y, [{ label: 'Revenue (net, before service & tax)', w: 345 }, { label: 'Amount', w: 150, align: 'right' }], [
    ['Rooms', fmtIDR(s.room)],
    ['F&B', fmtIDR(s.fnb)],
    ['Extras', fmtIDR(s.extras)],
    ['Activities', fmtIDR(s.activities)],
  ], { total: ['Total', fmtIDR(s.total)] });
  if (s.comp_nights) {
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(`Complimentary: ${s.comp_nights} night(s) · value ${fmtIDR(s.comp_value)} (not in revenue)`, LEFT, y - 6);
    y = doc.y + 8;
  }

  // 2. Charges posted
  const p = d.posted;
  y = heading(doc, y, 'Charges posted for the night', `${p.rooms} room(s) · net amounts`);
  if (!p.rows.length) y = empty(doc, y, 'No room charges were posted for this night.');
  else {
    y = table(doc, y, [
      { label: 'Room', w: 45 }, { label: 'Guest', w: 150 }, { label: 'Plan', w: 40 },
      { label: 'Room', w: 70, align: 'right' }, { label: 'Meals', w: 60, align: 'right' },
      { label: 'Extras', w: 60, align: 'right' }, { label: 'Total', w: 70, align: 'right' },
    ], p.rows.map(r => [
      r.unit_name,
      r.guest_name + (r.extras.length ? `\n${r.extras.map(e => `${e.quantity}× ${e.description}`).join(', ')}` : '') + (r.complimentary ? '\nComplimentary' : ''),
      r.rate_plan, num(r.room), num(r.meals), num(r.extras_total), num(r.total),
    ]), { total: ['', 'Total', '', num(p.totals.room), num(p.totals.meals), num(p.totals.extras), num(p.totals.total)] });
  }
  if (s.rooms_sold !== p.rooms) {
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(
      `${s.rooms_sold} room(s) sold, ${p.rooms} posted — Revenue above counts every room sold (the Reports rule), including stays never checked in or free; posted = charged to the guest's folio. Extras in revenue are counted on the day they were sold.`,
      LEFT, y - 6, { width: RIGHT - LEFT });
    y = doc.y + 10;
  }

  // 3. What needs attention
  const a = d.actions;
  y = heading(doc, y, 'Found by the audit');
  const lines = [];
  for (const n of a.no_shows) lines.push(['No-show', n.unit_name, `${n.guest_name} — marked no-show (never checked in on the arrival day)`]);
  for (const o of a.overdue || []) lines.push(['Past check-out', o.unit_name, `${o.guest_name} — still checked in, was due out ${fmtShort(o.check_out_date)}`]);
  for (const m of d.not_posted) lines.push(['Not posted', m.unit_name, `${m.guest_name} — ${m.reason}`]);
  for (const r of d.never_arrived) lines.push(['Never arrived', r.unit_name, `${r.guest_name} — booked ${fmtShort(r.check_in_date)}–${fmtShort(r.check_out_date)}, not checked in (counts as sold until marked no-show or cancelled)`]);
  if (!lines.length) y = empty(doc, y, 'Nothing to follow up.');
  else y = table(doc, y, [{ label: 'What', w: 80 }, { label: 'Room', w: 50 }, { label: 'Details', w: 365 }], lines);
  const notes = [];
  if (a.tasks_created != null) notes.push(`${a.tasks_created} housekeeping task(s) created for the next day's check-outs`);
  if (a.folio_failed) notes.push(`${a.folio_failed} room(s) failed to post — check the list above`);
  if (notes.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(notes.join(' · '), LEFT, y - 6, { width: RIGHT - LEFT });
    y = doc.y + 10;
  }

  // 4. Money received
  const c = d.collected;
  y = heading(doc, y, 'Money received that day', fmtIDR(c.total));
  if (!c.by_method.length) y = empty(doc, y, 'No payments received.');
  else y = table(doc, y, [{ label: 'Method', w: 345 }, { label: 'Amount', w: 150, align: 'right' }],
    c.by_method.map(m => [m.method, fmtIDR(m.amount)]), { total: ['Total', fmtIDR(c.total)] });

  // 5. Bookings
  const b = d.bookings;
  y = heading(doc, y, 'Reservations that day');
  y = table(doc, y, [{ label: '', w: 345 }, { label: '', w: 150, align: 'right' }], [
    ['Made', `${b.made?.bookings ?? 0} booking(s) · ${b.made?.nights ?? 0} night(s) · ${fmtIDR(b.made?.value)}`],
    ['Cancelled', `${b.cancelled} · ${fmtIDR(b.cancelled_value)}`],
  ]);

  // 6. Next day
  const nd = d.next_day;
  y = heading(doc, y, `Next day — ${fmtShort(nd.date)}`, `${nd.arrivals?.rooms ?? 0} arriving · ${nd.departures?.rooms ?? 0} departing`);
  if (!nd.to_collect.rows.length) y = empty(doc, y, 'Nothing to collect from guests leaving.');
  else y = table(doc, y, [{ label: 'Room', w: 60 }, { label: 'Guest leaving', w: 285 }, { label: 'To collect', w: 150, align: 'right' }],
    nd.to_collect.rows.map(r => [r.unit_name, r.guest_name, fmtIDR(r.balance_due)]), { total: ['', 'Total', fmtIDR(nd.to_collect.amount)] });

  y = ensure(doc, y, 20);
  doc.font('Helvetica').fontSize(7).fillColor('#999')
    .text(`Printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Makassar' })} (WITA)`, LEFT, y, { width: RIGHT - LEFT, align: 'center' });
}

module.exports = { renderNightAudit };
