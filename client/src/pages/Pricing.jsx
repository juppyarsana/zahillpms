import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RateCalendarTab, AutomaticTab, EventsTab, ReportsTab } from './pricing/YieldTabs';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtDate(d) { return d?.slice(0, 10) || ''; }

const PRESET_COLORS = ['#4D4D35', '#6b7280', '#b45309', '#1d4ed8', '#be185d', '#15803d', '#7c3aed', '#c2410c'];

// "My rules": the owner's own pricing periods. Automatic (yield) periods are written by the
// engine (source='auto') and managed from the Automatic tab, so they are hidden here.
function MyRules() {
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
    setPeriods(p.data.filter(x => x.source !== 'auto'));
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

  // Units grouped by room type (natural room order), so a whole type can be ticked at once.
  const unitGroups = Object.values(units.reduce((acc, u) => {
    const type = u.type || 'Other';
    (acc[type] ||= { type, units: [] }).units.push(u);
    return acc;
  }, {})).map(g => ({ ...g, units: [...g.units].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
    .sort((a, b) => a.type.localeCompare(b.type));

  // Tick a room type: select all of its rooms — or, if they're all selected already, clear them.
  function toggleType(g) {
    const ids = g.units.map(u => u.id);
    setForm(f => {
      const allPicked = ids.every(id => f.unit_ids.includes(id));
      return { ...f, unit_ids: allPicked ? f.unit_ids.filter(id => !ids.includes(id)) : [...new Set([...f.unit_ids, ...ids])] };
    });
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
                <label className="form-label">Apply To</label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4,
                  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                  background: form.unit_ids.length === 0 ? 'var(--green-pale)' : 'white' }}>
                  <input type="checkbox" checked={form.unit_ids.length === 0} onChange={() => set('unit_ids', [])} />
                  <strong>All units</strong>
                </label>

                <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {unitGroups.map(g => {
                    const picked = g.units.filter(u => form.unit_ids.includes(u.id)).length;
                    const all = picked === g.units.length;
                    return (
                      <div key={g.type} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, marginBottom: 6 }}>
                          <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = picked > 0 && !all; }}
                            onChange={() => toggleType(g)} />
                          {g.type}
                          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
                            {picked > 0 ? `${picked} of ${g.units.length} selected` : `${g.units.length} rooms`}
                          </span>
                        </label>
                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                          {g.units.map(u => (
                            <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                              padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13,
                              background: form.unit_ids.includes(u.id) ? 'var(--green-pale)' : 'white' }}>
                              <input type="checkbox" checked={form.unit_ids.includes(u.id)} onChange={() => toggleUnit(u.id)} />
                              {u.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  {form.unit_ids.length === 0
                    ? 'Applies to all units — including rooms you add later.'
                    : `Applies to ${form.unit_ids.length} selected room${form.unit_ids.length === 1 ? '' : 's'}. Tick a room type to select all its rooms. Rooms added later are not included automatically.`}
                </div>
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

const YIELD_TABS = [
  { key: 'calendar',  icon: '📅', label: 'Rate calendar' },
  { key: 'rules',     icon: '📝', label: 'My rules' },
  { key: 'automatic', icon: '🤖', label: 'Automatic' },
  { key: 'events',    icon: '🎉', label: 'Events' },
  { key: 'reports',   icon: '📊', label: 'Reports' },
];

// Yield management lives inside Pricing as extra tabs (owner-only + paid module) rather than a
// separate menu — both answer "what is the rate on this night". Without the module (or for
// non-owners) this renders exactly the classic Pricing page.
export default function Pricing() {
  const { user, hasModule } = useAuth();
  const [tab, setTab] = useState('calendar');
  const yieldOn = user?.role === 'owner' && hasModule('yield_management');
  if (!yieldOn) return <MyRules />;
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Pricing</div>
          <div className="page-subtitle">Your rules and automatic (yield) pricing — one rate per room type per night</div>
        </div>
      </div>
      <div className="tab-bar">
        {YIELD_TABS.map(t => (
          <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      {tab === 'calendar' && <RateCalendarTab />}
      {tab === 'rules' && <MyRules />}
      {tab === 'automatic' && <AutomaticTab />}
      {tab === 'events' && <EventsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
