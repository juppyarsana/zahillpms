// Events — /api/events (migration 106). The meeting room booked for a date and
// time, with its own bill, payments and the meals the restaurant prepares.
// Owner or the `events` permission; venues are set up by the owner.
//   GET  /                         ?from=&to=&status=&q=   list / calendar
//   GET  /venues                   · POST /venues · PUT /venues/:id  (owner)
//   POST /                         new event { …, status, hire_price? }
//   GET  /:id                      event + bill + meals + history + linked group
//   PUT  /:id                      change details
//   PUT  /:id/status               { status, reason?, hold_until? }
//   POST /:id/charges              { type, description, service_date?, quantity?, price }
//   DELETE /:id/charges/:chargeId  { reason }   (void; a restaurant bill → the POS is told and reopens it)
//   POST /:id/charges/:chargeId/tell-pos        try again to tell the POS
//   POST /:id/meals · PUT /:id/meals/:mealId · DELETE /:id/meals/:mealId
//   POST /:id/payments             { amount, method, received_at?, reference?, notes? }
//   DELETE /:id/payments/:paymentId { reason }  (void)
//   GET  /:id/refundable · POST /:id/refund { amount, method, refunded_at?, reference?, reason }
//   GET  /:id/proforma · /:id/invoice · /:id/function-sheet   (PDF)
// Logic in services/eventService.js.
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db');
const requireRole = require('../middleware/role');
const ev = require('../services/eventService');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { renderEventBill, renderFunctionSheet } = require('../services/eventPdf');

// Runs a handler; an EventError becomes its status + message.
const run = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ev.EventError) {
      const { status, message, ...extra } = err;
      return res.status(status).json({ error: message, ...extra });
    }
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
const owner = requireRole('owner');

router.get('/venues', run(async (req, res) => {
  res.json(await ev.listVenues(req.propertyId));
}));
router.post('/venues', owner, run(async (req, res) => {
  res.status(201).json(await ev.saveVenue(req.propertyId, null, req.body || {}));
}));
router.put('/venues/:id', owner, run(async (req, res) => {
  res.json(await ev.saveVenue(req.propertyId, req.params.id, req.body || {}));
}));

router.get('/', run(async (req, res) => {
  res.json(await ev.list(req.propertyId, req.query));
}));

router.post('/', run(async (req, res) => {
  res.status(201).json(await ev.create(req.propertyId, req.body || {}, req.user));
}));

const found = (res, value) => {
  if (!value) { res.status(404).json({ error: 'Event not found' }); return false; }
  return true;
};

router.get('/:id', run(async (req, res) => {
  const d = await ev.detail(req.propertyId, req.params.id);
  if (found(res, d)) res.json(d);
}));

router.put('/:id', run(async (req, res) => {
  res.json(await ev.update(req.propertyId, req.params.id, req.body || {}, req.user));
}));

router.put('/:id/status', run(async (req, res) => {
  res.json(await ev.setStatus(req.propertyId, req.params.id, req.body || {}, req.user));
}));

router.post('/:id/charges', run(async (req, res) => {
  res.status(201).json({ id: await ev.addCharge(req.propertyId, req.params.id, req.body || {}, req.user) });
}));
router.delete('/:id/charges/:chargeId', run(async (req, res) => {
  // pos: { told, error } when the line was a restaurant bill (the POS reopens it), else null
  res.json({ ok: true, ...(await ev.voidCharge(req.propertyId, req.params.id, req.params.chargeId, req.body, req.user)) });
}));
// A voided restaurant line the POS has not heard about yet: try again.
router.post('/:id/charges/:chargeId/tell-pos', run(async (req, res) => {
  res.json(await ev.tellPos(req.propertyId, req.params.id, req.params.chargeId, req.user));
}));

router.post('/:id/meals', run(async (req, res) => {
  await ev.addMeal(req.propertyId, req.params.id, req.body || {}, req.user);
  res.status(201).json({ ok: true });
}));
router.put('/:id/meals/:mealId', run(async (req, res) => {
  await ev.updateMeal(req.propertyId, req.params.id, req.params.mealId, req.body || {}, req.user);
  res.json({ ok: true });
}));
router.delete('/:id/meals/:mealId', run(async (req, res) => {
  await ev.cancelMeal(req.propertyId, req.params.id, req.params.mealId, req.user);
  res.json({ ok: true });
}));

router.post('/:id/payments', run(async (req, res) => {
  res.status(201).json({ id: await ev.recordPayment(req.propertyId, req.params.id, req.body || {}, req.user) });
}));
router.delete('/:id/payments/:paymentId', run(async (req, res) => {
  await ev.voidPayment(req.propertyId, req.params.id, req.params.paymentId, req.body, req.user);
  res.json({ ok: true });
}));
router.get('/:id/refundable', run(async (req, res) => {
  const r = await ev.refundable(req.propertyId, req.params.id);
  if (found(res, r)) res.json(r);
}));
router.post('/:id/refund', run(async (req, res) => {
  await ev.refund(req.propertyId, req.params.id, req.body || {}, req.user);
  res.status(201).json({ ok: true });
}));

// ── PDFs ─────────────────────────────────────────────────────────
async function propertyFor(propertyId) {
  const { rows: [p] } = await db.query(
    `SELECT property_name, property_address, property_phone, property_email, logo_url, show_tax_breakdown
     FROM property_settings WHERE property_id = $1`, [propertyId]);
  return p || {};
}

function billPdf(title, slug) {
  return run(async (req, res) => {
    const bill = await ev.eventBill(req.propertyId, req.params.id);
    if (!found(res, bill)) return;
    const [property, group] = await Promise.all([propertyFor(req.propertyId), ev.linkedGroup(req.propertyId, bill.event.reservation_group_id)]);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="event-${bill.event.event_no}-${slug}.pdf"`);
    doc.pipe(res);
    drawDocumentHeader(doc, property, { title, refLine: `Event #${bill.event.event_no}` });
    renderEventBill(doc, { bill, group, showBreakdown: !!property.show_tax_breakdown, proforma: slug === 'proforma' });
    doc.end();
  });
}
router.get('/:id/proforma', billPdf('Pro Forma Invoice', 'proforma'));
router.get('/:id/invoice', billPdf('Invoice', 'invoice'));

router.get('/:id/function-sheet', run(async (req, res) => {
  const e = await ev.getEvent(req.propertyId, req.params.id);
  if (!found(res, e)) return;
  const [property, meals, group] = await Promise.all([propertyFor(req.propertyId), ev.listMeals(e.id), ev.linkedGroup(req.propertyId, e.reservation_group_id)]);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="event-${e.event_no}-function-sheet.pdf"`);
  doc.pipe(res);
  drawDocumentHeader(doc, property, { title: 'Function Sheet', refLine: `Event #${e.event_no}` });
  renderFunctionSheet(doc, { event: e, meals, group });
  doc.end();
}));

module.exports = router;
