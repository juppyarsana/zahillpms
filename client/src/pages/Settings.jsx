import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api from '../services/api';

const EDITING_NONE = null;

const AUTO_COLORS = [
  '#7A2540','#1E40AF','#7C3AED','#DB2777','#0891B2',
  '#C9A227','#9A3412','#0D9488','#C2410C','#6D28D9',
];

const SOURCE_TYPES = [
  { value: 'direct',         label: 'Direct' },
  { value: 'walkin',         label: 'Walk-in' },
  { value: 'booking_engine', label: 'Booking Engine' },
  { value: 'ota',            label: 'OTA' },
  { value: 'travel_agent',   label: 'Travel Agent' },
  { value: 'company',        label: 'Company' },
  { value: 'wholesaler',     label: 'Wholesaler' },
];
const SOURCE_TYPE_LABEL = Object.fromEntries(SOURCE_TYPES.map(t => [t.value, t.label]));
const AGENT_TYPES = ['travel_agent', 'company', 'wholesaler'];

const PAYMENT_STATUSES = [
  { value: 'normal',                      label: 'Normal — guest pays the property directly' },
  { value: 'city_ledger',                 label: 'City ledger — agent is invoiced, AR posts automatically' },
  { value: 'city_ledger_payment',         label: 'City ledger — agent is invoiced, AR needs manual confirmation' },
  { value: 'commission',                  label: 'Commission — guest pays property, property pays agent a commission' },
  { value: 'commission_and_city_ledger',  label: 'City ledger + commission — agent pays property, then gets a commission back' },
];
const PAYMENT_STATUS_SHORT = {
  normal: 'Normal',
  city_ledger: 'City ledger',
  city_ledger_payment: 'City ledger (manual)',
  commission: 'Commission',
  commission_and_city_ledger: 'City ledger + commission',
};
const HAS_COMMISSION = new Set(['commission', 'commission_and_city_ledger']);

