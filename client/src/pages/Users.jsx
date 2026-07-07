import { useState, useEffect } from 'react';
import api from '../services/api';

const ROLE_BADGE = { owner: 'badge-green', staff: 'badge-blue' };

const EMPTY_FORM = { name: '', email: '', password: '', role: 'staff' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [modal, setModal] = useState(null); // null | 'add' | user object (edit)
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [u, r] = await Promise.all([
        api.get('/api/users'),
        api.get('/api/settings/roles'),
      ]);
      setUsers(u.data);
      setRoles(r.data);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('add');
  }

  function openEdit(user) {
    setForm({ name: user.name, email: user.email, password: '', role: user.role });
    setError('');
    setModal(user);
  }

  async function save() {
    setError('');
    if (!form.name || !form.email || (modal === 'add' && !form.password)) {
      setError('Name, email and password are required');
      return;
    }
    setLoading(true);
    try {
      if (modal === 'add') {
        await api.post('/api/users', form);
      } else {
        const payload = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/api/users/${modal.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  async function remove(user) {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/users/${user.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Staff Accounts</div>
          <div className="page-subtitle">Manage who can access Zahill PMS</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add User</button>
      </div>

      <div className="card">
        {users.length === 0 && <p className="text-muted">No users yet.</p>}
        {users.map(u => (
          <div key={u.id} className="flex-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="flex-center gap-2">
              <div className="avatar avatar-md" style={{ background: '#2D5016', fontSize: 13 }}>
                {u.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
              </div>
            </div>
            <div className="flex-center gap-2">
              <span className={`badge ${ROLE_BADGE[u.role] || 'badge-gray'}`}>{u.role}</span>
              <button className="btn btn-sm btn-secondary" onClick={() => openEdit(u)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal === 'add' ? 'Add User' : `Edit — ${modal.name}`}</div>
              <button className="btn btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{modal === 'add' ? 'Password' : 'New Password (leave blank to keep current)'}</label>
                <input className="form-input" type="password" value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-select" value={form.role} onChange={e => set('role', e.target.value)}>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Saving…' : modal === 'add' ? 'Create User' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
