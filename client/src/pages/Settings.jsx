import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const EDITING_NONE = null;

const AUTO_COLORS = [
  '#4A7C2A','#1E40AF','#7C3AED','#DB2777','#0891B2',
  '#B8860B','#9A3412','#0D9488','#C2410C','#6D28D9',
];

export default function Settings() {
  const { user } = useAuth();
  const { sources, paymentMethods, reload } = useSettings();

  const [editingId, setEditingId] = useState(EDITING_NONE); // 'source:direct' | 'method:cash'
  const [editForm, setEditForm] = useState({});
  const [adding, setAdding] = useState(null); // 'source' | 'method'
  const [addForm, setAddForm] = useState({});
  const [error, setError] = useState('');

  if (user?.role !== 'owner') {
    return <div className="alert alert-error">Owner access required to manage settings.</div>;
  }

  function startEdit(type, item) {
    setEditingId(`${type}:${item.id}`);
    setEditForm(type === 'source'
      ? { label: item.label, is_ota: item.is_ota, color: item.color, sort_order: item.sort_order }
      : { label: item.label, sort_order: item.sort_order }
    );
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
      setAddForm({ color: autoColor, is_ota: false });
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
          <div className="page-subtitle">Configure payment channels and payment methods</div>
        </div>
      </div>

      {/* ── Booking Sources ─────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Booking Sources</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Channels guests book through. Mark OTA sources — their check-in flow will skip the payment gate since payment is handled by the platform.
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
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
                <div className="flex gap-2 items-center">
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({s.id})</span>
                  {s.is_ota && <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 6px' }}>OTA</span>}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
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
