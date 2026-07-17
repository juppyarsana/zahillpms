const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const modules = require('../modules');

const ownerOnly = [auth, requireRole('owner')];

// ── Modules ───────────────────────────────────────────────────────────────

router.get('/modules', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT module, is_enabled FROM property_modules WHERE property_id = $1',
      [req.propertyId]
    );
    const enabledByModule = {};
    for (const r of rows) enabledByModule[r.module] = r.is_enabled;

    const result = {};
    for (const [key, def] of Object.entries(modules)) {
      result[key] = { label: def.label, is_enabled: enabledByModule[key] ?? false };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Display Token (Room Display / TV Display device provisioning) ───────────

router.get('/display-token', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT display_token FROM properties WHERE id = $1', [req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json({ display_token: rows[0].display_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Booking Sources ──────────────────────────────────────────────────────────

router.get('/booking-sources', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM booking_sources WHERE property_id = $1 ORDER BY sort_order, id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/booking-sources', auth, async (req, res) => {
  const { id, label, is_ota, color, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO booking_sources (id, label, is_ota, color, sort_order, property_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id.toLowerCase().replace(/\s+/g, '_'), label, !!is_ota, color || '#6b7280', sort_order || 0, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A source with this ID already exists' : err.message,
    });
  }
});

router.put('/booking-sources/:id', auth, async (req, res) => {
  const { label, is_ota, color, is_active, sort_order } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE booking_sources SET
        label      = COALESCE($1, label),
        is_ota     = COALESCE($2, is_ota),
        color      = COALESCE($3, color),
        is_active  = COALESCE($4, is_active),
        sort_order = COALESCE($5, sort_order)
       WHERE id = $6 AND property_id = $7 RETURNING *`,
      [label, is_ota ?? null, color, is_active ?? null, sort_order ?? null, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Source not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Methods ──────────────────────────────────────────────────────────

router.get('/payment-methods', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM payment_methods WHERE property_id = $1 ORDER BY sort_order, id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payment-methods', auth, async (req, res) => {
  const { id, label, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO payment_methods (id, label, sort_order, property_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id.toLowerCase().replace(/\s+/g, '_'), label, sort_order || 0, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A method with this ID already exists' : err.message,
    });
  }
});

router.put('/payment-methods/:id', auth, async (req, res) => {
  const { label, is_active, sort_order } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE payment_methods SET
        label      = COALESCE($1, label),
        is_active  = COALESCE($2, is_active),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4 AND property_id = $5 RETURNING *`,
      [label, is_active ?? null, sort_order ?? null, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Method not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Roles & Permissions ──────────────────────────────────────────────────────

router.get('/roles', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM roles WHERE property_id = $1 ORDER BY id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/roles', ownerOnly, async (req, res) => {
  const { id, label, allowed_menus } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  if (id === 'owner') return res.status(400).json({ error: 'Cannot create a role named owner' });
  try {
    const { rows } = await db.query(
      'INSERT INTO roles (id, label, allowed_menus, property_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [id.toLowerCase().replace(/\s+/g, '_'), label, allowed_menus || [], req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A role with this ID already exists' : err.message,
    });
  }
});

router.put('/roles/:id', ownerOnly, async (req, res) => {
  if (req.params.id === 'owner') return res.status(400).json({ error: 'Cannot modify the owner role' });
  const { label, allowed_menus } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE roles SET
        label         = COALESCE($1, label),
        allowed_menus = COALESCE($2, allowed_menus)
       WHERE id = $3 AND property_id = $4 RETURNING *`,
      [label, allowed_menus || null, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/roles/:id', ownerOnly, async (req, res) => {
  if (req.params.id === 'owner') return res.status(400).json({ error: 'Cannot delete the owner role' });
  try {
    const { rows: users } = await db.query('SELECT id FROM users WHERE role = $1 AND property_id = $2 LIMIT 1', [req.params.id, req.propertyId]);
    if (users.length) return res.status(409).json({ error: 'Cannot delete a role that is assigned to users' });
    const { rows } = await db.query('DELETE FROM roles WHERE id = $1 AND property_id = $2 RETURNING id', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
