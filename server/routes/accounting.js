// Accounting, step 1 (migration 101) — /api/accounting
//   GET  /setup                 chart of accounts + which account each item goes to
//   POST /accounts              add an account
//   PUT  /accounts/:id          rename / renumber / switch off an account
//   PUT  /map                   { map: { key: account_id | null } }
//   GET  /journal?from=&to=     the daily journal (JSON)
//   GET  /journal/xlsx?from=&to= the same as an Excel workbook
//   GET  /closing               closed through + corrections waiting
//   POST /closing               { through, start? } close days
//   DELETE /closing/last        open the last closed day again (owner)
// Owner, or the `accounting` permission (an accountant's login).
const router = require('express').Router();
const db = require('../db');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const accounting = require('../services/accountingService');
const requireRole = require('../middleware/role');
const { buildJournal, closingStatus, closeDays, reopenLastDay } = require('../services/journalService');
const { todayWITA } = require('../services/roomChargeService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(requireOwnerOrMenu('accounting'));

router.get('/setup', async (req, res) => {
  try {
    const m = await accounting.loadMapping(req.propertyId);
    res.json({
      accounts: m.accounts,
      types: accounting.TYPES,
      items: m.keys.map(k => ({ key: k.key, label: k.label, group: k.group, account_id: k.account_id, is_default: k.is_default })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const r = await accounting.createAccount(req.propertyId, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.status(201).json(r.account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Account not found' });
  try {
    const r = await accounting.updateAccount(req.propertyId, req.params.id, req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r.account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/map', async (req, res) => {
  const map = req.body?.map;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return res.status(400).json({ error: 'Nothing to save' });
  try {
    const r = await accounting.saveMapping(req.propertyId, map, req.user.userId || req.user.id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function period(req, res) {
  const from = String(req.query.from || todayWITA());
  const to = String(req.query.to || from);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' }); return null;
  }
  if (to < from) { res.status(400).json({ error: 'to must be on or after from' }); return null; }
  return { from, to };
}

router.get('/journal', async (req, res) => {
  const p = period(req, res);
  if (!p) return;
  try {
    const j = await buildJournal(req.propertyId, p.from, p.to);
    if (j.error) return res.status(400).json({ error: j.error });
    res.json(j);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Closing days (migration 102): how far the books are closed + corrections
// to closed days waiting for the next close.
router.get('/closing', async (req, res) => {
  try {
    res.json({ ...(await closingStatus(req.propertyId)), today: todayWITA() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// { through, start? } — closes every open day up to `through` (yesterday at
// the latest). `start` = the first day of the books, the first time only.
router.post('/closing', async (req, res) => {
  const through = String(req.body?.through || '');
  const start = req.body?.start ? String(req.body.start) : null;
  if (!DATE_RE.test(through) || isNaN(Date.parse(through)) || (start && (!DATE_RE.test(start) || isNaN(Date.parse(start))))) {
    return res.status(400).json({ error: 'Choose the day to close up to' });
  }
  try {
    const r = await closeDays(req.propertyId, through, req.user.id, { start, today: todayWITA() });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Opens the last closed day again. Owner only.
router.delete('/closing/last', requireRole('owner'), async (req, res) => {
  try {
    const r = await reopenLastDay(req.propertyId);
    if (r.error) return res.status(409).json({ error: r.error });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/journal/xlsx', async (req, res) => {
  const p = period(req, res);
  if (!p) return;
  try {
    const { buildJournalXlsx } = require('../services/journalXlsx');
    const [j, { rows: [prop] }] = await Promise.all([
      buildJournal(req.propertyId, p.from, p.to, { withDetail: true }),
      db.query(`SELECT COALESCE(NULLIF(ps.property_name, ''), pr.name) AS name
                FROM properties pr LEFT JOIN property_settings ps ON ps.property_id = pr.id WHERE pr.id = $1`, [req.propertyId]),
    ]);
    if (j.error) return res.status(400).json({ error: j.error });
    const buf = await buildJournalXlsx(j, { propertyName: prop?.name });
    const label = p.from === p.to ? p.from : `${p.from}_to_${p.to}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="journal-${label}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
