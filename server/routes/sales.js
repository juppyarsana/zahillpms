const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const salesService = require('../services/salesService');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { renderSaleReceipt } = require('../services/saleReceiptPdf');
const { basisFrom } = require('../services/priceBasis');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { sendControlAlert } = require('../services/ownerAlerts');

// GET /api/sales
// ?scope=extras — only sales containing at least one hotel extra (non-F&B
// item). Used by the PMS Sales page's History tab, which shouldn't list
// resto / room-service food orders (migration 067).
router.get('/', auth, async (req, res) => {
  const { booking_id, date_from, date_to, scope } = req.query;
  let query = `
    SELECT s.*, u.name as served_by_name,
           g.name AS guest_name, un.name AS unit_name,
           -- A per-night line (extra bed) reads "Extra Bed · 1 × 28 Sep, 29 Sep".
           COALESCE((SELECT string_agg(
                CASE WHEN si.per_night THEN p.name || ' · ' || COALESCE((
                       SELECT MAX(a.quantity) || ' × ' || string_agg(to_char(a.service_date, 'DD Mon'), ', ' ORDER BY a.service_date)
                       FROM booking_addons a WHERE a.sale_item_id = si.id AND a.status = 'active'), 'removed')
                     ELSE si.quantity || '× ' || COALESCE(si.description, p.name) END, ', ' ORDER BY p.name)
              FROM sale_items si JOIN products p ON p.id = si.product_id
             WHERE si.sale_id = s.id), s.description) AS items_summary
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
    if (result.error) return res.status(result.code ? 400 : 404).json({ error: result.error, code: result.code });
    res.status(201).json(result.sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/:id/void { reason } — a sale rung up by mistake (wrong
// guest, wrong item, never happened). Owner or the `corrections` permission.
// Nothing is deleted: the sale is kept, marked voided (and 'rejected', which
// every revenue / money query already leaves out), its folio line and its
// extra-bed nights are voided, its Pay-now payment is voided and the stock
// comes back. Not for a restaurant bill from the POS (void its folio line —
// that tells the POS) nor a restaurant table's tab.
router.post('/:id/void', auth, requireOwnerOrMenu('corrections'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [sale] } = await client.query(
      'SELECT * FROM sales WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]);
    if (!sale) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Sale not found' }); }
    const refuse = async (error, code) => { await client.query('ROLLBACK'); return res.status(409).json({ error, code }); };
    if (sale.voided_at || sale.confirmation_status === 'rejected') return refuse('This sale is already voided', 'ALREADY_VOIDED');
    if (sale.order_source === 'external_pos') return refuse('This is a restaurant bill from the POS — void its line on the guest\'s folio instead (that also tells the POS)', 'POS_BILL');
    if (sale.table_session_id) return refuse('This order belongs to a restaurant table — handle it in the restaurant app', 'TABLE_ORDER');
    if (sale.booking_id) {
      const { rows: [b] } = await client.query('SELECT folio_status FROM bookings WHERE id = $1 FOR UPDATE', [sale.booking_id]);
      if (sale.payment_method === 'room_charge' && ['invoiced', 'paid'].includes(b?.folio_status)) {
        return refuse('This stay is already on an agent invoice — the sale can\'t be voided now', 'ON_AGENT_INVOICE');
      }
    }

    // Stock back for one-off items (per-night items never left stock).
    const { rows: items } = await client.query(
      `SELECT si.product_id, si.quantity, si.per_night, p.track_stock
         FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 FOR UPDATE OF p`, [sale.id]);
    for (const it of items) {
      if (!it.track_stock || it.per_night) continue;
      await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [it.quantity, it.product_id]);
      await client.query(
        `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, reference_id, note, created_by)
         VALUES ($1, $2, $3, 'adjustment', $4, 'Sale voided', $5)`, [req.propertyId, it.product_id, it.quantity, sale.id, req.user.id]);
    }
    // Its folio line, and the nights of a per-night item with their lines.
    const { rows: nights } = await client.query(
      `UPDATE booking_addons SET status = 'removed', removed_by = $1, removed_at = NOW(), removed_reason = $2
        WHERE sale_id = $3 AND status = 'active' RETURNING id`, [req.user.id, `Sale voided: ${reason}`.slice(0, 250), sale.id]);
    const { rows: lines } = await client.query(
      `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
        WHERE is_voided = false AND (sale_id = $2 OR addon_id = ANY($3::uuid[])) RETURNING paid_payment_id`,
      [req.user.id, sale.id, nights.map(n => n.id)]);
    // The payment taken with it at the till (Pay now).
    const { rows: payments } = await client.query(
      `UPDATE payments SET status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2
        WHERE sale_id = $3 AND status = 'received' RETURNING amount`, [req.user.id, reason, sale.id]);
    await client.query(
      `UPDATE sales SET confirmation_status = 'rejected', rejection_reason = $1, kitchen_status = NULL,
              voided_at = NOW(), voided_by = $2, void_reason = $1 WHERE id = $3`, [reason, req.user.id, sale.id]);

    // A line that was paid later on its own (Record Payment): that money
    // stays on the folio as a credit — refund it or leave it for the bill.
    const paidLater = lines.some(l => l.paid_payment_id);
    const paid = payments.reduce((s, p) => s + parseFloat(p.amount), 0);
    const rupiah = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
    if (sale.booking_id) {
      const { rows: [{ what }] } = await client.query(
        `SELECT COALESCE((SELECT string_agg(COALESCE(si.description, p.name), ', ') FROM sale_items si JOIN products p ON p.id = si.product_id
                           WHERE si.sale_id = $1), $2, 'sale') AS what`, [sale.id, sale.description]);
      await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [sale.booking_id,
        (`Sale voided: ${what}${paid ? ` — its payment of ${rupiah(paid)} voided too` : ''}`
          + `${paidLater ? ' — it was paid separately; that payment stays on the folio as a credit (refund it if the money goes back)' : ''}. Reason: ${reason}`).slice(0, 1000),
        req.user.id]);
    }
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: sale.booking_id || [], userId: req.user.id, reason,
      headline: `🗑 Sale voided — ${rupiah(parseFloat(sale.shown_total ?? sale.total_amount))}${paid ? ` (payment ${rupiah(paid)} voided)` : ''}` });
    res.json({ ok: true, payment_voided: paid, credit_left: paidLater });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/sales/:id/receipt — printable receipt for a sale paid directly
// (cash/QRIS/etc). A room_charge sale is refused: it's on the guest's folio
// and belongs on the room Invoice; an 'unpaid' resto tab isn't paid yet.
router.get('/:id/receipt', auth, async (req, res) => {
  try {
    const { rows: [sale] } = await db.query(
      `SELECT s.id, s.total_amount, s.service_charge_amount, s.tax_amount, s.payment_method, s.created_at, s.voided_at,
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
    if (sale?.voided_at) return res.status(409).json({ error: 'This sale was voided — it has no receipt', code: 'VOIDED' });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.payment_method === 'room_charge') return res.status(400).json({ error: "This sale was charged to the room — it's on the guest's invoice, not a separate receipt" });
    if (sale.payment_method === 'unpaid') return res.status(400).json({ error: 'This order has not been paid yet' });
    sale.payment_method_label = sale.payment_method_label || sale.payment_method;

    const { rows: items } = await db.query(
      `SELECT COALESCE(si.description, p.name) AS name, si.quantity, si.unit_price, si.subtotal
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1 ORDER BY p.name`,
      [sale.id]
    );
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url,
              tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );

    const ref = String(sale.id).slice(0, 8).toUpperCase();
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sales-receipt-${ref.toLowerCase()}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Receipt', refLine: `Sale #${ref}` });
    renderSaleReceipt(doc, { sale, items, basis: basisFrom(property), showBreakdown: !!property?.show_tax_breakdown });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
