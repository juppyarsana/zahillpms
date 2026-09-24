import { useState, useEffect } from 'react';
import api from '../services/api';

// Pick the guest staying in a room: search an existing guest profile, or add
// a new one on the spot (only the name is required — nationality, passport/ID
// and phone can follow later on the guest profile). Used by BookingDetail's
// "Change Guest" and GroupDetail's "Assign Guests".
//
// value: null (no change) | { guest_id, name } | { new_guest: { name, ... } }
export default function GuestPicker({ value, onChange, placeholder = 'Search guest name, phone or email…' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', nationality: '', id_number: '', whatsapp: '' });

  // Same 300ms debounce as the Reservations search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.get('/api/guests', { params: { search: q } })
        .then(r => setResults(r.data.slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function startAdding() {
    const f = { name: query.trim(), nationality: '', id_number: '', whatsapp: '' };
    setForm(f);
    setAdding(true);
    onChange(f.name ? { new_guest: f } : null);
  }

  function setField(k, v) {
    const f = { ...form, [k]: v };
    setForm(f);
    onChange(f.name.trim() ? { new_guest: f } : null);
  }

  function clear() {
    setAdding(false);
    setQuery('');
    setResults([]);
    onChange(null);
  }

  if (value?.guest_id) {
    return (
      <div className="flex-between" style={{ gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
        <span><b>{value.name}</b>{value.detail && <span className="text-muted" style={{ fontSize: 12 }}> · {value.detail}</span>}</span>
        <button className="btn btn-sm btn-secondary" onClick={clear}>Change</button>
      </div>
    );
  }

  if (adding) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
        <div className="flex-between" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>New guest</span>
          <button className="btn btn-sm btn-secondary" onClick={clear}>Cancel</button>
        </div>
        <input className="form-input" placeholder="Full name *" value={form.name} autoFocus
          onChange={e => setField('name', e.target.value)} style={{ marginBottom: 6 }} />
        <div className="form-row" style={{ gap: 6 }}>
          <input className="form-input" placeholder="Nationality" value={form.nationality} onChange={e => setField('nationality', e.target.value)} />
          <input className="form-input" placeholder="Passport / ID no." value={form.id_number} onChange={e => setField('id_number', e.target.value)} />
          <input className="form-input" placeholder="Phone / WhatsApp" value={form.whatsapp} onChange={e => setField('whatsapp', e.target.value)} />
        </div>
      </div>
    );
  }

  const q = query.trim();
  return (
    <div>
      <input className="form-input" placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)} />
      {q.length >= 2 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4 }}>
          {searching && <div className="text-muted" style={{ fontSize: 12, padding: '6px 10px' }}>Searching…</div>}
          {!searching && results.map(g => (
            <div key={g.id} style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onClick={() => onChange({ guest_id: g.id, name: g.name, detail: [g.nationality, g.whatsapp].filter(Boolean).join(' · ') })}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{[g.nationality, g.whatsapp, g.email].filter(Boolean).join(' · ') || 'No details'}</div>
            </div>
          ))}
          {!searching && results.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12, padding: '6px 10px' }}>No guest found.</div>
          )}
          <div style={{ padding: '6px 10px', cursor: 'pointer', color: 'var(--green-dark)', fontWeight: 600, fontSize: 13 }} onClick={startAdding}>
            + Add “{q}” as a new guest
          </div>
        </div>
      )}
    </div>
  );
}
