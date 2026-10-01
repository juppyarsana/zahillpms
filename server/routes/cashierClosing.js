// Cashier closing (migration 093) — /api/cashier-closing
//   GET /?date=&user_id=      the day's payments, by method (JSON)
//   GET /pdf?date=&user_id=   the same, to print and sign
// Owner, or the cashier_closing permission. Everyone who can open it sees
// every user's lines (a handover is checked by someone else).
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { todayWITA } = require('../services/roomChargeService');
const cashierClosing = require('../services/cashierClosing');
const { renderCashierClosing } = require('../services/cashierClosingPdf');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canView = requireOwnerOrMenu('cashier_closing');

function params(req, res) {
  const date = req.query.date || todayWITA();
  if (!DATE_RE.test(date)) { res.status(400).json({ error: 'date must be YYYY-MM-DD' }); return null; }
  const userId = req.query.user_id || null;
  if (userId && !UUID_RE.test(userId)) { res.status(400).json({ error: 'Unknown user' }); return null; }
  return { date, userId };
}

router.get('/', canView, async (req, res) => {
  const p = params(req, res);
  if (!p) return;
  try {
    res.json(await cashierClosing.load(req.propertyId, p.date, { userId: p.userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pdf', canView, async (req, res) => {
  const p = params(req, res);
  if (!p) return;
  try {
    const data = await cashierClosing.load(req.propertyId, p.date, { userId: p.userId });
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`, [req.propertyId]);
    const [y, m, d] = p.date.split('-').map(Number);
    const longDate = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cashier-closing-${p.date}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Cashier Closing', refLine: longDate });
    renderCashierClosing(doc, data);
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
