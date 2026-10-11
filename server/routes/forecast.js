// Forecast — /api/forecast
//   GET /?from=YYYY-MM-DD&days=14            the days ahead, one row per day (JSON)
//   GET /pdf?from=&days=&by_type=1&money=0   the same, to print
// Owner, or the forecast permission. Revenue columns only for the owner or
// the month_summary permission (the same people who see the Dashboard's
// month revenue); money=0 leaves them off a printout for the staff board.
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { buildForecast, MAX_DAYS } = require('../services/forecast');
const { renderForecast, forecastLayout } = require('../services/forecastPdf');

const canView = requireOwnerOrMenu('forecast');
const seesMoney = user => user?.role === 'owner'
  || (Array.isArray(user?.allowed_menus) && user.allowed_menus.includes('month_summary'));

// → the forecast, or null after answering 400.
async function load(req, res, { money = true } = {}) {
  const days = req.query.days === undefined ? 14 : parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    res.status(400).json({ error: `days must be 1 to ${MAX_DAYS}` });
    return null;
  }
  const data = await buildForecast(req.propertyId, { from: req.query.from, days, withMoney: money && seesMoney(req.user) });
  if (!data) res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  return data;
}

router.get('/', canView, async (req, res) => {
  try {
    const data = await load(req, res);
    if (data) res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pdf', canView, async (req, res) => {
  try {
    const data = await load(req, res, { money: req.query.money !== '0' });
    if (!data) return;
    const byType = req.query.by_type === '1';
    const { rows: [property] } = await db.query(
      `SELECT property_name, property_address, property_phone, property_email, logo_url
       FROM property_settings WHERE property_id = $1`, [req.propertyId]);
    const fmt = ymd => {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: forecastLayout(data, { byType }) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="forecast-${data.from}_to_${data.to}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property || {}, { title: 'Forecast', refLine: `${fmt(data.from)} – ${fmt(data.to)}` });
    renderForecast(doc, data, { byType });
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
