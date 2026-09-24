const router = require('express').Router();
const db = require('../db');
const svc = require('../services/smartReports');
const telegram = require('../services/telegramService');
const telegramLink = require('../services/telegramLink');

// /api/smart-reports — Settings → Reports & Alerts (migration 068). Mounted in
// index.js behind auth + owner only, NOT a module guard: the instant Telegram
// alerts are free for every property; the scheduled reports need the paid
// `smart_reports` module, checked per report (svc.reportAllowed).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAT_ID_RE = /^-?\d{3,20}$/;   // Telegram chat IDs: numeric, groups negative

function validate(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required' };
    out.name = name.slice(0, 100);
  }
  if (!partial || body.channel !== undefined) {
    if (!['email', 'telegram'].includes(body.channel)) return { error: 'Channel must be email or telegram' };
    out.channel = body.channel;
  }
  if (!partial || body.address !== undefined) {
    out.address = String(body.address || '').trim() || null;
  }
  if (body.role !== undefined || !partial) {
    const role = body.role || 'other';
    if (!svc.ROLES.includes(role)) return { error: 'Unknown role' };
    out.role = role;
  }
  if (body.reports !== undefined) {
    if (!Array.isArray(body.reports) || body.reports.some(r => !svc.REPORTS[r])) return { error: 'Unknown report' };
    out.reports = [...new Set(body.reports)];
  }
  if (body.is_active !== undefined) out.is_active = !!body.is_active;
  return { value: out };
}

// A Telegram recipient may have no address yet: they connect themselves
// through the Connect link (services/telegramLink.js).
function checkAddress(channel, address, { linkPending = false } = {}) {
  if (!address) {
    if (channel === 'telegram' && linkPending) return null;
    return channel === 'email' ? 'Email address is required' : 'Telegram Chat ID is required';
  }
  if (channel === 'email' && !EMAIL_RE.test(address)) return 'That is not a valid email address';
  if (channel === 'telegram' && !CHAT_ID_RE.test(address)) return 'A Telegram Chat ID is a number (e.g. 123456789, or -100… for a group)';
  return null;
}

// Adds the Connect-link state for the settings page.
async function decorate(r) {
  const pending = !!(r.link_token && r.link_expires_at && new Date(r.link_expires_at) > new Date());
  const { link_token, ...rest } = r;
  return {
    ...rest,
    link_pending: pending,
    link_expired: !!(r.link_token && !pending),
    connect_urls: pending ? await telegramLink.connectUrls(r.property_id, link_token) : null,
  };
}

router.get('/catalog', async (req, res) => {
  res.json({
    telegram_bot: await telegram.getBotUsername(await telegram.botTokenFor(req.propertyId)),
    module_enabled: await svc.isModuleEnabled(req.propertyId),
    reports: Object.entries(svc.REPORTS).map(([key, r]) => ({
      key, type: r.type, label: r.label, when: r.when, description: r.description,
      default_roles: r.defaultRoles, channels: r.channels, paid: r.paid,
    })),
    roles: svc.ROLES,
  });
});

