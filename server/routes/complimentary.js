const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const comp = require('../services/complimentaryService');

// Complimentary stays — mounted at /api/bookings (reservations module), see
// services/complimentaryService.js. Owner / `grant_complimentary` apply
// directly; anyone else asks for approval — the approver taps Approve on
// Telegram, or reads out the code in the same message for front desk to type.
const PERMISSION = 'grant_complimentary';
const canGrant = user => user?.role === 'owner'
  || (Array.isArray(user?.allowed_menus) && user.allowed_menus.includes(PERMISSION));

function readBody(body) {
  const scope = String(body.scope || '');
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!comp.SCOPES[scope]) return { error: 'Choose what is free: room, room + meals, or everything' };
  if (!reason) return { error: 'A reason is required' };
  return { scope, reason };
}

// GET /api/bookings/:id/complimentary — what each option does, whether this
// user can grant it directly, and any request waiting for a code.
router.get('/:id/complimentary', auth, async (req, res) => {
  try {
    const { rows: [b] } = await db.query(
      'SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    const [q, pending, list, latest] = await Promise.all([
      comp.quote(db, req.propertyId, b),
      comp.pendingRequest(b.id),
      comp.approvers(req.propertyId),
      comp.latestRequest(b.id),
    ]);
    res.json({
      ...q,
      can_grant: canGrant(req.user),
      blocked: comp.blockReason(b),
      pending_request: comp.requestJson(pending),
      // Watched by the screen while waiting: approved / declined on Telegram.
      latest_request: latest,
      complimentary_scope: b.complimentary_scope,
      approvers: list.map(a => a.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/complimentary { scope, reason } — owner / permission.
router.post('/:id/complimentary', auth, requireOwnerOrMenu(PERMISSION), async (req, res) => {
  const body = readBody(req.body);
  if (body.error) return res.status(400).json({ error: body.error });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]);
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const result = await comp.applyComp(client, {
      propertyId: req.propertyId, before, ...body, userId: req.user.id, approvedByName: req.user.name,
    });
    if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json({ error: result.error }); }
    await client.query(
      "UPDATE complimentary_requests SET status = 'cancelled' WHERE booking_id = $1 AND status = 'pending'", [before.id]);
    await client.query('COMMIT');
    comp.notifyOwner(req.propertyId, before.id, req.user.id, { ...body, ...result });
    res.json({ new_total: result.payable, value_net: result.value_net, credit: result.credit });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/:id/complimentary/request { scope, reason } — any staff.
router.post('/:id/complimentary/request', auth, async (req, res) => {
  const body = readBody(req.body);
  if (body.error) return res.status(400).json({ error: body.error });
  try {
    const result = await comp.requestApproval({ propertyId: req.propertyId, bookingId: req.params.id, ...body, user: req.user });
    if (result.error) return res.status(result.status).json({ error: result.error, code: result.code });
    res.status(201).json(result.request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/complimentary/approve { request_id, code }
router.post('/:id/complimentary/approve', auth, async (req, res) => {
  try {
    const result = await comp.approveWithCode({
      propertyId: req.propertyId, bookingId: req.params.id,
      requestId: req.body.request_id, code: req.body.code,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error, code: result.code, attempts_left: result.attempts_left });
    }
    res.json({ new_total: result.payable, value_net: result.value_net, credit: result.credit, approved_by: result.approved_by });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id/complimentary/request — withdraw the ask.
router.delete('/:id/complimentary/request', auth, async (req, res) => {
  try {
    await comp.cancelRequest(req.propertyId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id/complimentary { reason } — undo (owner / permission).
router.delete('/:id/complimentary', auth, requireOwnerOrMenu(PERMISSION), async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [req.params.id, req.propertyId]);
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const result = await comp.removeComp(client, { propertyId: req.propertyId, before, reason, userId: req.user.id });
    if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json({ error: result.error }); }
    await client.query('COMMIT');
    res.json({ new_total: result.payable });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
