import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// Morning briefing: who arrives, who stays over and who leaves on a date —
// read-only, with a branded PDF download (same as the other documents) for
// handing to housekeeping / kitchen. Data from GET /api/bookings/guest-lists (every live booking lands
// in exactly one of the three lists).

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }

// Local calendar date as YYYY-MM-DD (not toISOString — that's UTC).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function shiftDate(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function fmtShort(s) { return parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtLong(s) { return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }

const BED_LABEL = { double: 'Double bed', twin: 'Twin beds', twin_or_double: 'Twin or double', other: 'Other bed setup' };

function stayText(r) {
  return `${fmtShort(r.check_in_date)} → ${fmtShort(r.check_out_date)} · ${r.nights} night${r.nights === 1 ? '' : 's'}`;
}

function planText(r) {
  return r.rate_plan_code || '—';
}

function Requests({ r }) {
  const parts = [r.bed_preference && BED_LABEL[r.bed_preference], r.special_requests].filter(Boolean);
  if (!parts.length) return <span className="text-muted">—</span>;
  return <span style={{ fontSize: 12 }}>{parts.join(' · ')}</span>;
}

function Balance({ r }) {
  const due = parseFloat(r.balance_due) || 0;
  if (due <= 0) return <span className="badge badge-green">Paid</span>;
  return (
    <span style={{ fontWeight: 600, color: 'var(--danger-text)' }}>
      {fmtIDR(due)}{r.is_ota && <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}> (OTA)</span>}
    </span>
  );
}

function GuestCell({ r }) {
  return (
    <>
      <div style={{ fontWeight: 600 }}>{r.guest_name}</div>
      <div className="text-muted" style={{ fontSize: 11 }}>
        {[r.nationality, r.source_label, r.reservation_group_id && 'Group'].filter(Boolean).join(' · ')}
      </div>
    </>
  );
}

function RoomCell({ r }) {
  return (
    <>
      <div style={{ fontWeight: 700 }}>{r.unit_name}</div>
      {r.unit_type && <div className="text-muted" style={{ fontSize: 11 }}>{r.unit_type}</div>}
    </>
  );
}

