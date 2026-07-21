import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const EMPTY_FORM = { name: '', slug: '', plan: 'basic', display_token: '' };

function genToken() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '');
}

export default function Properties() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/api/admin/properties');
      setProperties(data);
    } catch (_) {}
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setForm({ ...EMPTY_FORM, display_token: genToken() });
    setError('');
    setModal(true);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setError('');
    if (!form.name || !form.slug || !form.display_token) {
      setError('Name, slug, and display token are required');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/admin/properties', form);
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create property');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Properties</div>
          <div className="page-subtitle">All properties on the platform</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ New Property</button>
      </div>

      <div className="card">
        {properties.length === 0 && <p className="text-muted">No properties yet.</p>}
        {properties.map(p => (
          <div key={p.id} className="flex-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {p.slug} · {p.module_count} module{p.module_count === '1' ? '' : 's'}
              </div>
            </div>
            <div className="flex-center gap-2">
              <span className="badge badge-blue">{p.plan}</span>
              <span className={`badge ${p.is_active ? 'badge-green' : 'badge-gray'}`}>
                {p.is_active ? 'Active' : 'Inactive'}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/admin/properties/${p.id}`)}>
                Manage
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">New Property</div>
              <button className="btn btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Slug</label>
                <input
                  className="form-input"
                  value={form.slug}
                  onChange={e => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Plan</label>
                <select className="form-select" value={form.plan} onChange={e => set('plan', e.target.value)}>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Display Token</label>
                <input className="form-input" value={form.display_token} onChange={e => set('display_token', e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Creating…' : 'Create Property'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
