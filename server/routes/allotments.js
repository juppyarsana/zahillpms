const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/allotments?month=&year=
router.get('/', auth, async (req, res) => {
  const { month, year } = req.query;
  let query = 'SELECT a.*, u.name as unit_name FROM allotments a JOIN units u ON a.unit_id = u.id WHERE u.property_id = $1';
  const params = [req.propertyId];
  if (month) { params.push(month); query += ` AND a.month = $${params.length}`; }
  if (year) { params.push(year); query += ` AND a.year = $${params.length}`; }
  query += ' ORDER BY u.name';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/allotments  (upsert array)
router.put('/', auth, requireRole('owner'), async (req, res) => {
  const { allotments } = req.body;
  if (!Array.isArray(allotments)) return res.status(400).json({ error: 'allotments array required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const unitIds = allotments.map(a => a.unit_id);
    const { rows: ownedUnits } = await client.query('SELECT id FROM units WHERE id = ANY($1) AND property_id = $2', [unitIds, req.propertyId]);
    if (ownedUnits.length !== new Set(unitIds).size) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'One or more units not found' });
    }
    for (const a of allotments) {
      await client.query(
        `INSERT INTO allotments (unit_id, channel, month, year, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5, NOW())
         ON CONFLICT (unit_id, month, year) DO UPDATE SET channel=$2, notes=$5, updated_at=NOW()`,
        [a.unit_id, a.channel, a.month, a.year, a.notes]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Allotments updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