// Shared source-type + agent-billing fields, used by both the add and edit forms.
function SourceAgentFields({ form, set }) {
  const sourceType = form.source_type || 'direct';
  const isAgent = AGENT_TYPES.includes(sourceType);
  const paymentStatus = form.payment_status || 'normal';

  return (
    <>
      <div className="form-group">
        <label className="form-label">Source Type</label>
        <select className="form-select" value={sourceType} onChange={e => set('source_type', e.target.value)}>
          {SOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {isAgent && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
          <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>Agent Billing</div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Contact Name</label>
              <input className="form-input" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Contact Email</label>
              <input className="form-input" type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Contact Phone</label>
              <input className="form-input" value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Billing Address</label>
            <textarea className="form-input" rows={2} value={form.billing_address || ''} onChange={e => set('billing_address', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Tax ID (NPWP)</label>
              <input className="form-input" value={form.tax_id || ''} onChange={e => set('tax_id', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Credit Terms (days)</label>
              <input className="form-input" type="number" min={0} value={form.credit_terms_days ?? ''}
                onChange={e => set('credit_terms_days', e.target.value)} style={{ maxWidth: 120 }} />
            </div>
            <div className="form-group">
              <label className="form-label">Credit Limit (IDR)</label>
              <input className="form-input" type="number" min={0} value={form.credit_limit ?? ''}
                onChange={e => set('credit_limit', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Payment Arrangement</label>
            <select className="form-select" value={paymentStatus} onChange={e => set('payment_status', e.target.value)}>
              {PAYMENT_STATUSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {HAS_COMMISSION.has(paymentStatus) && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Commission Type</label>
                <select className="form-select" value={form.commission_type || 'percent'} onChange={e => set('commission_type', e.target.value)}>
                  <option value="percent">Percent (%)</option>
                  <option value="amount">Fixed amount (IDR)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Commission Value</label>
                <input className="form-input" type="number" min={0} value={form.commission_value ?? ''}
                  onChange={e => set('commission_value', e.target.value)} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function Settings() {
  const nav = useNavigate();
  const { sources, paymentMethods, reload } = useSettings();

  const [editingId, setEditingId] = useState(EDITING_NONE); // 'source:direct' | 'method:cash'
  const [editForm, setEditForm] = useState({});
  const [adding, setAdding] = useState(null); // 'source' | 'method'
  const [addForm, setAddForm] = useState({});
  const [error, setError] = useState('');

  const AGENT_FIELDS = [
    'source_type', 'payment_status', 'billing_address', 'tax_id', 'contact_name',
    'contact_email', 'contact_phone', 'credit_terms_days', 'credit_limit',
    'commission_type', 'commission_value',
  ];

  function startEdit(type, item) {
    setEditingId(`${type}:${item.id}`);
    if (type === 'source') {
      const f = { label: item.label, is_ota: item.is_ota, color: item.color, sort_order: item.sort_order };
      for (const k of AGENT_FIELDS) f[k] = item[k] ?? '';
      f.source_type = item.source_type || 'direct';
      f.payment_status = item.payment_status || 'normal';
      setEditForm(f);
    } else {
      setEditForm({ label: item.label, sort_order: item.sort_order });
    }
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setError('');
  }

  async function saveEdit() {
    const [type, id] = editingId.split(':');
    const url = type === 'source'
      ? `/api/settings/booking-sources/${id}`
      : `/api/settings/payment-methods/${id}`;
    try {
      await api.put(url, editForm);
      cancelEdit();
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  async function toggleActive(type, id, current) {
    const url = type === 'source'
      ? `/api/settings/booking-sources/${id}`
      : `/api/settings/payment-methods/${id}`;
    await api.put(url, { is_active: !current });
    reload();
  }

  function startAdd(type) {
    setAdding(type);
    if (type === 'source') {
      const used = new Set(sources.map(s => s.color?.toLowerCase()));
      const autoColor = AUTO_COLORS.find(c => !used.has(c.toLowerCase())) || AUTO_COLORS[0];
      setAddForm({ color: autoColor, is_ota: false, source_type: 'direct', payment_status: 'normal' });
    } else {
      setAddForm({});
    }
    setError('');
  }

  function cancelAdd() {
    setAdding(null);
    setAddForm({});
    setError('');
  }

  async function saveAdd() {
    const url = adding === 'source'
      ? '/api/settings/booking-sources'
      : '/api/settings/payment-methods';
    try {
      await api.post(url, addForm);
      cancelAdd();
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add');
    }
  }

  function setAdd(k, v) { setAddForm(f => ({ ...f, [k]: v })); }
  function setEdit(k, v) { setEditForm(f => ({ ...f, [k]: v })); }

  const rowStyle = { padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const formBoxStyle = { background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, margin: '6px 0 10px' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Booking Sources & Methods</div>
          <div className="page-subtitle">Configure booking channels, agents, and payment methods</div>
        </div>
      </div>

      {/* ── Booking Sources ─────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Booking Sources</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Channels guests book through. Mark OTA sources — their check-in flow will skip the payment gate since payment is handled by the platform.
          Set a source type of Travel Agent, Company, or Wholesaler to record billing details and a payment arrangement (city ledger / commission).
        </p>

        {sources.map(s => (
          <div key={s.id}>
            {editingId === `source:${s.id}` ? (
              <div style={formBoxStyle}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label</label>
                    <input className="form-input" value={editForm.label || ''} onChange={e => setEdit('label', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={editForm.color || '#6b7280'} onChange={e => setEdit('color', e.target.value)}
                        style={{ width: 40, height: 36, padding: 2, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{editForm.color}</span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order</label>
                    <input className="form-input" type="number" value={editForm.sort_order ?? 0}
                      onChange={e => setEdit('sort_order', parseInt(e.target.value) || 0)} style={{ maxWidth: 80 }} />
                  </div>
                </div>
                <SourceAgentFields form={editForm} set={setEdit} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '12px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editForm.is_ota} onChange={e => setEdit('is_ota', e.target.checked)} />
                  OTA channel — payment managed by platform
                </label>
                {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={rowStyle}>
                <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({s.id})</span>
                  {s.is_ota && <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 6px' }}>OTA</span>}
                  {AGENT_TYPES.includes(s.source_type) && (
                    <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>
                      {SOURCE_TYPE_LABEL[s.source_type]}
                    </span>
                  )}
                  {s.payment_status && s.payment_status !== 'normal' && (
                    <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 6px' }}>
                      {PAYMENT_STATUS_SHORT[s.payment_status]}
                    </span>
                  )}
                  {!s.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                </div>
                <div className="flex gap-2">
                  {AGENT_TYPES.includes(s.source_type) && (
                    <button className="btn btn-sm btn-secondary" onClick={() => nav(`/agents/${s.id}`)}>Statement →</button>
                  )}
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit('source', s)}>Edit</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => toggleActive('source', s.id, s.is_active)}>
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {adding === 'source' ? (
          <div style={{ ...formBoxStyle, marginTop: 14 }}>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>New Booking Source</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">ID (slug) *</label>
                <input className="form-input" placeholder="e.g. expedia" value={addForm.id || ''}
                  onChange={e => setAdd('id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Lowercase, underscores only. Cannot be changed later.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" placeholder="e.g. Expedia" value={addForm.label || ''} onChange={e => setAdd('label', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={addForm.color || '#6b7280'} onChange={e => setAdd('color', e.target.value)}
                    style={{ width: 40, height: 36, padding: 2, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }} />
                </div>
              </div>
            </div>
            <SourceAgentFields form={addForm} set={setAdd} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '12px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!addForm.is_ota} onChange={e => setAdd('is_ota', e.target.checked)} />
              OTA channel — payment managed by platform
            </label>
            {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveAdd}>Add Source</button>
              <button className="btn btn-secondary btn-sm" onClick={cancelAdd}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => startAdd('source')}>+ Add Source</button>
        )}
      </div>

      {/* ── Payment Methods ──────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Payment Methods</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Methods available when recording a payment against a booking.
        </p>

        {paymentMethods.map(m => (
          <div key={m.id}>
            {editingId === `method:${m.id}` ? (
              <div style={formBoxStyle}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label</label>
                    <input className="form-input" value={editForm.label || ''} onChange={e => setEdit('label', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order</label>
                    <input className="form-input" type="number" value={editForm.sort_order ?? 0}
                      onChange={e => setEdit('sort_order', parseInt(e.target.value) || 0)} style={{ maxWidth: 80 }} />
                  </div>
                </div>
                {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={rowStyle}>
                <div className="flex gap-2 items-center">
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({m.id})</span>
                  {!m.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit('method', m)}>Edit</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => toggleActive('method', m.id, m.is_active)}>
                    {m.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {adding === 'method' ? (
          <div style={{ ...formBoxStyle, marginTop: 14 }}>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>New Payment Method</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">ID (slug) *</label>
                <input className="form-input" placeholder="e.g. paypal" value={addForm.id || ''}
                  onChange={e => setAdd('id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Lowercase, underscores only. Cannot be changed later.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" placeholder="e.g. PayPal" value={addForm.label || ''} onChange={e => setAdd('label', e.target.value)} />
              </div>
            </div>
            {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveAdd}>Add Method</button>
              <button className="btn btn-secondary btn-sm" onClick={cancelAdd}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => startAdd('method')}>+ Add Method</button>
        )}
      </div>
    </div>
  );
}
