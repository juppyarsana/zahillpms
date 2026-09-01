import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

// Staff-facing heads-up when the chosen source is an agent with a non-standard
// billing arrangement. Informational only — booking creation is unchanged; the
// actual city-ledger / commission settlement flow lands in a later slice.
function SourceBillingNote({ source }) {
  if (!source || !source.payment_status || source.payment_status === 'normal') return null;
  const ps = source.payment_status;
  const cityLedger = ps === 'city_ledger' || ps === 'city_ledger_payment' || ps === 'commission_and_city_ledger';
  const commission = ps === 'commission' || ps === 'commission_and_city_ledger';
  const commissionText = commission && source.commission_value
    ? ` Commission to ${source.label}: ${source.commission_value}${source.commission_type === 'amount' ? ' IDR' : '%'}.`
    : '';
  const msg = cityLedger
    ? `Billed to ${source.label} — settled via the agent statement, not collected from the guest at checkout.${commissionText}`
    : `Property pays ${source.label} a commission on this booking.${commissionText}`;
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 10px' }}>
      {msg}
    </div>
  );
}

// Warn-only heads-up when a booking would push an agent source past its
// credit limit. Never blocks submission (client decision, locked 2026-08-31).
function CreditLimitNote({ check }) {
  if (!check || !check.would_exceed) return null;
  const fmt = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 10px' }}>
      ⚠ {check.label} would be over its credit limit — {fmt(check.projected_outstanding)} projected vs {fmt(check.credit_limit)} limit
      ({fmt(check.over_by)} over). The booking is still allowed; settle the agent statement to bring the balance down.
    </div>
  );
}

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

const EMPTY_ROOM = { unit_id: '', num_guests: 1, total_amount: '' };

