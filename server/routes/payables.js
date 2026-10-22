// Finance → Payables (migration 129): supplier bills, payments to suppliers,
// what the hotel owes. Owner or the `payables` permission; needs the
// `accounting` module (bill lines are accounts of the chart). Logic in
// services/payablesService.js.
const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const svc = require('../services/payablesService');

router.use(requireOwnerOrMenu('payables'));

const send = (res, r, ok = 200) => r && r.error
  ? res.status(r.status || 400).json({ error: r.error, code: r.code })
  : res.status(ok).json(r);
const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (err) { console.error('[payables]', err); res.status(500).json({ error: err.message }); }
};

router.get('/setup', wrap(async (req, res) => res.json(await svc.setup(req.propertyId))));
router.get('/summary', wrap(async (req, res) => res.json(await svc.summary(req.propertyId))));

router.post('/suppliers', wrap(async (req, res) => send(res, await svc.saveSupplier(req.propertyId, req.body || {}), 201)));
router.put('/suppliers/:id', wrap(async (req, res) => send(res, await svc.saveSupplier(req.propertyId, req.body || {}, req.params.id))));

router.get('/bills', wrap(async (req, res) => res.json(await svc.listBills(req.propertyId, req.query))));
router.get('/bills/:id', wrap(async (req, res) => {
  const bill = await svc.getBill(req.propertyId, req.params.id);
  bill ? res.json(bill) : res.status(404).json({ error: 'Bill not found' });
}));
router.post('/bills', wrap(async (req, res) => send(res, await svc.createBill(req.propertyId, req.body || {}, req.user.id), 201)));
router.put('/bills/:id', wrap(async (req, res) => send(res, await svc.updateBill(req.propertyId, req.params.id, req.body || {}))));
router.post('/bills/:id/void', wrap(async (req, res) => send(res, await svc.voidBill(req.propertyId, req.params.id, req.body?.reason, req.user.id))));

router.get('/from-po/:poId', wrap(async (req, res) => send(res, await svc.fromPurchaseOrder(req.propertyId, req.params.poId))));

router.get('/payments', wrap(async (req, res) => res.json(await svc.listPayments(req.propertyId, req.query))));
router.post('/payments', wrap(async (req, res) => send(res, await svc.recordPayment(req.propertyId, req.body || {}, req.user.id), 201)));
router.post('/payments/:id/void', wrap(async (req, res) => send(res, await svc.voidPayment(req.propertyId, req.params.id, req.body?.reason, req.user.id))));

module.exports = router;
