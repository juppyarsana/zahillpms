const router = require('express').Router();
const db = require('../db');
const proformaFooter = require('../services/proformaFooter');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const modules = require('../modules');
const agentBilling = require('../services/agentBillingService');
const taxChangeService = require('../services/taxChangeService');

const ownerOnly = [auth, requireRole('owner')];

// ── Modules ───────────────────────────────────────────────────────────────

router.get('/modules', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT module, is_enabled FROM property_modules WHERE property_id = $1',
      [req.propertyId]
    );
    const enabledByModule = {};
    for (const r of rows) enabledByModule[r.module] = r.is_enabled;

    const result = {};
    for (const [key, def] of Object.entries(modules)) {
      result[key] = { label: def.label, is_enabled: enabledByModule[key] ?? false };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Display Token (Room Display / TV Display device provisioning) ───────────

router.get('/display-token', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT display_token FROM properties WHERE id = $1', [req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json({ display_token: rows[0].display_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POS API key (external POS integration, migration 070) ───────────────────
// Unlike display_token this one can be regenerated: it lives in third-party
// software and must be rotatable if it leaks. Regenerating breaks the POS
// until the new key is pasted into it.

router.get('/pos-api-key', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT pos_api_key FROM properties WHERE id = $1', [req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json({ pos_api_key: rows[0].pos_api_key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pos-api-key/regenerate', ownerOnly, async (req, res) => {
  try {
    const key = require('crypto').randomBytes(32).toString('hex');
    const { rows } = await db.query(
      'UPDATE properties SET pos_api_key = $1 WHERE id = $2 RETURNING pos_api_key',
      [key, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json({ pos_api_key: rows[0].pos_api_key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Room tablet orders through the POS (migration 094) ──────────────────────
// The POS's address + the key the POS made for the hotel (POS Setup → Room
// service). The key is write-only: only its last 4 characters come back.
router.get('/pos-room-orders', ownerOnly, async (req, res) => {
  try {
    const { rows: [p] } = await db.query('SELECT pos_url, pos_hotel_key FROM properties WHERE id = $1', [req.propertyId]);
    if (!p) return res.status(404).json({ error: 'Property not found' });
    res.json({ url: p.pos_url || '', key_set: !!p.pos_hotel_key, key_last4: p.pos_hotel_key ? p.pos_hotel_key.slice(-4) : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT { url, key? } — empty key keeps the saved one; { clear: true } unlinks.
router.put('/pos-room-orders', ownerOnly, async (req, res) => {
  try {
    if (req.body?.clear) {
      await db.query('UPDATE properties SET pos_url = NULL, pos_hotel_key = NULL WHERE id = $1', [req.propertyId]);
      return res.json({ url: '', key_set: false, key_last4: '' });
    }
    const url = String(req.body?.url || '').trim().replace(/\/+$/, '');
    const key = String(req.body?.key || '').trim();
    if (!/^https?:\/\/[^\s/]+/i.test(url)) return res.status(400).json({ error: 'The POS address must start with http:// or https://' });
    if (key && key.length < 16) return res.status(400).json({ error: 'That key looks too short — copy it again from the POS' });
    const { rows: [p] } = await db.query(
      `UPDATE properties SET pos_url = $1, pos_hotel_key = COALESCE(NULLIF($2, ''), pos_hotel_key)
       WHERE id = $3 RETURNING pos_url, pos_hotel_key`, [url, key, req.propertyId]);
    if (!p.pos_hotel_key) return res.status(400).json({ error: 'Paste the key from the POS (Setup → Room service → Key for the hotel)' });
    res.json({ url: p.pos_url, key_set: true, key_last4: p.pos_hotel_key.slice(-4) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST { url?, key? } — try the link (typed values, else the saved ones).
router.post('/pos-room-orders/test', ownerOnly, async (req, res) => {
  const posRoomOrders = require('../services/posRoomOrders');
  try {
    const { rows: [p] } = await db.query('SELECT pos_url, pos_hotel_key FROM properties WHERE id = $1', [req.propertyId]);
    const url = String(req.body?.url || '').trim() || p?.pos_url || '';
    const key = String(req.body?.key || '').trim() || p?.pos_hotel_key || '';
    res.json(await posRoomOrders.test(url, key));
  } catch (err) {
    res.status(err.status && err.status < 600 ? (err.status === 503 ? 400 : err.status) : 500).json({ error: err.message });
  }
});

// ── Property Details & Tax Config ────────────────────────────────────────────

const PROPERTY_FIELDS = `tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown, property_name, property_address, property_phone, property_email,
        smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, registration_notice, birthday_offer`;

router.get('/property', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${PROPERTY_FIELDS} FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property settings not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/property', ownerOnly, async (req, res) => {
  const {
    tax_rate, service_charge_rate, property_name, property_address, property_phone, property_email,
    smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, registration_notice, birthday_offer,
  } = req.body;
  // A From header needs an actual email address (bare, or "Display Name" <addr>) — a
  // plain display name with no address is invalid RFC 5322 and every mail server
  // rejects it at send time (caught live: Titan Email 550 5.7.1 "Invalid From address").
  if (smtp_from && !/[^\s<>]+@[^\s<>]+\.[^\s<>]+/.test(smtp_from)) {
    return res.status(400).json({ error: 'From Address must include an email address, e.g. "Zahill Resort" <info@zahill.com>' });
  }
  try {
    // Service charge / tax go through PUT /tax, which keeps open bookings'
    // prices (taxChangeService) — refuse a change here so nothing skips that.
    if (tax_rate !== undefined || service_charge_rate !== undefined) {
      const { rows: [cur] } = await db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [req.propertyId]);
      const differs = (v, c) => v !== undefined && v !== null && v !== '' && parseFloat(v) !== parseFloat(c);
      if (cur && (differs(tax_rate, cur.tax_rate) || differs(service_charge_rate, cur.service_charge_rate))) {
        return res.status(400).json({ error: 'Change service charge and tax in the "Service charge & tax" card', code: 'USE_TAX_SETTINGS' });
      }
    }
    const { rows } = await db.query(
      `UPDATE property_settings SET
        tax_rate            = COALESCE($1, tax_rate),
        service_charge_rate = COALESCE($2, service_charge_rate),
        property_name       = COALESCE($3, property_name),
        property_address    = COALESCE($4, property_address),
        property_phone      = COALESCE($5, property_phone),
        property_email      = COALESCE($6, property_email),
        smtp_host           = COALESCE($7, smtp_host),
        smtp_port           = COALESCE($8, smtp_port),
        smtp_user           = COALESCE($9, smtp_user),
        smtp_password       = COALESCE($10, smtp_password),
        smtp_from           = COALESCE($11, smtp_from),
        registration_notice = COALESCE($13, registration_notice),
        birthday_offer      = COALESCE($14, birthday_offer)
       WHERE property_id = $12
       RETURNING ${PROPERTY_FIELDS}`,
      [
        tax_rate ?? null, service_charge_rate ?? null, property_name ?? null, property_address ?? null, property_phone ?? null, property_email ?? null,
        smtp_host ?? null, smtp_port ?? null, smtp_user ?? null, smtp_password ?? null, smtp_from ?? null,
        req.propertyId, registration_notice ?? null,
        birthday_offer === undefined ? null : String(birthday_offer).trim().slice(0, 500),
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property settings not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pro forma invoice footer (migration 092) ────────────────────────────────
// Payment terms, bank account and signature lines printed on the pro forma.
const EMPTY_FOOTER = { terms: '', bank: {}, signers: [] };

router.get('/proforma-footer', ownerOnly, async (req, res) => {
  try {
    res.json(await proformaFooter.load(req.propertyId) || EMPTY_FOOTER);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proforma-footer', ownerOnly, async (req, res) => {
  try {
    res.json(await proformaFooter.save(req.propertyId, req.body) || EMPTY_FOOTER);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Service charge & tax (migration 079) ────────────────────────────────────
// GET  /tax/preview?tax_rate=&service_charge_rate= — what a change would touch
// PUT  /tax { tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown } — saves it
//      and re-splits open bookings so each guest's price stays as agreed
//      (services/taxChangeService.js).
function parseRate(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : NaN;
}

router.get('/tax/preview', ownerOnly, async (req, res) => {
  const tax_rate = parseRate(req.query.tax_rate), service_charge_rate = parseRate(req.query.service_charge_rate);
  if (Number.isNaN(tax_rate) || Number.isNaN(service_charge_rate)) return res.status(400).json({ error: 'Rates must be between 0 and 100' });
  try {
    res.json(await taxChangeService.preview(req.propertyId, { tax_rate, service_charge_rate }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tax', ownerOnly, async (req, res) => {
  const tax_rate = parseRate(req.body.tax_rate), service_charge_rate = parseRate(req.body.service_charge_rate);
  if (Number.isNaN(tax_rate) || Number.isNaN(service_charge_rate)) return res.status(400).json({ error: 'Rates must be between 0 and 100' });
  const { prices_include_tax, show_tax_breakdown } = req.body;
  if ((prices_include_tax !== undefined && typeof prices_include_tax !== 'boolean')
      || (show_tax_breakdown !== undefined && typeof show_tax_breakdown !== 'boolean')) {
    return res.status(400).json({ error: 'prices_include_tax / show_tax_breakdown must be true or false' });
  }
  try {
    const r = await taxChangeService.apply(req.propertyId, { tax_rate, service_charge_rate, prices_include_tax, show_tax_breakdown }, req.user.id);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/branding — logo/name/color for the nav bar. Any
// authenticated staff role (not owner-only) since everyone sees the nav.
router.get('/branding', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COALESCE(property_name, (SELECT name FROM properties WHERE id = $1)) AS name,
              logo_url, brand_color,
              (SELECT slug FROM properties WHERE id = $1) AS slug, -- remembered on the device: login screen + installed app's name / icon
              market_area AS area, -- e.g. "Kintamani, Bali" (Dashboard subtitle, guest WhatsApp messages)
              birthday_offer, -- optional line in the birthday WhatsApp (Guests page)
              tax_rate, service_charge_rate, -- the Sales till shows tax on directly-paid extras
              prices_include_tax, -- prices entered incl. service & tax (migration 079)
              show_tax_breakdown  -- say what's inside an all-in total (080)
       FROM property_settings WHERE property_id = $1`,
      [req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property settings not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Booking Sources (also the per-property agent registry — see migration 041) ──

const SOURCE_TYPES = ['walkin', 'direct', 'booking_engine', 'ota', 'travel_agent', 'company', 'wholesaler'];
const PAYMENT_STATUSES = ['normal', 'city_ledger', 'city_ledger_payment', 'commission', 'commission_and_city_ledger'];
const COMMISSION_TYPES = ['percent', 'amount'];

// Normalises + validates the agent-billing fields shared by POST and PUT.
// Returns { values } on success or { error } with a 400 message.
function parseAgentFields(body) {
  const out = {};

  if (body.source_type !== undefined && body.source_type !== null && body.source_type !== '') {
    if (!SOURCE_TYPES.includes(body.source_type)) return { error: `source_type must be one of ${SOURCE_TYPES.join(', ')}` };
    out.source_type = body.source_type;
  }
  if (body.payment_status !== undefined && body.payment_status !== null && body.payment_status !== '') {
    if (!PAYMENT_STATUSES.includes(body.payment_status)) return { error: `payment_status must be one of ${PAYMENT_STATUSES.join(', ')}` };
    out.payment_status = body.payment_status;
  }
  if (body.commission_type !== undefined) {
    const v = body.commission_type === '' ? null : body.commission_type;
    if (v !== null && !COMMISSION_TYPES.includes(v)) return { error: `commission_type must be one of ${COMMISSION_TYPES.join(', ')}` };
    out.commission_type = v;
  }

  // Free-text fields: '' → null
  for (const f of ['billing_address', 'tax_id', 'contact_name', 'contact_email', 'contact_phone']) {
    if (body[f] !== undefined) out[f] = body[f] === '' || body[f] === null ? null : String(body[f]).trim();
  }

  // Numeric fields: '' → null, otherwise finite and >= 0
  if (body.credit_terms_days !== undefined) {
    if (body.credit_terms_days === '' || body.credit_terms_days === null) out.credit_terms_days = null;
    else {
      const n = parseInt(body.credit_terms_days, 10);
      if (!Number.isInteger(n) || n < 0) return { error: 'credit_terms_days must be a non-negative integer' };
      out.credit_terms_days = n;
    }
  }
  for (const f of ['credit_limit', 'commission_value']) {
    if (body[f] === undefined) continue;
    if (body[f] === '' || body[f] === null) { out[f] = null; continue; }
    const n = parseFloat(body[f]);
    if (!Number.isFinite(n) || n < 0) return { error: `${f} must be a non-negative number` };
    out[f] = n;
  }

  return { values: out };
}

router.get('/booking-sources', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM booking_sources WHERE property_id = $1 ORDER BY sort_order, id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/booking-sources', auth, async (req, res) => {
  const { id, label, is_ota, color, sort_order, publish_rate } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  const agent = parseAgentFields(req.body);
  if (agent.error) return res.status(400).json({ error: agent.error });

  const cols = ['id', 'label', 'is_ota', 'color', 'sort_order', 'property_id', 'publish_rate'];
  const vals = [id.toLowerCase().replace(/\s+/g, '_'), label, !!is_ota, color || '#6b7280', sort_order || 0, req.propertyId, publish_rate === false ? false : true];
  for (const [k, v] of Object.entries(agent.values)) { cols.push(k); vals.push(v); }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');

  try {
    const { rows } = await db.query(
      `INSERT INTO booking_sources (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A source with this ID already exists' : err.message,
    });
  }
});

router.put('/booking-sources/:id', auth, async (req, res) => {
  const { label, is_ota, color, is_active, sort_order, publish_rate } = req.body;
  const agent = parseAgentFields(req.body);
  if (agent.error) return res.status(400).json({ error: agent.error });

  const sets = [
    'label        = COALESCE($1, label)',
    'is_ota       = COALESCE($2, is_ota)',
    'color        = COALESCE($3, color)',
    'is_active    = COALESCE($4, is_active)',
    'sort_order   = COALESCE($5, sort_order)',
    'publish_rate = COALESCE($6, publish_rate)',
  ];
  const vals = [label, is_ota ?? null, color, is_active ?? null, sort_order ?? null, publish_rate ?? null];
  // Agent-billing fields: an explicit key in the body overwrites (including to NULL),
  // an absent key is left untouched.
  for (const [k, v] of Object.entries(agent.values)) {
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  vals.push(req.params.id, req.propertyId);

  try {
    const { rows } = await db.query(
      `UPDATE booking_sources SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND property_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Source not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Credit-limit check for an agent source (Slice B). Warn-only — the client
// shows a heads-up, it never blocks. `amount` is the prospective new
// booking's net total; omit (or 0) to just read the current outstanding.
router.get('/booking-sources/:id/credit-check', auth, async (req, res) => {
  try {
    const { rows: [source] } = await db.query(
      'SELECT id, label FROM booking_sources WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!source) return res.status(404).json({ error: 'Source not found' });
    // Billing terms moved to the agent (migration 084) — a source that was an
    // agent answers with that agent's limit and balance. Kept for the old
    // New Booking screen; the agent picker uses /api/agent-directory/:id/credit-check.
    const { rows: [agent] } = await db.query(
      'SELECT id, credit_limit FROM agents WHERE property_id = $1 AND legacy_source_id = $2 ORDER BY created_at LIMIT 1',
      [req.propertyId, source.id]
    );
    source.credit_limit = agent ? agent.credit_limit : null;

    const amount = Math.max(0, parseFloat(req.query.amount) || 0);
    const current_outstanding = agent ? await agentBilling.getAgentOutstanding(req.propertyId, agent.id) : 0;
    const projected_outstanding = Math.round((current_outstanding + amount) * 100) / 100;
    const credit_limit = source.credit_limit == null ? null : parseFloat(source.credit_limit);
    const would_exceed = credit_limit != null && projected_outstanding > credit_limit;

    res.json({
      source_id: source.id,
      label: source.label,
      credit_limit,
      current_outstanding,
      amount,
      projected_outstanding,
      would_exceed,
      over_by: would_exceed ? Math.round((projected_outstanding - credit_limit) * 100) / 100 : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Methods ──────────────────────────────────────────────────────────

router.get('/payment-methods', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM payment_methods WHERE property_id = $1 ORDER BY sort_order, id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payment-methods', auth, async (req, res) => {
  const { id, label, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO payment_methods (id, label, sort_order, property_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id.toLowerCase().replace(/\s+/g, '_'), label, sort_order || 0, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A method with this ID already exists' : err.message,
    });
  }
});

router.put('/payment-methods/:id', auth, async (req, res) => {
  const { label, is_active, sort_order } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE payment_methods SET
        label      = COALESCE($1, label),
        is_active  = COALESCE($2, is_active),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4 AND property_id = $5 RETURNING *`,
      [label, is_active ?? null, sort_order ?? null, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Method not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telegram Notifications ───────────────────────────────────────────────────
// Internal staff/owner alerts (new booking, guest requests) — see
// server/services/telegramService.js. Chat IDs are pasted in manually (get
// yours from @userinfobot on Telegram), not linked via a bot command — the
// deliberately simpler v1. ownerOnly since this controls where business
// alerts go, same sensitivity level as Roles & Permissions below.

// Telegram alert chats moved to Settings → Reports & Alerts
// (/api/smart-reports, notification_recipients — migration 068).

// ── Roles & Permissions ──────────────────────────────────────────────────────

router.get('/roles', ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM roles WHERE property_id = $1 ORDER BY id', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/roles', ownerOnly, async (req, res) => {
  const { id, label, allowed_menus } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  if (id === 'owner') return res.status(400).json({ error: 'Cannot create a role named owner' });
  try {
    const { rows } = await db.query(
      'INSERT INTO roles (id, label, allowed_menus, property_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [id.toLowerCase().replace(/\s+/g, '_'), label, allowed_menus || [], req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A role with this ID already exists' : err.message,
    });
  }
});

router.put('/roles/:id', ownerOnly, async (req, res) => {
  if (req.params.id === 'owner') return res.status(400).json({ error: 'Cannot modify the owner role' });
  const { label, allowed_menus } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE roles SET
        label         = COALESCE($1, label),
        allowed_menus = COALESCE($2, allowed_menus)
       WHERE id = $3 AND property_id = $4 RETURNING *`,
      [label, allowed_menus || null, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/roles/:id', ownerOnly, async (req, res) => {
  if (req.params.id === 'owner') return res.status(400).json({ error: 'Cannot delete the owner role' });
  try {
    const { rows: users } = await db.query('SELECT id FROM users WHERE role = $1 AND property_id = $2 LIMIT 1', [req.params.id, req.propertyId]);
    if (users.length) return res.status(409).json({ error: 'Cannot delete a role that is assigned to users' });
    const { rows } = await db.query('DELETE FROM roles WHERE id = $1 AND property_id = $2 RETURNING id', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
