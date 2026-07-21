const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const PDFDocument = require('pdfkit');

const CHARGE_TYPES = ['room', 'fnb', 'sale', 'activity', 'misc', 'discount', 'tax', 'service_charge'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmtIDR(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

// Shared by GET /:bookingId and GET /:bookingId/invoice
async function loadFolio(bookingId, propertyId) {
  const bookingQ = db.query(
    `SELECT b.id, b.check_in_date, b.check_out_date, g.name as guest_name, u.name as unit_name
     FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
     WHERE b.id = $1 AND b.property_id = $2`,
    [bookingId, propertyId]
  );
  const chargesQ = db.query(
    `SELECT fc.id, fc.type, fc.description, fc.quantity, fc.unit_price, fc.amount, fc.posted_at, u.name as posted_by_name
     FROM folio_charges fc LEFT JOIN users u ON fc.posted_by = u.id
     WHERE fc.booking_id = $1 AND fc.is_voided = false
     ORDER BY fc.posted_at`,
    [bookingId]
  );
  const settingsQ = db.query(
    `SELECT tax_rate, service_charge_rate, property_name, property_address, property_phone, property_email
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const paymentsQ = db.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY type', [bookingId]);

  const [{ rows: [booking] }, { rows: charges }, { rows: [settings] }, { rows: payments }] =
    await Promise.all([bookingQ, chargesQ, settingsQ, paymentsQ]);

  if (!booking) return null;

  const subtotal = round2(charges.reduce((sum, c) => sum + parseFloat(c.amount), 0));
  const tax_rate = parseFloat(settings?.tax_rate ?? 0);
  const service_charge_rate = parseFloat(settings?.service_charge_rate ?? 0);
  const service_charge_amount = round2(subtotal * service_charge_rate / 100);
  // Indonesian hotel practice: VAT (PB1) is charged on room + service charge combined.
  const tax_amount = round2((subtotal + service_charge_amount) * tax_rate / 100);
  const total = round2(subtotal + service_charge_amount + tax_amount);
  const receivedTotal = round2(payments.filter(p => p.status === 'received').reduce((sum, p) => sum + parseFloat(p.amount), 0));
  const balance_due = round2(total - receivedTotal);

  return {
    booking, charges, payments,
    subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due,
    property: settings || {},
  };
}

// GET /api/folio/:bookingId
router.get('/:bookingId', auth, async (req, res) => {
  try {
    const folio = await loadFolio(req.params.bookingId, req.propertyId);
    if (!folio) return res.status(404).json({ error: 'Booking not found' });
    const { booking, property, ...rest } = folio;
    res.json({ booking_id: booking.id, ...rest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/folio/:bookingId/charge
router.post('/:bookingId/charge', auth, async (req, res) => {
  const { type, description, quantity, unit_price } = req.body;
  if (!CHARGE_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${CHARGE_TYPES.join(', ')}` });
  if (!description || !description.trim()) return res.status(400).json({ error: 'description required' });
  const qty = quantity == null || quantity === '' ? 1 : parseFloat(quantity);
  const price = parseFloat(unit_price);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive number' });
  if (!Number.isFinite(price)) return res.status(400).json({ error: 'unit_price must be a number' });
  const amount = round2(qty * price);

  try {
    const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [req.params.bookingId, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const { rows: [charge] } = await db.query(
      `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.bookingId, type, description.trim(), qty, price, amount, req.user.id]
    );
    res.status(201).json(charge);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// GET /api/folio/:bookingId/invoice — PDF
router.get('/:bookingId/invoice', auth, async (req, res) => {
  try {
    const folio = await loadFolio(req.params.bookingId, req.propertyId);
    if (!folio) return res.status(404).json({ error: 'Booking not found' });
    const { booking, charges, payments, property, subtotal, tax_rate, service_charge_rate, service_charge_amount, tax_amount, total, balance_due } = folio;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${booking.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text(property.property_name || 'Zahill', { continued: false });
    doc.fontSize(9).font('Helvetica').fillColor('#555');
    if (property.property_address) doc.text(property.property_address);
    const contactLine = [property.property_phone, property.property_email].filter(Boolean).join('  ·  ');
    if (contactLine) doc.text(contactLine);
    doc.fillColor('#000');

    doc.moveDown(1);
    doc.fontSize(14).font('Helvetica-Bold').text('Invoice', { align: 'right' });
    doc.fontSize(9).font('Helvetica').text(`Booking #${booking.id.slice(0, 8).toUpperCase()}`, { align: 'right' });
    doc.text(new Date().toLocaleDateString('id-ID'), { align: 'right' });

    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica-Bold').text('Guest');
    doc.font('Helvetica').text(booking.guest_name);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Stay');
    doc.font('Helvetica').text(
      `${booking.unit_name}  ·  ${String(booking.check_in_date).slice(0, 10)} → ${String(booking.check_out_date).slice(0, 10)}`
    );

    doc.moveDown(1.5);
    const tableTop = doc.y;
    const colX = { desc: 50, qty: 300, price: 360, amount: 460 };
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', colX.desc, tableTop);
    doc.text('Qty', colX.qty, tableTop, { width: 50, align: 'right' });
    doc.text('Unit Price', colX.price, tableTop, { width: 90, align: 'right' });
    doc.text('Amount', colX.amount, tableTop, { width: 90, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

    let y = tableTop + 22;
    doc.font('Helvetica').fontSize(10);
    for (const c of charges) {
      if (y > 720) { doc.addPage(); y = 50; }
      doc.text(c.description, colX.desc, y, { width: 240 });
      doc.text(String(parseFloat(c.quantity)), colX.qty, y, { width: 50, align: 'right' });
      doc.text(fmtIDR(c.unit_price), colX.price, y, { width: 90, align: 'right' });
      doc.text(fmtIDR(c.amount), colX.amount, y, { width: 90, align: 'right' });
      y += 18;
    }
    if (charges.length === 0) {
      doc.fillColor('#888').text('No charges posted', colX.desc, y);
      doc.fillColor('#000');
      y += 18;
    }

    doc.moveTo(50, y + 4).lineTo(550, y + 4).strokeColor('#ccc').stroke();
    y += 14;

    function totalsLine(label, value, opts = {}) {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
      doc.text(label, colX.price - 90, y, { width: 90, align: 'right' });
      doc.text(value, colX.amount, y, { width: 90, align: 'right' });
      y += opts.bold ? 20 : 16;
    }

    totalsLine('Subtotal', fmtIDR(subtotal));
    totalsLine(`Service Charge (${service_charge_rate}%)`, fmtIDR(service_charge_amount));
    totalsLine(`Tax (${tax_rate}%)`, fmtIDR(tax_amount));
    totalsLine('Total', fmtIDR(total), { bold: true });

    const received = payments.filter(p => p.status === 'received');
    if (received.length) {
      y += 6;
      doc.font('Helvetica-Bold').fontSize(10).text('Payments Received', colX.desc, y);
      y += 16;
      for (const p of received) {
        doc.font('Helvetica').text(`${p.type} — ${(p.method || '').replace('_', ' ')} · ${String(p.received_at || '').slice(0, 10)}`, colX.desc, y, { width: 240 });
        doc.text(fmtIDR(p.amount), colX.amount, y, { width: 90, align: 'right' });
        y += 16;
      }
    }

    y += 8;
    totalsLine('Balance Due', fmtIDR(balance_due), { bold: true });

    doc.moveDown(3);
    doc.fontSize(9).fillColor('#888').font('Helvetica').text('Thank you for staying with us', 50, undefined, { align: 'center', width: 500 });

    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
