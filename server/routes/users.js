const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

const ownerOnly = [auth, requireRole('owner')];

// GET /api/users
router.get('/', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE property_id = $1 ORDER BY created_at',
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
router.post('/', ownerOnly, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, role required' });
  }
  const { rows: roleCheck } = await db.query('SELECT id FROM roles WHERE id = $1 AND property_id = $2', [role, req.propertyId]);
  if (!roleCheck[0]) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, role, property_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, created_at',
      [name, email.toLowerCase(), hash, role, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id  (update name, email, role, or reset password)
router.put('/:id', ownerOnly, async (req, res) => {
  const { name, email, role, password } = req.body;
  if (role) {
    const { rows: roleCheck } = await db.query('SELECT id FROM roles WHERE id = $1 AND property_id = $2', [role, req.propertyId]);
    if (!roleCheck[0]) return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    let passwordClause = '';
    const params = [name, email?.toLowerCase(), role];
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      params.push(hash);
      passwordClause = `, password_hash = $${params.length}`;
    }
    params.push(req.params.id, req.propertyId);
    const idPos = params.length - 1;
    const propPos = params.length;
    const { rows } = await db.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        role = COALESCE($3, role)
        ${passwordClause}
       WHERE id = $${idPos} AND property_id = $${propPos} RETURNING id, name, email, role, created_at`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', ownerOnly, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    const { rows } = await db.query(
      'DELETE FROM users WHERE id = $1 AND property_id = $2 RETURNING id',
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
