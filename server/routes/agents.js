const router = require('express').Router();
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const svc = require('../services/agentStatementService');
const { renderAgentInvoice } = require('../services/agentInvoicePdf');

// Agent Accounts / Direct Billing — Slice C. Mounted at /api/agents behind
// auth + moduleGuard('financial') in server/index.js; owner-only per handler.
const ownerOnly = [auth, requireRole('owner')];

// AR aging — one row per agent source
router.get('/', ownerOnly, async (req, res) => {
  try {
    res.json(await svc.aging(req.propertyId, {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full statement for one agent
router.get('/:sourceId', ownerOnly, async (req, res) => {
  try {
    const data = await svc.statement(req.propertyId, req.params.sourceId);
    if (!data) return res.status(404).json({ error: 'Agent not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sourceId/payments', ownerOnly, async (req, res) => {
  try {
    const result = await svc.recordPayment(req.propertyId, req.params.sourceId, req.body, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/payments/:paymentId', ownerOnly, async (req, res) => {
  try {
    const result = await svc.updatePayment(req.propertyId, req.params.paymentId, req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/payments/:paymentId', ownerOnly, async (req, res) => {
  try {
    const result = await svc.voidPayment(req.propertyId, req.params.paymentId);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sourceId/invoices', ownerOnly, async (req, res) => {
  try {
    const result = await svc.createInvoice(req.propertyId, req.params.sourceId, req.body, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/:invoiceId/pdf', ownerOnly, async (req, res) => {
  try {
    const payload = await svc.invoicePayload(req.propertyId, req.params.invoiceId);
    if (!payload) return res.status(404).json({ error: 'Invoice not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payload.invoice.invoice_number}.pdf"`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    renderAgentInvoice(doc, payload);
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.patch('/commissions/:commissionId', ownerOnly, async (req, res) => {
  try {
    const result = await svc.setCommissionStatus(req.propertyId, req.params.commissionId, req.body.status);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
