const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const svc = require('../services/purchasingService');

// Back Office Slice A. Mounted at /api/purchasing behind
// auth + moduleGuard('back_office') in server/index.js; owner-only per
// handler, same convention as routes/agents.js.
const ownerOnly = [auth, requireRole('owner')];

// ───────────────────────────── Suppliers ─────────────────────────────

router.get('/suppliers', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM suppliers WHERE property_id = $1 ORDER BY is_active DESC, name',
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers', ownerOnly, async (req, res) => {
  const { name, contact_name, contact_phone, contact_email, address, payment_terms_days } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO suppliers (property_id, name, contact_name, contact_phone, contact_email, address, payment_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.propertyId, name, contact_name || null, contact_phone || null, contact_email || null, address || null, payment_terms_days || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/suppliers/:id', ownerOnly, async (req, res) => {
  const { name, contact_name, contact_phone, contact_email, address, payment_terms_days, is_active } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE suppliers SET
        name = COALESCE($1, name), contact_name = COALESCE($2, contact_name),
        contact_phone = COALESCE($3, contact_phone), contact_email = COALESCE($4, contact_email),
        address = COALESCE($5, address), payment_terms_days = COALESCE($6, payment_terms_days),
        is_active = COALESCE($7, is_active)
       WHERE id = $8 AND property_id = $9 RETURNING *`,
      [name, contact_name, contact_phone, contact_email, address, payment_terms_days, is_active, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/suppliers/:id', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE suppliers SET is_active = false WHERE id = $1 AND property_id = $2 RETURNING id',
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────── Raw Materials ───────────────────────────

router.get('/raw-materials', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM raw_materials WHERE property_id = $1 ORDER BY is_active DESC, name',
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/raw-materials', ownerOnly, async (req, res) => {
  const { name, unit_of_measure, low_stock_threshold, cost_per_unit } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO raw_materials (property_id, name, unit_of_measure, low_stock_threshold, cost_per_unit)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.propertyId, name, unit_of_measure || 'pcs', low_stock_threshold || null, cost_per_unit || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/raw-materials/:id', ownerOnly, async (req, res) => {
  const { name, unit_of_measure, low_stock_threshold, cost_per_unit, is_active } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE raw_materials SET
        name = COALESCE($1, name), unit_of_measure = COALESCE($2, unit_of_measure),
        low_stock_threshold = COALESCE($3, low_stock_threshold), cost_per_unit = COALESCE($4, cost_per_unit),
        is_active = COALESCE($5, is_active)
       WHERE id = $6 AND property_id = $7 RETURNING *`,
      [name, unit_of_measure, low_stock_threshold, cost_per_unit, is_active, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Raw material not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/raw-materials/:id', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE raw_materials SET is_active = false WHERE id = $1 AND property_id = $2 RETURNING id',
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Raw material not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /raw-materials/:id/stock — manual restock/adjustment/waste, same
// row-lock/reject-negative/insert-ledger-row shape as products.js's
// PATCH /:id/stock, just against raw_materials/raw_material_movements and
// with NUMERIC (fractional) quantities instead of INT.
router.patch('/raw-materials/:id/stock', ownerOnly, async (req, res) => {
  const { change_qty, reason, note } = req.body;
  const REASONS = ['purchase', 'adjustment', 'waste'];
  const qty = parseFloat(change_qty);
  if (!Number.isFinite(qty) || qty === 0) return res.status(400).json({ error: 'change_qty must be a non-zero number' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: `reason must be one of ${REASONS.join(', ')}` });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [material] } = await client.query(
      'SELECT id, stock_quantity FROM raw_materials WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [req.params.id, req.propertyId]
    );
    if (!material) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Raw material not found' }); }
    if (parseFloat(material.stock_quantity) + qty < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot reduce stock below 0 (currently ${material.stock_quantity})` });
    }
    const { rows: [updated] } = await client.query(
      'UPDATE raw_materials SET stock_quantity = stock_quantity + $1 WHERE id = $2 RETURNING *',
      [qty, req.params.id]
    );
    await client.query(
      `INSERT INTO raw_material_movements (property_id, raw_material_id, change_qty, reason, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.propertyId, req.params.id, qty, reason, note || null, req.user.id]
    );
    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/raw-materials/:id/movements', ownerOnly, async (req, res) => {
  try {
    const { rows: [material] } = await db.query('SELECT id FROM raw_materials WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!material) return res.status(404).json({ error: 'Raw material not found' });
    const { rows } = await db.query(
      `SELECT rmm.*, u.name AS created_by_name
       FROM raw_material_movements rmm LEFT JOIN users u ON u.id = rmm.created_by
       WHERE rmm.raw_material_id = $1 AND rmm.property_id = $2
       ORDER BY rmm.created_at DESC LIMIT 50`,
      [req.params.id, req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────── Purchase Orders ───────────────────────────

router.get('/purchase-orders', ownerOnly, async (req, res) => {
  try {
    res.json(await svc.listPurchaseOrders(req.propertyId, { status: req.query.status }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/purchase-orders/:id', ownerOnly, async (req, res) => {
  try {
    const po = await svc.getPurchaseOrder(req.propertyId, req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(po);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/purchase-orders', ownerOnly, async (req, res) => {
  try {
    const result = await svc.createPurchaseOrder(req.propertyId, req.body, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.purchase_order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/purchase-orders/:id', ownerOnly, async (req, res) => {
  try {
    const result = await svc.updatePurchaseOrderItems(req.propertyId, req.params.id, req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.purchase_order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/purchase-orders/:id/status', ownerOnly, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  try {
    const result = await svc.setPurchaseOrderStatus(req.propertyId, req.params.id, status, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.purchase_order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/purchase-orders/:id/receive', ownerOnly, async (req, res) => {
  const { items } = req.body;
  try {
    const result = await svc.receivePurchaseOrder(req.propertyId, req.params.id, items, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.purchase_order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
