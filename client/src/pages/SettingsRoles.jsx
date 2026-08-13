import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

export const MENU_DEFS = [
  { key: 'dashboard',        label: 'Dashboard',            group: 'Operations' },
  { key: 'reservations',     label: 'Reservations',         group: 'Operations' },
  { key: 'quick_checkin',    label: 'Quick Check-in/out',   group: 'Operations' },
  { key: 'checkin_full',     label: 'Check-in/out (Full)',  group: 'Operations' },
  { key: 'guests',           label: 'Guests',               group: 'Operations' },
  { key: 'operations',       label: 'Operations (Tasks)',   group: 'Operations' },
  { key: 'sales',            label: 'Sales',                group: 'Operations' },
  { key: 'loyalty',          label: 'Loyalty',              group: 'Operations' },
  { key: 'allotments',       label: 'Allotments',           group: 'Operations' },
  { key: 'pricing',          label: 'Pricing',              group: 'Settings'   },
  { key: 'units',            label: 'Unit Settings',        group: 'Settings'   },
  { key: 'users',            label: 'Staff Accounts',       group: 'Settings'   },
  { key: 'settings',         label: 'Sources & Methods',    group: 'Settings'   },
  { key: 'room_controllers', label: 'Room Controllers',     group: 'Settings'   },
];

const GROUPS = ['Operations', 'Settings'];
const EMPTY_FORM = { id: '', label: '', allowed_menus: [] };

export default function SettingsRoles() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [roles, setRoles] = useState([]);
  const [modal, setModal] = useState(null); // null | 'add' | role object (edit)
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'owner') { navigate('/'); return; }
    load();
  }, []);

  async function load() {
    try {
      const { data } = await api.get('/api/settings/roles');
      setRoles(data);
    } catch (_) {}
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('add');
  }

  function openEdit(role) {
    setForm({ id: role.id, label: role.label, allowed_menus: role.allowed_menus || [] });
    setError('');
    setModal(role);
  }

  function toggleMenu(key) {
    setForm(f => ({
      ...f,
      allowed_menus: f.allowed_menus.includes(key)
        ? f.allowed_menus.filter(k => k !== key)
        : [...f.allowed_menus, key],
    }));
  }

  async function save() {
    setError('');
    if (!form.label) { setError('Role name is required'); return; }
    if (modal === 'add' && !form.id) { setError('Role ID is required'); return; }
    setLoading(true);
    try {
      if (modal === 'add') {
        await api.post('/api/settings/roles', form);
      } else {
        await api.put(`/api/settings/roles/${modal.id}`, {
          label: form.label,
          allowed_menus: form.allowed_menus,
        });
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  async function remove(role) {
    if (!confirm(`Delete role "${role.label}"? Users with this role will lose access.`)) return;
    try {
      await api.delete(`/api/settings/roles/${role.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Roles & Permissions</div>
          <div className="page-subtitle">Control which menus each role can access</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Role</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {roles.map(role => {
          const isOwner = role.id === 'owner';
          return (
            <div key={role.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isOwner ? 4 : 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{role.label}</span>
                  <span style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6', borderRadius: 6, padding: '2px 8px' }}>
                    {role.id}
                  </span>
                  {isOwner && (
                    <span className="badge badge-green" style={{ fontSize: 11 }}>Built-in · Full access</span>
                  )}
                </div>
                {!isOwner && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(role)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(role)}>Delete</button>
                  </div>
                )}
              </div>

              {isOwner ? (
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  All menus accessible — cannot be modified
                </div>
              ) : (
                GROUPS.map(group => {
                  const items = MENU_DEFS.filter(m => m.group === group);
                  return (
                    <div key={group} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        {group}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px' }}>
                        {items.map(m => {
                          const allowed = role.allowed_menus?.includes(m.key);
                          return (
                            <span
                              key={m.key}
                              style={{
                                fontSize: 12, padding: '3px 10px', borderRadius: 20,
                                background: allowed ? '#DCFCE7' : '#F3F4F6',
                                color: allowed ? '#16A34A' : '#9CA3AF',
                                fontWeight: allowed ? 600 : 400,
                              }}
                            >
                              {allowed ? '✓ ' : ''}{m.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div className="modal-title">
                {modal === 'add' ? 'Add Role' : `Edit — ${modal.label}`}
              </div>
              <button className="btn btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

              {modal === 'add' && (
                <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Role ID <span style={{ fontSize: 11, color: '#9CA3AF' }}>(lowercase, no spaces)</span></label>
                    <input
                      className="form-input"
                      placeholder="e.g. junior"
                      value={form.id}
                      onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Display Name</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Junior Staff"
                      value={form.label}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {modal !== 'add' && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Display Name</label>
                  <input
                    className="form-input"
                    value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  />
                </div>
              )}

              {GROUPS.map(group => (
                <div key={group} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    {group}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {MENU_DEFS.filter(m => m.group === group).map(m => (
                      <label
                        key={m.key}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={form.allowed_menus.includes(m.key)}
                          onChange={() => toggleMenu(m.key)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>
                Permission changes take effect on the user's next login.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Saving…' : modal === 'add' ? 'Create Role' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
