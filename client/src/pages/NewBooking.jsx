import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

function sourceMatchesAllotment(source, allotmentChannel) {
  if (allotmentChannel === 'buffer') return false;
  if (source === 'walkin') return allotmentChannel === 'direct';
  return source === allotmentChannel;
}

function AllotmentNote({ allotment, source, checkIn, sources }) {
  const monthLabel = new Date(checkIn + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' });
  const ch = allotment.channel;
  const matches = sourceMatchesAllotment(source, ch);
  function chLabel(id) {
    if (id === 'buffer') return 'Buffer';
    return sources.find(s => s.id === id)?.label || id;
  }

  if (ch === 'buffer') {
    return (
      <div className="alert alert-error" style={{ marginTop: 0 }}>
        ⚠ This unit is set as <strong>Buffer</strong> for {monthLabel} — it's reserved to prevent double-booking.
        Override only if intentional.
      </div>
    );
  }

  if (!matches) {
    return (
      <div style={{ marginTop: 0, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '10px 12px', color: '#92400e' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          ⚠ Channel mismatch: {chLabel(ch)} allotment · {chLabel(source) || source} booking
        </div>
        <div style={{ fontSize: 12, marginTop: 3 }}>
          This unit is allocated to {chLabel(ch)} for {monthLabel}. Close it on {chLabel(ch)} first to avoid double-booking.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
      ✓ Allotment for {monthLabel}: <strong>{chLabel(ch)}</strong>
      {allotment.notes && <span> · {allotment.notes}</span>}
    </div>
  );
}

export default function NewBooking() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { sources } = useSettings();
  const [units, setUnits] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestSearch, setGuestSearch] = useState('');
  const [form, setForm] = useState({
    guest_id: '', unit_id: sp.get('unit') || '',
    check_in_date: sp.get('date') || '', check_out_date: '',
    num_guests: 1, source: 'direct', total_amount: '', deposit_pct: 30, special_requests: '', status: 'pending',
  });
  const [newGuest, setNewGuest] = useState({ name: '', whatsapp: '', nationality: '', email: '' });
  const [mode, setMode] = useState('search');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceSuggestion, setPriceSuggestion] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  useEffect(() => {
    api.get('/api/units').then(r => setUnits(r.data));
  }, []);

  useEffect(() => {
    if (guestSearch.length >= 2) {
      api.get(`/api/guests?search=${encodeURIComponent(guestSearch)}`).then(r => setGuests(r.data));
    } else {
      setGuests([]);
    }
  }, [guestSearch]);

  useEffect(() => {
    if (form.unit_id && form.check_in_date && form.check_out_date) {
      api.get(`/api/pricing/suggest?unit_id=${form.unit_id}&check_in=${form.check_in_date}&check_out=${form.check_out_date}`)
        .then(r => setPriceSuggestion(r.data))
        .catch(() => setPriceSuggestion(null));
    } else {
      setPriceSuggestion(null);
    }
  }, [form.unit_id, form.check_in_date, form.check_out_date]);

  useEffect(() => {
    if (form.unit_id && form.check_in_date && form.check_out_date && form.check_out_date > form.check_in_date) {
      setAvailabilityLoading(true);
      setAvailability(null);
      api.get(`/api/bookings/availability?unit_id=${form.unit_id}&check_in=${form.check_in_date}&check_out=${form.check_out_date}`)
        .then(r => setAvailability(r.data))
        .catch(() => setAvailability(null))
        .finally(() => setAvailabilityLoading(false));
    } else {
      setAvailability(null);
    }
  }, [form.unit_id, form.check_in_date, form.check_out_date]);

  const nights = priceSuggestion?.nights || 0;
  const suggestedTotal = priceSuggestion?.suggested_total || 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let guestId = form.guest_id;
      if (mode === 'new') {
        const r = await api.post('/api/guests', newGuest);
        guestId = r.data.id;
      }
      if (!guestId) { setError('Select or create a guest'); setLoading(false); return; }
      const total = parseFloat(form.total_amount || 0);
      if (!total) { setError('Please enter the total amount before saving'); setLoading(false); return; }
      const deposit_amount = Math.round(total * (form.deposit_pct / 100));
      const res = await api.post('/api/bookings', { ...form, guest_id: guestId, deposit_amount });
      nav(`/reservations/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">New Booking</div>
          <div className="page-subtitle"><Link to="/reservations">← Back to Reservations</Link></div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card mb-3">
          <div className="card-title">Guest</div>
          <div className="flex gap-2 mb-3">
            <button type="button" className={`btn btn-sm ${mode==='search'?'btn-primary':'btn-secondary'}`} onClick={() => setMode('search')}>Search Existing</button>
            <button type="button" className={`btn btn-sm ${mode==='new'?'btn-primary':'btn-secondary'}`} onClick={() => setMode('new')}>New Guest</button>
          </div>

          {mode === 'search' ? (
            <div>
              <div className="form-group">
                <label className="form-label">Search Guest</label>
                <input className="form-input" placeholder="Name, phone, or email…" value={guestSearch}
                  onChange={e => setGuestSearch(e.target.value)} />
              </div>
              {guests.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: -4 }}>
                  {guests.map(g => (
                    <div key={g.id} onClick={() => { set('guest_id', g.id); setGuestSearch(g.name); setGuests([]); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: form.guest_id === g.id ? 'var(--green-pale)' : 'white' }}>
                      <div style={{ fontWeight: 600 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.whatsapp} · {g.nationality}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input className="form-input" value={newGuest.name} onChange={e => setNewGuest(g=>({...g,name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">WhatsApp</label>
                <input className="form-input" placeholder="+62…" value={newGuest.whatsapp} onChange={e => setNewGuest(g=>({...g,whatsapp:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Nationality</label>
                <input className="form-input" value={newGuest.nationality} onChange={e => setNewGuest(g=>({...g,nationality:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={newGuest.email} onChange={e => setNewGuest(g=>({...g,email:e.target.value}))} />
              </div>
            </div>
          )}
        </div>

        <div className="card mb-3">
          <div className="card-title">Booking Details</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Check-in *</label>
              <input className="form-input" type="date" value={form.check_in_date} onChange={e => set('check_in_date', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out *</label>
              <input className="form-input" type="date" value={form.check_out_date} min={form.check_in_date} onChange={e => set('check_out_date', e.target.value)} required />
            </div>
          </div>
          {nights > 0 && <div className="alert alert-success" style={{ marginTop: -4, marginBottom: 12 }}>{nights} night{nights !== 1 ? 's' : ''}</div>}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Unit *</label>
              <select className="form-select" value={form.unit_id} onChange={e => set('unit_id', e.target.value)} required>
                <option value="">Select unit…</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name} — Rp {Number(u.base_rate).toLocaleString('id-ID')}/night</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Number of Guests</label>
              <input className="form-input" type="number" min={1} max={10} value={form.num_guests} onChange={e => set('num_guests', parseInt(e.target.value))} />
            </div>
          </div>

          {availabilityLoading && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Checking availability…</div>
          )}
          {availability && (
            <div style={{ marginBottom: 12 }}>
              {availability.available ? (
                <div className="alert alert-success" style={{ marginBottom: availability.allotment ? 6 : 0 }}>
                  Unit is available for the selected dates
                </div>
              ) : (
                <div className="alert alert-error" style={{ marginBottom: availability.allotment ? 6 : 0 }}>
                  <strong>Not available</strong> — conflicting booking{availability.conflicts.length > 1 ? 's' : ''}:
                  {availability.conflicts.map(c => (
                    <div key={c.id} style={{ marginTop: 4, fontSize: 12 }}>
                      {c.guest_name} · {c.check_in_date?.slice(0,10)} → {c.check_out_date?.slice(0,10)} ({c.status})
                    </div>
                  ))}
                </div>
              )}
              {availability.allotment ? (
                <AllotmentNote allotment={availability.allotment} source={form.source} checkIn={form.check_in_date} sources={sources} />
              ) : form.unit_id && form.check_in_date ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  No allotment set for {new Date(form.check_in_date + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' })}
                </div>
              ) : null}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Source</label>
              <select className="form-select" value={form.source} onChange={e => set('source', e.target.value)}>
                {sources.filter(s => s.is_active).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Total Amount (IDR)</label>
            <input className="form-input" type="number" value={form.total_amount} placeholder={suggestedTotal ? `Suggested: ${suggestedTotal}` : ''}
              onChange={e => set('total_amount', e.target.value)} />
            {priceSuggestion && !form.total_amount && suggestedTotal > 0 && (
              <div style={{ marginTop: 6 }}>
                {priceSuggestion.period && (
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    <span style={{ background: priceSuggestion.period.color, color: 'white', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                      {priceSuggestion.period.name}
                    </span>
                    {' '}applied · Rp {Number(priceSuggestion.rate_per_night).toLocaleString('id-ID')}/night
                  </div>
                )}
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('total_amount', suggestedTotal)}>
                  Use Rp {Number(suggestedTotal).toLocaleString('id-ID')}
                  {!priceSuggestion.period && ' (base rate)'}
                </button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Deposit Required</label>
            <div className="flex gap-2 flex-center">
              <input className="form-input" type="number" min={0} max={100} value={form.deposit_pct}
                onChange={e => set('deposit_pct', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ maxWidth: 80 }} />
              <span>%</span>
              <div className="flex gap-2" style={{ marginLeft: 8 }}>
                {[0, 30, 50, 100].map(pct => (
                  <button key={pct} type="button"
                    className={`btn btn-sm ${form.deposit_pct === pct ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => set('deposit_pct', pct)}>
                    {pct === 0 ? 'None' : pct === 100 ? 'Full' : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>
            {form.total_amount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Deposit: Rp {Math.round(parseFloat(form.total_amount) * form.deposit_pct / 100).toLocaleString('id-ID')}
                {' · '}Balance: Rp {Math.round(parseFloat(form.total_amount) * (1 - form.deposit_pct / 100)).toLocaleString('id-ID')}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Special Requests</label>
            <textarea className="form-textarea" value={form.special_requests} onChange={e => set('special_requests', e.target.value)} placeholder="Any notes or requests from the guest…" />
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
          <Link to="/reservations" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={loading || availability?.available === false}>
            {loading ? 'Creating…' : 'Create Booking'}
          </button>
        </div>
      </form>
    </div>
  );
}
