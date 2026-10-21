import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import EventFormModal from '../components/EventFormModal';
import { STATUS, fmtIDR, fmtDay, ymd, parseYmd } from '../lib/events';
import { propertyToday } from '../lib/propertyTime';

// Events (migration 106): the meeting room booked for a date and time — who,
// when, how many people — with its own bill and the meals the restaurant
// prepares. A calendar of the venue(s) and a list. Server: /api/events
// (services/eventService.js).

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Owner: the venues that can be booked.
function VenuesModal({ venues, onClose, onChanged }) {
  const [rows, setRows] = useState(venues.map(v => ({ ...v, capacity: v.capacity ?? '' })));
  const [fresh, setFresh] = useState({ name: '', capacity: '' });
  const [error, setError] = useState('');

  async function save(v) {
    setError('');
    try {
      await api.put(`/api/events/venues/${v.id}`, { name: v.name, capacity: v.capacity, is_active: v.is_active });
      onChanged();
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }
  async function add() {
    setError('');
    try {
      const r = await api.post('/api/events/venues', fresh);
      setRows(x => [...x, { ...r.data, capacity: r.data.capacity ?? '' }]);
      setFresh({ name: '', capacity: '' });
      onChanged();
    } catch (err) { setError(err.response?.data?.error || 'Could not add'); }
  }
  const edit = (id, k, val) => setRows(x => x.map(r => (r.id === id ? { ...r, [k]: val } : r)));

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Venues</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>The rooms and spaces that can be booked for an event.</div>
          {rows.map(v => (
            <div key={v.id} className="flex gap-2" style={{ alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <input className="form-input" style={{ flex: 2, minWidth: 140 }} value={v.name} onChange={e => edit(v.id, 'name', e.target.value)} />
              <input className="form-input" style={{ width: 90 }} type="number" min={1} placeholder="People" value={v.capacity} onChange={e => edit(v.id, 'capacity', e.target.value)} />
              <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={v.is_active} onChange={e => edit(v.id, 'is_active', e.target.checked)} /> In use
              </label>
              <button className="btn btn-sm btn-secondary" onClick={() => save(v)}>Save</button>
            </div>
          ))}
          <div className="flex gap-2" style={{ alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <input className="form-input" style={{ flex: 2, minWidth: 140 }} placeholder="New venue, e.g. Meeting Room" value={fresh.name} onChange={e => setFresh(f => ({ ...f, name: e.target.value }))} />
            <input className="form-input" style={{ width: 90 }} type="number" min={1} placeholder="People" value={fresh.capacity} onChange={e => setFresh(f => ({ ...f, capacity: e.target.value }))} />
            <button className="btn btn-sm btn-primary" disabled={!fresh.name.trim()} onClick={add}>+ Add</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ event }) {
  const s = STATUS[event.status];
  return (
    <span className={`badge badge-${s.badge}`} title={s.hint}>
      {s.label}{event.hold_expired ? ' · hold expired' : event.status === 'tentative' && event.hold_until ? ` · until ${fmtDay(event.hold_until, { day: 'numeric', month: 'short' })}` : ''}
    </span>
  );
}

export default function Events() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const today = propertyToday();
  const [view, setView] = useState(() => {
    // the month grid needs width: a phone starts on the list unless the person chose otherwise
    const fallback = window.matchMedia('(max-width: 767px)').matches ? 'list' : 'calendar';
    try { return localStorage.getItem('eventsView') || fallback; } catch { return fallback; }
  });
  const [month, setMonth] = useState(() => monthStart(parseYmd(today)));
  const [when, setWhen] = useState('upcoming');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(null);       // { date } | null
  const [managing, setManaging] = useState(false);

  const loadVenues = useCallback(() => api.get('/api/events/venues').then(r => setVenues(r.data)).catch(() => {}), []);
  useEffect(() => { loadVenues(); }, [loadVenues]);

  const load = useCallback(() => {
    const params = {};
    if (view === 'calendar') {
      // the weeks shown: from the Monday on or before the 1st
      const first = new Date(month); first.setDate(1 - ((first.getDay() + 6) % 7));
      const last = new Date(first); last.setDate(first.getDate() + 41);
      params.from = ymd(first); params.to = ymd(last);
    } else {
      if (when === 'upcoming') params.from = today;
      if (when === 'past') { const y = parseYmd(today); y.setDate(y.getDate() - 1); params.to = ymd(y); }
      if (q.trim()) params.q = q.trim();
    }
    setLoading(true);
    return api.get('/api/events', { params })
      .then(r => { setEvents(r.data); setError(''); })
      .catch(e => setError(e.response?.data?.error || 'Could not load the events'))
      .finally(() => setLoading(false));
  }, [view, month, when, q, today]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  function pickView(v) { setView(v); try { localStorage.setItem('eventsView', v); } catch { /* private window */ } }

  const activeVenues = venues.filter(v => v.is_active);
  const noVenue = !activeVenues.length;

  // ── calendar cells ──
  const cells = [];
  if (view === 'calendar') {
    const first = new Date(month); first.setDate(1 - ((first.getDay() + 6) % 7));
    for (let i = 0; i < 42; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      const key = ymd(d);
      cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === month.getMonth(), list: events.filter(e => e.event_date <= key && e.end_date >= key && e.status !== 'cancelled') });
    }
    // drop a last week that is entirely next month
    if (!cells.slice(35).some(c => c.inMonth)) cells.length = 35;
  }
  const listed = view === 'list' ? (when === 'past' ? [...events].reverse() : events) : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Events</div>
          <div className="page-subtitle">Meetings and functions in {activeVenues.length === 1 ? `the ${activeVenues[0].name}` : 'the venues'} — who, when, the bill and the meals for the restaurant.</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {isOwner && <button className="btn btn-secondary" onClick={() => setManaging(true)}>Venues</button>}
          <button className="btn btn-primary" disabled={noVenue} onClick={() => setAdding({ date: today })}><Icon name="plus" />New event</button>
        </div>
      </div>

      <div className="tab-bar">
        <button type="button" className={`tab-bar-item${view === 'calendar' ? ' active' : ''}`} onClick={() => pickView('calendar')}>Calendar</button>
        <button type="button" className={`tab-bar-item${view === 'list' ? ' active' : ''}`} onClick={() => pickView('list')}>List</button>
      </div>

      <div className="page-toolbar">
        {view === 'calendar' ? (
          <>
            <div className="date-nav">
              <button type="button" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
              <span className="date-nav-label">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
              <button type="button" onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
            </div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMonth(monthStart(parseYmd(today)))}>Today</button>
          </>
        ) : (
          <>
            <div className="seg">
              {[['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => (
                <button key={k} type="button" className={when === k ? 'active' : ''} onClick={() => setWhen(k)}>{l}</button>
              ))}
            </div>
            <input className="form-input" style={{ width: 220, height: 34 }} placeholder="Search name or company…" value={q} onChange={e => setQ(e.target.value)} />
          </>
        )}
      </div>

      {noVenue && (
        <div className="alert alert-warn"><div>
          No venue has been set up yet. {isOwner ? 'Press Venues to add the meeting room.' : 'Ask the owner to add the meeting room (Events → Venues).'}
        </div></div>
      )}
      {error && <div className="alert alert-error"><div>{error}</div></div>}

      {view === 'calendar' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1 }}>
          <div className="table-wrap">
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
                {DOW.map(d => <div key={d} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{d}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {cells.map((c, i) => (
                  <div key={c.key} onClick={() => !noVenue && setAdding({ date: c.key })} title="New event on this day"
                    style={{
                      minHeight: 96, padding: 6, cursor: noVenue ? 'default' : 'pointer',
                      borderRight: i % 7 === 6 ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                      background: c.key === today ? '#FFFBEB' : c.inMonth ? 'transparent' : '#FAFAF8',
                    }}>
                    <div style={{ fontSize: 12, fontWeight: c.key === today ? 800 : 500, color: c.inMonth ? 'var(--text)' : '#9CA3AF', marginBottom: 4 }}>{c.day}</div>
                    {c.list.map(e => {
                      const s = STATUS[e.status];
                      return (
                        <div key={e.id} onClick={ev => { ev.stopPropagation(); nav(`/events/${e.id}`); }}
                          title={`${e.name} — ${e.customer || ''} · ${e.start_time}–${e.end_time} · ${e.pax} people · ${s.label}`}
                          style={{
                            background: s.bg, color: s.fg, borderRadius: 6, padding: '3px 6px', fontSize: 11, marginBottom: 3, cursor: 'pointer',
                            border: e.status === 'tentative' ? `1px dashed ${s.fg}` : '1px solid transparent', overflow: 'hidden',
                          }}>
                          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.start_time}–{e.end_time}</div>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2" style={{ padding: '8px 12px', flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
            {['confirmed', 'tentative', 'enquiry'].map(k => (
              <span key={k} style={{ background: STATUS[k].bg, color: STATUS[k].fg, borderRadius: 6, padding: '2px 8px', border: k === 'tentative' ? `1px dashed ${STATUS[k].fg}` : '1px solid transparent' }}>
                {STATUS[k].label} — {STATUS[k].hint.toLowerCase()}
              </span>
            ))}
            <span className="text-muted">Click a day to add an event.</span>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="card" style={{ padding: 0, opacity: loading ? 0.6 : 1 }}>
          {listed.length === 0 ? (
            <div className="text-muted" style={{ padding: 28, textAlign: 'center' }}>{loading ? 'Loading…' : 'No events here.'}</div>
          ) : (
            <div className="table-wrap">
              <table style={{ width: '100%', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>#</th><th>When</th><th>Event</th><th>For</th><th style={{ textAlign: 'right' }}>People</th><th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map(e => (
                    <tr key={e.id} style={{ cursor: 'pointer', opacity: e.status === 'cancelled' ? 0.55 : 1 }} onClick={() => nav(`/events/${e.id}`)}>
                      <td className="text-muted">{e.event_no}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtDay(e.event_date, { weekday: 'short', day: 'numeric', month: 'short' })}{e.end_date !== e.event_date ? ` – ${fmtDay(e.end_date, { day: 'numeric', month: 'short' })}` : ''}
                        <div className="text-muted" style={{ fontSize: 11 }}>{e.start_time}–{e.end_time} · {e.venue_name}</div>
                      </td>
                      <td>
                        <Link to={`/events/${e.id}`} onClick={ev => ev.stopPropagation()} style={{ fontWeight: 600 }}>{e.name}</Link>
                        {e.meals > 0 && <div className="text-muted" style={{ fontSize: 11 }}>🍽 {e.meals} meal{e.meals === 1 ? '' : 's'}{e.open_meals ? ` · ${e.open_meals} not rung up yet` : ' · all handled'}</div>}
                      </td>
                      <td>{e.customer || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{e.pax}</td>
                      <td><StatusBadge event={e} /></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(e.total)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: e.balance_due > 0 && e.status !== 'cancelled' ? '#B91C1C' : undefined }}>
                        {e.status === 'cancelled' ? '—' : e.balance_due < 0 ? `Credit ${fmtIDR(-e.balance_due)}` : e.balance_due > 0 ? fmtIDR(e.balance_due) : 'Paid'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {adding && (
        <EventFormModal date={adding.date} venues={venues} onClose={() => setAdding(null)}
          onSaved={e => nav(`/events/${e.id}`)} />
      )}
      {managing && <VenuesModal venues={venues} onClose={() => setManaging(false)} onChanged={loadVenues} />}
    </div>
  );
}

export { StatusBadge };
