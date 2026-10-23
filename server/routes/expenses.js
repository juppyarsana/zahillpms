const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');

// Back Office Slice B. Mounted at /api/expenses behind
// auth + moduleGuard('back_office') in server/index.js; owner-only per
// handler, same convention as routes/purchasing.js.
// Owner or the accountant (the `accounting` permission) — Finance → Expenses.
const ownerOnly = [auth, requireOwnerOrMenu('expenses')];

const { CATEGORY_KEYS: CATEGORIES, DEPARTMENT_KEYS, DEPARTMENT_LABEL, CATEGORY_LABEL, departmentFor } = require('../services/costCategories');

// Builds the WHERE clause + params shared by GET / and GET /export —
// month/year default to the current month, matching Reports.jsx's convention
// so "expenses this month" always means the same thing across the app.
// withVoided: the list's "Show voided" (?voided=1) — never the CSV export.
function buildFilter(req, { withVoided = false } = {}) {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const params = [req.propertyId, month, year];
  let where = `e.property_id = $1 ${withVoided ? '' : 'AND e.is_voided = false'}
    AND EXTRACT(MONTH FROM e.incurred_on) = $2 AND EXTRACT(YEAR FROM e.incurred_on) = $3`;
  if (req.query.category) {
    params.push(req.query.category);
    where += ` AND e.category = $${params.length}`;
  }
  if (req.query.department) {
    params.push(req.query.department);
    where += ` AND e.department = $${params.length}`;
  }
  return { where, params, month, year };
}

// GET /api/expenses?month=&year=&category=
router.get('/', ownerOnly, async (req, res) => {
  try {
    const { where, params } = buildFilter(req, { withVoided: req.query.voided === '1' });
    const { rows } = await db.query(
      `SELECT e.*, s.name AS supplier_name, u.name AS created_by_name, vu.name AS voided_by_name,
              COALESCE(pm.label, e.payment_method) AS payment_method_label
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN users vu ON vu.id = e.voided_by
       LEFT JOIN payment_methods pm ON pm.id = e.payment_method AND pm.property_id = e.property_id
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
  const { category, amount, incurred_on, payment_method, supplier_id, description, reference, department } = req.body;
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
  if (department && !DEPARTMENT_KEYS.includes(department)) return res.status(400).json({ error: 'Choose a department' });
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
    let supplierDept = null;
    if (supplier_id) {
      const { rows: [supplier] } = await db.query('SELECT id, default_department FROM suppliers WHERE id = $1 AND property_id = $2', [supplier_id, req.propertyId]);
      if (!supplier) return res.status(400).json({ error: 'Supplier not found' });
      supplierDept = supplier.default_department;
    }
    const { rows: [expense] } = await db.query(
      `INSERT INTO expenses (property_id, category, amount, incurred_on, payment_method, supplier_id, description, reference, created_by, department)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.propertyId, category, amt, incurred_on || null, payment_method || null, supplier_id || null, description || null, reference || null, req.user.id,
        departmentFor(department, supplierDept, category)]
    );
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id { reason } — void, not hard delete (mirrors
// folio.js's DELETE /charge/:id — an accountant needs an unbroken audit
// trail); the reason is kept (migration 134).
router.delete('/:id', ownerOnly, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why this expense is being voided', code: 'REASON_REQUIRED' });
    const { rows: [expense] } = await db.query(
      `UPDATE expenses SET is_voided = true, voided_by = $1, voided_at = NOW(), void_reason = $4
       WHERE id = $2 AND property_id = $3 AND is_voided = false
       RETURNING *`,
      [req.user.id, req.params.id, req.propertyId, reason.slice(0, 500)]
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

const EXPENSE_CSV_SELECT = `SELECT e.incurred_on, e.category, e.department, e.amount, e.payment_method, s.name AS supplier_name, e.reference, e.description, u.name AS created_by_name
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by`;

function expenseRowsCsv(rows) {
  const header = ['Date', 'Category', 'Department', 'Amount', 'Payment Method', 'Supplier', 'Reference', 'Description', 'Recorded By'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(String(r.incurred_on).slice(0, 10)),
      csvEscape(CATEGORY_LABEL[r.category] || r.category),
      csvEscape(DEPARTMENT_LABEL[r.department] || r.department),
      csvEscape(r.amount),
      csvEscape(r.payment_method),
      csvEscape(r.supplier_name),
      csvEscape(r.reference),
      csvEscape(r.description),
      csvEscape(r.created_by_name),
    ].join(','));
  }
  return lines.join('\n');
}

// Non-voided expenses in a date range as CSV (null when there are none) —
// used by the Monthly Report email (services/monthlyReport.js).
async function expensesCsv(propertyId, from, to) {
  const { rows } = await db.query(
    `${EXPENSE_CSV_SELECT}
     WHERE e.property_id = $1 AND e.is_voided = false AND e.incurred_on BETWEEN $2::date AND $3::date
     ORDER BY e.incurred_on ASC`,
    [propertyId, from, to]
  );
  return rows.length ? expenseRowsCsv(rows) : null;
}

// GET /api/expenses/export?month=&year=&category= — CSV, for handing to an
// outside accountant/bookkeeper. Same filters as the list endpoint.
router.get('/export', ownerOnly, async (req, res) => {
  try {
    const { where, params, month, year } = buildFilter(req);
    const { rows } = await db.query(
      `${EXPENSE_CSV_SELECT}
       WHERE ${where}
       ORDER BY e.incurred_on ASC`,
      params
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(expenseRowsCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.expensesCsv = expensesCsv;
