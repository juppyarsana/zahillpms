import { useState, useEffect } from 'react';
import api from '../services/api';

const STATUS_OPTIONS = ['available', 'occupied', 'maintenance', 'blocked'];
const STATUS_BADGE = { available: 'green', occupied: 'yellow', maintenance: 'red', blocked: 'gray' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function UnitSettings() {
  const [units, setUnits] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const r = await api.get('/api/units');
    setUnits(r.data);
  }
  useEffect(() => { load(); }, []);

  function openEdit(unit) {
    setEditing(unit.id);
    setForm({
      name: unit.name,
      type: unit.type || '',
      description: unit.description || '',
      base_rate: unit.base_rate,
      max_guests: unit.max_guests,
      status: unit.status,
    });
    setError('');
    setMsg('');
  }

  async function save(id) {
    setError('');
    try {
      await api.put(`/api/units/${id}`, form);
      setEditing(null);
      setMsg('Saved!');
      load();
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Unit Settings</div>
          <div className="page-subtitle">Manage your glamping nests</div>
        </div>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {units.map(unit => (
          <div key={unit.id} className="card">
            {editing === unit.id ? (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Unit Name</label>
                    <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <input className="form-input" placeholder="e.g. Glamping Tent" value={form.type} onChange={e => set('type', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-input" placeholder="Short description…" value={form.description} onChange={e => set('description', e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Base Rate / Night (IDR)</label>
                    <input className="form-input" type="number" value={form.base_rate} onChange={e => set('base_rate', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Guests</label>
                    <input className="form-input" type="number" min={1} max={10} value={form.max_guests} onChange={e => set('max_guests', parseInt(e.target.value))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {error && <div className="alert alert-error">{error}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => save(unit.id)}>Save</button>
                  <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="flex-between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{unit.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {unit.type} · {fmtIDR(unit.base_rate)}/night · Max {unit.max_guests} guests
                  </div>
                  {unit.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{unit.description}</div>}
                </div>
                <div className="flex gap-2 flex-center">
                  <span className={`badge badge-${STATUS_BADGE[unit.status] || 'gray'}`}>{unit.status}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => openEdit(unit)}>Edit</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
