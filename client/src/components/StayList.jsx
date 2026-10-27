// Drill-down on the Insights pages Rooms, Guests and Bookings: the
// reservations behind one figure (a channel, a room type, a country, a
// "how far ahead" bucket…), in a window — search, sort, each row opens its
// reservation. Server: GET /api/insight/stays (services/insightPages.js
// buildStayList), the same period and filters the figure was counted with.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { idr } from './InsightPeriod';

const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const STATUS = { cancelled: ['Cancelled', 'badge-red'], no_show: ['No-show', 'badge-gray'], checked_in: ['In house', 'badge-green'], checked_out: ['Checked out', 'badge-gray'] };

// what = { title, filter: { basis, …query } }
export default function StayList({ P, what, onClose }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('date');

  useEffect(() => {
    api.get('/api/insight/stays', { params: { ...P.apiParams, ...what.filter } })
      .then(r => setData(r.data)).catch(err => setError(err.response?.data?.error || 'Failed to load'));
  }, [what]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stays = what.filter.basis === 'stays';
  const rows = useMemo(() => {
    if (!data) return [];
    const words = q.trim().toLowerCase();
    const list = data.rows.filter(r => !words || [r.guest_name, r.unit_name, r.room_type, r.source, r.nationality].join(' ').toLowerCase().includes(words));
    if (sort === 'value') return [...list].sort((a, b) => b.value - a.value);
    if (sort === 'made') return [...list].sort((a, b) => (a.made_on < b.made_on ? 1 : a.made_on > b.made_on ? -1 : 0));
    return list;
  }, [data, q, sort]);
  const canOpen = can('reservations');

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cost-entries">
        <div className="modal-header">
          <div>
            <div className="modal-title">{what.title}</div>
            <div className="text-muted" style={{ fontSize: 13 }}>
              {data ? data.period.label : ' '}
              {data && ` · ${data.totals.rooms} ${data.totals.rooms === 1 ? 'room' : 'rooms'} · ${data.totals.nights} ${stays ? 'nights in the period' : 'nights'} · ${data.totals.guests} guests · ${idr(data.totals.value)}`}
            </div>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}
          {!data ? (!error && <div className="text-muted">Loading…</div>) : (<>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <input className="form-input" style={{ flex: '1 1 200px', height: 34 }} placeholder="Search guest, room, channel…" value={q} onChange={e => setQ(e.target.value)} />
              <div className="seg">
                <button type="button" className={sort === 'date' ? 'active' : ''} onClick={() => setSort('date')}>Arrival</button>
                <button type="button" className={sort === 'value' ? 'active' : ''} onClick={() => setSort('value')}>Value</button>
                <button type="button" className={sort === 'made' ? 'active' : ''} onClick={() => setSort('made')}>Booked on</button>
              </div>
            </div>
            {data.more && <div className="alert alert-warn" style={{ fontSize: 13 }}><div>Showing the first 500 — choose a shorter period to see them all.</div></div>}
            {rows.length === 0 ? <div className="text-muted" style={{ padding: '14px 0' }}>Nothing to show.</div> : (
              <div className="cost-list">
                {rows.map(r => (
                  <button key={r.id} type="button" className="cost-item stay-item" disabled={!canOpen}
                          onClick={() => canOpen && nav(`/reservations/${r.id}`)} title={canOpen ? 'Open the reservation' : undefined}>
                    <span className="cost-item-day">{dayShort(r.check_in)}</span>
                    <span className="cost-item-main">
                      <span className="cost-item-what">
                        {r.guest_name}
                        {STATUS[r.status] && <span className={`badge ${STATUS[r.status][1]}`} style={{ marginLeft: 6 }}>{STATUS[r.status][0]}</span>}
                      </span>
                      <span className="text-muted cost-item-sub">
                        {[`${r.unit_name} · ${r.room_type}`, `${r.nights} ${r.nights === 1 ? 'night' : 'nights'}`, `${r.guests}${r.children ? `+${r.children}` : ''} pax`, r.source, r.nationality, `booked ${dayShort(r.made_on)}${r.lead ? ` (${r.lead} days ahead)` : ' (same day)'}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="cost-item-amt">{idr(r.value)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Value = room + meal plan for the whole stay, net.{!canOpen && ' Opening a reservation needs the Reservations permission.'}</div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// The filters behind each bucket of the pages (must match the server's buckets).
export const LEAD_RANGES = [[0, 0], [1, 7], [8, 30], [31, 90], [91, '']];
export const NIGHT_RANGES = [[1, 1], [2, 2], [3, 3], [4, 6], [7, '']];
export const PARTY_RANGES = [[1, 1], [2, 2], [3, 3], [4, '']];
