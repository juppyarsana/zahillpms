import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

export default function Guests() {
  const [guests, setGuests] = useState([]);
  const [search, setSearch] = useState('');
  const [birthdays, setBirthdays] = useState([]);
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

  function waInvite(g) {
    const msg = encodeURIComponent(`Happy Birthday, ${g.name}! 🎂🌿\n\nWishing you a wonderful day from all of us at Birdnest Glamping, Kintamani.\n\nAs a special birthday gift, we'd love to invite you back for a complimentary upgrade on your next stay! 🎁\n\nWith warmth, Birdnest Team 🪺`);
    window.open(`https://wa.me/${g.whatsapp?.replace(/\D/g,'')}?text=${msg}`, '_blank');
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Guests</div>
      </div>

      {birthdays.length > 0 && (
        <div className="card mb-3" style={{ borderColor: 'var(--pink)', background: '#fdf2f8' }}>
          <div className="card-title" style={{ color: 'var(--pink)' }}>🎂 Upcoming Birthdays ({birthdays.length})</div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {birthdays.map(g => (
              <div key={g.id} style={{ background: 'white', border: '1px solid #fce7f3', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.birthday?.slice(5,10)} 🎂</div>
                <div className="flex gap-2 mt-2">
                  <Link to={`/guests/${g.id}`} className="btn btn-sm btn-secondary">Profile</Link>
                  {g.whatsapp && <button className="btn btn-sm btn-primary" onClick={() => waInvite(g)}>💬 WA Invite</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex-between mb-3">
          <input className="form-input" style={{ maxWidth: 320 }} placeholder="Search guests…" value={search} onChange={e => setSearch(e.target.value)} />
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
                    {g.whatsapp && (
                      <button className="btn btn-sm btn-secondary" onClick={() => waInvite(g)}>💬</button>
                    )}
                  </td>
                </tr>
              ))}
              {guests.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  {search ? 'No guests found' : 'Start searching guests above'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
