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
  { value: 'company',        label: 'Corporate / company' },
  { value: 'wholesaler',     label: 'Wholesaler' },
];
const SOURCE_TYPE_LABEL = Object.fromEntries(SOURCE_TYPES.map(t => [t.value, t.label]));
const AGENT_TYPES = ['travel_agent', 'company', 'wholesaler'];

// A source is a channel / segment (for statistics). The agents and companies
// themselves — with their billing and commission — are their own list in
// Agent Billing (migration 084); a booking on an agent-type source shows the
// Agent field on New Booking.
function SourceAgentFields({ form, set }) {
  const sourceType = form.source_type || 'direct';
  return (
    <div className="form-group">
      <label className="form-label">Source Type</label>
      <select className="form-select" value={sourceType} onChange={e => set('source_type', e.target.value)}>
        {SOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {AGENT_TYPES.includes(sourceType) && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
          Bookings on this source ask for the agent / company. Each agent's billing and commission are set in Agent Billing, not here.
        </div>
      )}
    </div>
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

  const AGENT_FIELDS = ['source_type'];

  function startEdit(type, item) {
    setEditingId(`${type}:${item.id}`);
    if (type === 'source') {
      const f = { label: item.label, is_ota: item.is_ota, color: item.color, sort_order: item.sort_order };
      for (const k of AGENT_FIELDS) f[k] = item[k] ?? '';
      f.source_type = item.source_type || 'direct';
      f.publish_rate = item.publish_rate !== false;
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
      setAddForm({ color: autoColor, is_ota: false, source_type: 'direct', publish_rate: true });
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
          <div className="page-subtitle">Configure booking channels and payment methods</div>
        </div>
      </div>

      {/* ── Booking Sources ─────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Booking Sources</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Channels guests book through — keep this list short (Direct, Walk-in, each OTA, Travel Agent, Corporate, Wholesaler). Mark OTA sources — their check-in flow will skip the payment gate since payment is handled by the platform.
          Agents and companies themselves, with their billing and commission, are in{' '}
          <a href="/agents" onClick={e => { e.preventDefault(); nav('/agents'); }}>Agent Billing</a>.
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '12px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editForm.publish_rate !== false} onChange={e => setEdit('publish_rate', e.target.checked)} />
                  Publish rate on Registration Card
                </label>
                {editForm.publish_rate === false && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                    Off: Room Rate and Deposit print as "Arranged by {editForm.label || 'this source'}" instead of the actual numbers.
                  </div>
                )}
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
                  {s.publish_rate === false && <span className="badge badge-amber" style={{ fontSize: 10, padding: '2px 6px' }}>Rate hidden on Reg. Card</span>}
                  {!s.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                </div>
                <div className="flex gap-2">
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '12px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.publish_rate !== false} onChange={e => setAdd('publish_rate', e.target.checked)} />
              Publish rate on Registration Card
            </label>
            {addForm.publish_rate === false && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                Off: Room Rate and Deposit print as "Arranged by {addForm.label || 'this source'}" instead of the actual numbers.
              </div>
            )}
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
