const db = require('../db');

// Agents & companies (migration 084) — the list of travel agents, companies
// and wholesalers a property works with, attached to bookings
// (bookings.agent_id). Billing terms live here: who pays and when
// (payment_status), credit terms / limit, the default commission. A booking
// can carry its own commission (bookings.commission_type / _value); NULL =
// the agent's default.

const AGENT_TYPES = ['travel_agent', 'company', 'wholesaler', 'ota', 'other'];
const PAYMENT_STATUSES = ['normal', 'city_ledger', 'city_ledger_payment', 'commission', 'commission_and_city_ledger'];
const COMMISSION_TYPES = ['percent', 'amount'];
// Fields only the owner (or the agent_billing permission) may set — the rest
// front desk can fill in when adding an agent from a booking.
const BILLING_FIELDS = ['payment_status', 'credit_terms_days', 'credit_limit', 'commission_type', 'commission_value'];

// Validates + normalises the editable fields. Returns { values } or { error }.
function parseAgentFields(body, { requireName = false } = {}) {
  const out = {};
  if (body.name !== undefined || requireName) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required' };
    if (name.length > 150) return { error: 'Name is too long (150 characters max)' };
    out.name = name;
  }
  if (body.agent_type !== undefined && body.agent_type !== null && body.agent_type !== '') {
    if (!AGENT_TYPES.includes(body.agent_type)) return { error: `agent_type must be one of ${AGENT_TYPES.join(', ')}` };
    out.agent_type = body.agent_type;
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
  for (const f of ['contact_name', 'contact_email', 'contact_phone', 'tax_id', 'billing_address', 'notes']) {
    if (body[f] !== undefined) out[f] = body[f] === '' || body[f] === null ? null : String(body[f]).trim();
  }
  if (body.credit_terms_days !== undefined) {
    if (body.credit_terms_days === '' || body.credit_terms_days === null) out.credit_terms_days = null;
    else {
      const n = parseInt(body.credit_terms_days, 10);
      if (!Number.isInteger(n) || n < 0) return { error: 'credit_terms_days must be a whole number, 0 or more' };
      out.credit_terms_days = n;
    }
  }
  for (const f of ['credit_limit', 'commission_value']) {
    if (body[f] === undefined) continue;
    if (body[f] === '' || body[f] === null) { out[f] = null; continue; }
    const n = parseFloat(body[f]);
    if (!Number.isFinite(n) || n < 0) return { error: `${f} must be a number, 0 or more` };
    out[f] = n;
  }
  if (out.commission_type === 'percent' && out.commission_value != null && out.commission_value > 100) {
    return { error: 'A commission percentage can\'t be more than 100' };
  }
  if (body.is_active !== undefined) out.is_active = body.is_active !== false;
  return { values: out };
}

// A booking's own commission (New Booking / Edit Details). '' / null clears
// it back to the agent's default. Returns { values: {commission_type, commission_value} } or { error }.
function parseBookingCommission(body) {
  if (body.commission_type === undefined && body.commission_value === undefined) return { values: {} };
  const type = body.commission_type === '' || body.commission_type == null ? null : body.commission_type;
  const raw = body.commission_value;
  const value = raw === '' || raw == null ? null : parseFloat(raw);
  if (type === null || value === null) return { values: { commission_type: null, commission_value: null } };
  if (!COMMISSION_TYPES.includes(type)) return { error: `commission_type must be one of ${COMMISSION_TYPES.join(', ')}` };
  if (!Number.isFinite(value) || value < 0) return { error: 'The commission must be a number, 0 or more' };
  if (type === 'percent' && value > 100) return { error: 'A commission percentage can\'t be more than 100' };
  return { values: { commission_type: type, commission_value: value } };
}

