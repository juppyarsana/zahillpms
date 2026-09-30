const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const PDFDocument = require('pdfkit');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { runNightAudit, getBusinessDate } = require('../jobs/nightAudit');
const { detailForRun } = require('../services/nightAuditDetail');
const { renderNightAudit } = require('../services/nightAuditPdf');
const { drawDocumentHeader } = require('../services/pdfHeader');

// Running an audit by hand is owner-only; viewing it (list, detail, PDF) is
// the owner or anyone with the night_audit permission (migration 089).
const ownerOnly = [auth, requireRole('owner')];
const canView = [auth, requireOwnerOrMenu('night_audit')];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/night-audit/run — manually trigger (owner only)
router.post('/run', ownerOnly, async (req, res) => {
  try {
    const result = await runNightAudit(`manual:${req.user.id}`, req.propertyId);
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
router.get('/latest', canView, async (req, res) => {
  try {
    const [auditRes, settingsRes] = await Promise.all([
      db.query(
        `SELECT * FROM night_audit_runs WHERE property_id = $1 ORDER BY run_at DESC LIMIT 1`,
        [req.propertyId]
      ),
      db.query('SELECT business_date, last_audit_at FROM property_settings WHERE property_id = $1', [req.propertyId]),
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
router.get('/history', canView, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  try {
    const { rows } = await db.query(
      `SELECT id, business_date, run_at, triggered_by, units_occupied, no_shows, room_revenue, fnb_revenue,
              ancillary_revenue, pending_balances, arriving_today, tasks_created, summary, property_id,
              (detail IS NOT NULL) AS has_detail
       FROM night_audit_runs WHERE property_id = $1 ORDER BY business_date DESC LIMIT $2`,
      [req.propertyId, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function findRun(propertyId, date) {
  const { rows } = await db.query(
    `SELECT * FROM night_audit_runs WHERE business_date = $1 AND property_id = $2 ORDER BY run_at DESC LIMIT 1`,
    [date, propertyId]
  );
  return rows[0] || null;
}

// GET /api/night-audit/:date/detail — the full audit report (saved when the
// audit ran; rebuilt from today's data for runs before migration 089).
router.get('/:date/detail', canView, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const run = await findRun(req.propertyId, req.params.date);
    if (!run) return res.status(404).json({ error: 'No audit found for this date' });
    const detail = await detailForRun(run);
    res.json({ run: { id: run.id, business_date: run.business_date, run_at: run.run_at, triggered_by: run.triggered_by }, detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/night-audit/:date/pdf — the same report as a branded PDF.
router.get('/:date/pdf', canView, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const run = await findRun(req.propertyId, req.params.date);
    if (!run) return res.status(404).json({ error: 'No audit found for this date' });
    const detail = await detailForRun(run);
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`, [req.propertyId]);
    const [y, m, d] = req.params.date.split('-').map(Number);
    const longDate = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="night-audit-${req.params.date}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Night Audit', refLine: longDate, dateLine: null });
    renderNightAudit(doc, detail, { run });
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/night-audit/:date — single audit by date (YYYY-MM-DD)
router.get('/:date', canView, async (req, res) => {
  try {
    const run = await findRun(req.propertyId, req.params.date);
    if (!run) return res.status(404).json({ error: 'No audit found for this date' });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
