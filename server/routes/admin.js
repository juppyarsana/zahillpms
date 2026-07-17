const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const seedPropertyDefaults = require('../utils/seedPropertyDefaults');

// GET /api/admin/properties
router.get('/properties', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.name, p.slug, p.plan, p.is_active, p.created_at,
             COUNT(pm.module) AS module_count
      FROM properties p
      LEFT JOIN property_modules pm ON pm.property_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/properties
router.post('/properties', async (req, res) => {
  const { name, slug, plan, display_token } = req.body;
  if (!name || !slug || !display_token) {
    return res.status(400).json({ error: 'name, slug, display_token required' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO properties (name, slug, plan, display_token) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, slug, plan || 'basic', display_token]
    );
    const property = rows[0];
    await seedPropertyDefaults(property.id);
    res.status(201).json(property);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A property with this slug or display_token already exists' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/properties/:id
router.get('/properties/:id', async (req, res) => {
  try {
    const { rows: [property] } = await db.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    const { rows: modules } = await db.query(
      'SELECT module, is_enabled FROM property_modules WHERE property_id = $1 ORDER BY module',
      [req.params.id]
    );
    res.json({ ...property, modules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/properties/:id
router.patch('/properties/:id', async (req, res) => {
  const { name, slug, plan, is_active } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE properties SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        plan = COALESCE($3, plan),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [name, slug, plan, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already in use' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/properties/:id/modules
router.patch('/properties/:id/modules', async (req, res) => {
  const { module, is_enabled } = req.body;
  if (!module || is_enabled === undefined) {
    return res.status(400).json({ error: 'module and is_enabled required' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO property_modules (property_id, module, is_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (property_id, module) DO UPDATE SET is_enabled = $3
       RETURNING *`,
      [req.params.id, module, is_enabled]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/properties/:id/users
router.get('/properties/:id/users', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE property_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/properties/:id/users
router.post('/properties/:id/users', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, role required' });
  }
  try {
    const { rows: roleCheck } = await db.query(
      'SELECT id FROM roles WHERE id = $1 AND property_id = $2',
      [role, req.params.id]
    );
    if (!roleCheck[0]) return res.status(400).json({ error: 'Invalid role for this property' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, role, property_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, created_at',
      [name, email.toLowerCase(), hash, role, req.params.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