router.get('/recipients', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM notification_recipients WHERE property_id = $1 ORDER BY created_at',
      [req.propertyId]
    );
    res.json(await Promise.all(rows.map(decorate)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recipients', async (req, res) => {
  const { value, error } = validate(req.body);
  if (error) return res.status(400).json({ error });
  // Telegram without a Chat ID → a Connect link the person opens themselves.
  const useLink = value.channel === 'telegram' && !value.address;
  const addrErr = checkAddress(value.channel, value.address, { linkPending: useLink });
  if (addrErr) return res.status(400).json({ error: addrErr });
  const moduleEnabled = await svc.isModuleEnabled(req.propertyId);
  for (const key of value.reports || []) {
    const allowed = svc.reportAllowed(key, { channel: value.channel, moduleEnabled });
    if (allowed.error) return res.status(400).json({ error: allowed.error });
  }
  const reports = value.reports ?? svc.defaultReportsFor(value.role, { channel: value.channel, moduleEnabled });
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO notification_recipients
         (property_id, name, channel, address, role, reports, created_by, link_token, link_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.propertyId, value.name, value.channel, value.address, value.role, reports, req.user.id,
       useLink ? telegramLink.newToken() : null, useLink ? telegramLink.linkExpiry() : null]
    );
    if (useLink) telegramLink.ensurePolling();
    res.status(201).json(await decorate(row));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This recipient is already on the list' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/recipients/:id', async (req, res) => {
  const { value, error } = validate(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  try {
    const { rows: [current] } = await db.query(
      'SELECT * FROM notification_recipients WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!current) return res.status(404).json({ error: 'Recipient not found' });
    const next = { ...current, ...value };
    // Only newly ticked reports are checked, so pausing a recipient still
    // works after the add-on was switched off. Changing the channel drops
    // reports the new channel can't carry (alerts are Telegram only).
    const moduleEnabled = await svc.isModuleEnabled(req.propertyId);
    if (value.reports) {
      for (const key of value.reports.filter(k => !current.reports.includes(k))) {
        const allowed = svc.reportAllowed(key, { channel: next.channel, moduleEnabled });
        if (allowed.error) return res.status(400).json({ error: allowed.error });
      }
    }
    if (next.channel !== current.channel) {
      next.reports = next.reports.filter(k => svc.REPORTS[k]?.channels.includes(next.channel));
    }
    const linkPending = !!(current.link_token && new Date(current.link_expires_at) > new Date());
    const addrErr = checkAddress(next.channel, next.address, { linkPending });
    if (addrErr) return res.status(400).json({ error: addrErr });
    const { rows: [row] } = await db.query(
      `UPDATE notification_recipients
       SET name = $1, channel = $2, address = $3, role = $4, reports = $5, is_active = $6, updated_at = NOW()
       WHERE id = $7 AND property_id = $8 RETURNING *`,
      [next.name, next.channel, next.address, next.role, next.reports, next.is_active, req.params.id, req.propertyId]
    );
    res.json(await decorate(row));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This recipient is already on the list' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/recipients/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM notification_recipients WHERE id = $1 AND property_id = $2 RETURNING id',
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Recipient not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telegram bot ─────────────────────────────────────────────────────────────
// The property's own bot (property_settings.telegram_bot_token) or, when it
// has none, the platform bot. The token itself is never sent to the browser.

async function botStatus(propertyId) {
  const { rows: [ps] } = await db.query(
    'SELECT telegram_bot_token FROM property_settings WHERE property_id = $1', [propertyId]
  );
  const own = ps?.telegram_bot_token || null;
  const platform = process.env.TELEGRAM_BOT_TOKEN || null;
  return {
    own: !!own,
    own_username: own ? await telegram.getBotUsername(own) : null,
    own_hint: own ? `…${own.slice(-4)}` : null,
    platform_username: platform ? await telegram.getBotUsername(platform) : null,
  };
}

// A new bot can't message anyone who pressed Start on the old one, so
// changing bots sends every Telegram recipient a fresh Connect link.
async function reconnectAllTelegram(client, propertyId) {
  const { rows } = await client.query(
    "SELECT id FROM notification_recipients WHERE property_id = $1 AND channel = 'telegram'",
    [propertyId]
  );
  for (const { id } of rows) {
    await client.query(
      `UPDATE notification_recipients
       SET address = NULL, telegram_name = NULL, link_token = $1, link_expires_at = $2,
           last_error = NULL, updated_at = NOW()
       WHERE id = $3`,
      [telegramLink.newToken(), telegramLink.linkExpiry(), id]
    );
  }
  return rows.length;
}

router.get('/bot', async (req, res) => {
  try {
    res.json(await botStatus(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function setBot(req, res, token) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [ps] } = await client.query(
      'SELECT telegram_bot_token FROM property_settings WHERE property_id = $1 FOR UPDATE', [req.propertyId]
    );
    if (!ps) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Property settings not found' }); }
    const before = ps.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null;
    const after = token || process.env.TELEGRAM_BOT_TOKEN || null;
    await client.query(
      'UPDATE property_settings SET telegram_bot_token = $1 WHERE property_id = $2', [token, req.propertyId]
    );
    const reconnect = before !== after ? await reconnectAllTelegram(client, req.propertyId) : 0;
    await client.query('COMMIT');
    telegramLink.ensurePolling();
    res.json({ ...(await botStatus(req.propertyId)), reconnect });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'This bot is already used by another property. Create a new bot in @BotFather for this hotel.' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// PUT /bot { token } — use this property's own bot.
router.put('/bot', async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return res.status(400).json({ error: 'That doesn\'t look like a bot token — it looks like 1234567890:AAH…, copied from @BotFather' });
  }
  const check = await telegram.checkBotToken(token);
  if (check.error) return res.status(400).json({ error: check.error });
  return setBot(req, res, token);
});

// DELETE /bot — stop using an own bot (back to the platform bot, if any).
router.delete('/bot', (req, res) => setBot(req, res, null));

// POST /recipients/:id/link — a fresh Connect link for a Telegram recipient
// (first time, expired, or to move them to another phone/group). Their
// current chat keeps receiving reports until the new link is used.
router.post('/recipients/:id/link', async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE notification_recipients
       SET link_token = $1, link_expires_at = $2, updated_at = NOW()
       WHERE id = $3 AND property_id = $4 AND channel = 'telegram' RETURNING *`,
      [telegramLink.newToken(), telegramLink.linkExpiry(), req.params.id, req.propertyId]
    );
    if (!row) return res.status(404).json({ error: 'Telegram recipient not found' });
    telegramLink.ensurePolling();
    res.json(await decorate(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /recipients/:id/test { report } — send that report to this recipient
// right now, with today's real figures.
router.post('/recipients/:id/test', async (req, res) => {
  const report = req.body.report || 'morning_brief';
  if (!svc.REPORTS[report]) return res.status(400).json({ error: 'Unknown report' });
  try {
    if (svc.REPORTS[report].paid && !(await svc.isModuleEnabled(req.propertyId))) {
      return res.status(400).json({ error: `${svc.REPORTS[report].label} is part of the Smart Reports add-on, which isn't enabled for this property` });
    }
    const results = await svc.sendReport(req.propertyId, report, { recipientIds: [req.params.id] });
    if (!results.length) return res.status(404).json({ error: 'Recipient not found' });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /preview/:report — what the report would say right now (both channels).
router.get('/preview/:report', async (req, res) => {
  try {
    const preview = await svc.renderPreview(req.propertyId, req.params.report);
    if (!preview) return res.status(404).json({ error: 'Unknown report' });
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
