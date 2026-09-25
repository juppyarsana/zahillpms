import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

// Check Availability: a guest asks "do you have a room for these dates?" —
// FO types the dates and party size and sees, per room type, how many rooms
// are free and what the stay costs, then ticks rooms and continues straight
// into New Booking with dates + rooms filled in (2+ rooms = group booking).
// Data: GET /api/bookings/availability-search (services/availabilityService).

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function nightsBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function fmtDay(s) { return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtShort(s) { return parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

const REASON = {
  booked: r => `Booked${r.guest_name ? ` — ${r.guest_name}` : ''} until ${fmtShort(r.booked_until)}`,
  overdue: r => `${r.guest_name || 'Guest'} still checked in (overdue)`,
  out_of_order: r => `Out of order${r.note ? ` — ${r.note}` : ''}${r.expected_back ? ` · back ${fmtShort(r.expected_back)}` : ''}`,
};

export default function Availability() {
  const nav = useNavigate();
  const today = ymd(new Date());
  const [checkIn, setCheckIn] = useState(today);
  const [nights, setNights] = useState('1');
  const [checkOut, setCheckOut] = useState(addDays(today, 1));
  const [guests, setGuests] = useState('2');
  const [roomsWanted, setRoomsWanted] = useState('1');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]); // unit ids, in pick order
  const [openType, setOpenType] = useState(null);
  // Phone width: shorter button label so it clears the floating call button.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = e => setNarrow(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  function onCheckIn(v) {
    setCheckIn(v);
    const n = parseInt(nights, 10) || 1;
    if (v) setCheckOut(addDays(v, n));
  }
  function onNights(v) {
    setNights(v);
    const n = parseInt(v, 10);
    if (n >= 1 && checkIn) setCheckOut(addDays(checkIn, n));
  }
  function onCheckOut(v) {
    setCheckOut(v);
    if (v && checkIn && v > checkIn) setNights(String(nightsBetween(checkIn, v)));
  }
  function quick(ci, n) { setCheckIn(ci); setNights(String(n)); setCheckOut(addDays(ci, n)); }
  // Next Friday (or today if it is Friday) → 2 nights.
  function weekend() {
    const d = parseYmd(today);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    quick(ymd(d), 2);
  }

  const valid = checkIn && checkOut && checkOut > checkIn;
  useEffect(() => {
    if (!valid) { setData(null); return; }
    let live = true;
    setLoading(true); setError('');
    const t = setTimeout(() => {
      api.get('/api/bookings/availability-search', { params: { check_in: checkIn, check_out: checkOut, guests, rooms: roomsWanted } })
        .then(r => {
          if (!live) return;
          setData(r.data);
          // Drop picks that aren't free any more for the new dates.
          const free = new Set(r.data.room_types.flatMap(t => t.units.filter(u => u.available).map(u => u.id)));
          setSelected(sel => sel.filter(id => free.has(id)));
        })
        .catch(e => { if (live) { setData(null); setError(e.response?.data?.error || 'Could not check availability'); } })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [checkIn, checkOut, guests, roomsWanted]);

  const allRooms = data ? data.room_types.flatMap(t => t.units.map(u => ({ ...u, type: t }))) : [];
  const picked = selected.map(id => allRooms.find(r => r.id === id)).filter(Boolean);
  const pickedTotal = picked.reduce((s, r) => s + (r.price || 0), 0);
  const wanted = Math.max(1, parseInt(roomsWanted, 10) || 1);
  const partySize = Math.max(1, parseInt(guests, 10) || 1);

  function toggle(id) { setSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]); }
  function pickNext(t) {
    const next = t.units.find(u => u.available && !selected.includes(u.id));
    if (next) setSelected(sel => [...sel, next.id]);
  }

  function continueToBooking() {
    // Spread the party over the picked rooms (never more than a room's max).
    const n = picked.length;
    const per = picked.map((r, i) => Math.max(1, Math.floor(partySize / n) + (i < partySize % n ? 1 : 0)));
    const capped = per.map((g, i) => Math.min(g, picked[i].type.max_guests || g));
    const params = new URLSearchParams({
      check_in: checkIn, check_out: checkOut,
      units: picked.map(r => r.id).join(','),
      guests: capped.join(','),
    });
    nav(`/reservations/new?${params}`);
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Check Availability</div>
          <div className="page-subtitle"><Link to="/reservations">← Reservations</Link></div>
        </div>
      </div>

      <div className="card mb-3">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Check-in</label>
            <input className="form-input" type="date" value={checkIn} onChange={e => onCheckIn(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nights</label>
            <input className="form-input" type="number" min="1" max="90" value={nights} onChange={e => onNights(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Check-out</label>
            <input className="form-input" type="date" value={checkOut} min={checkIn} onChange={e => onCheckOut(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Guests</label>
            <input className="form-input" type="number" min="1" value={guests} onChange={e => setGuests(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Rooms</label>
            <input className="form-input" type="number" min="1" value={roomsWanted} onChange={e => setRoomsWanted(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => quick(today, 1)}>Tonight</button>
          <button className="btn btn-sm btn-secondary" onClick={() => quick(addDays(today, 1), 1)}>Tomorrow</button>
          <button className="btn btn-sm btn-secondary" onClick={weekend}>This weekend</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!valid && <div className="text-muted" style={{ padding: 20, textAlign: 'center' }}>Pick a check-out date after check-in.</div>}

      {data && (
        <>
          <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 8, opacity: loading ? 0.5 : 1 }}>
            <div style={{ fontSize: 15 }}>
              <b>{data.available_rooms}</b> of {data.total_rooms} rooms free · {fmtDay(data.check_in)} → {fmtDay(data.check_out)} · {data.nights} night{data.nights === 1 ? '' : 's'}
            </div>
            {wanted > 1 && (
              <span className={`badge badge-${data.available_rooms >= wanted ? 'green' : 'red'}`}>
                {data.available_rooms >= wanted ? `Enough for ${wanted} rooms` : `Only ${data.available_rooms} free — ${wanted} wanted`}
              </span>
            )}
          </div>

          {data.room_types.map(t => {
            const key = t.room_type_id || t.name;
            const pickedHere = picked.filter(r => r.type === t || r.type.name === t.name).length;
            const expanded = openType === key || pickedHere > 0;
            const freeLeft = t.available_count - pickedHere;
            return (
              <div key={key} className="card mb-3" style={{ opacity: loading ? 0.5 : 1, borderLeft: `4px solid ${t.available_count === 0 ? '#D1D5DB' : t.fits ? '#16A34A' : '#F59E0B'}` }}>
                <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Up to {t.max_guests} guest{t.max_guests === 1 ? '' : 's'}
                      {!t.fits && <span style={{ color: '#B45309', fontWeight: 600 }}> · too small for {data.guests_per_room} per room</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 90 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: t.available_count === 0 ? '#9CA3AF' : '#16A34A' }}>{t.available_count}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>of {t.total_count} free</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 170 }}>
                    {t.price ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{t.price.varies ? 'from ' : ''}{fmtIDR(t.price.total)}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {data.nights} night{data.nights === 1 ? '' : 's'} · avg {fmtIDR(t.price.per_night)}/night · room only, incl. tax
                        </div>
                      </>
                    ) : <div className="text-muted">Sold out</div>}
                  </div>
                  <div className="flex gap-2">
                    {t.available_count > 0 && (
                      <button className="btn btn-sm btn-primary" disabled={freeLeft <= 0} onClick={() => pickNext(t)}>
                        + Add room{pickedHere ? ` (${pickedHere})` : ''}
                      </button>
                    )}
                    <button className="btn btn-sm btn-secondary" onClick={() => setOpenType(expanded && openType === key ? null : key)}>
                      {expanded ? 'Hide rooms' : 'Rooms'}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <>
                    {t.price?.varies_by_night && (
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
                        Rate per night: {t.price.nights.map(n => `${fmtShort(n.date)} ${fmtIDR(n.rate)}${n.period ? ` (${n.period})` : ''}`).join(' · ')} (before tax)
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {t.units.map(u => {
                        const on = selected.includes(u.id);
                        return (
                          <button key={u.id} type="button" disabled={!u.available} onClick={() => toggle(u.id)}
                            title={u.available ? `${u.name} — ${fmtIDR(u.price)}${u.bed_config ? ` · ${u.bed_config.replace(/_/g, ' ')}` : ''}` : REASON[u.reason]?.(u)}
                            style={{
                              padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: u.available ? 'pointer' : 'not-allowed',
                              border: `2px solid ${on ? 'var(--color-primary, #6B1E3A)' : u.available ? '#BBF7D0' : '#E5E7EB'}`,
                              background: on ? 'var(--color-primary, #6B1E3A)' : u.available ? '#F0FDF4' : '#F3F4F6',
                              color: on ? '#fff' : u.available ? '#166534' : '#9CA3AF',
                              textAlign: 'left', minWidth: 76,
                            }}>
                            {on ? '✓ ' : ''}{u.name}
                            <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>
                              {u.available ? (u.price !== t.price?.total ? fmtIDR(u.price) : 'Free') : u.reason === 'out_of_order' ? 'Out of order' : u.reason === 'overdue' ? 'Overdue' : `Until ${fmtShort(u.booked_until)}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      {picked.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 20, background: 'var(--surface, #fff)', borderRadius: 12,
          border: '1px solid var(--border)', boxShadow: '0 -4px 16px rgba(0,0,0,0.10)', padding: '12px 84px 12px 16px', marginTop: 8, // right padding: clear of the floating call button
        }}>
          <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14 }}>
              <b>{picked.length} room{picked.length === 1 ? '' : 's'}</b>: {picked.map(r => r.name).join(', ')}
              <span className="text-muted"> · {fmtIDR(pickedTotal)} room only, incl. tax</span>
              {picked.length !== wanted && <span style={{ color: '#B45309' }}> · {wanted} wanted</span>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setSelected([])}>Clear</button>
              <button className="btn btn-primary" onClick={continueToBooking}>
                {narrow ? 'Continue →' : `Continue to booking${picked.length > 1 ? ' (group)' : ''} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
