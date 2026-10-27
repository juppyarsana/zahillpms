import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../services/api';
import UnitStatusBoard, { cleanAskedText } from '../components/UnitStatusBoard';
import { TodaySection, MonthSection, SectionHeading } from '../components/DashboardSections';
import { OtaTodayBox } from '../components/OtaInbox';
import { NoteReminders } from '../components/StaffNotes';
import { propertyClock, propertyToday, PROPERTY_TZ } from '../lib/propertyTime';

/* ─── helpers ─────────────────────────────────────────── */

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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

/* ─── night audit widget ───────────────────────────────── */
function NightAuditWidget() {
  const nav = useNavigate();
  const [info, setInfo]       = useState(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/api/night-audit/latest');
      setInfo(data);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  async function handleRun(e) {
    e.stopPropagation();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const auditDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (!confirm(`Run night audit for ${auditDate} (yesterday)?`)) return;
    setRunning(true);
    try {
      await api.post('/api/night-audit/run');
      await load();
    } catch {}
    setRunning(false);
  }

  const lastAuditAt = info?.last_audit_at;
  const ranToday = lastAuditAt
    ? new Date(lastAuditAt).toDateString() === new Date().toDateString()
    : false;

  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('/night-audit')}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Night Audit</span>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 11, padding: '4px 10px' }}
          onClick={handleRun}
          disabled={running}
        >
          {running ? '…' : 'Run Now'}
        </button>
      </div>

      {ranToday ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>Audit complete</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>
              {new Date(lastAuditAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {info?.latest?.summary ? ` · ${info.latest.summary}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#B45309' }}>Audit not run today</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>
              {lastAuditAt
                ? `Last run: ${new Date(lastAuditAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                : 'No audits yet'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── competitor ratings card ──────────────────────────── */
function PriceLevel({ level }) {
  if (level == null) return null;
  return (
    <span style={{ fontSize: 11, color: '#6B7280' }}>
      {'$'.repeat(level + 1)}<span style={{ color: '#E5E7EB' }}>{'$'.repeat(3 - level)}</span>
    </span>
  );
}

function CompetitorRow({ c, highlight, isOwner, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0',
      borderBottom: '1px solid #E5E7EB', background: highlight ? '#F0FDF4' : 'transparent',
      marginBottom: highlight ? 8 : 0, borderRadius: highlight ? 8 : 0, paddingLeft: highlight ? 10 : 0, paddingRight: highlight ? 10 : 0,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{highlight ? 'You — ' : ''}{c.name}</div>
        <div style={{ fontSize: 11, color: '#6B7280', display: 'flex', gap: 6, alignItems: 'center' }}>
          {c.rating != null ? `${c.review_count} reviews` : 'Awaiting first check'}
          <PriceLevel level={c.price_level} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {c.rating != null ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>⭐ {c.rating.toFixed(1)}</div>
            {c.rating_delta != null && c.rating_delta !== 0 && (
              <div style={{ fontSize: 11, color: c.rating_delta > 0 ? '#15803D' : '#DC2626' }}>
                {c.rating_delta > 0 ? '▲' : '▼'} {Math.abs(c.rating_delta).toFixed(1)} rating
              </div>
            )}
            {c.review_count_delta != null && c.review_count_delta !== 0 && (
              <div style={{ fontSize: 11, color: '#6B7280' }}>
                {c.review_count_delta > 0 ? '+' : ''}{c.review_count_delta} reviews this week
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>—</span>
        )}
        {isOwner && !highlight && (
          <button
            onClick={onRemove}
            title="Remove competitor"
            style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}
          >×</button>
        )}
      </div>
    </div>
  );
}

function CompetitorRatingsCard({ competitors, isOwner, onChanged }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const notConfigured = competitors.length > 0 && competitors.every(c => !c.configured);
  const self = competitors.find(c => c.is_self);
  const others = competitors.filter(c => !c.is_self);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.post('/api/insights/competitors', { name: name.trim() });
      setName('');
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add competitor');
    }
    setAdding(false);
  }

  async function handleRemove(id) {
    if (!confirm('Remove this competitor from tracking?')) return;
    try {
      await api.delete(`/api/insights/competitors/${id}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove competitor');
    }
  }

  return (
    <div className="card">
      <div className="card-title">Competitor Ratings</div>
      {notConfigured ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          Not configured yet — add a Google Places API key to start tracking competitors.
        </p>
      ) : (
        <>
          {self && <CompetitorRow c={self} highlight />}
          {!self && isOwner && (
            <p style={{ color: '#6B7280', fontSize: 12, margin: '0 0 8px' }}>
              Compare with your own rating: set your Google listing in{' '}
              <Link to="/settings/property">Settings → Property Details → Market Insights</Link>.
            </p>
          )}
          {others.length > 0 ? (
            others.map(c => <CompetitorRow key={c.id} c={c} isOwner={isOwner} onRemove={() => handleRemove(c.id)} />)
          ) : (
            <p style={{ color: '#6B7280', fontSize: 13, marginTop: 8, marginBottom: isOwner ? 12 : 0 }}>
              No competitors added yet — add one below to start tracking its Google rating.
            </p>
          )}
          {isOwner && (
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <input
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Competitor name (e.g. Toteme Glamping)"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <button className="btn btn-secondary btn-sm" type="submit" disabled={adding}>
                {adding ? '…' : '+ Add'}
              </button>
            </form>
          )}
          {error && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

/* ─── search trends card ───────────────────────────────── */
function formatShortDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function trendAverage(points) {
  if (points.length === 0) return null;
  return points.reduce((sum, p) => sum + p.interest, 0) / points.length;
}

function SearchTrendsCard({ trends, isOwner }) {
  const terms = Object.keys(trends);
  if (terms.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Search Interest</div>
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          No data yet — follow the Google searches your guests make (e.g. "ubud villa")
          {isOwner
            ? <> in <Link to="/settings/property">Settings → Property Details → Market Insights</Link>.</>
            : '. The owner sets them in Settings.'}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Search Interest (90 days)</div>
      {terms.map(term => {
        const points = trends[term].slice(-30); // last ~30 days for a readable sparkline
        const max = Math.max(...points.map(p => p.interest), 1);
        const latest = points[points.length - 1]?.interest ?? 0;

        const last7Avg = trendAverage(points.slice(-7));
        const prev7Avg = trendAverage(points.slice(-14, -7));
        const delta = (last7Avg != null && prev7Avg != null) ? Math.round(last7Avg - prev7Avg) : null;

        const rangeLabel = points.length > 0
          ? `${formatShortDate(points[0].date)} – ${formatShortDate(points[points.length - 1].date)}`
          : '';

        return (
          <div key={term} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{term}</span>
              <span style={{ fontSize: 12, color: '#6B7280' }}>{latest}/100 today</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>{rangeLabel}</span>
              {delta != null && delta !== 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: delta > 0 ? '#15803D' : '#DC2626' }}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs prior 7 days
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
              {points.map((p, i) => (
                <div key={i} title={`${p.date}: ${p.interest}`} style={{
                  flex: 1, height: `${Math.max(6, Math.round((p.interest / max) * 100))}%`,
                  background: '#8FBC6A', borderRadius: '2px 2px 0 0',
                }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── AI weekly briefing card ───────────────────────────── */
function AiSummaryCard({ summary }) {
  if (!summary) return null;
  const briefing = summary.summary;

  return (
    <div className="card">
      <div className="card-title">AI Weekly Briefing</div>
      {!summary.configured ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          Not configured yet — add an Anthropic API key to generate a weekly briefing.
        </p>
      ) : briefing ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4, marginBottom: 14 }}>
            {briefing.headline}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {briefing.highlights?.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                  color: 'var(--green-dark)', background: 'var(--green-light)', borderRadius: 4, padding: '3px 8px',
                  flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap',
                }}>{h.label}</span>
                <span style={{ fontSize: 13, lineHeight: 1.5 }}>{h.text}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 14 }}>
            Generated {new Date(summary.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </div>
        </>
      ) : (
        <p style={{ color: '#6B7280', fontSize: 13 }}>No briefing yet — generates weekly, Monday mornings.</p>
      )}
    </div>
  );
}

/* ─── main component ───────────────────────────────────── */
export default function Dashboard() {
  const { branding } = useSettings();
  const { user, can, hasModule } = useAuth();
  const [data,           setData]          = useState(null);
  const [tasks,          setTasks]         = useState([]);
  const [loading,        setLoading]       = useState(true);
  const [competitors,    setCompetitors]   = useState([]);
  const [trends,         setTrends]        = useState({});
  const [holidays,       setHolidays]      = useState([]);
  const [aiSummary,      setAiSummary]     = useState(null);
  const [guestRequests,  setGuestRequests] = useState([]);
  const [loadError,      setLoadError]     = useState('');

  async function load() {
    // Only the summary is needed to show the page. Tasks (operations module) and
    // the Market cards (insights module) are extras: skipped when their module is
    // off, and a failure of one of them never blanks the whole dashboard.
    const insights = hasModule('insights');
    const optional = (on, url) => (on ? api.get(url).then(r => r.data) : Promise.resolve(null));
    const [summaryRes, tasksRes, competitorsRes, trendsRes, holidaysRes, aiSummaryRes] = await Promise.allSettled([
      api.get('/api/dashboard/summary').then(r => r.data),
      optional(hasModule('operations'), '/api/tasks'),
      optional(insights, '/api/insights/competitors'),
      optional(insights, '/api/insights/trends'),
      optional(insights, '/api/insights/holidays?days=45'),
      optional(insights, '/api/insights/summary'),
    ]);
    const val = (r, fallback) => (r.status === 'fulfilled' && r.value != null ? r.value : fallback);
    if (summaryRes.status === 'fulfilled') { setData(summaryRes.value); setLoadError(''); }
    else {
      const e = summaryRes.reason;
      setLoadError(e?.response ? `${e.response.status} ${e.response.data?.error || ''}`.trim() : (e?.message || 'no response from the server'));
    }
    setCompetitors(val(competitorsRes, []));
    setTrends(val(trendsRes, {}));
    setHolidays(val(holidaysRes, []));
    setAiSummary(val(aiSummaryRes, null));
    const allTasks = val(tasksRes, []);
    const todayStr = propertyToday();
    const todayTasks = allTasks.filter(t => {
      if (!t.due_time) return false;
      return new Date(t.due_time).toLocaleDateString('en-CA', { timeZone: PROPERTY_TZ }) === todayStr;
    });
    setTasks(todayTasks.slice(0, 5));
    setGuestRequests(allTasks.filter(t => t.type === 'guest_request' && t.status !== 'done'));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // 10s so housekeeping / unit-status changes from the Room Display surface
    // quickly; skipped while the tab is hidden, with an immediate refetch when
    // it regains focus so a glance at a backgrounded dashboard is never stale.
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function handleResolveRequest(unitId) {
    try {
      await api.post(`/api/housekeeping/rooms/${unitId}/clean`);
      load();
    } catch {}
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading dashboard…</div>;
  if (!data)   return <div className="alert alert-error"><div>Failed to load dashboard{loadError ? ` (${loadError})` : ''}</div></div>;

  const { occupancy, arrivals_today, departures_today } = data;
  const isOwner = user?.role === 'owner';
  // "This Month" (money): owners, or staff given Month summary in Roles & Permissions.
  const showMonth = can('month_summary') && hasModule('financial');

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">{greeting()}, {user?.name?.split(' ')[0]}</div>
          {/* Property time — the hotel's day, wherever the viewer is. */}
          <div className="page-subtitle" title="The property's local time — every 'today' on this page is the property's day">
            {propertyClock()}{branding?.area ? ` · ${branding.area}` : ''}
          </div>
        </div>
      </div>

      {/* ── Overdue check-outs: still checked in past their check-out date.
           Their room stays blocked for new bookings until someone checks
           them out or amends the dates, so this goes first. ── */}
      {data.overdue_checkouts?.length > 0 && (
        <div className="alert alert-error" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ fontWeight: 700 }}>
            ⚠ {data.overdue_checkouts.length} guest{data.overdue_checkouts.length !== 1 ? 's are' : ' is'} past check-out and still checked in
          </div>
          <div style={{ fontSize: 12 }}>
            Check them out, or use Amend Dates if they've extended. Until then their room can't be booked.
          </div>
          {data.overdue_checkouts.map(o => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>
                <b>{o.unit_name}</b> · {o.guest_name} — was due out {new Date(o.check_out_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {' '}({o.days_overdue} day{o.days_overdue !== 1 ? 's' : ''} ago)
                {o.balance_due > 0 && <> · <b>Rp {Math.round(o.balance_due).toLocaleString('id-ID')} unpaid</b></>}
              </span>
              <Link to={`/reservations/${o.id}`} className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 10px' }}>Open booking →</Link>
            </div>
          ))}
        </div>
      )}

      {/* ── Alert banner for actionable guest requests (Clean Room) ──
           DND is excluded — it's a room state shown passively on the Live
           Unit Status tile/popover, not a task for staff to mark done. */}
      {(() => {
        const actionable = (occupancy?.units || []).filter(u => u.clean_request_at);
        if (actionable.length === 0) return null;
        return (
          <div className="alert alert-warn" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              🔔 {actionable.length} guest request{actionable.length !== 1 ? 's' : ''} need{actionable.length === 1 ? 's' : ''} attention
            </div>
            {actionable.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13 }}>🧹 Room {u.name} — clean {cleanAskedText(u)}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => handleResolveRequest(u.id)}
                >
                  Mark clean
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Alert banner if a holiday is coming up ── */}
      {holidays.length > 0 && (
        <div className="alert alert-info">
          🎉 <span>
            <strong>{holidays[0].name}</strong> in {holidays[0].days_until} day{holidays[0].days_until !== 1 ? 's' : ''}
            {' '}({new Date(holidays[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })})
            {' — '}consider opening a pricing period. <Link to="/pricing" style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline' }}>Go to Pricing →</Link>
          </span>
        </div>
      )}

      {/* ── Today — for everyone ── */}
      <SectionHeading title="Today" />
      <TodaySection today={data.today} occupancy={occupancy}
        canLists={can('guest_lists')} canReservations={can('reservations') && hasModule('reservations')} />
      <OtaTodayBox />
      {can('reservations') && hasModule('reservations') && <NoteReminders title="Reminders for today" />}

      {/* ── Live Unit Status — full width ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Live Unit Status</div>
        <UnitStatusBoard units={occupancy.units} guestRequests={guestRequests} onChanged={load} />
      </div>

      {/* ── Today's activity (+ night audit for owners) ── */}
      <div className={isOwner ? 'grid-2' : undefined} style={{ gap: 16 }}>

        {/* ── LEFT: Today's Activity ── */}
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
                          {t.due_time ? `Due ${new Date(t.due_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}
                          {t.assignee_name && t.due_time ? ' · ' : ''}
                          {t.assignee_name ? `${t.assignee_name}` : ''}
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
              <Link to="/operations" style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 600 }}>
                View all tasks →
              </Link>
            </div>
        </div>

        {/* ── RIGHT: Night Audit — owner only ── */}
        {isOwner && <NightAuditWidget />}
      </div>

      {/* ── This Month — owner or month_summary permission ── */}
      {showMonth && <MonthSection showReportLink={can('reports')} />}

      {/* ── Market (insights module) ── */}
      {hasModule('insights') && (<>
        <div style={{ marginTop: 24 }}><SectionHeading title="Market" /></div>
        <div className="grid-2" style={{ gap: 16 }}>
          <CompetitorRatingsCard competitors={competitors} isOwner={user?.role === 'owner'} onChanged={load} />
          <SearchTrendsCard trends={trends} isOwner={user?.role === 'owner'} />
        </div>
        <div style={{ marginTop: 16 }}>
          <AiSummaryCard summary={aiSummary} />
        </div>
      </>)}
    </div>
  );
}
