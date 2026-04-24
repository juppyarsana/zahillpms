import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

/* ─── helpers ─────────────────────────────────────────── */

function fmtIDR(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000)     return `Rp ${(num / 1_000_000).toFixed(1)}M`;
  return 'Rp ' + num.toLocaleString('id-ID');
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ─── channel badge ────────────────────────────────────── */
const CH_STYLE = {
  direct:      { background: '#2D5016', color: 'white' },
  airbnb:      { background: '#FF5A5F', color: 'white' },
  booking_com: { background: '#003580', color: 'white' },
  traveloka:   { background: '#038CFC', color: 'white' },
  walkin:      { background: '#0891B2', color: 'white' },
  buffer:      { background: '#6B7280', color: 'white' },
};
const CH_LABEL = {
  direct:'Direct', airbnb:'Airbnb', booking_com:'Booking.com',
  traveloka:'Traveloka', walkin:'Walk-in', buffer:'Buffer',
};

function ChBadge({ source }) {
  if (!source) return null;
  const s = CH_STYLE[source] || { background: '#6B7280', color: 'white' };
  return (
    <span style={{ ...s, padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>
      {CH_LABEL[source] || source}
    </span>
  );
}

/* ─── unit status card ─────────────────────────────────── */
function UnitCard({ unit }) {
  const isOccupied = unit.status === 'occupied' && unit.guest_name;
  const isArriving = !!unit.arriving_guest_name;
  const isMaint    = unit.status === 'maintenance';
  const isBlocked  = unit.status === 'blocked';

  let cls = 'available';
  if (isOccupied)   cls = 'occupied';
  else if (isArriving) cls = 'arriving';
  else if (isMaint) cls = 'occupied'; // red-ish
  else if (isBlocked) cls = 'blocked';

  const unitBg    = { occupied: '#FFF7ED', arriving: '#EFF6FF', available: '#F0FDF4', blocked: '#F9FAFB' };
  const unitBorder= { occupied: '#F97316', arriving: '#3B82F6', available: '#22C55E', blocked: '#D1D5DB' };

  const bg     = isMaint ? '#FEE2E2' : (unitBg[cls]     || '#F9FAFB');
  const border = isMaint ? '#FCA5A5' : (unitBorder[cls] || '#D1D5DB');

  return (
    <div style={{ borderRadius: 10, padding: 14, border: `1.5px solid ${border}`, background: bg }}>

      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>🏕 {unit.name}</strong>
        {isOccupied && <ChBadge source={unit.source} />}
        {!isOccupied && isArriving && <ChBadge source={unit.arriving_source} />}
        {!isOccupied && !isArriving && unit.status === 'available' && (
          <span style={{ background: '#D1FAE5', color: '#065F46', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Available</span>
        )}
        {isMaint  && <span style={{ background: '#FEE2E2', color: '#991B1B', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Maintenance</span>}
        {isBlocked && <span style={{ background: '#F3F4F6', color: '#374151', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Blocked</span>}
      </div>

      {/* status line */}
      {isOccupied && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#C2410C' }}>
            ● Occupied{unit.nights_left > 0 ? ` · ${unit.nights_left} night${unit.nights_left !== 1 ? 's' : ''} left` : ' · last night'}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            {unit.guest_name}{unit.nationality ? ` · ${unit.nationality}` : ''}{unit.num_guests ? ` · ${unit.num_guests} pax` : ''}
          </div>
        </>
      )}

      {!isOccupied && isArriving && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8' }}>🔄 Arriving today</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            {unit.arriving_guest_name}{unit.arriving_nationality ? ` · ${unit.arriving_nationality}` : ''}{unit.arriving_num_guests ? ` · ${unit.arriving_num_guests} pax` : ''}
          </div>
        </>
      )}

      {!isOccupied && !isArriving && unit.status === 'available' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#15803D' }}>
            ✓ Empty &amp; ready{unit.next_booking_date
              ? ` · Next booking ${new Date(unit.next_booking_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : ''}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            {unit.gap_nights ? `${unit.gap_nights}-night gap · Open for last-minute booking` : 'No upcoming bookings'}
          </div>
        </>
      )}

      {(isMaint || isBlocked) && (
        <div style={{ fontSize: 11, color: '#6B7280' }}>Unit not available for booking</div>
      )}
    </div>
  );
}

/* ─── task icon map ────────────────────────────────────── */
const TASK_ICONS = {
  housekeeping: { emoji: '🧹', bg: '#FEF3C7' },
  maintenance:  { emoji: '🔧', bg: '#FEE2E2' },
  guest:        { emoji: '💬', bg: '#EDE9FE' },
  restocking:   { emoji: '📦', bg: '#D1FAE5' },
  other:        { emoji: '📋', bg: '#F3F4F6' },
};

function taskIcon(type) {
  return TASK_ICONS[type] || TASK_ICONS.other;
}

/* ─── revenue bar chart ────────────────────────────────── */
function RevenueChart({ bookings, pendingCount, pendingTotal }) {
  // Build last-7-days daily revenue from this-month bookings
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return d;
  });

  const dailyRevenue = days.map(d => {
    const ds = d.toISOString().slice(0, 10);
    return bookings
      .filter(b => b.check_in_date?.slice(0, 10) === ds || b.check_out_date?.slice(0, 10) === ds)
      .reduce((sum, b) => sum + parseFloat(b.total_amount || 0), 0);
  });

  const maxRev = Math.max(...dailyRevenue, 1);

  // Channel mix from recent bookings
  const recent = bookings.filter(b => {
    const ci = new Date(b.check_in_date);
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - 30);
    return ci >= cutoff;
  });
  const totalRecent = recent.length || 1;
  const channelCounts = {};
  recent.forEach(b => { channelCounts[b.source] = (channelCounts[b.source] || 0) + 1; });
  const topChannels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([ch, cnt]) => ({ ch, pct: Math.round((cnt / totalRecent) * 100) }));

  return (
    <>
      {/* bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
        {dailyRevenue.map((rev, i) => {
          const isToday = i === 6;
          const h = Math.max(8, Math.round((rev / maxRev) * 100));
          return (
            <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0',
              background: isToday ? '#2D5016' : '#E8F0E0', transition: 'height 0.3s' }}
              title={fmtIDR(rev)} />
          );
        })}
      </div>

      {/* day labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {days.map((d, i) => {
          const isToday = i === 6;
          return (
            <span key={i} style={{ fontSize: 11, color: isToday ? '#2D5016' : '#6B7280',
              fontWeight: isToday ? 800 : 400, flex: 1, textAlign: 'center' }}>
              {isToday ? 'Today' : DAY_LABELS[d.getDay()]}
            </span>
          );
        })}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '14px 0' }} />

      {/* footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Channel Mix</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {topChannels.length > 0
              ? topChannels.map(({ ch, pct }) => (
                  <span key={ch} style={{ ...CH_STYLE[ch], padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                    {pct}% {CH_LABEL[ch] || ch}
                  </span>
                ))
              : <span style={{ fontSize: 11, color: '#6B7280' }}>No data</span>
            }
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Pending Payments</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#D97706', marginTop: 4 }}>
            {pendingTotal > 0 ? `${fmtIDR(pendingTotal)} · ` : ''}{pendingCount} booking{pendingCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── main component ───────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth();
  const [data,           setData]          = useState(null);
  const [tasks,          setTasks]         = useState([]);
  const [monthBookings,  setMonthBookings] = useState([]);
  const [pendingTotal,   setPendingTotal]  = useState(0);
  const [loading,        setLoading]       = useState(true);

  async function load() {
    try {
      const now = new Date();
      const [summaryRes, tasksRes, bookingsRes] = await Promise.all([
        api.get('/api/dashboard/summary'),
        api.get('/api/tasks'),
        api.get(`/api/bookings?month=${now.getMonth() + 1}&year=${now.getFullYear()}`),
      ]);
      setData(summaryRes.data);
      setTasks(tasksRes.data.slice(0, 5)); // top 5 by priority
      setMonthBookings(bookingsRes.data);

      // estimate pending total from confirmed bookings with no received deposit
      const pending = bookingsRes.data.filter(b => b.status === 'pending');
      setPendingTotal(pending.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0));
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading dashboard…</div>;
  if (!data)   return <div className="alert alert-error">Failed to load dashboard</div>;

  const { occupancy, arrivals_today, departures_today, pending_payments_count, revenue } = data;
  const occupiedPct = occupancy.total > 0 ? Math.round((occupancy.occupied / occupancy.total) * 100) : 0;

  // Today's date string for greeting subtitle
  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">{greeting()}, {user?.name?.split(' ')[0]} 👋</div>
          <div className="page-subtitle">{todayStr} · Kintamani, Bali</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge badge-green" style={{ padding: '6px 14px', fontSize: 12 }}>
            🟢 All Systems Normal
          </span>
        </div>
      </div>

      {/* ── Alert banner if arrivals today ── */}
      {arrivals_today.length > 0 && (
        <div className="alert alert-info">
          📌 <span>
            <strong>{arrivals_today.length} arrival{arrivals_today.length > 1 ? 's' : ''} today</strong>
            {' — '}{arrivals_today.map(b => `${b.guest_name} (${b.unit_name})`).join(' · ')}. Please prepare units.
          </span>
        </div>
      )}

      {/* ── 4 Stat Cards ── */}
      <div className="dashboard-stats">

        <div className="stat-card">
          <div className="stat-label">Tonight's Occupancy</div>
          <div className="stat-value">
            {occupancy.occupied}
            <span style={{ fontSize: 16, color: '#6B7280' }}>/{occupancy.total}</span>
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="badge badge-green">{occupiedPct}%</span>
            <span style={{ fontSize: 11, color: '#6B7280' }}>{occupancy.total - occupancy.occupied} units free</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Arrivals Today</div>
          <div className="stat-value">{arrivals_today.length}</div>
          <div className="stat-sub">
            {arrivals_today.length > 0
              ? `↑ ${arrivals_today.map(b => b.unit_name).join(', ')}`
              : 'No arrivals today'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Departures Today</div>
          <div className="stat-value">{departures_today.length}</div>
          <div className="stat-sub">
            {departures_today.length > 0
              ? departures_today.map(b => b.unit_name).join(', ')
              : 'No departures today'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Revenue This Month</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {fmtIDR(revenue?.room_revenue_mtd)}
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#6B7280' }}>room revenue MTD</span>
          </div>
        </div>
      </div>

      {/* ── Two-column section ── */}
      <div className="grid-2" style={{ gap: 16 }}>

        {/* ── LEFT: Live Unit Status ── */}
        <div className="card">
          <div className="card-title">Live Unit Status</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {occupancy.units.map((u, idx) => {
              const isLast = idx === occupancy.units.length - 1;
              const isOdd  = occupancy.units.length % 2 !== 0;
              return (
                <div key={u.id} style={isLast && isOdd ? { gridColumn: 'span 2' } : {}}>
                  <UnitCard unit={u} />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Activity + Revenue stacked ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Today's Activity */}
          <div className="card">
            <div className="card-title">Today's Activity</div>

            {tasks.length === 0 && arrivals_today.length === 0 && departures_today.length === 0 ? (
              <p style={{ color: '#6B7280', fontSize: 13 }}>No activity today</p>
            ) : (
              <>
                {/* Arrivals as timeline items */}
                {arrivals_today.slice(0, 2).map(b => (
                  <div key={`arr-${b.id}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #E5E7EB' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>🔑</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Check-in — {b.guest_name}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>{b.unit_name} · {b.num_guests} pax</div>
                    </div>
                    <Link to="/checkin" className="badge badge-blue" style={{ cursor: 'pointer', textDecoration: 'none' }}>Check in</Link>
                  </div>
                ))}

                {/* Departures as timeline items */}
                {departures_today.slice(0, 1).map(b => (
                  <div key={`dep-${b.id}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #E5E7EB' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>🧳</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Check-out — {b.guest_name}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>{b.unit_name}</div>
                    </div>
                    <Link to="/checkin" className="badge badge-amber" style={{ cursor: 'pointer', textDecoration: 'none' }}>Check out</Link>
                  </div>
                ))}

                {/* Ops tasks */}
                {tasks.slice(0, 4 - Math.min(arrivals_today.length, 2) - Math.min(departures_today.length, 1)).map((t, i) => {
                  const { emoji, bg } = taskIcon(t.type);
                  const isLast = i === tasks.length - 1 && departures_today.length === 0 && arrivals_today.length === 0;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{emoji}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {t.title}{t.unit_name ? ` — ${t.unit_name}` : ''}
                        </div>
                        <div style={{ fontSize: 11, color: '#6B7280' }}>
                          {t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned'}
                          {t.due_time ? ` · ${t.due_time}` : ''}
                        </div>
                      </div>
                      {t.status === 'done'
                        ? <span className="badge badge-green">Done</span>
                        : t.priority === 'high'
                          ? <span className="badge badge-red">Urgent</span>
                          : <span className="badge badge-amber">Pending</span>
                      }
                    </div>
                  );
                })}
              </>
            )}

            <div style={{ marginTop: 12 }}>
              <Link to="/operations" style={{ fontSize: 12, color: '#2D5016', fontWeight: 600 }}>
                View all tasks →
              </Link>
            </div>
          </div>

          {/* Revenue — Last 7 Days */}
          <div className="card">
            <div className="card-title">Revenue — Last 7 Days</div>
            <RevenueChart
              bookings={monthBookings}
              pendingCount={pending_payments_count}
              pendingTotal={pendingTotal}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
