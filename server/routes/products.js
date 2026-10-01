const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const canManageMenu = requireOwnerOrMenu('resto_menu');

// Mirrors products_category_check (migration 067): F&B for the resto app /
// Room Display Dining, the rest are hotel extras sold from the PMS Sales page.
const CATEGORIES = ['drinks', 'food', 'room_addon', 'transport', 'laundry', 'service', 'merchandise', 'minibar', 'other'];

// Breakfast on an item (migrations 074/075): meal_price = ONE breakfast (net),
// meal_pax = breakfasts one unit includes (single extra bed 1, double 2).
// Together never more than the item's price.
function checkMealPrice(meal, price, pax = 1) {
  if (meal === undefined || meal === null || meal === '') return null;
  const m = parseFloat(meal);
  if (!Number.isFinite(m) || m < 0) return 'Breakfast price must be 0 or more';
  if (price !== undefined && price !== null && m * (parseInt(pax) || 0) > parseFloat(price)) return 'The breakfasts can\'t cost more than the item itself';
  return null;
}
// Price typed at sale (migration 077): only for one-off hotel extras — not a
// per-night item (its price per night is already editable) and not F&B.
function checkOpenPrice(openPrice, perNight, category) {
  if (!openPrice) return null;
  if (perNight) return "A per-night item can't have its price typed at sale — its price per night can already be changed on each sale";
  if (['drinks', 'food'].includes(category)) return "Food and drinks can't have their price typed at sale";
  return null;
}
function checkMealPax(pax) {
  if (pax === undefined || pax === null || pax === '') return null;
  const n = Number(pax);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? null : 'Breakfasts per unit must be a whole number from 0 to 20';
}

// GET /api/products
router.get('/', auth, async (req, res) => {
  const { category, available } = req.query;
  let query = 'SELECT * FROM products WHERE property_id = $1';
  const params = [req.propertyId];
  if (category) { params.push(category); query += ` AND category = $${params.length}`; }
  if (available !== undefined) { params.push(available === 'true'); query += ` AND is_available = $${params.length}`; }
  query += ' ORDER BY category, name';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post('/', auth, canManageMenu, async (req, res) => {
  const { name, category, price, description, track_stock, stock_quantity, low_stock_threshold, per_night, meal_price, meal_pax, open_price } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
  const mealErr = checkOpenPrice(open_price, per_night, category || 'other') || checkMealPax(meal_pax) || checkMealPrice(meal_price, price, meal_pax ?? 1);
  if (mealErr) return res.status(400).json({ error: mealErr });
  try {
    const { rows } = await db.query(
      `INSERT INTO products (name, category, price, description, property_id, track_stock, stock_quantity, low_stock_threshold, per_night, meal_price, meal_pax, open_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, category || 'other', price, description, req.propertyId, !!track_stock, stock_quantity || 0, low_stock_threshold || null,
       !!per_night, parseFloat(meal_price) || 0, meal_pax === undefined || meal_pax === '' ? 1 : parseInt(meal_pax), !!open_price]
    );
    // Log the opening count so the item's stock history starts from a real
    // entry instead of an unexplained number.
    if (rows[0].track_stock && rows[0].stock_quantity > 0) {
      await db.query(
        `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, note, created_by)
         VALUES ($1,$2,$3,'restock','Starting stock',$4)`,
        [req.propertyId, rows[0].id, rows[0].stock_quantity, req.user.id]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id', auth, canManageMenu, async (req, res) => {
  const { name, category, price, description, is_available, track_stock, low_stock_threshold, per_night, meal_price, meal_pax, open_price } = req.body;
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
  try {
    if (open_price !== undefined || per_night !== undefined || category !== undefined) {
      const { rows: [cur] } = await db.query('SELECT category, per_night, open_price FROM products WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
      const openErr = cur && checkOpenPrice(open_price ?? cur.open_price, per_night ?? cur.per_night, category ?? cur.category);
      if (openErr) return res.status(400).json({ error: openErr });
    }
    const paxErr = checkMealPax(meal_pax);
    if (paxErr) return res.status(400).json({ error: paxErr });
    if (meal_price !== undefined || meal_pax !== undefined) {
      const { rows: [cur] } = await db.query('SELECT price, meal_price, meal_pax FROM products WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
      const mealErr = checkMealPrice(meal_price ?? cur?.meal_price, price ?? cur?.price, meal_pax ?? cur?.meal_pax);
      if (mealErr) return res.status(400).json({ error: mealErr });
    }
    // Changing the price / breakfast part / per-night applies to NEW sales
    // only — what was already sold keeps the amounts it was sold at.
    const { rows } = await db.query(
      `UPDATE products SET
        name = COALESCE($1, name), category = COALESCE($2, category),
        price = COALESCE($3, price), description = COALESCE($4, description),
        is_available = COALESCE($5, is_available), track_stock = COALESCE($6, track_stock),
        low_stock_threshold = COALESCE($7, low_stock_threshold),
        per_night = COALESCE($10, per_night), meal_price = COALESCE($11, meal_price), meal_pax = COALESCE($12, meal_pax),
        open_price = COALESCE($13, open_price)
       WHERE id = $8 AND property_id = $9 RETURNING *`,
      [name, category, price, description, is_available, track_stock, low_stock_threshold, req.params.id, req.propertyId,
       per_night === undefined ? null : !!per_night, meal_price === undefined || meal_price === '' ? null : parseFloat(meal_price),
       meal_pax === undefined || meal_pax === '' ? null : parseInt(meal_pax), open_price === undefined ? null : !!open_price]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/:id/stock — manual restock/adjustment/waste (sales
// decrement stock automatically inside salesService.createSale instead)
router.patch('/:id/stock', auth, canManageMenu, async (req, res) => {
  const { change_qty, reason, note } = req.body;
  const REASONS = ['restock', 'adjustment', 'waste'];
  if (!Number.isInteger(change_qty) || change_qty === 0) return res.status(400).json({ error: 'change_qty must be a non-zero integer' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: `reason must be one of ${REASONS.join(', ')}` });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [product] } = await client.query(
      'SELECT id, stock_quantity FROM products WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [req.params.id, req.propertyId]
    );
    if (!product) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found' }); }
    if (product.stock_quantity + change_qty < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot reduce stock below 0 (currently ${product.stock_quantity})` });
    }
    const { rows: [updated] } = await client.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 RETURNING *',
      [change_qty, req.params.id]
    );
    await client.query(
      `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.propertyId, req.params.id, change_qty, reason, note || null, req.user.id]
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

// GET /api/products/:id/stock/movements — audit trail
router.get('/:id/stock/movements', auth, async (req, res) => {
  try {
    const { rows: [product] } = await db.query('SELECT id FROM products WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { rows } = await db.query(
      `SELECT sm.*, u.name AS created_by_name, po.po_number
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.created_by
       LEFT JOIN purchase_orders po ON po.id = sm.purchase_order_id
       WHERE sm.product_id = $1 AND sm.property_id = $2
       ORDER BY sm.created_at DESC LIMIT 50`,
      [req.params.id, req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
