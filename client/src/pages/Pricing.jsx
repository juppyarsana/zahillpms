import { useState, useEffect } from 'react';
import api from '../services/api';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtDate(d) { return d?.slice(0, 10) || ''; }

const PRESET_COLORS = ['#4D4D35', '#6b7280', '#b45309', '#1d4ed8', '#be185d', '#15803d', '#7c3aed', '#c2410c'];

export default function Pricing() {
  const [periods, setPeriods] = useState([]);
  const [units, setUnits] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', color: '#b45309', date_from: '', date_to: '',
    type: 'multiplier', value: 1.3, unit_ids: [], sort_order: 0, is_active: true,
  });
  const [error, setError] = useState('');

  async function load() {
    const [p, u] = await Promise.all([api.get('/api/pricing/periods'), api.get('/api/units')]);
    setPeriods(p.data);
    setUnits(u.data);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({ name: '', color: '#b45309', date_from: '', date_to: '', type: 'multiplier', value: 1.3, unit_ids: [], sort_order: periods.length, is_active: true });
    setError('');
    setModal(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({ ...p, unit_ids: p.unit_ids || [], date_from: fmtDate(p.date_from), date_to: fmtDate(p.date_to) });
    setError('');
    setModal(true);
  }

  async function save() {
    setError('');
    try {
      if (editing) await api.put(`/api/pricing/periods/${editing.id}`, form);
      else await api.post('/api/pricing/periods', form);
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  }

  async function deletePeriod(id) {
    if (!confirm('Delete this pricing period?')) return;
    await api.delete(`/api/pricing/periods/${id}`);
    load();
  }

  async function toggleActive(p) {
    await api.put(`/api/pricing/periods/${p.id}`, { is_active: !p.is_active });
    load();
  }

  function toggleUnit(id) {
    setForm(f => ({
      ...f,
      unit_ids: f.unit_ids.includes(id) ? f.unit_ids.filter(u => u !== id) : [...f.unit_ids, id],
    }));
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const displayValue = (p) => p.type === 'multiplier'
    ? `×${p.value} (+${Math.round((p.value - 1) * 100)}%)`
    : fmtIDR(p.value) + '/night';

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Pricing Periods</div>
          <div className="page-subtitle">Set seasonal and special date pricing — overrides base rate on booking</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Period</button>
      </div>

      <div className="card mb-3" style={{ background: '#fefce8', borderColor: '#fde68a' }}>
        <div style={{ fontSize: 13 }}>
          💡 <strong>How it works:</strong> When creating a booking, the system checks if the check-in date falls within any active period.
          The highest-priority matching period sets the rate. Base rate is used if no period applies.
          You can always override the suggested price manually.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {periods.map(p => (
          <div key={p.id} className="card" style={{ borderLeft: `4px solid ${p.color}`, opacity: p.is_active ? 1 : 0.5 }}>
            <div className="flex-between">
              <div>
                <div className="flex-center gap-2">
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                  {!p.is_active && <span className="badge badge-gray">Inactive</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  📅 {fmtDate(p.date_from)} → {fmtDate(p.date_to)}
                  &nbsp;·&nbsp;
                  💰 {displayValue(p)}
                  &nbsp;·&nbsp;
                  Priority {p.sort_order}
                  &nbsp;·&nbsp;
                  {p.unit_ids?.length === 0 ? 'All units' : `${p.unit_ids.length} unit(s)`}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-secondary" onClick={() => toggleActive(p)}>
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => deletePeriod(p.id)}>✕</button>
              </div>
            </div>
          </div>
        ))}
        {periods.length === 0 && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No pricing periods yet. Create your first one — e.g. "Weekend Rate" or "Peak Season".
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editing ? 'Edit Period' : 'New Pricing Period'}</div>
              <button className="btn btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}

              <div className="form-group">
                <label className="form-label">Period Name *</label>
                <input className="form-input" value={form.name} placeholder="e.g. Weekend, Eid Holiday, Peak Season…"
                  onChange={e => set('name', e.target.value)} autoFocus />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Date From *</label>
                  <input className="form-input" type="date" value={form.date_from} onChange={e => set('date_from', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Date To *</label>
                  <input className="form-input" type="date" value={form.date_to} min={form.date_from} onChange={e => set('date_to', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Pricing Type</label>
                  <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                    <option value="multiplier">Multiplier (× base rate)</option>
                    <option value="fixed">Fixed price per night (IDR)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">
                    {form.type === 'multiplier' ? 'Multiplier (e.g. 1.3 = +30%)' : 'Price per Night (IDR)'}
                  </label>
                  <input className="form-input" type="number"
                    step={form.type === 'multiplier' ? 0.05 : 50000}
                    min={form.type === 'multiplier' ? 0.1 : 0}
                    value={form.value}
                    onChange={e => set('value', parseFloat(e.target.value))} />
                  {form.type === 'multiplier' && form.value && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      = +{Math.round((form.value - 1) * 100)}% above base rate
                    </div>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Priority (higher = wins overlap)</label>
                  <input className="form-input" type="number" min={0} value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Color Label</label>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <div key={c} onClick={() => set('color', c)}
                        style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: form.color === c ? '3px solid #1a1a1a' : '2px solid transparent' }} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Apply To Units (leave empty = all units)</label>
                <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                  {units.map(u => (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: form.unit_ids.includes(u.id) ? 'var(--green-pale)' : 'white' }}>
                      <input type="checkbox" checked={form.unit_ids.includes(u.id)} onChange={() => toggleUnit(u.id)} />
                      {u.name}
                    </label>
                  ))}
                </div>
                {form.unit_ids.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Applies to all units</div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save Period</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