export default function NewBooking() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { sources } = useSettings();
  const [units, setUnits] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestSearch, setGuestSearch] = useState('');
  const [form, setForm] = useState({
    guest_id: '',
    check_in_date: sp.get('date') || '', check_out_date: '',
    source: 'direct', deposit_pct: 30, special_requests: '', status: 'pending',
    discount_type: '', discount_value: '',
  });
  const [rooms, setRooms] = useState([{ ...EMPTY_ROOM, unit_id: sp.get('unit') || '' }]);
  const [newGuest, setNewGuest] = useState({ name: '', whatsapp: '', nationality: '', email: '' });
  const [mode, setMode] = useState('search');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceSuggestions, setPriceSuggestions] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [creditCheck, setCreditCheck] = useState(null);

  const isGroup = rooms.length > 1;

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

  const unitIdsKey = rooms.map(r => r.unit_id).join(',');

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date) { setPriceSuggestions([]); return; }
    Promise.all(rooms.map(r => r.unit_id
      ? api.get(`/api/pricing/suggest?unit_id=${r.unit_id}&check_in=${form.check_in_date}&check_out=${form.check_out_date}`).then(res => res.data).catch(() => null)
      : Promise.resolve(null)
    )).then(setPriceSuggestions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIdsKey, form.check_in_date, form.check_out_date]);

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) { setAvailabilities([]); return; }
    setAvailabilityLoading(true);
    Promise.all(rooms.map(r => r.unit_id
      ? api.get(`/api/bookings/availability?unit_id=${r.unit_id}&check_in=${form.check_in_date}&check_out=${form.check_out_date}`).then(res => res.data).catch(() => null)
      : Promise.resolve(null)
    )).then(setAvailabilities).finally(() => setAvailabilityLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIdsKey, form.check_in_date, form.check_out_date]);

  const groupTotal = rooms.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const dValue     = parseFloat(form.discount_value || 0);
  const discountAmt = !form.discount_type || !dValue ? 0
    : form.discount_type === 'fixed' ? Math.min(dValue, groupTotal)
    : Math.round(groupTotal * dValue / 100);
  const netAmt = groupTotal - discountAmt;

  useEffect(() => {
    const src = sources.find(s => s.id === form.source);
    if (!src || src.credit_limit == null) { setCreditCheck(null); return; }
    const t = setTimeout(() => {
      api.get(`/api/settings/booking-sources/${form.source}/credit-check?amount=${netAmt}`)
        .then(r => setCreditCheck(r.data))
        .catch(() => setCreditCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [form.source, netAmt, sources]);

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
      if (rooms.some(r => !r.unit_id)) { setError('Select a unit for every room'); setLoading(false); return; }
      if (rooms.some(r => !parseFloat(r.total_amount || 0))) { setError('Please enter the total amount for every room'); setLoading(false); return; }

      const deposit_amount = Math.round(netAmt * (form.deposit_pct / 100));

      if (!isGroup) {
        // Single-room booking — same endpoint and payload shape as before
        // this feature existed. No proration, no group ever created.
        const room = rooms[0];
        const res = await api.post('/api/bookings', {
          guest_id: guestId,
          unit_id: room.unit_id,
          num_guests: room.num_guests,
          total_amount: room.total_amount,
          check_in_date: form.check_in_date,
          check_out_date: form.check_out_date,
          source: form.source,
          status: form.status,
          special_requests: form.special_requests,
          deposit_amount,
          discount_type: form.discount_type || null,
          discount_value: dValue,
        });
        nav(`/reservations/${res.data.id}`);
      } else {
        const res = await api.post('/api/bookings/group', {
          guest_id: guestId,
          check_in_date: form.check_in_date,
          check_out_date: form.check_out_date,
          source: form.source,
          status: form.status,
          special_requests: form.special_requests,
          group_discount_type: form.discount_type || null,
          group_discount_value: dValue,
          group_deposit_amount: deposit_amount,
          rooms: rooms.map(r => ({ unit_id: r.unit_id, num_guests: r.num_guests, total_amount: r.total_amount })),
        });
        nav(`/reservations/group/${res.data.group.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setRoom(i, k, v) { setRooms(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r)); }
  function addRoom() { setRooms(rs => [...rs, { ...EMPTY_ROOM }]); }
  function removeRoom(i) { setRooms(rs => rs.filter((_, idx) => idx !== i)); }

  const anyUnavailable = availabilities.some(a => a && a.available === false);

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
          <div className="card-title">Dates</div>
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
          <div className="form-group">
            <label className="form-label">Source</label>
            <select className="form-select" value={form.source} onChange={e => set('source', e.target.value)}>
              {sources.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <SourceBillingNote source={sources.find(s => s.id === form.source)} />
            <CreditLimitNote check={creditCheck} />
          </div>
        </div>

        {rooms.map((room, i) => {
          const priceSuggestion = priceSuggestions[i];
          const availability = availabilities[i];
          const suggestedTotal = priceSuggestion?.suggested_total || 0;
          return (
            <div className="card mb-3" key={i}>
              <div className="card-title flex" style={{ justifyContent: 'space-between' }}>
                <span>{isGroup ? `Room ${i + 1}` : 'Booking Details'}</span>
                {rooms.length > 1 && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => removeRoom(i)}>Remove</button>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Unit *</label>
                  <select className="form-select" value={room.unit_id} onChange={e => setRoom(i, 'unit_id', e.target.value)} required>
                    <option value="">Select unit…</option>
                    {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Number of Guests</label>
                  <input className="form-input" type="number" min={1} max={10} value={room.num_guests} onChange={e => setRoom(i, 'num_guests', parseInt(e.target.value))} />
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
                  ) : room.unit_id && form.check_in_date ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
                      No allotment set for {new Date(form.check_in_date + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Total Amount (IDR)</label>
                <input className="form-input" type="number" value={room.total_amount} placeholder={suggestedTotal ? `Suggested: ${suggestedTotal}` : ''}
                  onChange={e => setRoom(i, 'total_amount', e.target.value)} />
                {priceSuggestion && !room.total_amount && suggestedTotal > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {priceSuggestion.period && (
                      <div style={{ fontSize: 12, marginBottom: 4 }}>
                        <span style={{ background: priceSuggestion.period.color, color: 'white', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                          {priceSuggestion.period.name}
                        </span>
                        {' '}applied · Rp {Number(priceSuggestion.rate_per_night).toLocaleString('id-ID')}/night
                      </div>
                    )}
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRoom(i, 'total_amount', suggestedTotal)}>
                      Use Rp {Number(suggestedTotal).toLocaleString('id-ID')}
                      {!priceSuggestion.period && ' (base rate)'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div className="mb-3">
          <button type="button" className="btn btn-secondary" onClick={addRoom}>+ Add Another Room</button>
        </div>

        <div className="card mb-3">
          <div className="card-title">{isGroup ? 'Group Discount & Deposit' : 'Discount & Deposit'}</div>
          {isGroup && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Group total: Rp {groupTotal.toLocaleString('id-ID')} across {rooms.length} rooms
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Discount</label>
            <div className="flex gap-2 flex-center" style={{ marginBottom: 6 }}>
              {[{ v: '', label: 'None' }, { v: 'fixed', label: 'Fixed (IDR)' }, { v: 'percentage', label: 'Percentage (%)' }].map(opt => (
                <button key={opt.v} type="button"
                  className={`btn btn-sm ${form.discount_type === opt.v ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { set('discount_type', opt.v); set('discount_value', ''); }}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.discount_type && (
              <div className="flex gap-2 flex-center">
                <input className="form-input" type="number" min={0}
                  placeholder={form.discount_type === 'fixed' ? 'Amount in IDR' : '0 – 100'}
                  value={form.discount_value}
                  onChange={e => set('discount_value', e.target.value)}
                  style={{ maxWidth: 200 }} />
                <span style={{ color: 'var(--text-muted)' }}>{form.discount_type === 'percentage' ? '%' : 'IDR'}</span>
              </div>
            )}
            {discountAmt > 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-success, green)', marginTop: 4 }}>
                Discount: − Rp {discountAmt.toLocaleString('id-ID')} · Net: Rp {netAmt.toLocaleString('id-ID')}
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
            {netAmt > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Deposit: Rp {Math.round(netAmt * form.deposit_pct / 100).toLocaleString('id-ID')}
                {' · '}Balance: Rp {Math.round(netAmt * (1 - form.deposit_pct / 100)).toLocaleString('id-ID')}
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
          <button type="submit" className="btn btn-primary" disabled={loading || anyUnavailable}>
            {loading ? 'Creating…' : isGroup ? 'Create Group Booking' : 'Create Booking'}
          </button>
        </div>
      </form>
    </div>
  );
}
