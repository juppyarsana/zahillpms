const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { runNightAudit, getBusinessDate } = require('../jobs/nightAudit');

const ownerOnly = [auth, requireRole('owner')];

// POST /api/night-audit/run — manually trigger (owner only)
router.post('/run', ownerOnly, async (req, res) => {
  try {
    const result = await runNightAudit(`manual:${req.user.id}`);
    if (result.skipped) {
      const msg = result.reason === 'future_date'
        ? `Cannot audit ${result.business_date} — the day has not completed yet`
        : `Audit already run for ${result.business_date}`;
      return res.status(409).json({ skipped: true, reason: result.reason, business_date: result.business_date, message: msg });
    }
    res.json(result);
  } catch (err) {
    console.error('[Night Audit] Manual run failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/night-audit/latest — most recent audit summary
router.get('/latest', ownerOnly, async (req, res) => {
  try {
    const [auditRes, settingsRes] = await Promise.all([
      db.query(
        `SELECT * FROM night_audit_runs ORDER BY run_at DESC LIMIT 1`
      ),
      db.query('SELECT business_date, last_audit_at FROM property_settings WHERE id = 1'),
    ]);
    res.json({
      latest: auditRes.rows[0] || null,
      business_date: settingsRes.rows[0]?.business_date || null,
      last_audit_at: settingsRes.rows[0]?.last_audit_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/night-audit/history — list of past audit runs
router.get('/history', ownerOnly, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  try {
    const { rows } = await db.query(
      `SELECT * FROM night_audit_runs ORDER BY business_date DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/night-audit/:date — single audit by date (YYYY-MM-DD)
router.get('/:date', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM night_audit_runs WHERE business_date = $1`,
      [req.params.date]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No audit found for this date' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
