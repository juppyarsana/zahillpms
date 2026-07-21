import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

const MODULE_LABELS = {
  reservations:    'Reservations',
  front_desk:      'Front Desk',
  guest_crm:       'Guest CRM',
  financial:       'Financial',
  operations:      'Operations',
  sales:           'Sales',
  in_room_media:   'In-Room Media',
  room_controller: 'Room Controller',
  insights:        'Insights',
};

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [property, setProperty] = useState(null);
  const [modules, setModules] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data } = await api.get(`/api/admin/properties/${id}`);
      const { modules: mods, ...prop } = data;
      setProperty(prop);
      setForm({ name: prop.name, slug: prop.slug, plan: prop.plan, is_active: prop.is_active });
      setModules(mods);
    } catch (_) {}
  }

  useEffect(() => { load(); }, [id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function saveInfo() {
    setError('');
    setSaving(true);
    try {
      const { data } = await api.patch(`/api/admin/properties/${id}`, form);
      setProperty(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleModule(moduleName, current) {
    setModules(mods => mods.map(m => m.module === moduleName ? { ...m, is_enabled: !current } : m));
    try {
      await api.patch(`/api/admin/properties/${id}/modules`, { module: moduleName, is_enabled: !current });
    } catch (_) {
      setModules(mods => mods.map(m => m.module === moduleName ? { ...m, is_enabled: current } : m));
    }
  }

  if (!property || !form) return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <button className="btn btn-sm btn-secondary" onClick={() => navigate('/admin')} style={{ marginBottom: 8 }}>
            ← Properties
          </button>
          <div className="page-title">{property.name}</div>
          <div className="page-subtitle">{property.slug}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Property Info</div>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Slug</label>
          <input className="form-input" value={form.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
        </div>
        <div className="form-group">
          <label className="form-label">Plan</label>
          <select className="form-select" value={form.plan} onChange={e => set('plan', e.target.value)}>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={e => set('is_active', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          Active
        </label>
        <button className="btn btn-primary" onClick={saveInfo} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Modules</div>
        {modules.map(m => (
          <div key={m.module} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 14 }}>{MODULE_LABELS[m.module] || m.module}</span>
            <button
              className={`btn btn-sm ${m.is_enabled ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleModule(m.module, m.is_enabled)}
              style={{ minWidth: 60 }}
            >
              {m.is_enabled ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
