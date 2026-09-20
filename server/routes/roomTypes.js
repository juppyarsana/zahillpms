const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// Room types (migration 062) — the single source of truth for a type's name, base rate
// and max guests. Triggers copy those onto every room of the type (units.type /
// base_rate / max_guests stay as read-only mirrors), so editing a type here updates all
// its rooms in one statement. Core route (always on, like /api/units), not module-gated.

const LIST_SQL = `
  SELECT rt.*,
         COUNT(u.id)::int AS rooms,
         COUNT(u.id) FILTER (WHERE u.status = 'out_of_order')::int AS out_of_order
  FROM room_types rt
  LEFT JOIN units u ON u.room_type_id = rt.id
  WHERE rt.property_id = $1
  GROUP BY rt.id
  ORDER BY rt.sort_order, rt.name`;

function parseBody(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim().slice(0, 100);
    if (!name) return { error: 'Room type name is required' };
    out.name = name;
  }
  if (b.base_rate !== undefined) {
    const n = Number(b.base_rate);
    if (!Number.isFinite(n) || n < 0) return { error: 'Base rate must be a number, 0 or more' };
    out.base_rate = n;
  }
  if (b.max_guests !== undefined) {
    const n = parseInt(b.max_guests, 10);
    if (!(n >= 1 && n <= 20)) return { error: 'Max guests must be between 1 and 20' };
    out.max_guests = n;
  }
  if (b.description !== undefined) out.description = String(b.description || '').slice(0, 1000);
  if (b.sort_order !== undefined) {
    const n = parseInt(b.sort_order, 10);
    if (Number.isFinite(n)) out.sort_order = n;
  }
  return { value: out };
}

// GET /api/room-types — any staff (the room pickers need it), with room counts.
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query(LIST_SQL, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/room-types (owner)
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { error, value } = parseBody(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  try {
    const { rows: [max] } = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM room_types WHERE property_id = $1', [req.propertyId]);
    const { rows: [row] } = await db.query(
      `INSERT INTO room_types (property_id, name, description, base_rate, max_guests, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.propertyId, value.name, value.description ?? '', value.base_rate ?? 0, value.max_guests ?? 2, value.sort_order ?? max.n]
    );
    res.status(201).json({ ...row, rooms: 0, out_of_order: 0 });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A room type with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/room-types/:id (owner) — the triggers push name/base_rate/max_guests to every room.
// A rename also has to follow the things that key off the type NAME: yield settings, the
// auto pricing periods ("Auto: <name>") and the yield change log. Done in one transaction.
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { error, value } = parseBody(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [cur] } = await client.query('SELECT * FROM room_types WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]);
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Room type not found' }); }

    const { rows: [row] } = await client.query(
      `UPDATE room_types SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         base_rate = COALESCE($5, base_rate), max_guests = COALESCE($6, max_guests),
         sort_order = COALESCE($7, sort_order)
       WHERE id = $1 AND property_id = $2 RETURNING *`,
      [req.params.id, req.propertyId, value.name ?? null, value.description ?? null, value.base_rate ?? null, value.max_guests ?? null, value.sort_order ?? null]
    );

    if (value.name && value.name !== cur.name) {
      await client.query('UPDATE yield_settings SET room_type = $3 WHERE property_id = $1 AND room_type = $2', [req.propertyId, cur.name, value.name]);
      await client.query('UPDATE yield_rate_log SET room_type = $3 WHERE property_id = $1 AND room_type = $2', [req.propertyId, cur.name, value.name]);
      await client.query(
        `UPDATE pricing_periods SET name = $3 WHERE property_id = $1 AND source = 'auto' AND name = $2`,
        [req.propertyId, `Auto: ${cur.name}`, `Auto: ${value.name}`]
      );
    }
    await client.query('COMMIT');
    const { rows: [full] } = await db.query(LIST_SQL.replace('WHERE rt.property_id = $1', 'WHERE rt.property_id = $1 AND rt.id = $2'), [req.propertyId, req.params.id]);
    res.json(full || row);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A room type with that name already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/room-types/:id (owner) — only when no rooms use it.
router.delete('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const { rows: [used] } = await db.query(
      'SELECT COUNT(*)::int AS n FROM units WHERE room_type_id = $1 AND property_id = $2', [req.params.id, req.propertyId]
    );
    if (used.n > 0) return res.status(409).json({ error: `Cannot delete — ${used.n} room${used.n === 1 ? '' : 's'} still use this type. Move or delete them first.` });
    const { rows } = await db.query('DELETE FROM room_types WHERE id = $1 AND property_id = $2 RETURNING name', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room type not found' });
    await db.query('DELETE FROM yield_settings WHERE property_id = $1 AND room_type = $2', [req.propertyId, rows[0].name]);
    res.json({ message: 'Room type deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
