const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const modules = require('../modules');

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

// ── Property Details & Tax Config ────────────────────────────────────────────

const PROPERTY_FIELDS = `tax_rate, service_charge_rate, property_name, property_address, property_phone, property_email,
        smtp_host, smtp_port, smtp_user, smtp_password, smtp_from`;

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
    smtp_host, smtp_port, smtp_user, smtp_password, smtp_from,
  } = req.body;
  try {
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
        smtp_from           = COALESCE($11, smtp_from)
       WHERE property_id = $12
       RETURNING ${PROPERTY_FIELDS}`,
      [
        tax_rate ?? null, service_charge_rate ?? null, property_name ?? null, property_address ?? null, property_phone ?? null, property_email ?? null,
        smtp_host ?? null, smtp_port ?? null, smtp_user ?? null, smtp_password ?? null, smtp_from ?? null,
        req.propertyId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Property settings not found' });
    res.json(rows[0]);
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
              logo_url, brand_color
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
  const { id, label, is_ota, color, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  const agent = parseAgentFields(req.body);
  if (agent.error) return res.status(400).json({ error: agent.error });

  const cols = ['id', 'label', 'is_ota', 'color', 'sort_order', 'property_id'];
  const vals = [id.toLowerCase().replace(/\s+/g, '_'), label, !!is_ota, color || '#6b7280', sort_order || 0, req.propertyId];
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
  const { label, is_ota, color, is_active, sort_order } = req.body;
  const agent = parseAgentFields(req.body);
  if (agent.error) return res.status(400).json({ error: agent.error });

  const sets = [
    'label      = COALESCE($1, label)',
    'is_ota     = COALESCE($2, is_ota)',
    'color      = COALESCE($3, color)',
    'is_active  = COALESCE($4, is_active)',
    'sort_order = COALESCE($5, sort_order)',
  ];
  const vals = [label, is_ota ?? null, color, is_active ?? null, sort_order ?? null];
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
