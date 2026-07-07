const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const mqttClient = require('../mqtt');

// GET /api/iot/units — all units with controller_id, relay states, controller status
router.get('/units', auth, async (req, res) => {
  try {
    const { rows: units } = await db.query(
      `SELECT u.id, u.name, u.controller_id,
              rcs.connected, rcs.ip_address, rcs.rgb, rcs.last_seen
       FROM units u
       LEFT JOIN room_controller_status rcs ON rcs.controller_id = u.controller_id
       ORDER BY u.name`
    );

    const { rows: relays } = await db.query(
      `SELECT ur.unit_id, ur.relay_num, ur.label, ur.icon, ur.state, ur.enabled, ur.updated_at
       FROM unit_relays ur
       ORDER BY ur.unit_id, ur.relay_num`
    );

    const relaysByUnit = {};
    for (const r of relays) {
      if (!relaysByUnit[r.unit_id]) relaysByUnit[r.unit_id] = [];
      relaysByUnit[r.unit_id].push(r);
    }

    const result = units.map(u => ({ ...u, relays: relaysByUnit[u.id] || [] }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/iot/units/:unitId — single unit IoT state
router.get('/units/:unitId', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.controller_id,
              rcs.connected, rcs.ip_address, rcs.rgb, rcs.last_seen
       FROM units u
       LEFT JOIN room_controller_status rcs ON rcs.controller_id = u.controller_id
       WHERE u.id = $1`,
      [req.params.unitId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });

    const { rows: relays } = await db.query(
      `SELECT relay_num, label, icon, state, enabled, updated_at
       FROM unit_relays WHERE unit_id = $1 ORDER BY relay_num`,
      [req.params.unitId]
    );
    res.json({ ...rows[0], relays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iot/relay — set a relay on/off
// Body: { unit_id, relay_num, state: true|false }
router.post('/relay', auth, async (req, res) => {
  const { unit_id, relay_num, state } = req.body;
  if (!unit_id || relay_num == null || state == null) {
    return res.status(400).json({ error: 'unit_id, relay_num, and state are required' });
  }
  try {
    const { rows } = await db.query(
      'SELECT controller_id FROM units WHERE id = $1',
      [unit_id]
    );
    if (!rows[0] || !rows[0].controller_id) {
      return res.status(404).json({ error: 'Unit not found or has no controller assigned' });
    }
    const { controller_id } = rows[0];
    const topic = `zahill/room/${controller_id}/relay/${relay_num}/set`;
    await mqttClient.publish(topic, state ? 'on' : 'off');
    res.json({ ok: true, topic, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iot/rgb — set RGB color
// Body: { unit_id, r, g, b }
router.post('/rgb', auth, async (req, res) => {
  const { unit_id, r, g, b } = req.body;
  if (!unit_id || r == null || g == null || b == null) {
    return res.status(400).json({ error: 'unit_id, r, g, b are required' });
  }
  try {
    const { rows } = await db.query(
      'SELECT controller_id FROM units WHERE id = $1',
      [unit_id]
    );
    if (!rows[0] || !rows[0].controller_id) {
      return res.status(404).json({ error: 'Unit not found or has no controller assigned' });
    }
    const { controller_id } = rows[0];
    const topic = `zahill/room/${controller_id}/rgb/set`;
    await mqttClient.publish(topic, JSON.stringify({ r, g, b }));
    res.json({ ok: true, topic, r, g, b });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iot/ir/send — send a stored IR command
// Body: { unit_id, slot: 0-4 }
router.post('/ir/send', auth, async (req, res) => {
  const { unit_id, slot } = req.body;
  if (!unit_id || slot == null) return res.status(400).json({ error: 'unit_id and slot are required' });
  if (slot < 0 || slot > 4) return res.status(400).json({ error: 'slot must be 0–4' });
  try {
    const { rows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [unit_id]);
    if (!rows[0]?.controller_id) return res.status(404).json({ error: 'Unit not found or has no controller assigned' });
    const topic = `zahill/room/${rows[0].controller_id}/ir/send`;
    await mqttClient.publish(topic, String(slot));
    res.json({ ok: true, topic, slot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iot/ir/learn — start IR learning mode for a slot
// Body: { unit_id, slot: 0-4 }
router.post('/ir/learn', auth, async (req, res) => {
  const { unit_id, slot } = req.body;
  if (!unit_id || slot == null) return res.status(400).json({ error: 'unit_id and slot are required' });
  if (slot < 0 || slot > 4) return res.status(400).json({ error: 'slot must be 0–4' });
  try {
    const { rows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [unit_id]);
    if (!rows[0]?.controller_id) return res.status(404).json({ error: 'Unit not found or has no controller assigned' });
    const topic = `zahill/room/${rows[0].controller_id}/ir/learn`;
    await mqttClient.publish(topic, String(slot));
    res.json({ ok: true, topic, slot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iot/units/:unitId/request-status — trigger full status publish from device
router.post('/units/:unitId/request-status', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [req.params.unitId]);
    if (!rows[0]?.controller_id) return res.status(404).json({ error: 'Unit not found or has no controller assigned' });
    const topic = `zahill/room/${rows[0].controller_id}/request/status`;
    await mqttClient.publish(topic, '1');
    res.json({ ok: true, topic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/iot/units/:unitId/controller — assign or clear controller_id
router.put('/units/:unitId/controller', auth, async (req, res) => {
  const { controller_id } = req.body;
  const value = controller_id ? String(controller_id).trim().slice(0, 10) : null;
  try {
    const { rows } = await db.query(
      'UPDATE units SET controller_id = $1 WHERE id = $2 RETURNING id, name, controller_id',
      [value, req.params.unitId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'That controller ID is already assigned to another unit' : err.message,
    });
  }
});

// PUT /api/iot/units/:unitId/relay/:relayNum/label — update relay label
router.put('/units/:unitId/relay/:relayNum/label', auth, async (req, res) => {
  const { label } = req.body;
  if (label == null) return res.status(400).json({ error: 'label is required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO unit_relays (unit_id, relay_num, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (unit_id, relay_num) DO UPDATE SET label = $3
       RETURNING *`,
      [req.params.unitId, req.params.relayNum, label]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/iot/units/:unitId/relays/:relayNum
// Body: { label, icon, enabled }
router.patch('/units/:unitId/relays/:relayNum', auth, async (req, res) => {
  const { label, icon, enabled } = req.body;
  if (label == null || icon == null || enabled == null) {
    return res.status(400).json({ error: 'label, icon, and enabled are required' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO unit_relays (unit_id, relay_num, label, icon, enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (unit_id, relay_num) DO UPDATE
         SET label = EXCLUDED.label,
             icon = EXCLUDED.icon,
             enabled = EXCLUDED.enabled
       RETURNING *`,
      [req.params.unitId, req.params.relayNum, label, icon, enabled]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
