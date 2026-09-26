import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';

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

// YYYY-MM-DD date math on local calendar dates (toISOString is UTC).
function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

const idr = n => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

// A typed room total far from the normal price for the stay is usually a
// nightly price typed into the whole-stay field (or an extra zero).
function priceWarning(total, normal, nights) {
  const t = parseFloat(total);
  if (!t || !normal) return null;
  const ratio = t / normal;
  if (ratio < 0.6) {
    return nights > 1 && Math.abs(t * nights - normal) / normal < 0.4
      ? `Much lower than the normal price for ${nights} nights (${idr(normal)}). Did you type one night's price? This field is the whole stay.`
      : `Much lower than the normal price for ${nights} night${nights > 1 ? 's' : ''} (${idr(normal)}).`;
  }
  if (ratio > 1.5) return `Much higher than the normal price for ${nights} night${nights > 1 ? 's' : ''} (${idr(normal)}). Check for an extra zero.`;
  return null;
}

const EMPTY_ROOM = { unit_id: '', num_guests: 1, total_amount: '', rate_plan_id: '', bed_preference: '' };

const BED_PREFS = [
  ['', 'No preference'],
  ['double', 'Double bed'],
  ['twin', 'Twin beds'],
];

export default function NewBooking() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { sources, ratePlans } = useSettings();
  const [units, setUnits] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestSearch, setGuestSearch] = useState('');
  // Pre-fill: from a calendar cell (?unit=&date=, 1 night) or from Check
  // Availability (?check_in=&check_out=&units=a,b&guests=2,2 — 2+ units open
  // as a group booking).
  const preIn = sp.get('check_in') || sp.get('date') || '';
  const preOut = sp.get('check_out') || (sp.get('date') ? addDaysYmd(sp.get('date'), 1) : '');
  const preUnits = (sp.get('units') || sp.get('unit') || '').split(',').filter(Boolean);
  const preGuests = (sp.get('guests') || '').split(',').map(g => parseInt(g, 10) || 1);
  const { can } = useAuth();
  // Complimentary stay (single room): the booking is created at its normal
  // price, then made free on the booking page (ComplimentaryModal) — directly
  // with the permission, otherwise via a manager's Telegram approval code.
  const [comp, setComp] = useState({ on: false, scope: 'room', reason: '' });
  const [form, setForm] = useState({
    guest_id: '',
    check_in_date: preIn, check_out_date: preOut,
    source: 'direct', deposit_pct: 50, special_requests: '', status: 'pending',
    discount_type: '', discount_value: '',
  });
  const [rooms, setRooms] = useState(preUnits.length
    ? preUnits.map((id, i) => ({ ...EMPTY_ROOM, unit_id: id, num_guests: preGuests[i] || 1 }))
    : [{ ...EMPTY_ROOM }]);
  const [newGuest, setNewGuest] = useState({ name: '', whatsapp: '', nationality: '', email: '' });
  const [mode, setMode] = useState('search');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceSuggestions, setPriceSuggestions] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [creditCheck, setCreditCheck] = useState(null);
  // Nights ↔ check-out stay in sync: type nights and check-out follows, pick
  // check-out and nights follows; moving check-in keeps the number of nights.
  const [nights, setNights] = useState(preIn && preOut && preOut > preIn ? String(nightsBetween(preIn, preOut)) : '');
  // Every unit's availability for the chosen dates (booked / free), so the
  // Unit dropdown can grey out rooms that are taken.
  const [unitAvail, setUnitAvail] = useState({});

  const isGroup = rooms.length > 1;
  // Review step: "Create Booking" first shows a summary to confirm.
  const [review, setReview] = useState(false);
  const stayNights = form.check_in_date && form.check_out_date && form.check_out_date > form.check_in_date
    ? nightsBetween(form.check_in_date, form.check_out_date) : 0;

  function onCheckIn(v) {
    const n = parseInt(nights, 10) || 1;
    setNights(String(n));
    setForm(f => ({ ...f, check_in_date: v, check_out_date: v ? addDaysYmd(v, n) : f.check_out_date }));
  }
  function onNights(v) {
    setNights(v);
    const n = parseInt(v, 10);
    if (n >= 1 && form.check_in_date) setForm(f => ({ ...f, check_out_date: addDaysYmd(f.check_in_date, n) }));
  }
  function onCheckOut(v) {
    setForm(f => ({ ...f, check_out_date: v }));
    if (v && form.check_in_date && v > form.check_in_date) setNights(String(nightsBetween(form.check_in_date, v)));
  }

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) { setUnitAvail({}); return; }
    api.get('/api/bookings/transfer-availability', { params: { check_in: form.check_in_date, check_out: form.check_out_date } })
      .then(r => setUnitAvail(Object.fromEntries(r.data.map(u => [u.id, u]))))
      .catch(() => setUnitAvail({}));
  }, [form.check_in_date, form.check_out_date]);

  // Dropdown label + whether it can be picked for room row `i`.
  function unitOption(u, i) {
    const otherRow = rooms.findIndex((r, j) => j !== i && r.unit_id === u.id);
    const a = unitAvail[u.id];
    let note = '';
    let blocked = false;
    if (otherRow !== -1) { note = ` — already in this group (Room ${otherRow + 1})`; blocked = true; }
    else if (a && !a.available) {
      note = a.conflict?.overdue
        ? ` — ${a.conflict.guest_name} still checked in (overdue)`
        : ` — booked${a.conflict?.guest_name ? ` (${a.conflict.guest_name})` : ''}`;
      blocked = true;
    }
    // Out of order is a current status, not date-based — the room may be back
    // by these dates, so it's flagged but still selectable.
    else if (u.status === 'out_of_order') note = ' — out of order now';
    return { label: `${u.name}${u.type ? ` · ${u.type}` : ''}${note}`, disabled: blocked && rooms[i].unit_id !== u.id };
  }

  useEffect(() => {
    api.get('/api/units').then(r => setUnits(r.data));
  }, []);

  // Default every room's rate plan to the property default once plans load.
  const defaultRatePlanId = (ratePlans.find(p => p.is_default) || ratePlans[0])?.id || '';
  useEffect(() => {
    if (!defaultRatePlanId) return;
    setRooms(rs => rs.map(r => r.rate_plan_id ? r : { ...r, rate_plan_id: defaultRatePlanId }));
  }, [defaultRatePlanId]);

  useEffect(() => {
    if (guestSearch.length >= 2) {
      api.get(`/api/guests?search=${encodeURIComponent(guestSearch)}`).then(r => setGuests(r.data));
    } else {
      setGuests([]);
    }
  }, [guestSearch]);

  const unitIdsKey = rooms.map(r => r.unit_id).join(',');
  const suggestKey = rooms.map(r => `${r.unit_id}:${r.rate_plan_id}:${r.num_guests}`).join(',');

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date) { setPriceSuggestions([]); return; }
    Promise.all(rooms.map(r => r.unit_id
      ? api.get(`/api/pricing/suggest?unit_id=${r.unit_id}&check_in=${form.check_in_date}&check_out=${form.check_out_date}&rate_plan_id=${r.rate_plan_id || ''}&num_guests=${r.num_guests || 1}`).then(res => res.data).catch(() => null)
      : Promise.resolve(null)
    )).then(setPriceSuggestions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey, form.check_in_date, form.check_out_date]);

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

  // Form submit only checks the form and opens the review; createBooking()
  // (the review's Confirm) actually saves.
  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'new' ? !newGuest.name.trim() : !form.guest_id) { setError('Select or create a guest'); return; }
    if (rooms.some(r => !r.unit_id)) { setError('Select a unit for every room'); return; }
    if (rooms.some(r => !parseFloat(r.total_amount || 0))) { setError('Please enter the total amount for every room'); return; }
    if (comp.on && !isGroup && !comp.reason.trim()) { setError('Give a reason for the complimentary stay'); return; }
    setReview(true);
  }

  async function createBooking() {
    setError('');
    setLoading(true);
    try {
      let guestId = form.guest_id;
      if (mode === 'new') {
        const r = await api.post('/api/guests', newGuest);
        guestId = r.data.id;
        // If the booking itself fails, a retry reuses this guest (no duplicate).
        setForm(f => ({ ...f, guest_id: guestId }));
        setGuestSearch(newGuest.name);
        setMode('search');
      }
      const compOn = comp.on && !isGroup;
      const deposit_amount = compOn ? 0 : Math.round(netAmt * (form.deposit_pct / 100));

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
          rate_plan_id: room.rate_plan_id || null,
          bed_preference: room.bed_preference || null,
        });
        nav(`/reservations/${res.data.id}`, compOn ? { state: { complimentary: { scope: comp.scope, reason: comp.reason.trim() } } } : undefined);
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
          rooms: rooms.map(r => ({ unit_id: r.unit_id, num_guests: r.num_guests, total_amount: r.total_amount, rate_plan_id: r.rate_plan_id || null, bed_preference: r.bed_preference || null })),
        });
        nav(`/reservations/group/${res.data.group.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create booking');
      setReview(false);
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
                <CountrySelect value={newGuest.nationality} onChange={v => setNewGuest(g=>({...g,nationality:v}))} />
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
          <div className="form-row form-row-dates">
            <div className="form-group">
              <label className="form-label">Check-in *</label>
              <input className="form-input" type="date" value={form.check_in_date} onChange={e => onCheckIn(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Nights</label>
              <input className="form-input" type="number" min={1} max={365} inputMode="numeric" value={nights}
                onChange={e => onNights(e.target.value)} placeholder="1" />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out *</label>
              <input className="form-input" type="date" value={form.check_out_date} min={form.check_in_date ? addDaysYmd(form.check_in_date, 1) : undefined}
                onChange={e => onCheckOut(e.target.value)} required />
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
          const suggestedTotal = priceSuggestion?.grand_total || 0;
          const unit = units.find(u => u.id === room.unit_id);
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
                    <option value="">{Object.keys(unitAvail).length ? 'Select unit…' : 'Select unit… (pick dates first to see what\'s free)'}</option>
                    {units.map(u => { const o = unitOption(u, i); return <option key={u.id} value={u.id} disabled={o.disabled}>{o.label}</option>; })}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Number of Guests</label>
                  <input className="form-input" type="number" min={1} max={10} value={room.num_guests} onChange={e => setRoom(i, 'num_guests', parseInt(e.target.value) || 1)} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Rate Plan</label>
                  <select className="form-select" value={room.rate_plan_id} onChange={e => setRoom(i, 'rate_plan_id', e.target.value)}>
                    {ratePlans.length === 0 && <option value="">Room Only</option>}
                    {ratePlans.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Bed Preference</label>
                  <select className="form-select" value={room.bed_preference} onChange={e => setRoom(i, 'bed_preference', e.target.value)}>
                    {BED_PREFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {unit?.bed_config && unit.bed_config !== 'twin_or_double' && room.bed_preference && room.bed_preference !== unit.bed_config && (
                    <div style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>
                      This room is set up as {unit.bed_config === 'twin' ? 'twin' : 'double'} — staff may need to reconfigure it.
                    </div>
                  )}
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
                          {c.guest_name} · {c.check_in_date?.slice(0,10)} → {c.check_out_date?.slice(0,10)}{' '}
                          {c.overdue
                            ? <b>— still checked in past check-out (overdue). Check them out or extend their stay first.</b>
                            : `(${c.status})`}
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
                <label className="form-label">
                  Total for the whole stay{stayNights ? ` (${stayNights} night${stayNights > 1 ? 's' : ''})` : ''} — IDR, incl. tax &amp; service
                </label>
                <input className="form-input" type="number" value={room.total_amount} placeholder={suggestedTotal ? `Suggested: ${suggestedTotal}` : ''}
                  onChange={e => setRoom(i, 'total_amount', e.target.value)} />
                {parseFloat(room.total_amount) > 0 && stayNights > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>
                    = <strong style={{ color: 'var(--text)' }}>{idr(room.total_amount / stayNights)} per night</strong> × {stayNights} night{stayNights > 1 ? 's' : ''}
                  </div>
                )}
                {(() => {
                  const w = priceWarning(room.total_amount, suggestedTotal, stayNights);
                  return w && <div className="alert alert-warn" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}><div>⚠️ {w}</div></div>;
                })()}
                {priceSuggestion && suggestedTotal > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div className="flex-between" style={{ marginBottom: 4 }}>
                      <span className="text-muted">
                        Room ({priceSuggestion.nights} night{priceSuggestion.nights > 1 ? 's' : ''}
                        {!priceSuggestion.varies_by_night && ` × Rp ${Number(priceSuggestion.room_rate_per_night).toLocaleString('id-ID')}`})
                        {!priceSuggestion.varies_by_night && priceSuggestion.period && (
                          <span style={{ background: priceSuggestion.period.color, color: 'white', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, marginLeft: 6 }}>
                            {priceSuggestion.period.name}
                          </span>
                        )}
                        {priceSuggestion.varies_by_night && <span style={{ fontStyle: 'italic' }}> · rates vary by night, see below</span>}
                      </span>
                      <span>Rp {Number(priceSuggestion.room_total).toLocaleString('id-ID')}</span>
                    </div>

                    {priceSuggestion.meal_total > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">
                          {priceSuggestion.rate_plan?.name || 'Breakfast'} ({room.num_guests} guest{room.num_guests > 1 ? 's' : ''} × {priceSuggestion.nights} night{priceSuggestion.nights > 1 ? 's' : ''} × Rp {Number(priceSuggestion.rate_plan?.meal_price || 0).toLocaleString('id-ID')})
                        </span>
                        <span>Rp {Number(priceSuggestion.meal_total).toLocaleString('id-ID')}</span>
                      </div>
                    )}

                    <div className="flex-between" style={{ marginBottom: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                      <span className="text-muted">Subtotal</span>
                      <span>Rp {Number(priceSuggestion.subtotal).toLocaleString('id-ID')}</span>
                    </div>
                    {priceSuggestion.service_charge_amount > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">Service Charge ({priceSuggestion.service_charge_rate}%)</span>
                        <span>Rp {Number(priceSuggestion.service_charge_amount).toLocaleString('id-ID')}</span>
                      </div>
                    )}
                    {priceSuggestion.tax_amount > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">Tax ({priceSuggestion.tax_rate}%)</span>
                        <span>Rp {Number(priceSuggestion.tax_amount).toLocaleString('id-ID')}</span>
                      </div>
                    )}

                    <div className="flex-between" style={{ fontWeight: 700, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                      <span>Grand Total</span>
                      <span>Rp {Number(suggestedTotal).toLocaleString('id-ID')}</span>
                    </div>

                    {!room.total_amount && (
                      <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setRoom(i, 'total_amount', suggestedTotal)}>
                        Use this
                      </button>
                    )}

                    {priceSuggestion.night_breakdown?.length > 1 && (
                      <details open={priceSuggestion.varies_by_night} style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text)' }}>
                          Nightly room rate breakdown ({priceSuggestion.night_breakdown.length} nights)
                        </summary>
                        <div style={{ marginTop: 6 }}>
                          {priceSuggestion.night_breakdown.map(n => (
                            <div key={n.date} className="flex-between" style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                              <span>
                                {n.date}
                                {n.period && (
                                  <span style={{ background: n.period.color, color: 'white', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 600, marginLeft: 6 }}>
                                    {n.period.name}
                                  </span>
                                )}
                              </span>
                              <span>Rp {Number(n.room_rate).toLocaleString('id-ID')}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
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

        {!isGroup && (
          <div className="card mb-3">
            <label className="flex gap-2" style={{ alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={comp.on} onChange={e => setComp(c => ({ ...c, on: e.target.checked }))} />
              🎁 Complimentary stay (free)
            </label>
            {comp.on && (
              <div style={{ marginTop: 10 }}>
                <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  {[['room', 'Room only'], ['room_meals', 'Room + meals'], ['all', 'Everything (incl. extras)']].map(([v, label]) => (
                    <button key={v} type="button" className={`btn btn-sm ${comp.scope === v ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setComp(c => ({ ...c, scope: v }))}>{label}</button>
                  ))}
                </div>
                <textarea className="form-textarea" placeholder="Reason * — e.g. Travel agent site inspection"
                  value={comp.reason} onChange={e => setComp(c => ({ ...c, reason: e.target.value }))} />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Keep the normal price above — it's recorded as the value given away. The booking is created, then made free
                  {can('grant_complimentary') ? '.' : ' once a manager approves: a one-time code is sent to them on Telegram, and you type it in on the next screen.'}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
          <Link to="/reservations" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={loading || anyUnavailable}>
            {isGroup ? 'Review Group Booking' : 'Review Booking'}
          </button>
        </div>
      </form>

      {review && (() => {
        const guestName = mode === 'new' ? newGuest.name : guestSearch;
        const sourceLabel = sources.find(s => s.id === form.source)?.label || form.source;
        const compOn = comp.on && !isGroup;
        const deposit = compOn ? 0 : Math.round(netAmt * form.deposit_pct / 100);
        const lines = rooms.map((r, i) => {
          const normal = priceSuggestions[i]?.grand_total || 0;
          return {
            r, normal,
            unit: units.find(u => u.id === r.unit_id),
            plan: ratePlans.find(p => p.id === r.rate_plan_id),
            total: parseFloat(r.total_amount) || 0,
            warning: priceWarning(r.total_amount, normal, stayNights),
          };
        });
        const warned = lines.filter(l => l.warning).length;
        const td = { padding: '6px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 640 }}>
              <div className="modal-header">
                <div className="modal-title">Check before creating</div>
                <button type="button" className="btn btn-icon" onClick={() => setReview(false)}>✕</button>
              </div>
              <div className="modal-body">
                {warned > 0 && (
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <div>⚠️ <strong>{warned === 1 ? '1 room price looks' : `${warned} room prices look`} wrong</strong> — see the red line{warned > 1 ? 's' : ''} below. Each price is the total for the whole stay, not per night.</div>
                  </div>
                )}
                <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>
                  <div><span className="text-muted">Guest:</span> <strong>{guestName || '—'}</strong>{mode === 'new' && <span className="text-muted"> (new guest)</span>}</div>
                  <div><span className="text-muted">Stay:</span> <strong>{form.check_in_date} → {form.check_out_date}</strong> · {stayNights} night{stayNights > 1 ? 's' : ''}</div>
                  <div><span className="text-muted">Source:</span> {sourceLabel}</div>
                </div>
                <div className="table-wrap">
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={td}>Room</th>
                        <th style={{ ...td, textAlign: 'right' }}>Per night</th>
                        <th style={{ ...td, textAlign: 'right' }}>Total ({stayNights} night{stayNights > 1 ? 's' : ''})</th>
                        <th style={{ ...td, textAlign: 'right' }}>Normal price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} style={l.warning ? { background: 'var(--danger-bg, #FEF2F2)' } : undefined}>
                          <td style={td}>
                            <strong>{l.unit?.name || '—'}</strong>{l.unit?.type ? ` · ${l.unit.type}` : ''}
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {l.r.num_guests} guest{l.r.num_guests > 1 ? 's' : ''}{l.plan ? ` · ${l.plan.code}` : ''}
                            </div>
                            {l.warning && <div style={{ fontSize: 11, color: 'var(--danger, #B91C1C)', marginTop: 2 }}>⚠️ {l.warning}</div>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{stayNights ? idr(l.total / stayNights) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{idr(l.total)}</td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="text-muted">{l.normal ? idr(l.normal) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 14, marginTop: 12, lineHeight: 1.7 }}>
                  {discountAmt > 0 && (
                    <div className="flex-between"><span className="text-muted">Discount{form.discount_type === 'percentage' ? ` (${dValue}%)` : ''}</span><span>− {idr(discountAmt)}</span></div>
                  )}
                  <div className="flex-between" style={{ fontWeight: 700 }}><span>{isGroup ? `Total for ${rooms.length} rooms` : 'Total'}</span><span>{idr(netAmt)}</span></div>
                  {compOn ? (
                    <div className="text-muted" style={{ fontSize: 12 }}>🎁 Will be made complimentary ({comp.scope === 'room' ? 'room only' : comp.scope === 'room_meals' ? 'room + meals' : 'everything'}) — the price above is recorded as the value given.</div>
                  ) : (
                    <div className="flex-between text-muted" style={{ fontSize: 13 }}>
                      <span>Deposit {form.deposit_pct}%</span><span>{idr(deposit)} · balance {idr(netAmt - deposit)}</span>
                    </div>
                  )}
                </div>
                {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReview(false)} disabled={loading}>← Back to edit</button>
                <button type="button" className="btn btn-primary" onClick={createBooking} disabled={loading}>
                  {loading ? 'Creating…' : warned ? 'Create anyway' : isGroup ? 'Confirm & create group' : 'Confirm & create'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
