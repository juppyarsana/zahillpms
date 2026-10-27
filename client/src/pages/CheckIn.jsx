import { useState, useEffect } from 'react';
import { BalanceLine } from '../components/CheckoutBalance';
import { NotesPreview } from '../components/StaffNotes';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import RegistrationCardModal from '../components/RegistrationCardModal';
import LateArrivals from '../components/LateArrivals';
import { useCheckInOut } from '../components/CheckInOutWindows';

const PALETTE = ['#5C1A2E','#7A2540','#C9A227','#1E40AF','#7C3AED','#DB2777','#0891B2','#9A3412'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initials(name = '') {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

// Groups arrivals sharing a reservation_group_id under one cluster, in the
// order their first room appears, leaving ungrouped rows as singles.
function clusterByGroup(list) {
  const seen = new Set();
  const result = [];
  for (const b of list) {
    if (b.reservation_group_id) {
      if (seen.has(b.reservation_group_id)) continue;
      seen.add(b.reservation_group_id);
      result.push({ type: 'group', groupId: b.reservation_group_id, bookings: list.filter(x => x.reservation_group_id === b.reservation_group_id) });
    } else {
      result.push({ type: 'single', booking: b });
    }
  }
  return result;
}

// A guest's name in the lists: opens the reservation for staff who may see
// Reservations; plain text otherwise.
function GuestName({ b }) {
  const { can } = useAuth();
  if (!can('reservations')) return b.guest_name;
  return (
    <Link to={`/reservations/${b.id}`} title="Open the reservation" style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3 }}>
      {b.guest_name}
    </Link>
  );
}

