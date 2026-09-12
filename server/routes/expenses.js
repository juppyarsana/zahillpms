const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// Back Office Slice B. Mounted at /api/expenses behind
// auth + moduleGuard('back_office') in server/index.js; owner-only per
// handler, same convention as routes/purchasing.js.
const ownerOnly = [auth, requireRole('owner')];

const CATEGORIES = ['utilities', 'laundry', 'maintenance', 'staff', 'supplies', 'marketing', 'admin_fees', 'other'];

// Builds the WHERE clause + params shared by GET / and GET /export —
// month/year default to the current month, matching Reports.jsx's convention
// so "expenses this month" always means the same thing across the app.
function buildFilter(req) {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const params = [req.propertyId, month, year];
  let where = `e.property_id = $1 AND e.is_voided = false
    AND EXTRACT(MONTH FROM e.incurred_on) = $2 AND EXTRACT(YEAR FROM e.incurred_on) = $3`;
  if (req.query.category) {
    params.push(req.query.category);
    where += ` AND e.category = $${params.length}`;
  }
  return { where, params, month, year };
}

// GET /api/expenses?month=&year=&category=
router.get('/', ownerOnly, async (req, res) => {
  try {
    const { where, params } = buildFilter(req);
    const { rows } = await db.query(
      `SELECT e.*, s.name AS supplier_name, u.name AS created_by_name
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY e.incurred_on DESC, e.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses
router.post('/', ownerOnly, async (req, res) => {
  const { category, amount, incurred_on, payment_method, supplier_id, description, reference } = req.body;
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  try {
    if (payment_method) {
      const { rows: [method] } = await db.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true',
        [payment_method, req.propertyId]
      );
      if (!method) return res.status(400).json({ error: 'Unknown payment method' });
    }
    if (supplier_id) {
      const { rows: [supplier] } = await db.query('SELECT id FROM suppliers WHERE id = $1 AND property_id = $2', [supplier_id, req.propertyId]);
      if (!supplier) return res.status(400).json({ error: 'Supplier not found' });
    }
    const { rows: [expense] } = await db.query(
      `INSERT INTO expenses (property_id, category, amount, incurred_on, payment_method, supplier_id, description, reference, created_by)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
      [req.propertyId, category, amt, incurred_on || null, payment_method || null, supplier_id || null, description || null, reference || null, req.user.id]
    );
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id — void, not hard delete (mirrors folio.js's
// DELETE /charge/:id — an accountant needs an unbroken audit trail)
router.delete('/:id', ownerOnly, async (req, res) => {
  try {
    const { rows: [expense] } = await db.query(
      `UPDATE expenses SET is_voided = true, voided_by = $1, voided_at = NOW()
       WHERE id = $2 AND property_id = $3 AND is_voided = false
       RETURNING *`,
      [req.user.id, req.params.id, req.propertyId]
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found (or already voided)' });
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/expenses/export?month=&year=&category= — CSV, for handing to an
// outside accountant/bookkeeper. Same filters as the list endpoint.
router.get('/export', ownerOnly, async (req, res) => {
  try {
    const { where, params, month, year } = buildFilter(req);
    const { rows } = await db.query(
      `SELECT e.incurred_on, e.category, e.amount, e.payment_method, s.name AS supplier_name, e.reference, e.description, u.name AS created_by_name
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY e.incurred_on ASC`,
      params
    );
    const header = ['Date', 'Category', 'Amount', 'Payment Method', 'Supplier', 'Reference', 'Description', 'Recorded By'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        csvEscape(String(r.incurred_on).slice(0, 10)),
        csvEscape(r.category),
        csvEscape(r.amount),
        csvEscape(r.payment_method),
        csvEscape(r.supplier_name),
        csvEscape(r.reference),
        csvEscape(r.description),
        csvEscape(r.created_by_name),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
