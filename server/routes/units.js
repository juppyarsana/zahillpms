const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const sse = require('../sse');

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
  const { name, type, description, base_rate, max_guests, bed_config, controller_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Unit name is required' });
  if (bed_config && !BED_CONFIGS.includes(bed_config)) {
    return res.status(400).json({ error: `bed_config must be one of ${BED_CONFIGS.join(', ')}` });
  }
  // Room ID (controller_id) defaults to the room name — every kiosk
  // display keys off it and it's almost always just the room number.
  // A caller-supplied value overrides; an explicit '' / null opts out.
  const rawRoomId = controller_id !== undefined ? controller_id : name;
  const roomId = rawRoomId ? String(rawRoomId).trim().slice(0, 32) : null;
  try {
    const { rows } = await db.query(
      `INSERT INTO units (name, type, description, base_rate, max_guests, bed_config, controller_id, property_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, type || '', description || '', base_rate || 0, max_guests || 2, bed_config || 'double', roomId, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const dupRoomId = err.constraint === 'units_controller_id_property_unique';
      return res.status(409).json({
        error: dupRoomId
          ? 'That Room ID is already assigned to another unit'
          : 'A unit with that name already exists',
      });
    }
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
    ? (controller_id ? String(controller_id).trim().slice(0, 32) : null)
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
      error: err.code === '23505' ? 'That Room ID is already assigned to another unit' : err.message,
    });
  }
});

// PATCH /api/units/:id/housekeeping  (any staff — front desk fallback for the
// room tablet's "Mark Room Clean"). Deliberately not owner-gated like PUT /:id:
// clearing a room after checkout is a routine front-desk / housekeeping action.
// Body: { status: 'clean' | 'dirty' }
router.patch('/:id/housekeeping', auth, async (req, res) => {
  const { status } = req.body;
  if (!['clean', 'dirty'].includes(status)) {
    return res.status(400).json({ error: "status must be 'clean' or 'dirty'" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE units SET housekeeping_status = $1, housekeeping_updated_at = NOW()
       WHERE id = $2 AND property_id = $3 RETURNING id, controller_id, housekeeping_status`,
      [status, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });

    if (status === 'clean') {
      await db.query(
        `UPDATE tasks SET status = 'done', updated_at = NOW()
         WHERE unit_id = $1 AND property_id = $2 AND type = 'housekeeping' AND status <> 'done'`,
        [req.params.id, req.propertyId]
      );
    }
    if (rows[0].controller_id) sse.notify(rows[0].controller_id, { type: 'housekeeping' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/units/:id/status  (any staff — mirrors /housekeeping: taking a
// room out of service for a broken AC/plumbing/etc. is usually noticed by
// front desk or housekeeping, not the owner, and is time-sensitive).
// Body: { status: 'out_of_order' | 'available', reason?, expected_back? }
// 'out_of_order' requires a reason and opens a type='maintenance' task
// (the same task type Operations already uses) so it's tracked as real
// work, not just a status flag. 'available' clears the reason/date and
// closes that task, mirroring how 'clean' closes the housekeeping task.
router.patch('/:id/status', auth, async (req, res) => {
  const { status, reason, expected_back } = req.body;
  if (!['out_of_order', 'available'].includes(status)) {
    return res.status(400).json({ error: "status must be 'out_of_order' or 'available'" });
  }
  if (status === 'out_of_order' && !String(reason || '').trim()) {
    return res.status(400).json({ error: 'A reason is required to mark a room Out of Order' });
  }
  try {
    // status is a single column shared with occupancy — guard both
    // directions so this can't silently clobber 'occupied' (marking a room
    // Out of Order while a guest is checked in would erase that a guest is
    // there; a broken fixture in an occupied room should go through the
    // regular Operations task instead) or reset an occupied room to
    // 'available' via the "return to service" action.
    const { rows: current } = await db.query(
      'SELECT status FROM units WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!current[0]) return res.status(404).json({ error: 'Unit not found' });
    if (status === 'out_of_order' && current[0].status !== 'available') {
      return res.status(409).json({ error: `Cannot mark a(n) ${current[0].status} room Out of Order — check the guest out or transfer them first` });
    }
    if (status === 'available' && current[0].status !== 'out_of_order') {
      return res.status(409).json({ error: 'Room is not marked Out of Order' });
    }

    const { rows } = await db.query(
      `UPDATE units SET
        status = $1,
        status_reason = $2,
        status_expected_back = $3,
        status_updated_at = NOW(),
        status_updated_by = $4
       WHERE id = $5 AND property_id = $6 RETURNING id, name, controller_id, status, status_reason, status_expected_back, status_updated_at`,
      [
        status,
        status === 'out_of_order' ? reason.trim() : null,
        status === 'out_of_order' ? (expected_back || null) : null,
        req.user.id,
        req.params.id,
        req.propertyId,
      ]
    );
    const unit = rows[0];

    if (status === 'out_of_order') {
      await db.query(
        `INSERT INTO tasks (title, description, type, priority, unit_id, property_id)
         VALUES ($1, $2, 'maintenance', 'high', $3, $4)`,
        [`Out of Order — ${unit.name}`, unit.status_reason, unit.id, req.propertyId]
      );
    } else {
      await db.query(
        `UPDATE tasks SET status = 'done', updated_at = NOW()
         WHERE unit_id = $1 AND property_id = $2 AND type = 'maintenance' AND status <> 'done'`,
        [unit.id, req.propertyId]
      );
    }

    if (unit.controller_id) sse.notify(unit.controller_id, { type: 'unit_status' });
    res.json(unit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/units/:id/tablet — clear the room_display_devices telemetry
// row for this unit's Room ID. Plain `auth` (like /housekeeping) — used
// when a kiosk tablet is physically moved to another room, so front desk
// can dismiss the now-permanently-"offline" ghost from the Dashboard.
router.delete('/:id/tablet', auth, async (req, res) => {
  try {
    const { rows: unitRows } = await db.query(
      'SELECT controller_id FROM units WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found' });
    if (!unitRows[0].controller_id) return res.json({ message: 'No tablet record' });
    await db.query(
      'DELETE FROM room_display_devices WHERE property_id = $1 AND controller_id = $2',
      [req.propertyId, unitRows[0].controller_id]
    );
    res.json({ message: 'Tablet record removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