async function listAgents(propertyId, { q, active } = {}) {
  const params = [propertyId];
  const where = ['a.property_id = $1'];
  if (q) { params.push(`%${String(q).trim()}%`); where.push(`(a.name ILIKE $${params.length} OR a.contact_name ILIKE $${params.length})`); }
  if (active === 'true' || active === true) where.push('a.is_active = true');
  const { rows } = await db.query(
    `SELECT a.*,
            (SELECT COUNT(*) FROM bookings b WHERE b.agent_id = a.id AND b.status NOT IN ('cancelled','no_show'))::int AS booking_count
     FROM agents a WHERE ${where.join(' AND ')}
     ORDER BY a.is_active DESC, lower(a.name)`,
    params
  );
  return rows;
}

async function getAgent(propertyId, agentId, client = db) {
  if (!agentId || !/^[0-9a-f-]{36}$/i.test(String(agentId))) return null;
  const { rows: [agent] } = await client.query('SELECT * FROM agents WHERE id = $1 AND property_id = $2', [agentId, propertyId]);
  return agent || null;
}

// canBill: owner / agent_billing permission — may set billing terms.
async function createAgent(propertyId, body, { userId, canBill }) {
  const parsed = parseAgentFields(body, { requireName: true });
  if (parsed.error) return { error: parsed.error, code: 'INVALID' };
  const values = { ...parsed.values };
  if (!canBill) for (const f of BILLING_FIELDS) delete values[f];
  delete values.is_active;
  const cols = ['property_id', 'created_by', ...Object.keys(values)];
  const vals = [propertyId, userId || null, ...Object.values(values)];
  try {
    const { rows: [agent] } = await db.query(
      `INSERT INTO agents (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      vals
    );
    return { agent };
  } catch (err) {
    if (err.code === '23505') {
      const { rows: [existing] } = await db.query('SELECT * FROM agents WHERE property_id = $1 AND lower(name) = lower($2)', [propertyId, values.name]);
      return { error: `An agent called "${existing?.name || values.name}" already exists`, code: 'DUPLICATE', agent: existing };
    }
    throw err;
  }
}

async function updateAgent(propertyId, agentId, body, { canBill }) {
  const agent = await getAgent(propertyId, agentId);
  if (!agent) return { error: 'Agent not found', code: 'NOT_FOUND' };
  const parsed = parseAgentFields(body);
  if (parsed.error) return { error: parsed.error, code: 'INVALID' };
  const values = { ...parsed.values };
  if (!canBill) for (const f of BILLING_FIELDS) delete values[f];
  const keys = Object.keys(values);
  if (!keys.length) return { agent };
  const vals = [...Object.values(values), agentId, propertyId];
  try {
    const { rows: [updated] } = await db.query(
      `UPDATE agents SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${keys.length + 1} AND property_id = $${keys.length + 2} RETURNING *`,
      vals
    );
    return { agent: updated };
  } catch (err) {
    if (err.code === '23505') return { error: `An agent called "${values.name}" already exists`, code: 'DUPLICATE' };
    throw err;
  }
}

// The agent to link a new booking to: the one picked, else — for a booking
// made on a source that was an agent before migration 084 (legacy_source_id)
// — that agent, so a booking made the old way still reaches Agent Billing.
// Returns { agentId } (null = no agent) or { error }.
async function agentForBooking(client, propertyId, { agentId, source }) {
  if (agentId) {
    const agent = await getAgent(propertyId, agentId, client);
    if (!agent) return { error: 'Agent not found', code: 'AGENT_NOT_FOUND' };
    return { agentId: agent.id, agent };
  }
  if (source) {
    const { rows: [legacy] } = await client.query(
      'SELECT * FROM agents WHERE property_id = $1 AND legacy_source_id = $2 ORDER BY created_at LIMIT 1',
      [propertyId, source]
    );
    if (legacy) return { agentId: legacy.id, agent: legacy };
  }
  return { agentId: null, agent: null };
}

module.exports = {
  AGENT_TYPES, PAYMENT_STATUSES, COMMISSION_TYPES, BILLING_FIELDS,
  parseAgentFields, parseBookingCommission, listAgents, getAgent, createAgent, updateAgent, agentForBooking,
};
