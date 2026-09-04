import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useCall } from '../context/CallContext';
import { checkinTemplate, checkoutTemplate } from '../lib/messageTemplates';
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
function ChBadge({ source }) {
  const { sources } = useSettings();
  if (!source) return null;
  if (source === 'buffer') {
    return <span style={{ background: '#6B7280', color: 'white', padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>Buffer</span>;
  }
  const s = sources.find(src => src.id === source);
  return (
    <span style={{ background: s?.color || '#6B7280', color: 'white', padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>
      {s?.label || source}
    </span>
  );
}

/* ─── unit status card ─────────────────────────────────── */
function UnitCard({ unit, flags }) {
  const { hasModule } = useAuth();
  const { callRoom } = useCall();
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState('');
  const [messaging, setMessaging] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState('');

  async function handleCallRoom(e) {
    e.stopPropagation();
    setCallError('');
    setCalling(true);
    try {
      await callRoom({ id: unit.id, name: unit.name });
    } catch (err) {
      setCallError(err.response?.data?.error || err.message || 'Could not place call');
    }
    setCalling(false);
  }

  function openMessage(e) {
    e.stopPropagation();
    setMessageError('');
    setMessageBody('');
    setMessaging(true);
  }

  async function handleSendMessage() {
    if (!messageBody.trim()) return;
    setSendingMessage(true);
    setMessageError('');
    try {
      await api.post(`/api/bookings/${unit.booking_id}/message`, { body: messageBody.trim() });
      setMessaging(false);
    } catch (err) {
      setMessageError(err.response?.data?.error || 'Failed to send message');
    }
    setSendingMessage(false);
  }

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

      {/* guest request flags — set from Room Display's DND / Clean Room widget */}
      {(flags?.dnd || flags?.clean) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {flags.dnd && (
            <span style={{ background: '#EDE9FE', color: '#5B21B6', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
              🔕 Do Not Disturb
            </span>
          )}
          {flags.clean && (
            <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
              🧹 Clean requested
            </span>
          )}
        </div>
      )}

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

      {/* Call Room — same eligibility as Sidebar's "Call a Room" / CallRoomModal:
          the calling module on, and a Room Display tablet actually assigned.
          Send Message — needs an actual checked-in booking to attach to (no
          point messaging an empty room's tablet). */}
      {(hasModule('calling') && unit.controller_id) || unit.booking_id ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {hasModule('calling') && unit.controller_id && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: 12 }}
              disabled={calling}
              onClick={handleCallRoom}
            >
              📞 {calling ? 'Calling…' : 'Call Room'}
            </button>
          )}
          {unit.booking_id && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: 12 }}
              onClick={openMessage}
            >
              ✉️ Message
            </button>
          )}
        </div>
      ) : null}
      {callError && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{callError}</div>}

      {messaging && (
        <div className="modal-backdrop" onClick={e => e.stopPropagation()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Send Message — {unit.name}</div>
              <button className="btn btn-icon" onClick={() => setMessaging(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Shown full-screen on the room's tablet until the guest dismisses it.
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkinTemplate(unit.guest_name))}>
                    🔑 Check-in Welcome
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkoutTemplate(unit.guest_name))}>
                    🧳 Check-out Reminder
                  </button>
                </div>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Friendly reminder: check-out is at 12:00 today"
                  value={messageBody}
                  onChange={e => setMessageBody(e.target.value)}
                  autoFocus
                />
              </div>
              {messageError && <div className="alert alert-error">{messageError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMessaging(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSendMessage}
                disabled={sendingMessage || !messageBody.trim()}
              >
                {sendingMessage ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── compact unit status board ────────────────────────── */

const TILE_BG = {
  occupied:    '#F97316',
  arriving:    '#3B82F6',
  available:   '#22C55E',
  maintenance: '#DC2626',
  blocked:     '#9CA3AF',
};

// Icons so status doesn't rely on color alone — small but legible at tile size.
const TILE_ICON = {
  occupied:    '🛏',
  arriving:    '🔑',
  available:   '✓',
  maintenance: '🔧',
  blocked:     '🔒',
};

// DND / Clean Room requests come from Room Display as `guest_request` tasks
// (server/routes/display.js's /housekeeping endpoint) with fixed title
// prefixes — matching on those avoids a schema change just to tag intent.
// DND is a room *state* the guest controls (cleared automatically when they
// turn it off), not a task for staff to complete — so it's surfaced only as
// passive status on the room tile, never in the actionable requests banner.
function isDndTask(t) {
  return t.title.startsWith('Do Not Disturb');
}

function unitRequestFlags(guestRequests) {
  const map = new Map();
  for (const t of guestRequests) {
    if (!t.unit_id) continue;
    const flags = map.get(t.unit_id) || { dnd: false, clean: false };
    if (isDndTask(t)) flags.dnd = true;
    else if (t.title.startsWith('Please clean room')) flags.clean = true;
    map.set(t.unit_id, flags);
  }
  return map;
}

// mirrors UnitCard's branch order
function tileState(u) {
  if (u.status === 'maintenance') return 'maintenance';
  if (u.status === 'blocked')     return 'blocked';
  if (u.status === 'occupied' && u.guest_name) return 'occupied';
  if (u.arriving_guest_name)      return 'arriving';
  return 'available';
}

const TYPE_ORDER = ['Villa', 'Suite', 'Glamping', 'Deluxe'];
function typeRank(t) {
  const i = TYPE_ORDER.findIndex(x => (t || '').includes(x));
  return i === -1 ? 99 : i;
}
function groupUnitsByType(units) {
  const m = new Map();
  for (const u of units) {
    const k = u.type || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  return [...m.entries()]
    .map(([type, list]) => ({
      type,
      list: list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.type.localeCompare(b.type));
}
// strip the leading type word so a "Deluxe 101" tile just reads "101"
function shortRoomName(name, type) {
  const w = (type || '').split(/\s+/)[0];
  return w && name.startsWith(w) ? (name.slice(w.length).trim() || name) : name;
}

function UnitPopover({ unit, anchor, flags, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  if (typeof window !== 'undefined' && window.innerWidth <= 768) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
          <div className="modal-body"><UnitCard unit={unit} flags={flags} /></div>
        </div>
      </div>
    );
  }

  const H = flags ? 240 : 200;
  const W = 300, pad = 8;
  const left = Math.min(Math.max(anchor.left, pad), window.innerWidth - W - pad);
  const top = anchor.bottom + H + pad > window.innerHeight ? anchor.top - H - 6 : anchor.bottom + 6;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={onClose} />
      <div className="card" style={{ position: 'fixed', top, left, width: W, zIndex: 200, boxShadow: 'var(--shadow-md)', padding: 12 }}
        onClick={e => e.stopPropagation()}>
        <UnitCard unit={unit} flags={flags} />
      </div>
    </>
  );
}

function UnitStatusBoard({ units, arrivals, departures, guestRequests = [] }) {
  const [selected, setSelected] = useState(null); // { unit, anchor }

  useEffect(() => {
    if (selected && !units.some(u => u.id === selected.unit.id)) setSelected(null);
  }, [units, selected]);

  const groups = groupUnitsByType(units);
  const requestFlags = unitRequestFlags(guestRequests);
  const counts = {
    occupied:  units.filter(u => tileState(u) === 'occupied').length,
    arriving:  arrivals.length,
    departing: departures.length,
    available: units.filter(u => tileState(u) === 'available').length,
    offline:   units.filter(u => ['maintenance', 'blocked'].includes(tileState(u))).length,
    requests:  requestFlags.size,
  };

  const strip = [
    ['#F97316', counts.occupied, 'Occupied'],
    ['#3B82F6', counts.arriving, 'Arriving today'],
    ['#92400E', counts.departing, 'Departing today'],
    ['#22C55E', counts.available, 'Available'],
    ['#9CA3AF', counts.offline, 'Maint / blocked'],
    ...(counts.requests > 0 ? [['#7C3AED', counts.requests, 'Guest request']] : []),
  ];

  return (
    <div>
      <div className="unit-summary-strip">
        {strip.map(([dot, n, label]) => (
          <span key={label} className="unit-summary-item">
            <span className="unit-summary-dot" style={{ background: dot }} />
            <b>{n}</b> {label}
          </span>
        ))}
      </div>

      {groups.map(g => (
        <div key={g.type} className="unit-tile-group">
          <div className="unit-tile-group-label">{g.type} · {g.list.length}</div>
          <div className="unit-tile-grid">
            {g.list.map(u => {
              const flags = requestFlags.get(u.id);
              const state = tileState(u);
              return (
                <button
                  key={u.id}
                  className={`unit-tile${selected?.unit.id === u.id ? ' selected' : ''}`}
                  style={{ background: TILE_BG[state] }}
                  title={`${u.name}${flags?.dnd ? ' · Do Not Disturb' : ''}${flags?.clean ? ' · Clean requested' : ''}`}
                  onClick={e => setSelected({ unit: u, anchor: e.currentTarget.getBoundingClientRect() })}
                >
                  <span className="unit-tile-icon">{TILE_ICON[state]}</span>
                  <span className="unit-tile-num">{shortRoomName(u.name, u.type)}</span>
                  {flags && (
                    <span className="unit-tile-badges">
                      {flags.dnd && <span className="unit-tile-badge" title="Do Not Disturb">🔕</span>}
                      {flags.clean && <span className="unit-tile-badge" title="Clean requested">🧹</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {selected && (
        <UnitPopover
          unit={selected.unit}
          anchor={selected.anchor}
          flags={requestFlags.get(selected.unit.id)}
          onClose={() => setSelected(null)}
        />
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
  const { sources } = useSettings();
  function chLabel(id) { return sources.find(s => s.id === id)?.label || id; }
  function chColor(id) { return sources.find(s => s.id === id)?.color || '#6B7280'; }

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
              background: isToday ? '#5C1A2E' : '#F3E3E6', transition: 'height 0.3s' }}
              title={fmtIDR(rev)} />
          );
        })}
      </div>

      {/* day labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {days.map((d, i) => {
          const isToday = i === 6;
          return (
            <span key={i} style={{ fontSize: 11, color: isToday ? '#5C1A2E' : '#6B7280',
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
                  <span key={ch} style={{ background: chColor(ch), color: 'white', padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                    {pct}% {chLabel(ch)}
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

function SearchTrendsCard({ trends }) {
  const terms = Object.keys(trends);
  if (terms.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Search Interest</div>
        <p style={{ color: '#6B7280', fontSize: 13 }}>No data yet — trends refresh weekly.</p>
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
                  color: '#5C1A2E', background: '#F3E3E6', borderRadius: 4, padding: '3px 8px',
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
  const { user } = useAuth();
  const [data,           setData]          = useState(null);
  const [tasks,          setTasks]         = useState([]);
  const [monthBookings,  setMonthBookings] = useState([]);
  const [pendingTotal,   setPendingTotal]  = useState(0);
  const [loading,        setLoading]       = useState(true);
  const [competitors,    setCompetitors]   = useState([]);
  const [trends,         setTrends]        = useState({});
  const [holidays,       setHolidays]      = useState([]);
  const [aiSummary,      setAiSummary]     = useState(null);
  const [guestRequests,  setGuestRequests] = useState([]);

  async function load() {
    try {
      const now = new Date();
      const [summaryRes, tasksRes, bookingsRes, competitorsRes, trendsRes, holidaysRes, aiSummaryRes] = await Promise.all([
        api.get('/api/dashboard/summary'),
        api.get('/api/tasks'),
        api.get(`/api/bookings?month=${now.getMonth() + 1}&year=${now.getFullYear()}`),
        api.get('/api/insights/competitors'),
        api.get('/api/insights/trends'),
        api.get('/api/insights/holidays?days=45'),
        api.get('/api/insights/summary'),
      ]);
      setData(summaryRes.data);
      setCompetitors(competitorsRes.data);
      setTrends(trendsRes.data);
      setHolidays(holidaysRes.data);
      setAiSummary(aiSummaryRes.data);
      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
      const todayTasks = tasksRes.data.filter(t => {
        if (!t.due_time) return false;
        return new Date(t.due_time).toLocaleDateString('en-CA') === todayStr;
      });
      setTasks(todayTasks.slice(0, 5));
      setGuestRequests(tasksRes.data.filter(t => t.type === 'guest_request' && t.status !== 'done'));
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

  async function handleResolveRequest(taskId) {
    try {
      await api.put(`/api/tasks/${taskId}`, { status: 'done' });
      setGuestRequests(prev => prev.filter(t => t.id !== taskId));
    } catch {}
  }

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

      {/* ── Alert banner for actionable guest requests (Clean Room) ──
           DND is excluded — it's a room state shown passively on the Live
           Unit Status tile/popover, not a task for staff to mark done. */}
      {(() => {
        const actionable = guestRequests.filter(t => !isDndTask(t));
        if (actionable.length === 0) return null;
        return (
          <div className="alert alert-warn" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              🔔 {actionable.length} guest request{actionable.length !== 1 ? 's' : ''} need{actionable.length === 1 ? 's' : ''} attention
            </div>
            {actionable.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13 }}>🧹 {t.title}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => handleResolveRequest(t.id)}
                >
                  Mark Done
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
            <span style={{ fontSize: 11, color: '#6B7280' }}>
              net room revenue MTD
              {parseFloat(revenue?.fnb_revenue_mtd || 0) > 0 && ` · + ${fmtIDR(revenue.fnb_revenue_mtd)} F&B`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Live Unit Status — full width ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Live Unit Status</div>
        <UnitStatusBoard units={occupancy.units} arrivals={arrivals_today} departures={departures_today} guestRequests={guestRequests} />
      </div>

      {/* ── Two-column section ── */}
      <div className="grid-2" style={{ gap: 16 }}>

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
              <Link to="/operations" style={{ fontSize: 12, color: '#5C1A2E', fontWeight: 600 }}>
                View all tasks →
              </Link>
            </div>
        </div>

        {/* ── RIGHT: Revenue + Night Audit ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Revenue — Last 7 Days */}
          <div className="card">
            <div className="card-title">Revenue — Last 7 Days</div>
            <RevenueChart
              bookings={monthBookings}
              pendingCount={pending_payments_count}
              pendingTotal={pendingTotal}
            />
          </div>

          {/* Night Audit — owner only */}
          {user?.role === 'owner' && <NightAuditWidget />}

        </div>
      </div>

      {/* ── Market Insights ── */}
      <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
        <CompetitorRatingsCard competitors={competitors} isOwner={user?.role === 'owner'} onChanged={load} />
        <SearchTrendsCard trends={trends} />
      </div>
      <div style={{ marginTop: 16 }}>
        <AiSummaryCard summary={aiSummary} />
      </div>
    </div>
  );
}
