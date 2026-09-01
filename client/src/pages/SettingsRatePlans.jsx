import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import api from '../services/api';

const EMPTY = {
  code: '', name: '',
  includes_breakfast: false, includes_lunch: false, includes_dinner: false,
  meal_price: '', is_default: false, sort_order: 0, is_active: true,
};

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

function mealsLabel(p) {
  const m = [];
  if (p.includes_breakfast) m.push('Breakfast');
  if (p.includes_lunch) m.push('Lunch');
  if (p.includes_dinner) m.push('Dinner');
  return m.length ? m.join(' + ') : 'No meals';
}

export default function SettingsRatePlans() {
  const { reload } = useSettings();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/api/rate-plans');
      setPlans(data);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setForm({ ...EMPTY, sort_order: plans.length });
    setEditingId('new');
    setError('');
  }
  function startEdit(p) {
    setForm({
      code: p.code, name: p.name,
      includes_breakfast: p.includes_breakfast, includes_lunch: p.includes_lunch, includes_dinner: p.includes_dinner,
      meal_price: p.meal_price, is_default: p.is_default, sort_order: p.sort_order, is_active: p.is_active,
    });
    setEditingId(p.id);
    setError('');
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, meal_price: parseFloat(form.meal_price) || 0, sort_order: parseInt(form.sort_order) || 0 };
      if (editingId === 'new') await api.post('/api/rate-plans', payload);
      else await api.put(`/api/rate-plans/${editingId}`, payload);
      setEditingId(null);
      await load();
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(p) {
    if (!confirm(`Deactivate "${p.name}"? Existing bookings keep it; it just won't be offered for new bookings.`)) return;
    try {
      await api.delete(`/api/rate-plans/${p.id}`);
      await load();
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  const rowStyle = { padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Rate Plans</div>
          <div className="page-subtitle">The "arrangement" a room is sold as — Room Only, Bed &amp; Breakfast… · Owner only</div>
        </div>
        {editingId === null && <button className="btn btn-primary" onClick={startNew}>+ New Rate Plan</button>}
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <>
            {editingId === 'new' && <RatePlanForm form={form} set={set} onSave={save} onCancel={() => setEditingId(null)} saving={saving} error={error} isNew />}
            {plans.length === 0 && editingId !== 'new' && (
              <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>No rate plans yet.</div>
            )}
            {plans.map(p => (
              <div key={p.id}>
                {editingId === p.id ? (
                  <RatePlanForm form={form} set={set} onSave={save} onCancel={() => setEditingId(null)} saving={saving} error={error} />
                ) : (
                  <div style={rowStyle}>
                    <div>
                      <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{p.code}</span>
                        <span>{p.name}</span>
                        {p.is_default && <span className="badge badge-green" style={{ fontSize: 10, padding: '2px 6px' }}>Default</span>}
                        {!p.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {mealsLabel(p)}
                        {parseFloat(p.meal_price) > 0 && ` · ${fmtIDR(p.meal_price)} / guest / night (net)`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-sm btn-secondary" onClick={() => startEdit(p)}>Edit</button>
                      {p.is_active && <button className="btn btn-sm btn-secondary" onClick={() => deactivate(p)}>Deactivate</button>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RatePlanForm({ form, set, onSave, onCancel, saving, error, isNew }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="form-row">
        <div className="form-group" style={{ maxWidth: 120 }}>
          <label className="form-label">Code *</label>
          <input className="form-input" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="BB" maxLength={10} />
        </div>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Bed &amp; Breakfast" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Meals included</label>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          {[['includes_breakfast', 'Breakfast'], ['includes_lunch', 'Lunch'], ['includes_dinner', 'Dinner']].map(([k, l]) => (
            <label key={k} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} /> {l}
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Meal price — net, per guest per night (IDR)</label>
          <input className="form-input" type="number" value={form.meal_price} onChange={e => set('meal_price', e.target.value)} placeholder="100000" />
        </div>
        <div className="form-group" style={{ maxWidth: 120 }}>
          <label className="form-label">Sort order</label>
          <input className="form-input" type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginTop: 4 }}>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} /> Default for new bookings
        </label>
        {!isNew && (
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
          </label>
        )}
      </div>
      <div className="flex gap-2" style={{ marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving || !form.code || !form.name}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
