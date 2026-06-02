import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

const EMPTY_FORM = {
  name: '', nationality: '', whatsapp: '', email: '',
  birthday: '', anniversary: '', notes: '',
};

export default function Guests() {
  const [guests, setGuests] = useState([]);
  const [search, setSearch] = useState('');
  const [birthdays, setBirthdays] = useState([]);
  const [modal, setModal] = useState(null); // null | 'add' | guest object (edit)
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    api.get('/api/guests/upcoming-birthdays').then(r => setBirthdays(r.data));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/api/guests?search=${encodeURIComponent(search)}`).then(r => setGuests(r.data));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    api.get(`/api/guests?search=${encodeURIComponent(search)}`).then(r => setGuests(r.data));
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('add');
  }

  function openEdit(g) {
    setForm({
      name: g.name || '',
      nationality: g.nationality || '',
      whatsapp: g.whatsapp || '',
      email: g.email || '',
      birthday: g.birthday?.slice(0, 10) || '',
      anniversary: g.anniversary?.slice(0, 10) || '',
      notes: g.notes || '',
    });
    setError('');
    setModal(g);
  }

  async function save() {
    if (!form.name.trim()) { setError('Guest name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        birthday: form.birthday || null,
        anniversary: form.anniversary || null,
      };
      if (modal === 'add') {
        await api.post('/api/guests', payload);
      } else {
        await api.put(`/api/guests/${modal.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  async function remove(g) {
    if (!confirm(`Delete ${g.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/guests/${g.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  function waInvite(g) {
    const msg = encodeURIComponent(`Happy Birthday, ${g.name}! 🎂🌿\n\nWishing you a wonderful day from all of us at Birdnest Glamping, Kintamani.\n\nAs a special birthday gift, we'd love to invite you back for a complimentary upgrade on your next stay! 🎁\n\nWith warmth, Birdnest Team 🪺`);
    const rawWa = (g.whatsapp || '').trim();
    let waNum = rawWa.replace(/\D/g, '');
    if (!rawWa.startsWith('+')) {
      if (waNum.startsWith('0')) waNum = '62' + waNum.slice(1);
      else if (!waNum.startsWith('62')) waNum = '62' + waNum;
    }
    window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Guests</div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Guest</button>
      </div>

      {birthdays.length > 0 && (
        <div className="card mb-3" style={{ borderColor: 'var(--pink)', background: '#fdf2f8' }}>
          <div className="card-title" style={{ color: 'var(--pink)' }}>🎂 Upcoming Birthdays ({birthdays.length})</div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {birthdays.map(g => (
              <div key={g.id} style={{ background: 'white', border: '1px solid #fce7f3', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.birthday?.slice(5, 10)} 🎂</div>
                <div className="flex gap-2 mt-2">
                  <Link to={`/guests/${g.id}`} className="btn btn-sm btn-secondary">Profile</Link>
                  {g.whatsapp && <button className="btn btn-sm btn-primary" onClick={() => waInvite(g)}>💬 WA</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex-between mb-3">
          <input className="form-input" style={{ maxWidth: 320 }} placeholder="Search guests…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Nationality</th><th>WhatsApp</th><th>Email</th><th>Tier</th><th></th></tr>
            </thead>
            <tbody>
              {guests.map(g => (
                <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/guests/${g.id}`)}>
                  <td style={{ fontWeight: 600 }}>{g.name}</td>
                  <td>{g.nationality}</td>
                  <td>{g.whatsapp}</td>
                  <td>{g.email}</td>
                  <td>
                    {g.tier_name && (
                      <span className="badge" style={{ background: g.tier_color || '#e5e7eb', color: '#1f2937' }}>
                        {g.tier_emoji} {g.tier_name}
                      </span>
                    )}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {g.whatsapp && (
                        <button className="btn btn-sm btn-secondary" title="WhatsApp" onClick={() => waInvite(g)}>💬</button>
                      )}
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(g)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(g)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {guests.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  {search ? 'No guests found' : 'No guests yet — add your first guest above'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">{modal === 'add' ? 'Add Guest' : `Edit — ${modal.name}`}</div>
              <button className="btn btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nationality</label>
                  <input className="form-input" value={form.nationality} onChange={e => set('nationality', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">WhatsApp</label>
                  <input className="form-input" type="tel" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="+62..." />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Birthday</label>
                  <input className="form-input" type="date" value={form.birthday} onChange={e => set('birthday', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Anniversary</label>
                  <input className="form-input" type="date" value={form.anniversary} onChange={e => set('anniversary', e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any notes about this guest…" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Saving…' : modal === 'add' ? 'Add Guest' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
