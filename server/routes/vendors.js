// Finance → Vendor payouts (migration 140): tour / transport vendors, what each
// trip owes them, and the money paid. Mounted with auth + moduleGuard('activities')
// + requireOwnerOrMenu('vendors') in index.js.
const router = require('express').Router();
const db = require('../db');
const PDFDocument = require('pdfkit');
const svc = require('../services/vendorPayoutService');
const { drawDocumentHeader } = require('../services/pdfHeader');

const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));
const send = (res, r, ok = 200) => r.error ? res.status(r.status || 400).json(r) : res.status(ok).json(r);

router.get('/', wrap(async (req, res) => res.json(await svc.listVendors(req.propertyId))));
router.get('/suppliers', wrap(async (req, res) => res.json(await svc.otherSuppliers(req.propertyId))));
router.post('/', wrap(async (req, res) => send(res, await svc.saveVendor(req.propertyId, req.body || {}), 201)));

router.get('/trips', wrap(async (req, res) => res.json(await svc.listTrips(req.propertyId, req.query))));
router.put('/trips/:lineId', wrap(async (req, res) => send(res, await svc.updateLine(req.propertyId, req.params.lineId, req.body || {}, req.user.id))));
router.delete('/trips/:lineId', wrap(async (req, res) => send(res, await svc.removeLine(req.propertyId, req.params.lineId, req.user.id))));
router.get('/bookings/:abId', wrap(async (req, res) => res.json(await svc.linesForBooking(req.propertyId, req.params.abId))));
router.post('/bookings/:abId', wrap(async (req, res) => send(res, await svc.addLine(req.propertyId, req.params.abId, req.body || {}, req.user.id), 201)));

router.get('/payouts', wrap(async (req, res) => res.json(await svc.listPayouts(req.propertyId, req.query))));
router.post('/payouts', wrap(async (req, res) => send(res, await svc.createPayout(req.propertyId, req.body || {}, req.user.id), 201)));
router.post('/payouts/:id/void', wrap(async (req, res) => send(res, await svc.voidPayout(req.propertyId, req.params.id, req.body?.reason, req.user.id))));
router.get('/payouts/:id', wrap(async (req, res) => {
  const p = await svc.payoutDetail(req.propertyId, req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: 'Payout not found' });
}));
// The slip the vendor signs.
router.get('/payouts/:id/pdf', wrap(async (req, res) => {
  const p = await svc.payoutDetail(req.propertyId, req.params.id);
  if (!p) return res.status(404).json({ error: 'Payout not found' });
  const { rows: [property] } = await db.query(
    'SELECT property_name, property_address, property_phone, property_email, logo_url FROM property_settings WHERE property_id = $1', [req.propertyId]);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="vendor-payout-${p.payout_no_text}.pdf"`);
  doc.pipe(res);
  drawDocumentHeader(doc, property || {}, { title: 'Vendor payout', refLine: p.payout_no_text });
  svc.renderSlip(doc, p);
  doc.end();
}));

router.put('/:id', wrap(async (req, res) => send(res, await svc.saveVendor(req.propertyId, req.body || {}, req.params.id))));
router.delete('/:id', wrap(async (req, res) => send(res, await svc.removeVendor(req.propertyId, req.params.id))));

module.exports = router;