export default function CheckIn() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams] = useSearchParams();

  const { startCheckin, startCheckout, waWelcome, otaPays, windows } = useCheckInOut({ onChanged: () => load() });

  const [arrivals, setArrivals]     = useState([]);
  const [departures, setDepartures] = useState([]);
  const [inHouse, setInHouse]       = useState([]);
  // Registration Card straight from an arrival row — printed as the guest
  // walks up (or ahead of time), before the check-in steps.
  const [regCardFor, setRegCardFor] = useState(null);
  const [groupCheckinLoading, setGroupCheckinLoading] = useState(null);
  const [groupCheckinResults, setGroupCheckinResults] = useState(null);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  async function load() {
    const [a, d, h] = await Promise.all([
      api.get('/api/bookings/today/arrivals'),
      api.get('/api/bookings/today/departures'),
      api.get('/api/bookings/in-house'),
    ]);
    setArrivals(a.data);
    setDepartures(d.data);
    setInHouse(h.data);
    return a.data;
  }

  useEffect(() => { load(); }, []);

  // A no-show put back from "Marked no-show last night": reload, and open the
  // check-in for a single booking (a group then uses Check In Whole Group).
  async function onLateRestored({ bookingIds, groupId }) {
    const a = await load();
    if (!groupId) {
      const b = a.find(x => x.id === bookingIds[0]);
      if (b) startCheckin(b);
    }
  }

  useEffect(() => {
    const bookingId = searchParams.get('checkin');
    if (!bookingId) return;
    api.get(`/api/bookings/${bookingId}`).then(r => startCheckin(r.data)).catch(() => {});
  }, [searchParams]);


  async function checkInWholeGroup(groupId) {
    setGroupCheckinLoading(groupId);
    setGroupCheckinResults(null);
    try {
      const r = await api.post(`/api/checkin/group/${groupId}/start`);
      setGroupCheckinResults({ groupId, ...r.data });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to check in group');
    } finally {
      setGroupCheckinLoading(null);
    }
  }




  async function markNoShow(b) {
    if (!confirm(`Mark ${b.guest_name} as a no-show? The guest never checked in.`)) return;
    try {
      await api.put(`/api/bookings/${b.id}/no-show`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to mark as no-show');
    }
  }


  // OTA, or an agent that pays the hotel later (migration 084): nothing to collect for the room
  const isOTA = (b) => otaPays(b) || !!b.agent_billed;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-eyebrow"><Link to="/today">← Today</Link></div>
          <div className="page-title">Check-in / Check-out</div>
          <div className="page-subtitle">{today}</div>
        </div>
        {can('quick_checkin') && (
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/quick-checkin')}>
            <Icon name="zap" />Quick mode
          </button>
        )}
      </div>

      <LateArrivals lang="en" onRestored={onLateRestored} />

      <div className="grid-2 mb-3">
        {/* ── Arrivals ── */}
        <div className="card">
          <div className="card-title">Arriving Today ({arrivals.length})</div>
          {arrivals.length === 0 && <p className="text-muted">No arrivals today</p>}
          {clusterByGroup(arrivals).map(item => {
            const d0 = new Date();
            const todayStr = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`; // local date, not UTC
            const rows = (item.type === 'group' ? item.bookings : [item.booking]).map(b => {
              const depositOk = b.deposit_paid || isOTA(b);
              const isOverdue = b.check_in_date < todayStr;
              return (
                <div
                  key={b.id}
                  className="guest-row"
                  style={{
                    marginBottom: 8, cursor: 'default',
                    ...(isOverdue ? { background: '#FFF7ED', borderColor: '#FED7AA' } : {}),
                  }}
                >
                  <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                    {initials(b.guest_name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}><GuestName b={b} /></div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {b.unit_name} · {b.num_guests} pax · {b.nationality}
                      {b.rate_plan_code && b.rate_plan_code !== 'RO' && <span> · {b.rate_plan_code}</span>}
                      {(b.bed_preference || (b.bed_config && b.bed_config !== 'double')) && (
                        <span> · 🛏 {b.bed_preference === 'twin' || (!b.bed_preference && b.bed_config === 'twin') ? 'Twin' : b.bed_preference === 'double' ? 'Double' : b.bed_config === 'twin_or_double' ? 'Twin/Double' : ''}</span>
                      )}
                    </div>
                    {isOverdue && (
                      <div style={{ fontSize: 11, color: '#B45309', fontWeight: 700, marginTop: 2 }}>
                        LATE ARRIVAL · was due {new Date(b.check_in_date.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </div>
                    )}
                    {b.housekeeping_status === 'dirty' && (
                      <div style={{ fontSize: 11, color: '#92400E', fontWeight: 700, marginTop: 2 }}>
                        🧹 Room not yet cleaned
                      </div>
                    )}
                    <NotesPreview notes={b.staff_notes} max={2} />
                    {b.guest_whatsapp && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }}
                        onClick={() => waWelcome(b)}
                      >
                        💬 Send Welcome WA
                      </button>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span
                      className={`badge ${depositOk ? 'badge-blue' : 'badge-red'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => startCheckin(b)}
                    >
                      Check In →
                    </span>
                    <div style={{ fontSize: 11, marginTop: 4, color: depositOk ? 'var(--green)' : '#DC2626', fontWeight: 600 }}>
                      {isOTA(b)
                        ? (b.agent_billed ? `🧾 Billed to ${b.agent_name}` : '🏷 OTA managed')
                        : b.deposit_paid
                          ? '✓ Deposit paid'
                          : '⚠ Deposit pending'}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setRegCardFor(b.id)}
                    >
                      🖨 Reg. Card
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 4, padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)' }}
                      onClick={() => markNoShow(b)}
                    >
                      No-show
                    </button>
                  </div>
                </div>
              );
            });

            if (item.type === 'single') return rows[0];

            const results = groupCheckinResults?.groupId === item.groupId ? groupCheckinResults : null;
            return (
              <div key={item.groupId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8, background: '#FAFAFA' }}>
                <div className="flex-between" style={{ marginBottom: 8, paddingLeft: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>
                    {item.bookings.length} rooms · {item.bookings[0].guest_name}
                  </span>
                  <button className="btn btn-primary btn-sm" onClick={() => checkInWholeGroup(item.groupId)} disabled={groupCheckinLoading === item.groupId}>
                    {groupCheckinLoading === item.groupId ? 'Processing…' : 'Check In Whole Group'}
                  </button>
                </div>
                {results && (
                  <div style={{ fontSize: 11, marginBottom: 8, paddingLeft: 4 }}>
                    {results.succeeded} of {results.attempted} rooms checked in
                    {results.failed > 0 && ` — ${results.failed} not: ${[...new Set(results.results.filter(x => !x.ok).map(x => x.error))].join(' · ')}`}
                  </div>
                )}
                {rows}
              </div>
            );
          })}
        </div>

        {/* ── Departures ── */}
        <div className="card">
          <div className="card-title">Departing Today ({departures.length})</div>
          {departures.length === 0 && <p className="text-muted">No departures today</p>}
          {departures.map(b => {
            return (
              <div
                key={b.id}
                className="guest-row"
                style={{ marginBottom: 8, background: '#F0FDF4', borderColor: '#BBF7D0', cursor: 'default' }}
              >
                <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                  {initials(b.guest_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}><GuestName b={b} /></div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{b.unit_name}</div>
                  <NotesPreview notes={b.staff_notes} max={2} />
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span
                    className="badge badge-amber"
                    style={{ cursor: 'pointer' }}
                    onClick={() => startCheckout(b)}
                  >
                    Check Out →
                  </span>
                  <BalanceLine b={b} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Currently In-House ── */}
      {inHouse.length > 0 && (
        <div className="card mb-3">
          <div className="card-title">Currently In-House ({inHouse.length})</div>
          {inHouse.map(b => {
            return (
              <div
                key={b.id}
                className="guest-row"
                style={{ marginBottom: 8, background: b.overdue ? '#FFF7ED' : undefined, borderColor: b.overdue ? '#FED7AA' : undefined, cursor: 'default' }}
              >
                <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                  {initials(b.guest_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}><GuestName b={b} /></div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{b.unit_name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    Check-out: {b.check_out_date?.slice(0, 10)}
                    {b.overdue && <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 6 }}>OVERDUE</span>}
                  </div>
                  <NotesPreview notes={b.staff_notes} max={2} />
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span
                    className="badge badge-amber"
                    style={{ cursor: 'pointer' }}
                    onClick={() => startCheckout(b)}
                  >
                    Check Out →
                  </span>
                  <BalanceLine b={b} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {windows}
      {regCardFor && (
        <RegistrationCardModal bookingId={regCardFor} onClose={() => setRegCardFor(null)} />
      )}
    </div>
  );
}