// Kitchen tab: one meal (breakfast / dinner), room by room.
function MealSection({ title, icon, meal, empty, withoutLabel, onOpen }) {
  return (
    <div className="card mb-3">
      <div className="flex-between" style={{ marginBottom: 4 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{icon} {title}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{meal.pax} pax</div>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {plural(meal.rooms, 'room')}
        {meal.without.pax > 0 && ` · ${withoutLabel}: ${meal.without.pax} pax in ${plural(meal.without.rooms, 'room')}`}
      </div>
      {meal.rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13, padding: '8px 0' }}>{empty}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Room</th><th>Guest</th><th style={{ textAlign: 'right' }}>Pax</th><th>Plan</th><th>Special requests</th></tr>
            </thead>
            <tbody>
              {meal.rows.map(r => (
                <tr key={r.id} onClick={onOpen ? () => onOpen(r.id) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
                  <td><RoomCell r={r} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.guest_name}</div>
                    {r.status !== 'checked_in' && r.status !== 'checked_out' && (
                      <div className="text-muted" style={{ fontSize: 11 }}>Not checked in yet</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>{r.num_guests}</td>
                  <td>{r.rate_plan_code || '—'}</td>
                  <td style={{ fontSize: 12, maxWidth: 280 }}>{r.special_requests || <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Balance Due tab: one section of unpaid guests (departing / overdue / staying).
function BalanceSection({ title, icon, rows, total, empty, onOpen, onOpenPay }) {
  return (
    <div className="card mb-3">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{icon} {title}</div>
        <div className="text-muted" style={{ fontSize: 13 }}>{plural(rows.length, 'guest')} owing</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>{empty}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th><th>Guest</th><th>Check-out</th>
                <th style={{ textAlign: 'right' }}>Room &amp; meals</th><th style={{ textAlign: 'right' }}>Extras</th>
                <th style={{ textAlign: 'right' }}>Service/tax</th><th style={{ textAlign: 'right' }}>Paid</th>
                <th style={{ textAlign: 'right' }}>Balance due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const note = r.agent_billed ? 'Billed to agent — not collected at desk'
                  : r.status === 'checked_out' ? 'Already checked out — left unpaid'
                  : r.status !== 'checked_in' && r.section === 'staying' ? 'Not checked in yet'
                  : r.is_ota ? 'OTA booking — check if prepaid to OTA' : '';
                return (
                  <tr key={r.id} onClick={onOpen ? () => onOpen(r.id) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
                    <td><RoomCell r={r} /></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.guest_name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{[r.source_label, note].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(r.check_out_date)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtIDR(r.room_and_meals)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtIDR(r.extras)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtIDR(r.service_and_tax)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtIDR(r.paid)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: r.agent_billed ? 'var(--text-muted)' : 'var(--danger-text)' }}>
                      {fmtIDR(r.balance_due)}
                      {onOpen && !r.agent_billed && (
                        <div>
                          <a href={`/reservations/${r.id}#record-payment`} style={{ fontSize: 11, fontWeight: 600 }}
                            onClick={e => { e.preventDefault(); e.stopPropagation(); onOpenPay(r.id); }}>Record payment →</a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={7} style={{ textAlign: 'right' }}>To collect</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// One list section. `extra` = additional columns [{ label, render }].
function ListSection({ title, icon, rows, summary, empty, extra = [], onOpen }) {
  return (
    <div className="card mb-3 guest-list-section">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{icon} {title}</div>
        <div className="text-muted" style={{ fontSize: 13 }}>
          {summary.rooms} room{summary.rooms === 1 ? '' : 's'} · {summary.pax} guest{summary.pax === 1 ? '' : 's'}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>{empty}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th><th>Guest</th><th>Pax</th><th>Stay</th><th>Plan</th>
                {extra.map(c => <th key={c.label}>{c.label}</th>)}
                <th>Balance</th><th>Requests</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={onOpen ? () => onOpen(r.id) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
                  <td><RoomCell r={r} /></td>
                  <td><GuestCell r={r} /></td>
                  <td>{r.num_guests}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{stayText(r)}</td>
                  <td>{planText(r)}</td>
                  {extra.map(c => <td key={c.label}>{c.render(r)}</td>)}
                  <td style={{ whiteSpace: 'nowrap' }}><Balance r={r} /></td>
                  <td style={{ maxWidth: 260 }}><Requests r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GuestLists() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [date, setDate] = useState(ymd(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Balance Due holds money details — only for staff who take payments
  // (owner or Check-in/out), enforced server-side too.
  const canSeeBalances = can('checkin_full');
  const [tab, setTab] = useState('lists');
  const [balance, setBalance] = useState(null);
  const [kitchen, setKitchen] = useState(null);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setError('');
    const req = tab === 'balance'
      ? api.get('/api/bookings/balance-due', { params: { date } }).then(r => setBalance(r.data))
      : tab === 'kitchen'
        ? api.get('/api/bookings/kitchen', { params: { date } }).then(r => setKitchen(r.data))
        : api.get('/api/bookings/guest-lists', { params: { date } }).then(r => setData(r.data));
    req
      .catch(err => setError(err.response?.data?.error || 'Could not load the list'))
      .finally(() => setLoading(false));
  }, [date, tab]);

  // Same blob download as Reservations' Guest Report PDF — for whichever tab is open.
  async function downloadPdf() {
    setDownloading(true);
    const kind = tab === 'balance' ? 'balance-due' : tab === 'kitchen' ? 'kitchen' : 'guest-lists';
    try {
      const r = await api.get(`/api/bookings/${kind}/pdf`, { params: { date }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate the PDF');
    } finally {
      setDownloading(false);
    }
  }

  // Opening a booking needs Reservations access — without it rows are read-only.
  const openBooking = can('reservations') ? id => nav(`/reservations/${id}`) : null;
  const current = tab === 'balance' ? balance : tab === 'kitchen' ? kitchen : data;
  const isToday = date === ymd(new Date());

  return (
    <div className="guest-lists-page">
      <div className="page-header">
        <div>
          <div className="page-title">Guest Lists</div>
          <div className="page-subtitle">{fmtLong(date)}{isToday ? ' · Today' : ''}</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day">←</button>
          <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 170 }} aria-label="Date" />
          <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, 1))} aria-label="Next day">→</button>
          {!isToday && <button className="btn btn-secondary" onClick={() => setDate(ymd(new Date()))}>Today</button>}
          <button className="btn btn-secondary" onClick={downloadPdf} disabled={loading || !current || downloading}>
            {downloading ? 'Generating…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-bar-item${tab === 'lists' ? ' active' : ''}`} onClick={() => setTab('lists')}>🗂 Guest Lists</button>
        {canSeeBalances && (
          <button className={`tab-bar-item${tab === 'balance' ? ' active' : ''}`} onClick={() => setTab('balance')}>💰 Balance Due</button>
        )}
        <button className={`tab-bar-item${tab === 'kitchen' ? ' active' : ''}`} onClick={() => setTab('kitchen')}>🍳 Kitchen</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : tab === 'kitchen' ? (kitchen && (
        <>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            From each booking's meal plan (BB = breakfast, HB = breakfast + dinner, FB = all meals), counted in guests.
            Breakfast = guests who slept here the night before (incl. those checking out); dinner = guests sleeping here that night.
            Use → to see tomorrow.
          </div>
          <MealSection title={`Breakfast — ${fmtLong(date)} morning`} icon="🍳" meal={kitchen.breakfast} onOpen={openBooking}
            empty="No guests with breakfast included." withoutLabel="In house without breakfast" />
          <MealSection title={`Dinner — ${fmtLong(date)} night`} icon="🍽" meal={kitchen.dinner} onOpen={openBooking}
            empty="No guests with dinner included." withoutLabel="In house without dinner" />
        </>
      )) : tab === 'balance' ? (balance && (
        <>
          <div className="card mb-3" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}>
            <div style={{ flex: '1 1 220px', padding: '14px 18px' }}>
              <div className="stat-label">To collect from departing guests</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger-text)' }}>{fmtIDR(balance.totals.departing + balance.totals.overdue)}</div>
              <div className="stat-sub">{plural(balance.departing.length + balance.overdue.length, 'guest')}</div>
            </div>
            <div style={{ flex: '1 1 220px', padding: '14px 18px', borderLeft: '1px solid var(--border)' }}>
              <div className="stat-label">Total outstanding</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtIDR(balance.totals.all)}</div>
              <div className="stat-sub">incl. guests staying on</div>
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Balance = the whole stay (all nights + extras charged to the room + service/tax) minus payments received — the same as the Pro Forma on the booking's Folio tab. Guests with nothing to pay aren't listed.
          </div>
          <BalanceSection title="Departing" icon="🧳" rows={balance.departing} total={balance.totals.departing} onOpen={openBooking}
            onOpenPay={id => nav(`/reservations/${id}#record-payment`)} empty="No departing guests owe anything." />
          {balance.is_today && (
            <BalanceSection title="Overdue departures (still checked in)" icon="⏰" rows={balance.overdue} total={balance.totals.overdue} onOpen={openBooking}
              onOpenPay={id => nav(`/reservations/${id}#record-payment`)} empty="No overdue guests owe anything." />
          )}
          <BalanceSection title="Staying" icon="🛏" rows={balance.staying} total={balance.totals.staying} onOpen={openBooking}
            onOpenPay={id => nav(`/reservations/${id}#record-payment`)} empty="No staying guests owe anything." />
        </>
      )) : data && (
        <>
          <div className="card mb-3" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}>
            {[
              ['Arrivals', plural(data.summary.arrivals.rooms, 'room'), plural(data.summary.arrivals.pax, 'guest')],
              ['In-House', plural(data.summary.in_house.rooms, 'room'), `${plural(data.summary.in_house.pax, 'guest')} staying over`],
              ['Departures', plural(data.summary.departures.rooms, 'room'), plural(data.summary.departures.pax, 'guest')],
              ['Breakfast', `${data.summary.breakfast_pax} pax`, 'this morning (BB/HB/FB)'],
              ['Dinner', `${data.summary.dinner_pax} pax`, 'tonight (HB/FB)'],
            ].map(([label, value, sub], i) => (
              <div key={label} style={{ flex: '1 1 140px', padding: '14px 18px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <div className="stat-label">{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          <ListSection
            title="Arriving" icon="🛬" rows={data.arrivals} summary={data.summary.arrivals} onOpen={openBooking}
            empty="No arrivals on this date."
            extra={[
              { label: 'Status', render: r => r.status === 'checked_in' || r.status === 'checked_out'
                  ? <span className="badge badge-green">Arrived</span>
                  : <span className="badge badge-amber">Expected</span> },
              // Room condition is live (now), so only meaningful for today's list.
              ...(isToday ? [{ label: 'Room', render: r => r.housekeeping_status === 'dirty'
                  ? <span className="badge badge-orange">Needs cleaning</span>
                  : <span className="badge badge-green">Ready</span> }] : []),
            ]}
          />

          <ListSection
            title="In-House (staying over)" icon="🛏" rows={data.in_house} summary={data.summary.in_house} onOpen={openBooking}
            empty="No guests staying over on this date."
            extra={[
              // A stay-over that was never checked in is worth a second look.
              { label: 'Status', render: r => r.status === 'checked_in'
                  ? <span className="badge badge-blue">In house</span>
                  : r.status === 'checked_out'
                    ? <span className="badge badge-gray">Checked out</span>
                    : <span className="badge badge-amber">Not checked in</span> },
            ]}
          />

          <ListSection
            title="Departing" icon="🧳" rows={data.departures} summary={data.summary.departures} onOpen={openBooking}
            empty="No departures on this date."
            extra={[
              { label: 'Status', render: r => r.status === 'checked_out'
                  ? <span className="badge badge-gray">Checked out</span>
                  : r.overdue
                    ? <span className="badge badge-red">Overdue · due {fmtShort(r.check_out_date)}</span>
                    : <span className="badge badge-blue">Due out</span> },
            ]}
          />

        </>
      )}
    </div>
  );
}
