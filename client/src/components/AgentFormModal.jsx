import { useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AGENT_TYPES, PAYMENT_MODES, HAS_COMMISSION } from '../lib/agents';

// Add or edit an agent / company (migration 084). Anyone can add one (e.g.
// from a booking) with its name and contacts; how the agent pays, credit and
// the default commission are the owner's — shown read-only to others.
// agent = existing row to edit, or null to add (initialName pre-fills it).
export default function AgentFormModal({ agent, initialName = '', onClose, onSaved }) {
  const { user } = useAuth();
  const canBill = user?.role === 'owner';
  const editing = !!agent;
  const [form, setForm] = useState(() => ({
    name: agent?.name || initialName,
    agent_type: agent?.agent_type || 'travel_agent',
    contact_name: agent?.contact_name || '',
    contact_phone: agent?.contact_phone || '',
    contact_email: agent?.contact_email || '',
    tax_id: agent?.tax_id || '',
    billing_address: agent?.billing_address || '',
    notes: agent?.notes || '',
    // the old 'payments confirmed by hand' mode is the same as billed to the agent
    payment_status: agent?.payment_status === 'city_ledger_payment' ? 'city_ledger' : (agent?.payment_status || 'normal'),
    credit_terms_days: agent?.credit_terms_days ?? '',
    credit_limit: agent?.credit_limit != null ? String(parseFloat(agent.credit_limit)) : '',
    commission_type: agent?.commission_type || 'percent',
    commission_value: agent?.commission_value != null ? String(parseFloat(agent.commission_value)) : '',
    is_active: agent ? agent.is_active !== false : true,
  }));
  const [more, setMore] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const withCommission = HAS_COMMISSION.includes(form.payment_status);

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    const body = { ...form };
    if (!withCommission) { body.commission_type = ''; body.commission_value = ''; }
    if (!canBill) for (const k of ['payment_status', 'credit_terms_days', 'credit_limit', 'commission_type', 'commission_value']) delete body[k];
    try {
      const { data } = editing
        ? await api.put(`/api/agent-directory/${agent.id}`, body)
        : await api.post('/api/agent-directory', body);
      onSaved(data);
    } catch (e) {
      // Same name already on the list: offer that one instead of a duplicate.
      const existing = e.response?.data?.agent;
      if (!editing && existing && confirm(`${e.response.data.error}. Use "${existing.name}"?`)) { onSaved(existing); return; }
      setError(e.response?.data?.error || 'Could not save');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">{editing ? `Edit ${agent.name}` : 'New agent / company'}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Name *</label>
              <input className="form-input" autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. PT Bali Tours" />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.agent_type} onChange={e => set('agent_type', e.target.value)}>
                {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Contact name</label>
              <input className="form-input" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone / WhatsApp</label>
              <input className="form-input" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
            </div>
          </div>

          {!more ? (
            <button className="btn btn-sm btn-secondary" onClick={() => setMore(true)}>More details (email, tax number, billing{canBill ? ', commission' : ''})</button>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tax number (NPWP)</label>
                  <input className="form-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Billing address</label>
                <textarea className="form-textarea" rows={2} value={form.billing_address} onChange={e => set('billing_address', e.target.value)} />
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>
                  Billing {!canBill && <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>· set by the owner</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">How they pay</label>
                  <select className="form-select" value={form.payment_status} disabled={!canBill} onChange={e => set('payment_status', e.target.value)}>
                    {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {withCommission && (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Default commission</label>
                      <select className="form-select" value={form.commission_type} disabled={!canBill} onChange={e => set('commission_type', e.target.value)}>
                        <option value="percent">Percent of the bill (%)</option>
                        <option value="amount">Fixed amount per booking (IDR)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{form.commission_type === 'percent' ? 'Percent' : 'Amount (IDR)'}</label>
                      <input className="form-input" type="number" min={0} value={form.commission_value} disabled={!canBill} onChange={e => set('commission_value', e.target.value)} />
                    </div>
                  </div>
                )}
                {withCommission && <div className="text-muted" style={{ fontSize: 11, marginTop: -6, marginBottom: 10 }}>Each booking can have its own commission; this is the starting value.</div>}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Days to pay (credit terms)</label>
                    <input className="form-input" type="number" min={0} value={form.credit_terms_days} disabled={!canBill} placeholder="on receipt" onChange={e => set('credit_terms_days', e.target.value)} />
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>After the invoice (or check-out, if not invoiced yet) — e.g. 30. Overdue counts from then.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Credit limit (IDR)</label>
                    <input className="form-input" type="number" min={0} value={form.credit_limit} disabled={!canBill} onChange={e => set('credit_limit', e.target.value)} placeholder="no limit" />
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
              {editing && (
                <label className="flex gap-2 items-center" style={{ fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                  Active (shows in the agent picker on bookings)
                </label>
              )}
            </>
          )}
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save' : 'Add agent'}</button>
        </div>
      </div>
    </div>
  );
}
