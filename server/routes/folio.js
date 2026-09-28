const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const { loadFolio, computeProforma, round2 } = require('../services/folioService');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { factor } = require('../services/priceBasis');
const { recomputeBookingStatus } = require('../services/paymentStatusService');

function fmtIDR(n) {
  // Fixed 2 decimals — the default toLocaleString('id-ID') caps at 3 fraction
  // digits but trims trailing zeros down to the minimum of 0, so e.g.
  // 2105103.30 prints as "2.105.103,3" while 2105103.31 prints as
  // "2.105.103,31" on the same invoice (real bug, not rounding: room charges
  // are split across nights to the cent, e.g. 6315309.91 / 3 nights).
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// GET /api/folio/group/:groupId — master folio: aggregates each room's own
// folio (still keyed to its own booking_id — folio_charges are always posted
// per-room) into one combined total. Read-only, no schema change.
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { rows: [group] } = await db.query(
      'SELECT id FROM reservation_groups WHERE id = $1 AND property_id = $2',
      [req.params.groupId, req.propertyId]
    );
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { rows: bookingRows } = await db.query(
      'SELECT id FROM bookings WHERE reservation_group_id = $1 AND property_id = $2',
      [req.params.groupId, req.propertyId]
    );
    const folios = await Promise.all(bookingRows.map(b => loadFolio(b.id, req.propertyId)));
    const sum = key => round2(folios.reduce((s, f) => s + f[key], 0));
    const byType = type => round2(folios.reduce((s, f) =>
      s + f.charges.filter(c => c.type === type).reduce((cs, c) => cs + parseFloat(c.amount), 0), 0));

    res.json({
      group_id: group.id,
      rooms: folios.map(f => ({
        booking_id: f.booking.id, unit_name: f.booking.unit_name,
        complimentary_scope: f.booking.complimentary_scope || null,
        charges: f.charges, payments: f.payments,
        subtotal: f.subtotal, total: f.total, balance_due: f.balance_due,
      })),
      subtotal: sum('subtotal'),
      service_charge_rate: folios[0]?.service_charge_rate ?? 0,
      tax_rate: folios[0]?.tax_rate ?? 0,
      prices_include_tax: !!folios[0]?.prices_include_tax,
      show_tax_breakdown: !!folios[0]?.show_tax_breakdown,
      service_charge_amount: sum('service_charge_amount'),
      tax_amount: sum('tax_amount'),
      total: sum('total'),
      balance_due: sum('balance_due'),
      by_type: { room: byType('room'), fnb: byType('fnb') },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/folio/:bookingId
router.get('/:bookingId', auth, async (req, res) => {
  try {
    const folio = await loadFolio(req.params.bookingId, req.propertyId);
    if (!folio) return res.status(404).json({ error: 'Booking not found' });
    const { booking, property, ...rest } = folio;
    res.json({ booking_id: booking.id, complimentary_scope: booking.complimentary_scope || null, ...rest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/folio/:bookingId/estimate — JSON projection (see
// folioService.computeProforma), used by the Folio tab to show a sensible
// "Estimated Balance Due" even before any night has actually posted to the
// ledger (loadFolio's balance_due is 0 minus whatever's been paid until
// then, which reads as a confusing negative number pre-check-in/pre-audit).
router.get('/:bookingId/estimate', auth, async (req, res) => {
  try {
    const estimate = await computeProforma(req.params.bookingId, req.propertyId);
    if (!estimate) return res.status(404).json({ error: 'Booking not found' });
    const { booking, property, ...rest } = estimate;
    res.json({ booking_id: booking.id, ...rest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// No free-text charges on the folio (removed with migration 077): anything
// charged to a guest goes through a Sales item (POST /api/sales, room_charge)
// so Sales History and the reports count it — including "Other charge", an
// item whose description and price are typed at sale.

// POST /api/folio/:bookingId/payment — record money received against the
// whole folio: { amount, method, received_at?, notes? }. Settles what's
// owed on the stay, e.g. extras charged to the room (extra bed, laundry,
// activities) that no room payment line covers — before this there was no
// way to mark those paid, so a checked-out guest could stay "owing" forever.
// Applied in order: the room's own pending deposit/balance lines first
// (oldest first; a partial payment splits a line into a received part and a
// pending remainder), so Payment Tracking and the booking status stay
// right; whatever is left is recorded as an 'incidental' payment (extras
// paid at the desk, migration 067 — never mistaken for the room's payment).
router.post('/:bookingId/payment', auth, async (req, res) => {
  const amount = round2(parseFloat(req.body.amount));
  const { method, notes } = req.body;
  const receivedAt = req.body.received_at || null;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be more than 0' });
  if (!method) return res.status(400).json({ error: 'Payment method required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [booking] } = await client.query(
      'SELECT id, status FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.bookingId, req.propertyId]
    );
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    if (['cancelled', 'no_show'].includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot record a payment — booking is ${booking.status.replace('_', '-')}` });
    }
    const { rows: [pm] } = await client.query(
      'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true', [method, req.propertyId]
    );
    if (!pm) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid payment method' }); }

    const cleanNotes = String(notes || '').trim() || null;
    let remaining = amount;
    const applied = [];
    const { rows: lines } = await client.query(
      `SELECT id, type, amount FROM payments
       WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'pending' AND amount > 0
       ORDER BY CASE type WHEN 'deposit' THEN 0 ELSE 1 END, created_at FOR UPDATE`,
      [booking.id]
    );
    for (const l of lines) {
      if (remaining <= 0) break;
      const lineAmt = parseFloat(l.amount);
      if (remaining >= lineAmt) {
        await client.query(
          `UPDATE payments SET status = 'received', method = $1, received_at = COALESCE($2::timestamptz, NOW()),
                               received_by = $3, notes = COALESCE($4, notes)
           WHERE id = $5`,
          [method, receivedAt, req.user.id, cleanNotes, l.id]
        );
        applied.push({ type: l.type, amount: lineAmt });
        remaining = round2(remaining - lineAmt);
      } else {
        // Partial: keep the unpaid remainder pending, record the paid part.
        await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [round2(lineAmt - remaining), l.id]);
        await client.query(
          `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes)
           VALUES ($1, $2, $3, 'received', $4, COALESCE($5::timestamptz, NOW()), $6, $7)`,
          [booking.id, l.type, remaining, method, receivedAt, req.user.id, cleanNotes]
        );
        applied.push({ type: l.type, amount: remaining });
        remaining = 0;
      }
    }
    if (remaining > 0) {
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes)
         VALUES ($1, 'incidental', $2, 'received', $3, COALESCE($4::timestamptz, NOW()), $5, $6)`,
        [booking.id, remaining, method, receivedAt, req.user.id, cleanNotes || 'Folio payment (extras)']
      );
      applied.push({ type: 'incidental', amount: remaining });
    }
    await recomputeBookingStatus(client, booking.id);
    await client.query(
      'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [booking.id, `Payment recorded on folio: Rp ${Math.round(amount).toLocaleString('id-ID')} (${method})${cleanNotes ? ` — ${cleanNotes}` : ''}`.slice(0, 1000), req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ amount, applied });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/folio/charge/:id — void, not hard delete
router.delete('/charge/:id', auth, async (req, res) => {
  try {
    const { rows: [charge] } = await db.query(
      `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
       WHERE id = $2
         AND is_voided = false
         AND booking_id IN (SELECT id FROM bookings WHERE property_id = $3)
       RETURNING *`,
      [req.user.id, req.params.id, req.propertyId]
    );
    if (!charge) return res.status(404).json({ error: 'Charge not found' });
    res.json(charge);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guest-facing stay lines: each night's room + meal-plan charges printed as
// ONE line ("Room with Breakfast"), and nights in a row at the same rate
// grouped ("27 Sep – 29 Sep · 2 nights × rate") — the way guests (and the
// previous PMS) expect it; the breakfast price isn't shown on its own. The
// folio underneath, the Folio tab and the reports keep room and meals apart.
function stayLabel(b, { roomPart, mealPart }) {
  const bf = b?.includes_breakfast, lu = b?.includes_lunch, di = b?.includes_dinner;
  const meals = bf && lu && di ? 'Full Board' : bf && di ? 'Half Board' : bf && !lu && !di ? 'Breakfast'
    : (bf || lu || di) ? (b?.rate_plan_name || 'meals') : null;
  if (roomPart && mealPart) return meals ? `Room with ${meals}` : 'Room with meals';
  if (roomPart) return 'Room';
  return meals || 'Meals';   // room complimentary, meals charged
}
const shortDay = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const nextDay = d => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
// Per-night extras (type 'addon', migration 074): same idea — one line per
// item per run of nights at the same price. Description comes in as
// "Extra Bed — 2026-09-28"; the name is the part before the date.
function mergeAddonLines(charges) {
  const runs = [];
  const lines = charges.filter(c => c.type === 'addon' && c.service_date)
    .map(c => ({
      name: String(c.description).replace(/ — \d{4}-\d{2}-\d{2}$/, ''),
      date: String(c.service_date instanceof Date ? c.service_date.toISOString() : c.service_date).slice(0, 10),
      qty: parseFloat(c.quantity) || 1,
      unit: parseFloat(c.unit_price),
      amount: parseFloat(c.amount),
      withMeal: !!c.addon_meal,
      paid: c.paid_method || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
  for (const l of lines) {
    const last = runs[runs.length - 1];
    if (last && last.name === l.name && last.qty === l.qty && last.withMeal === l.withMeal && last.paid === l.paid && Math.abs(last.unit - l.unit) < 1 && nextDay(last.to) === l.date) {
      last.to = l.date; last.nights++; last.sum += l.amount;
    } else runs.push({ name: l.name, from: l.date, to: l.date, nights: 1, qty: l.qty, unit: l.unit, sum: l.amount, withMeal: l.withMeal, paid: l.paid });
  }
  return runs.map(r => ({
    type: 'stay',
    description: `${r.name}${r.withMeal ? ' with Breakfast' : ''}${r.qty > 1 ? ` × ${r.qty}` : ''} · ${shortDay(r.from)} – ${shortDay(nextDay(r.to))}`,
    quantity: r.nights * r.qty, unit_price: Math.round((r.sum / (r.nights * r.qty)) * 100) / 100,
    amount: Math.round(r.sum * 100) / 100,
    paid_method: r.paid,
  }));
}

function mergeStayLines(charges, booking) {
  const nightly = new Map();   // date → { room, meal }
  for (const c of charges) {
    if (!(c.type === 'room' || c.type === 'fnb') || !c.service_date) continue;
    const d = String(c.service_date instanceof Date ? c.service_date.toISOString() : c.service_date).slice(0, 10);
    const n = nightly.get(d) || { room: 0, meal: 0 };
    if (c.type === 'room') n.room += parseFloat(c.amount); else n.meal += parseFloat(c.amount);
    nightly.set(d, n);
  }
  const runs = [];
  for (const d of [...nightly.keys()].sort()) {
    const n = nightly.get(d);
    const rate = Math.round((n.room + n.meal) * 100) / 100;
    const label = stayLabel(booking, { roomPart: n.room > 0, mealPart: n.meal > 0 });
    const last = runs[runs.length - 1];
    // < Rp 1 apart = the same rate (the last night carries the rounding cent).
    if (last && Math.abs(last.rate - rate) < 1 && last.label === label && nextDay(last.to) === d) {
      last.to = d; last.nights++; last.sum += rate;
    } else runs.push({ from: d, to: d, nights: 1, rate, sum: rate, label });
  }
  return runs.map(r => ({
    type: 'stay',
    description: `${r.label} · ${shortDay(r.from)} – ${shortDay(nextDay(r.to))}`,
    quantity: r.nights, unit_price: Math.round((r.sum / r.nights) * 100) / 100,
    amount: Math.round(r.sum * 100) / 100,
  }));
}

// Prices entered incl. service & tax: each line the folio adds service + tax
// to ('added' — rooms, meals, extras, "++" activities) shown all-in. Lines
// already all-in ('included' / 'none' activities) stay as they are.
function allInCharges(charges, taxRate, serviceChargeRate) {
  const F = factor(taxRate, serviceChargeRate);
  return charges.map(c => (c.tax_mode && c.tax_mode !== 'added') ? c : {
    ...c,
    unit_price: round2(parseFloat(c.unit_price) * F),
    amount: round2(parseFloat(c.amount) * F),
  });
}

// "Includes service charge Rp … (10%) and tax Rp … (11%)", or null at 0%.
function includesNote({ service_charge_rate, service_charge_amount, tax_rate, tax_amount }, fmt = fmtIDR) {
  const parts = [];
  if (parseFloat(service_charge_rate) > 0) parts.push(`service charge ${fmt(service_charge_amount)} (${parseFloat(service_charge_rate)}%)`);
  if (parseFloat(tax_rate) > 0) parts.push(`tax ${fmt(tax_amount)} (${parseFloat(tax_rate)}%)`);
  return parts.length ? `Includes ${parts.join(' and ')}` : null;
}

// Draws the line-item table + totals + payments-received + (optionally)
// balance due, starting at the doc's current y. Shared by the single-booking
// invoice/pro-forma and, per room, by the group pro-forma. Returns the y the
// caller should continue from.
function drawChargeTable(doc, { booking, charges: netCharges, payments, subtotal, untaxed_subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due, prices_include_tax, show_tax_breakdown, showBalance = true }) {
  // Prices entered incl. service & tax (migration 079): every line the folio
  // adds service + tax to is shown all-in, and the totals say what's inside.
  const rawCharges = prices_include_tax ? allInCharges(netCharges, tax_rate, service_charge_rate) : netCharges;
  // All-in amounts print in whole rupiah (the parts inside carry the cents).
  const money = prices_include_tax ? n => fmtIDR(Math.round(parseFloat(n) || 0)) : fmtIDR;
  // Nightly room + meal lines → one "Room with Breakfast" line per run of
  // nights at the same rate; everything else is listed as posted.
  const isStayLine = c => (c.type === 'room' || c.type === 'fnb' || c.type === 'addon') && c.service_date;
  const charges = [
    ...mergeStayLines(rawCharges, booking),
    ...mergeAddonLines(rawCharges),
    ...rawCharges.filter(c => !isStayLine(c)),
  ];
  const tableTop = doc.y;
  const colX = { desc: 50, qty: 300, price: 360, amount: 460 };
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Description', colX.desc, tableTop);
  doc.text('Qty', colX.qty, tableTop, { width: 50, align: 'right' });
  doc.text('Unit Price', colX.price, tableTop, { width: 90, align: 'right' });
  doc.text('Amount', colX.amount, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;

  // Group the itemised lines: Accommodation (room) → Food & Beverage (fnb +
  // food/drink sales) → Other. 'fnb' is the rate plan's included meal
  // (migration 044); a 'sale' is an actual ordered item (migration 049) and
  // counts as F&B only when it contains food/drinks (c.is_fnb, from
  // folioService) — a front-desk extra like an extra bed (migration 067)
  // goes under Other. Keep in sync with the same grouping in
  // client/src/pages/BookingDetail.jsx's Folio tab.
  const isFnb = c => c.type === 'fnb' || (c.type === 'sale' && c.is_fnb);
  const GROUPS = [
    { key: 'Accommodation', match: c => c.type === 'room' || c.type === 'stay' },
    { key: 'Food & Beverage', match: isFnb },
    { key: 'Other', match: c => c.type !== 'room' && c.type !== 'stay' && !isFnb(c) },
  ];
  const renderLine = c => {
    if (y > 720) { doc.addPage(); y = 50; }
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    // Paid at the front desk (Pay now) — listed for a complete record, its
    // payment is under Payments Received, so it isn't owed again.
    // An activity priced tax-included / without tax (migration 078) gets no
    // service/tax added below — say so on its line.
    const taxNote = prices_include_tax ? (c.tax_mode === 'none' ? ' (no tax)' : '')
      : c.tax_mode === 'included' ? ' (tax incl.)' : c.tax_mode === 'none' ? ' (no tax)' : '';
    const desc = c.complimentary ? `${c.description} (complimentary)`
      : c.paid_method ? `${c.description}${taxNote} (paid · ${c.paid_method})` : `${c.description}${taxNote}`;
    const rowH = Math.max(16, doc.heightOfString(desc, { width: 240 }) + 4);
    doc.text(desc, colX.desc, y, { width: 240 });
    doc.text(String(parseFloat(c.quantity)), colX.qty, y, { width: 50, align: 'right' });
    doc.text(money(c.unit_price), colX.price, y, { width: 90, align: 'right' });
    // A comped extra (stay complimentary for everything, migration 072) is
    // listed at its price but not counted in the totals.
    doc.text(c.complimentary ? 'Free' : money(c.amount), colX.amount, y, { width: 90, align: 'right' });
    y += rowH;
  };

  const anyGrouped = charges.some(c => c.type === 'stay' || c.type === 'room' || c.type === 'fnb' || c.type === 'sale');
  if (charges.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#888').text('No charges posted', colX.desc, y);
    doc.fillColor('#000');
    y += 18;
  } else if (!anyGrouped) {
    for (const c of charges) renderLine(c);
  } else {
    for (const g of GROUPS) {
      const lines = charges.filter(g.match);
      if (!lines.length) continue;
      if (y > 715) { doc.addPage(); y = 50; }
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#555').text(g.key.toUpperCase(), colX.desc, y);
      doc.fillColor('#000');
      y += 15;
      for (const c of lines) renderLine(c);
      y += 4;
    }
  }

  doc.moveTo(50, y + 4).lineTo(550, y + 4).strokeColor('#ccc').stroke();
  y += 14;

  function totalsLine(label, value, opts = {}) {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
    // A 90pt-wide box is too narrow for "Service Charge (0%)" at this font
    // size — it silently wraps onto 2 lines, and since the row height below
    // is a fixed 16, the wrapped second line ("(0%)") spills down onto the
    // next row's text, reading as doubled/overlapping glyphs.
    doc.text(label, colX.price - 150, y, { width: 150, align: 'right' });
    doc.text(value, colX.amount, y, { width: 90, align: 'right' });
    y += opts.bold ? 20 : 16;
  }

  // A property at 0% (rates published all-in) prints no service/tax lines,
  // and no Subtotal either since it would just repeat the Total.
  const hasSc = parseFloat(service_charge_rate) > 0;
  const hasTax = parseFloat(tax_rate) > 0;
  if (prices_include_tax) {
    totalsLine('Total', money(total), { bold: true });
    // Only when the property shows it (migration 080) — else just the total.
    const inc = show_tax_breakdown && includesNote({ service_charge_rate, service_charge_amount, tax_rate, tax_amount }, money);
    if (inc) {
      doc.font('Helvetica').fontSize(8).fillColor('#777').text(inc, 50, y - 4, { width: 500, align: 'right' });
      doc.fillColor('#000');
      y += 10;
    }
  } else {
  if (hasSc || hasTax) totalsLine('Subtotal', money(subtotal));
  // Lines marked "tax incl." / "no tax" (migration 078) get nothing added —
  // say what service + tax were worked out on, so the % doesn't look wrong.
  if ((hasSc || hasTax) && parseFloat(untaxed_subtotal) > 0) {
    doc.font('Helvetica').fontSize(8).fillColor('#777')
      .text(`Service & tax on ${money(parseFloat(subtotal) - parseFloat(untaxed_subtotal))} — lines marked tax incl. / no tax excluded`, 50, y, { width: 490, align: 'right' });
    doc.fillColor('#000');
    y += 12;
  }
  if (hasSc) totalsLine(`Service Charge (${service_charge_rate}%)`, money(service_charge_amount));
  if (hasTax) totalsLine(`Tax (${tax_rate}%)`, money(tax_amount));
  totalsLine('Total', money(total), { bold: true });
  }

  const received = payments.filter(p => p.status === 'received');
  if (received.length) {
    y += 6;
    doc.font('Helvetica-Bold').fontSize(10).text('Payments Received', colX.desc, y);
    y += 16;
    for (const p of received) {
      // 'incidental' = an extra paid at the front desk (migration 067).
      // received_at is a TIMESTAMPTZ (a JS Date from pg), so format it rather
      // than String().slice(), which yields "Thu Sep 24" instead of a date.
      const typeLabel = p.type === 'incidental' ? 'extras' : p.type;
      const when = p.received_at ? new Date(p.received_at).toLocaleDateString('en-GB') : '';
      doc.font('Helvetica').text(`${typeLabel} — ${(p.method || '').replace('_', ' ')} · ${when}`, colX.desc, y, { width: 240 });
      doc.text(money(p.amount), colX.amount, y, { width: 90, align: 'right' });
      y += 16;
    }
  }

  if (showBalance) {
    y += 8;
    totalsLine('Balance Due', money(balance_due), { bold: true });
  }

  doc.y = y;
}

// Complimentary stay (migration 072) — printed under the stay line.
function complimentaryNote(scope) {
  if (scope === 'room') return 'Complimentary stay — room free of charge';
  if (scope === 'room_meals') return 'Complimentary stay — room and meals free of charge';
  if (scope === 'all') return 'Complimentary stay — room, meals and extras free of charge';
  return null;
}

// Renders the single-booking invoice/pro-forma PDF straight to the response.
function renderBookingInvoicePdf(res, folio, { title, filenamePrefix, note }) {
  const { booking, property } = folio;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${booking.id}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  drawDocumentHeader(doc, property, { title, refLine: `Booking #${booking.id.slice(0, 8).toUpperCase()}` });

  doc.fontSize(10).font('Helvetica-Bold').text('Guest');
  doc.font('Helvetica').text(booking.guest_name);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('Stay');
  // En dash (WinAnsi-safe under pdfkit's standard Helvetica font) instead of
  // "→" (U+2192) — pdfkit's built-in fonts only support WinAnsiEncoding, so
  // an arrow outside that range rendered as garbage ("!'").
  doc.font('Helvetica').text(
    `${booking.unit_name}  ·  ${String(booking.check_in_date).slice(0, 10)}  –  ${String(booking.check_out_date).slice(0, 10)}`
  );

  if (note) {
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#92400e').text(note, { width: 500 });
    doc.fillColor('#000');
  }
  const compNote = complimentaryNote(booking.complimentary_scope);
  if (compNote) {
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#047857').text(compNote, { width: 500 });
    doc.fillColor('#000');
  }

  doc.moveDown(1.5);
  drawChargeTable(doc, folio);

  doc.moveDown(3);
  doc.fontSize(9).fillColor('#888').font('Helvetica').text('Thank you for staying with us', 50, undefined, { align: 'center', width: 500 });

  doc.end();
}

const PROFORMA_NOTE = 'Estimate only — projected charges for the full stay. The final invoice may differ if dates, rate plan, or extras change.';

// GET /api/folio/:bookingId/invoice — PDF, reflects the live folio (only
// what's actually posted so far — see computeProforma below for why that
// can be incomplete before checkout).
router.get('/:bookingId/invoice', auth, async (req, res) => {
  try {
    const folio = await loadFolio(req.params.bookingId, req.propertyId);
    if (!folio) return res.status(404).json({ error: 'Booking not found' });
    renderBookingInvoicePdf(res, folio, { title: 'Invoice', filenamePrefix: 'invoice' });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/folio/:bookingId/proforma — PDF, projected charges for the whole
// stay (see folioService.computeProforma). What front desk hands a guest who
// asks for "an invoice" before night audit/checkout has posted every night.
router.get('/:bookingId/proforma', auth, async (req, res) => {
  try {
    const folio = await computeProforma(req.params.bookingId, req.propertyId);
    if (!folio) return res.status(404).json({ error: 'Booking not found' });
    renderBookingInvoicePdf(res, folio, { title: 'Pro Forma Invoice', filenamePrefix: 'proforma', note: PROFORMA_NOTE });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/folio/group/:groupId/proforma — PDF, one section per room
// (each projected the same way as the single-booking pro forma) followed by
// a grand total across the whole group.
router.get('/group/:groupId/proforma', auth, async (req, res) => {
  try {
    const { rows: [group] } = await db.query(
      `SELECT rg.id, rg.check_in_date, rg.check_out_date, g.name as guest_name
       FROM reservation_groups rg JOIN guests g ON rg.primary_guest_id = g.id
       WHERE rg.id = $1 AND rg.property_id = $2`,
      [req.params.groupId, req.propertyId]
    );
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { rows: bookingRows } = await db.query(
      // A cancelled / no-show room isn't billed on the group's estimate.
      `SELECT id FROM bookings WHERE reservation_group_id = $1 AND property_id = $2
         AND status NOT IN ('cancelled', 'no_show')`,
      [req.params.groupId, req.propertyId]
    );
    const folios = await Promise.all(bookingRows.map(b => computeProforma(b.id, req.propertyId)));
    const { rows: [settings] } = await db.query(
      `SELECT tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown, property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    const property = settings || {};

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proforma-group-${group.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    drawDocumentHeader(doc, property, { title: 'Pro Forma Invoice (Group)', refLine: `Group #${group.id.slice(0, 8).toUpperCase()}` });

    doc.fontSize(10).font('Helvetica-Bold').text('Guest');
    doc.font('Helvetica').text(group.guest_name);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Stay');
    doc.font('Helvetica').text(
      `${folios.length} room${folios.length !== 1 ? 's' : ''}  ·  ${String(group.check_in_date).slice(0, 10)}  –  ${String(group.check_out_date).slice(0, 10)}`
    );

    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#92400e')
      .text('Estimate only — projected charges for the full stay, per room. The final invoice may differ if dates, rate plans, or extras change.', { width: 500 });
    doc.fillColor('#000');

    doc.moveDown(1.2);

    for (const folio of folios) {
      if (doc.y > 650) { doc.addPage(); doc.y = 50; }
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(
        `${folio.booking.unit_name}  ·  ${String(folio.booking.check_in_date).slice(0, 10)} – ${String(folio.booking.check_out_date).slice(0, 10)}`,
        50, doc.y
      );
      const compNote = complimentaryNote(folio.booking.complimentary_scope);
      if (compNote) doc.fontSize(9).font('Helvetica-Bold').fillColor('#047857').text(compNote, 50, doc.y).fillColor('#000');
      doc.moveDown(0.3);
      drawChargeTable(doc, { ...folio, showBalance: false });
      doc.y += 14;
    }

    const sum = key => round2(folios.reduce((s, f) => s + f[key], 0));
    const grand = {
      subtotal: sum('subtotal'),
      tax_rate: folios[0]?.tax_rate ?? 0,
      service_charge_rate: folios[0]?.service_charge_rate ?? 0,
      service_charge_amount: sum('service_charge_amount'),
      tax_amount: sum('tax_amount'),
      total: sum('total'),
      balance_due: sum('balance_due'),
    };

    if (doc.y > 680) { doc.addPage(); doc.y = 50; }
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#000').lineWidth(1).stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text('GROUP TOTAL', 50, doc.y);
    doc.moveDown(0.3);

    function grandLine(label, value, opts = {}) {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
      doc.text(label, 210, doc.y, { width: 150, align: 'right' });
      doc.text(value, 460, doc.y, { width: 90, align: 'right' });
      doc.moveDown(opts.bold ? 0.9 : 0.7);
    }
    const hasSc = parseFloat(grand.service_charge_rate) > 0;
    const hasTax = parseFloat(grand.tax_rate) > 0;
    const whole = n => fmtIDR(Math.round(parseFloat(n) || 0));
    if (settings?.prices_include_tax) {
      grandLine('Total', whole(grand.total), { bold: true });
      const inc = settings?.show_tax_breakdown && includesNote(grand, whole);
      if (inc) {
        doc.font('Helvetica').fontSize(8).fillColor('#777').text(inc, 50, doc.y - 4, { width: 500, align: 'right' });
        doc.fillColor('#000');
        doc.moveDown(0.6);
      }
    } else {
      if (hasSc || hasTax) grandLine('Subtotal', fmtIDR(grand.subtotal));
      if (hasSc) grandLine(`Service Charge (${grand.service_charge_rate}%)`, fmtIDR(grand.service_charge_amount));
      if (hasTax) grandLine(`Tax (${grand.tax_rate}%)`, fmtIDR(grand.tax_amount));
      grandLine('Total', fmtIDR(grand.total), { bold: true });
    }
    grandLine('Estimated Balance Due', settings?.prices_include_tax ? whole(grand.balance_due) : fmtIDR(grand.balance_due), { bold: true });

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#888').font('Helvetica').text('Thank you for staying with us', 50, undefined, { align: 'center', width: 500 });

    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
