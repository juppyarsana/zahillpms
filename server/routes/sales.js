const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const salesService = require('../services/salesService');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { renderSaleReceipt } = require('../services/saleReceiptPdf');

// GET /api/sales
// ?scope=extras — only sales containing at least one hotel extra (non-F&B
// item). Used by the PMS Sales page's History tab, which shouldn't list
// resto / room-service food orders (migration 067).
router.get('/', auth, async (req, res) => {
  const { booking_id, date_from, date_to, scope } = req.query;
  let query = `
    SELECT s.*, u.name as served_by_name,
           g.name AS guest_name, un.name AS unit_name,
           (SELECT string_agg(si.quantity || '× ' || p.name, ', ' ORDER BY p.name)
              FROM sale_items si JOIN products p ON p.id = si.product_id
             WHERE si.sale_id = s.id) AS items_summary
    FROM sales s
    LEFT JOIN users u ON s.served_by = u.id
    LEFT JOIN bookings b ON b.id = s.booking_id
    LEFT JOIN guests g ON g.id = b.guest_id
    LEFT JOIN units un ON un.id = b.unit_id
    WHERE s.property_id = $1
  `;
  const params = [req.propertyId];
  if (booking_id) { params.push(booking_id); query += ` AND s.booking_id = $${params.length}`; }
  if (date_from) { params.push(date_from); query += ` AND s.created_at >= $${params.length}`; }
  if (date_to) { params.push(date_to); query += ` AND s.created_at <= $${params.length}`; }
  if (scope === 'extras') {
    params.push(salesService.FNB_CATEGORIES);
    query += ` AND EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
                            WHERE si.sale_id = s.id AND p.category <> ALL($${params.length}))`;
  }
  query += ' ORDER BY s.created_at DESC';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales
router.post('/', auth, async (req, res) => {
  const { booking_id, payment_method, items, order_type, table_number, table_id } = req.body;
  if (!payment_method || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'payment_method and items required' });
  }
  if (items.some(i => !Number.isInteger(Number(i.quantity)) || Number(i.quantity) < 1)) {
    return res.status(400).json({ error: 'Each item quantity must be a whole number of at least 1' });
  }
  try {
    if (booking_id) {
      const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [booking_id, req.propertyId]);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
    }
    const result = await salesService.createSale(req.propertyId, {
      bookingId: booking_id, paymentMethod: payment_method, items,
      orderType: order_type, tableNumber: table_number, tableId: table_id, servedBy: req.user.id,
      // This route is the PMS Sales page's till — directly-paid extras carry
      // tax like everything on the folio (see salesService.createSale).
      taxDirectPay: true,
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json(result.sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id/receipt — printable receipt for a sale paid directly
// (cash/QRIS/etc). A room_charge sale is refused: it's on the guest's folio
// and belongs on the room Invoice; an 'unpaid' resto tab isn't paid yet.
router.get('/:id/receipt', auth, async (req, res) => {
  try {
    const { rows: [sale] } = await db.query(
      `SELECT s.id, s.total_amount, s.service_charge_amount, s.tax_amount, s.payment_method, s.created_at,
              g.name AS guest_name, un.name AS unit_name, u.name AS served_by_name,
              pm.label AS payment_method_label
       FROM sales s
       LEFT JOIN users u ON u.id = s.served_by
       LEFT JOIN bookings b ON b.id = s.booking_id
       LEFT JOIN guests g ON g.id = b.guest_id
       LEFT JOIN units un ON un.id = b.unit_id
       LEFT JOIN payment_methods pm ON pm.id = s.payment_method AND pm.property_id = s.property_id
       WHERE s.id = $1 AND s.property_id = $2`,
      [req.params.id, req.propertyId]
    );
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.payment_method === 'room_charge') return res.status(400).json({ error: "This sale was charged to the room — it's on the guest's invoice, not a separate receipt" });
    if (sale.payment_method === 'unpaid') return res.status(400).json({ error: 'This order has not been paid yet' });
    sale.payment_method_label = sale.payment_method_label || sale.payment_method;

    const { rows: items } = await db.query(
      `SELECT p.name, si.quantity, si.unit_price, si.subtotal
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1 ORDER BY p.name`,
      [sale.id]
    );
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );

    const ref = String(sale.id).slice(0, 8).toUpperCase();
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sales-receipt-${ref.toLowerCase()}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Receipt', refLine: `Sale #${ref}` });
    renderSaleReceipt(doc, { sale, items });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
