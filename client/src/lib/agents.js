// Agents & companies (migration 084) — shared labels for the Agent Billing
// page, the agent picker and the booking screens.

export const AGENT_TYPES = [
  { value: 'travel_agent', label: 'Travel agent' },
  { value: 'company',      label: 'Company' },
  { value: 'wholesaler',   label: 'Wholesaler' },
  { value: 'ota',          label: 'OTA' },
  { value: 'other',        label: 'Other (guide, driver…)' },
];
export const AGENT_TYPE_LABEL = Object.fromEntries(AGENT_TYPES.map(t => [t.value, t.label]));

// Who pays and when (agents.payment_status).
export const PAYMENT_MODES = [
  { value: 'normal',                     label: 'Guest pays the hotel',                                   short: 'Guest pays' },
  { value: 'commission',                 label: 'Guest pays the hotel · the agent earns a commission',    short: 'Commission' },
  { value: 'city_ledger',                label: 'Agent pays the hotel later (billed to the agent)',       short: 'Billed to agent' },
  { value: 'commission_and_city_ledger', label: 'Agent pays the hotel later · and earns a commission',    short: 'Billed + commission' },
];
// 'city_ledger_payment' (older data, from migration 041) works exactly like
// 'city_ledger' — it was never different in the app — so it isn't offered
// any more and reads as billed to the agent.
const LEGACY = { value: 'city_ledger_payment', label: 'Agent pays the hotel later (billed to the agent)', short: 'Billed to agent' };
export const PAYMENT_MODE_LABEL = Object.fromEntries([...PAYMENT_MODES, LEGACY].map(m => [m.value, m.label]));
export const PAYMENT_MODE_SHORT = Object.fromEntries([...PAYMENT_MODES, LEGACY].map(m => [m.value, m.short]));

export const CITY_LEDGER = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'];
export const HAS_COMMISSION = ['commission', 'commission_and_city_ledger'];

// Booking sources whose bookings usually come with an agent: the agent field
// shows by itself for these (it can still be picked with any source).
export const AGENT_SOURCE_TYPES = ['travel_agent', 'company', 'wholesaler'];

// The wording + default type of the agent field, following the booking's
// source type: Corporate → "Company", Wholesaler → "Wholesaler", else "Agent".
// It's one list (Agent Billing) either way; the type just tells them apart.
export function agentKindForSource(sourceType) {
  if (sourceType === 'company') return { type: 'company', label: 'Company', noun: 'company' };
  if (sourceType === 'wholesaler') return { type: 'wholesaler', label: 'Wholesaler', noun: 'wholesaler' };
  if (sourceType === 'travel_agent') return { type: 'travel_agent', label: 'Agent', noun: 'agent' };
  return { type: 'travel_agent', label: 'Agent / company', noun: 'agent / company' };
}
// "Agent" / "Company" / "Wholesaler" for a saved agent's type (booking page).
export function agentRoleLabel(agentType) {
  return agentType === 'company' ? 'Company' : agentType === 'wholesaler' ? 'Wholesaler' : 'Agent';
}

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');

// "10%" / "Rp 150.000" / '' for a { commission_type, commission_value }.
export function commissionText(type, value) {
  if (!type || value === null || value === undefined || value === '') return '';
  return type === 'percent' ? `${parseFloat(value)}%` : fmtIDR(value);
}

// ── Booking agent fields (components/BookingAgentFields.jsx) ──
// value = { agent: row | null, own: bool, type: 'percent'|'amount', amount: string }
export const EMPTY_AGENT_VALUE = { agent: null, own: false, type: 'percent', amount: '' };

// The fields to send to POST /api/bookings(/group) and PUT /api/bookings/:id.
export function agentBody(v) {
  if (!v.agent) return { agent_id: '', commission_type: '', commission_value: '' };
  const own = v.own && v.amount !== '' && HAS_COMMISSION.includes(v.agent.payment_status);
  return { agent_id: v.agent.id, commission_type: own ? v.type : '', commission_value: own ? v.amount : '' };
}

// From a booking row (GET /api/bookings/:id) back to the value above.
export function agentValueFromBooking(b) {
  if (!b?.agent_id) return EMPTY_AGENT_VALUE;
  const agent = { id: b.agent_id, name: b.agent_name, agent_type: b.agent_type, payment_status: b.agent_payment_status,
    commission_type: b.agent_commission_type, commission_value: b.agent_commission_value };
  const own = !!b.commission_type && b.commission_value != null;
  return { agent, own, type: own ? b.commission_type : 'percent', amount: own ? String(parseFloat(b.commission_value)) : '' };
}

