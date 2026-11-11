// Vouchers (migration 167, VOUCHERS_PLAN.md). Mounted at /api/vouchers behind
// auth + moduleGuard('vouchers') + the `vouchers` permission (owner always).
//   GET  /templates                       voucher types (active; ?all=1 owner)
//   POST /templates · PUT /templates/:id  owner
//   GET  /?q=&status=                     vouchers sold
//   GET  /report?from=&to=                outstanding, sold / used / expired, expiring, ledger check
//   POST /                                sell { template_id, buyer_guest_id | buyer_name…, recipient_name, payment_method, received_on, reference }
//   GET  /:id · GET /:id/pdf
//   POST /:id/void { reason, refund_amount?, refund_method? } · POST /:id/extend { expires_on, reason }   owner or `corrections`
const router = require('express').Router();
const db = require('../db');
const requireRole = require('../middleware/role');
const svc = require('../services/voucherService');
const freeApproval = require('../services/voucherFreeApproval');
const { renderVoucherPdf } = require('../services/voucherPdf');

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
const send = (res, r, ok = 200) => (r && r.error ? res.status(r.status || 400).json({ error: r.error, code: r.code }) : res.status(ok).json(r));
const canException = req => req.user.role === 'owner' || (Array.isArray(req.user.allowed_menus) && req.user.allowed_menus.includes('corrections'));
const exceptionOnly = (req, res, next) => (canException(req) ? next() : res.status(403).json({ error: 'Only the owner or staff with the Corrections permission can do this' }));

router.get('/templates', wrap(async (req, res) => res.json(await svc.listTemplates(req.propertyId, { all: req.user.role === 'owner' && req.query.all === '1' }))));
router.post('/templates', requireRole('owner'), wrap(async (req, res) => send(res, await svc.saveTemplate(req.propertyId, req.body || {}), 201)));
router.put('/templates/:id', requireRole('owner'), wrap(async (req, res) => send(res, await svc.saveTemplate(req.propertyId, req.body || {}, req.params.id))));

router.get('/', wrap(async (req, res) => res.json(await svc.list(req.propertyId, req.query))));
router.get('/report', wrap(async (req, res) => res.json(await svc.report(req.propertyId, req.query))));
// A free voucher (migration 168): given at once by the owner / the Complimentary permission (201),
// otherwise asked on Telegram and waiting for an approver (202 + the request to watch).
router.post('/', wrap(async (req, res) => {
  if (req.body?.free) {
    const r = await svc.sellFree(req.propertyId, req.body, req.user);
    return r.error ? send(res, r) : res.status(r.request ? 202 : 201).json(r);
  }
  return send(res, await svc.sell(req.propertyId, req.body || {}, req.user.id), 201);
}));
router.get('/free-requests', wrap(async (req, res) => res.json(await freeApproval.listOpen(req.propertyId))));
router.get('/free-requests/:id', wrap(async (req, res) => {
  const r = await freeApproval.getRequest(req.propertyId, req.params.id);
  return r ? res.json(r) : res.status(404).json({ error: 'Request not found' });
}));
router.post('/free-requests/:id/cancel', wrap(async (req, res) => send(res, await freeApproval.cancel(req.propertyId, req.params.id, req.user))));

router.get('/:id', wrap(async (req, res) => {
  const v = await svc.detail(req.propertyId, req.params.id);
  return v ? res.json(v) : res.status(404).json({ error: 'Voucher not found' });
}));

router.get('/:id/pdf', wrap(async (req, res) => {
  const v = await svc.detail(req.propertyId, req.params.id);
  if (!v) return res.status(404).json({ error: 'Voucher not found' });
  if (v.status === 'voided') return res.status(409).json({ error: 'This voucher was cancelled.' });
  const { rows: [property] } = await db.query(
    `SELECT property_name, property_address, property_phone, property_email, logo_url, app_color FROM property_settings WHERE property_id = $1`, [req.propertyId]);
  await renderVoucherPdf(res, { property: property || {}, voucher: v, filename: `voucher-${v.voucher_label}.pdf` });
}));

router.post('/:id/void', exceptionOnly, wrap(async (req, res) => send(res, await svc.voidVoucher(req.propertyId, req.params.id, req.body || {}, req.user.id))));
router.post('/:id/extend', exceptionOnly, wrap(async (req, res) => send(res, await svc.extend(req.propertyId, req.params.id, req.body || {}, req.user.id))));

module.exports = router;
