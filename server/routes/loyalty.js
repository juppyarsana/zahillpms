const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/loyalty/tiers
router.get('/tiers', auth, async (req, res) => {
  try {
    const tiersQ = db.query('SELECT * FROM loyalty_tiers ORDER BY sort_order, threshold_value');
    const perksQ = db.query('SELECT * FROM loyalty_perks ORDER BY tier_id, sort_order');
    const [{ rows: tiers }, { rows: perks }] = await Promise.all([tiersQ, perksQ]);
    const result = tiers.map(t => ({ ...t, perks: perks.filter(p => p.tier_id === t.id) }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/tiers
router.post('/tiers', auth, requireRole('owner'), async (req, res) => {
  const { name, emoji, color, threshold_type, threshold_value, sort_order, perks } = req.body;
  if (!name || !threshold_type || threshold_value === undefined) {
    return res.status(400).json({ error: 'name, threshold_type, threshold_value required' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [tier] } = await client.query(
      `INSERT INTO loyalty_tiers (name, emoji, color, threshold_type, threshold_value, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, emoji, color, threshold_type, threshold_value, sort_order || 0]
    );
    if (Array.isArray(perks)) {
      for (let i = 0; i < perks.length; i++) {
        await client.query('INSERT INTO loyalty_perks (tier_id, description, sort_order) VALUES ($1,$2,$3)', [tier.id, perks[i], i]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json(tier);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/loyalty/tiers/:id
router.put('/tiers/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, emoji, color, threshold_type, threshold_value, sort_order, perks } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [tier] } = await client.query(
      `UPDATE loyalty_tiers SET
        name = COALESCE($1, name), emoji = COALESCE($2, emoji), color = COALESCE($3, color),
        threshold_type = COALESCE($4, threshold_type), threshold_value = COALESCE($5, threshold_value),
        sort_order = COALESCE($6, sort_order)
       WHERE id = $7 RETURNING *`,
      [name, emoji, color, threshold_type, threshold_value, sort_order, req.params.id]
    );
    if (!tier) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Tier not found' }); }

    if (Array.isArray(perks)) {
      await client.query('DELETE FROM loyalty_perks WHERE tier_id = $1', [req.params.id]);
      for (let i = 0; i < perks.length; i++) {
        await client.query('INSERT INTO loyalty_perks (tier_id, description, sort_order) VALUES ($1,$2,$3)', [req.params.id, perks[i], i]);
      }
    }
    await client.query('COMMIT');
    res.json(tier);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/loyalty/tiers/:id
router.delete('/tiers/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    await db.query('DELETE FROM loyalty_tiers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Tier deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
