import { useState, useEffect } from 'react';
import api from '../services/api';

export default function Loyalty() {
  const [tiers, setTiers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '⭐', color: '#e5e7eb', threshold_type: 'nights', threshold_value: 1, sort_order: 0, perks: [''] });
  const [error, setError] = useState('');

  async function load() {
    const r = await api.get('/api/loyalty/tiers');
    setTiers(r.data);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({ name: '', emoji: '⭐', color: '#e5e7eb', threshold_type: 'nights', threshold_value: 1, sort_order: tiers.length, perks: [''] });
    setError('');
    setModal(true);
  }

  function openEdit(tier) {
    setEditing(tier);
    setForm({ ...tier, perks: tier.perks?.map(p => p.description) || [''] });
    setError('');
    setModal(true);
  }

  async function save() {
    setError('');
    const perks = form.perks.filter(p => p.trim());
    try {
      if (editing) await api.put(`/api/loyalty/tiers/${editing.id}`, { ...form, perks });
      else await api.post('/api/loyalty/tiers', { ...form, perks });
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error');
    }
  }

  async function deleteTier(id) {
    if (!confirm('Delete this tier? Guests will lose it.')) return;
    await api.delete(`/api/loyalty/tiers/${id}`);
    load();
  }

  function setPerk(i, v) { setForm(f => { const p = [...f.perks]; p[i] = v; return { ...f, perks: p }; }); }
  function addPerk() { setForm(f => ({ ...f, perks: [...f.perks, ''] })); }
  function removePerk(i) { setForm(f => ({ ...f, perks: f.perks.filter((_,j) => j !== i) })); }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Loyalty Program</div>
          <div className="page-subtitle">Configure tiers — changes apply to all guests instantly</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Tier</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tiers.map(tier => (
          <div key={tier.id} className="card" style={{ borderLeft: `4px solid ${tier.color || '#e5e7eb'}` }}>
            <div className="flex-between">
              <div className="flex-center gap-2">
                <span style={{ fontSize: 24 }}>{tier.emoji}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{tier.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {tier.threshold_value}+ {tier.threshold_type} · Sort {tier.sort_order}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(tier)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => deleteTier(tier.id)}>Delete</button>
              </div>
            </div>
            {tier.perks?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>PERKS</div>
                {tier.perks.map((p, i) => (
                  <div key={i} style={{ fontSize: 13, padding: '2px 0' }}>🎁 {p.description}</div>
                ))}
              </div>
            )}
          </div>
        ))}
        {tiers.length === 0 && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No loyalty tiers yet. Create your first tier above.
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editing ? 'Edit Tier' : 'New Tier'}</div>
              <button className="btn btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tier Name *</label>
                  <input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Wanderer" />
                </div>
                <div className="form-group">
                  <label className="form-label">Emoji</label>
                  <input className="form-input" value={form.emoji} onChange={e=>setForm(f=>({...f,emoji:e.target.value}))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Color</label>
                  <input className="form-input" type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Sort Order</label>
                  <input className="form-input" type="number" min={0} value={form.sort_order} onChange={e=>setForm(f=>({...f,sort_order:parseInt(e.target.value)}))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Threshold Type</label>
                  <select className="form-select" value={form.threshold_type} onChange={e=>setForm(f=>({...f,threshold_type:e.target.value}))}>
                    <option value="nights">Total Nights</option>
                    <option value="spend">Total Spend (Rp)</option>
                    <option value="visits">Number of Visits</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Minimum Value</label>
                  <input className="form-input" type="number" min={0} value={form.threshold_value} onChange={e=>setForm(f=>({...f,threshold_value:parseFloat(e.target.value)}))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Perks</label>
                {form.perks.map((p, i) => (
                  <div key={i} className="flex gap-2" style={{ marginBottom: 6 }}>
                    <input className="form-input" value={p} placeholder={`Perk ${i+1}…`} onChange={e=>setPerk(i,e.target.value)} />
                    <button className="btn btn-sm btn-danger" onClick={()=>removePerk(i)}>✕</button>
                  </div>
                ))}
                <button className="btn btn-sm btn-secondary" onClick={addPerk}>+ Add Perk</button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save Tier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
