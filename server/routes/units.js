const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/units
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units WHERE property_id = $1 ORDER BY name', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/units/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const BED_CONFIGS = ['double', 'twin', 'twin_or_double', 'other'];

// POST /api/units  (owner only)
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { name, type, description, base_rate, max_guests, bed_config } = req.body;
  if (!name) return res.status(400).json({ error: 'Unit name is required' });
  if (bed_config && !BED_CONFIGS.includes(bed_config)) {
    return res.status(400).json({ error: `bed_config must be one of ${BED_CONFIGS.join(', ')}` });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO units (name, type, description, base_rate, max_guests, bed_config, property_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, type || '', description || '', base_rate || 0, max_guests || 2, bed_config || 'double', req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/units/:id  (owner only)
// controller_id is intentionally editable here, not just under
// /api/iot (which is gated behind the room_controller module) — Room
// Display/TV Display/Kitchen Display/calling all key off it regardless of
// whether a property has ESP32 relay hardware, so assigning it can't
// depend on that module being on. `undefined` leaves it untouched;
// `''`/null clears it (mirrors routes/iot.js's controller-assignment
// endpoint, which keeps working for hardware-owning properties too).
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, type, description, base_rate, max_guests, status, controller_id, bed_config } = req.body;
  const controllerIdProvided = controller_id !== undefined;
  const controllerIdValue = controllerIdProvided
    ? (controller_id ? String(controller_id).trim().slice(0, 10) : null)
    : null;
  if (bed_config && !BED_CONFIGS.includes(bed_config)) {
    return res.status(400).json({ error: `bed_config must be one of ${BED_CONFIGS.join(', ')}` });
  }
  try {
    const { rows } = await db.query(
      `UPDATE units SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        description = COALESCE($3, description),
        base_rate = COALESCE($4, base_rate),
        max_guests = COALESCE($5, max_guests),
        status = COALESCE($6, status),
        bed_config = COALESCE($11, bed_config),
        controller_id = CASE WHEN $9 THEN $7 ELSE controller_id END
       WHERE id = $8 AND property_id = $10 RETURNING *`,
      [name, type, description, base_rate, max_guests, status, controllerIdValue, req.params.id, controllerIdProvided, req.propertyId, bed_config || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'That controller ID is already assigned to another unit' : err.message,
    });
  }
});

// DELETE /api/units/:id  (owner only — blocked if active bookings exist)
router.delete('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const { rows: active } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1
         AND property_id = $2
         AND status IN ('pending','deposit_paid','confirmed','checked_in')
       LIMIT 1`,
      [req.params.id, req.propertyId]
    );
    if (active.length > 0) {
      return res.status(409).json({ error: 'Cannot delete — this unit has active or upcoming bookings' });
    }
    const { rows } = await db.query('DELETE FROM units WHERE id = $1 AND property_id = $2 RETURNING id', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json({ message: 'Unit deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
