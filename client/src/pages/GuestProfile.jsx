import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { SourceBadge } from '../context/SettingsContext';

const PREF_ICONS  = { dietary: '🍽', room: '🛏', habit: '💡', special: '⭐' };
const PREF_CLASS  = { dietary: 'pref-food', room: 'pref-room', habit: 'pref-habit', special: 'pref-special' };


const STATUS_CLASS = { confirmed: 'badge-blue', deposit_paid: 'badge-amber', pending: 'badge-amber', checked_in: 'badge-green', checked_out: 'badge-gray', cancelled: 'badge-red', no_show: 'badge-red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function GuestProfile() {
  const { id } = useParams();
  const [guest, setGuest] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [newPref, setNewPref] = useState({ category: 'dietary', value: '' });

  async function load() {
    const r = await api.get(`/api/guests/${id}`);
    setGuest(r.data);
    setForm({ name: r.data.name, nationality: r.data.nationality, whatsapp: r.data.whatsapp, email: r.data.email, birthday: r.data.birthday?.slice(0,10)||'', anniversary: r.data.anniversary?.slice(0,10)||'', notes: r.data.notes||'' });
  }

  useEffect(() => { load(); }, [id]);

  async function save() {
    await api.put(`/api/guests/${id}`, form);
    setEditing(false);
    load();
  }

  async function addPref() {
    if (!newPref.value.trim()) return;
    const prefs = [...(guest.preferences||[]), newPref];
    await api.put(`/api/guests/${id}`, { preferences: prefs });
    setNewPref({ category: 'dietary', value: '' });
    load();
  }

  async function removePref(idx) {
    const prefs = (guest.preferences||[]).filter((_,i) => i !== idx);
    await api.put(`/api/guests/${id}`, { preferences: prefs });
    load();
  }

  if (!guest) return <div style={{ padding: 40 }}>Loading…</div>;
  const { lifetime } = guest;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">{guest.name}</div>
          <div className="page-subtitle"><Link to="/guests">← Guests</Link></div>
        </div>
        <div className="flex gap-2">
          {guest.whatsapp && (
            <a href={`https://wa.me/${guest.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="btn btn-secondary">💬 WhatsApp</a>
          )}
          <button className="btn btn-primary" onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
        </div>
      </div>

      {guest.tier_name && (
        <div style={{ background: guest.tier_color || '#e5e7eb', borderRadius: 8, padding: '10px 16px', marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{guest.tier_emoji}</span>
          <div>
            <div style={{ fontWeight: 700 }}>{guest.tier_name}</div>
            <div style={{ fontSize: 12 }}>Loyalty Member</div>
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label">Total Stays</div><div className="stat-value">{lifetime?.stays}</div></div>
        <div className="stat-card"><div className="stat-label">Total Nights</div><div className="stat-value">{lifetime?.nights}</div></div>
        <div className="stat-card"><div className="stat-label">Lifetime Value</div><div className="stat-value" style={{ fontSize: 16 }}>{fmtIDR(lifetime?.spend)}</div></div>
      </div>

      {editing ? (
        <div className="card mb-3">
          <div className="card-title">Edit Profile</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Nationality</label><input className="form-input" value={form.nationality||''} onChange={e=>setForm(f=>({...f,nationality:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">WhatsApp</label><input className="form-input" value={form.whatsapp||''} onChange={e=>setForm(f=>({...f,whatsapp:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.email||''} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Birthday</label><input className="form-input" type="date" value={form.birthday||''} onChange={e=>setForm(f=>({...f,birthday:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Anniversary</label><input className="form-input" type="date" value={form.anniversary||''} onChange={e=>setForm(f=>({...f,anniversary:e.target.value}))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
          <button className="btn btn-primary" onClick={save}>Save Changes</button>
        </div>
      ) : (
        <div className="grid-2 mb-3" style={{ gap: 12 }}>
          <div className="card">
            <div className="card-title">Contact</div>
            <div className="flex-between" style={{ marginBottom: 6 }}><span className="text-muted">Nationality</span><span>{guest.nationality||'—'}</span></div>
            <div className="flex-between" style={{ marginBottom: 6 }}><span className="text-muted">WhatsApp</span><span>{guest.whatsapp||'—'}</span></div>
            <div className="flex-between" style={{ marginBottom: 6 }}><span className="text-muted">Email</span><span>{guest.email||'—'}</span></div>
            <div className="flex-between" style={{ marginBottom: 6 }}><span className="text-muted">Birthday</span><span>{guest.birthday?.slice(0,10)||'—'}</span></div>
            <div className="flex-between"><span className="text-muted">Anniversary</span><span>{guest.anniversary?.slice(0,10)||'—'}</span></div>
          </div>
          <div className="card">
            <div className="card-title">Notes</div>
            <p style={{ fontSize: 13, color: guest.notes ? 'inherit' : 'var(--text-muted)' }}>{guest.notes||'No notes'}</p>
            {guest.id_document_url && <div className="mt-2"><a href={guest.id_document_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">🪪 View ID</a></div>}
          </div>
        </div>
      )}

      <div className="card mb-3">
        <div className="card-title">Preferences & Habits</div>
        {(guest.preferences||[]).length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>No preferences recorded yet.</p>
        )}
        <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 12 }}>
          {(guest.preferences||[]).map((p, i) => (
            <span key={p.id || i} className={`pref-tag ${PREF_CLASS[p.category] || 'pref-habit'}`}>
              {PREF_ICONS[p.category]} {p.value}
              <button
                onClick={() => removePref(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 12, opacity: 0.6, lineHeight: 1 }}
              >✕</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 130 }} value={newPref.category} onChange={e=>setNewPref(p=>({...p,category:e.target.value}))}>
            <option value="dietary">Dietary</option>
            <option value="room">Room</option>
            <option value="habit">Habit</option>
            <option value="special">Special</option>
          </select>
          <input className="form-input" placeholder="e.g. Peanut allergy, Prefers Nest 2…" value={newPref.value} onChange={e=>setNewPref(p=>({...p,value:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&addPref()} style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={addPref}>+ Add</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Stay History</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Unit</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Source</th><th>Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(guest.stay_history||[]).map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.unit_name}</td>
                  <td>{s.check_in_date?.slice(0,10)}</td>
                  <td>{s.check_out_date?.slice(0,10)}</td>
                  <td>{s.nights}</td>
                  <td>
                    <SourceBadge sourceId={s.source} />
                  </td>
                  <td style={{ fontWeight: 600 }}>{fmtIDR(s.total_amount)}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[s.status] || 'badge-gray'}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </td>
                  <td>
                    <Link to={`/reservations/${s.id}`} className="btn btn-sm btn-secondary">View</Link>
                  </td>
                </tr>
              ))}
              {(!guest.stay_history?.length) && <tr><td colSpan={8} style={{ textAlign:'center', color:'var(--text-muted)', padding: 20 }}>No stays yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
