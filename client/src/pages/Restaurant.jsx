// 🍽 Restaurant — everything F&B that comes from the property's POS, in one
// place (server/routes/restaurant.js; needs pos_integration + the Restaurant
// permission). Tabs:
//   Today        — the day at a glance: sessions sent, takings (paid at the
//                  restaurant vs charged to rooms), breakfast came vs expected,
//                  sessions never sent, breakfast take-up, top items, F&B share.
//   Sessions     — every Breakfast / Lunch / Dinner report the POS sent, with
//                  every bill and the history of each send (what changed).
//   Kitchen      — breakfast / dinner counts from the meal plans (moved here
//                  from Guest Lists) + how many came, once breakfast is sent.
//   Room charges — POS room charges checked against the guests' folios.
import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday } from '../lib/propertyTime';

const TABS = [['today', '📊 Today'], ['sessions', '🧾 Sessions'], ['kitchen', '🍳 Kitchen'], ['room-charges', '🛏 Room charges']];
const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDate = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtShort = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const fmtWhen = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const vs = (now, before) => {
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 100);
  return <span style={{ color: d >= 0 ? 'var(--success-text, #2f6b3a)' : 'var(--danger-text)', fontWeight: 600 }}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}%</span>;
};

export default function Restaurant() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t[0] === params.get('tab')) ? params.get('tab') : 'today';
  const setTab = t => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('session'); return n; });
  const [date, setDate] = useState(propertyToday());
  const openSession = id => setParams({ tab: 'sessions', session: id });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Restaurant</div>
          <div className="page-subtitle">From the restaurant POS — sessions, kitchen and room charges</div>
        </div>
        {(tab === 'today' || tab === 'kitchen') && <DatePicker date={date} setDate={setDate} />}
      </div>
      <div className="tab-bar">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab-bar-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'today' && <TodayTab date={date} onOpenSession={openSession} onTab={setTab} />}
      {tab === 'sessions' && <SessionsTab selected={params.get('session')} onOpen={openSession} onClose={() => setTab('sessions')} />}
      {tab === 'kitchen' && <KitchenTab date={date} />}
      {tab === 'room-charges' && <RoomChargesTab />}
    </div>
  );
}

function DatePicker({ date, setDate }) {
  const isToday = date === propertyToday();
  return (
    <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day">←</button>
      <input className="form-input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 170 }} aria-label="Date" />
      <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, 1))} aria-label="Next day">→</button>
      {!isToday && <button className="btn btn-secondary" onClick={() => setDate(propertyToday())}>Today</button>}
    </div>
  );
}

function useLoad(url, params, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    setLoading(true); setError('');
    api.get(url, { params }).then(r => setData(r.data)).catch(e => setError(e.response?.data?.error || 'Could not load'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN(x => x + 1) };
}

const Loading = () => <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ─── TODAY ──────────────────────────────────────────────────────────────
function TodayTab({ date, onOpenSession, onTab }) {
  const { data: d, error, loading } = useLoad('/api/restaurant/overview', { date }, [date]);
  if (loading && !d) return <Loading />;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return null;
  const bf = d.breakfast;
  return (
    <>
      {d.missing.length > 0 && (
        <div className="alert alert-warn mb-3">
          <div>
            <b>Sessions never sent from the POS</b> — their restaurant sales aren't in the hotel's reports yet:{' '}
            {d.missing.map(m => `${fmtShort(m.date)} (${m.sessions.join(', ')})`).join(' · ')}.
            Ask the restaurant to open POS → Transactions and send them.
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {d.sessions.map(s => (
          <div key={s.session} className="stat-card" onClick={s.id ? () => onOpenSession(s.id) : undefined} style={{ cursor: s.id ? 'pointer' : 'default' }}>
            <div className="stat-label">{s.label}</div>
            {s.sent_at ? (
              <>
                <div className="stat-value" style={{ fontSize: 20 }}>{fmtIDR(s.outlet_total + s.room_charge_total)}</div>
                <div className="stat-sub">{plural(s.bills, 'bill')} · sent {fmtTime(s.sent_at)}{s.sent_by ? ` by ${s.sent_by}` : ''}{s.send_count > 1 ? ` · ${s.send_count} sends` : ''}</div>
              </>
            ) : <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>Not sent yet</div>}
          </div>
        ))}
      </div>

      <div className="stat-grid">
        <Stat label={`F&B takings · ${date === d.today ? 'today' : fmtShort(date)}`} value={fmtIDR(d.day.gross)}
          sub={<>{fmtIDR(d.day.outlet.gross)} paid here · {fmtIDR(d.day.rooms.gross)} to rooms</>} />
        <Stat label="Bills" value={d.day.bills ? plural(d.day.bills, 'bill') : '—'}
          sub={<>{d.day.bills ? `Average ${fmtIDR(d.day.average_bill)}` : 'No bills'}{d.last_week.bills
            ? <> · vs same day last week {vs(d.day.gross, d.last_week.gross)}</> : ' · none the same day last week'}</>} />
        <Stat label="This month so far" value={fmtIDR(d.month.gross)}
          sub={<>vs same days last month {vs(d.month.gross, d.prev_month.gross) || '—'}</>} />
        <Stat label="Breakfast came" value={bf.came == null ? `— / ${bf.expected}` : `${bf.came} / ${bf.expected}`}
          sub={!bf.expected ? 'No guests with breakfast' : bf.came == null ? 'Breakfast not sent from the POS yet' : `${pct(bf.came, bf.expected)}% of guests with breakfast`} />
        {d.fnb_share && <Stat label="F&B share this month" value={`${d.fnb_share.share}%`} sub={`${fmtIDR(d.fnb_share.fnb)} of ${fmtIDR(d.fnb_share.total)} hotel revenue`} />}
      </div>

      {bf.came != null && bf.not_came.length > 0 && (
        <div className="card mb-3">
          <div className="card-title">Didn't come to breakfast</div>
          <div style={{ fontSize: 13 }}>{bf.not_came.map(r => `${r.room}${r.guest ? ` (${r.guest})` : ''}`).join(' · ')}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-title">Breakfast take-up · last 14 days</div>
          {!d.breakfast_trend.length ? <div className="text-muted" style={{ fontSize: 13 }}>No breakfast sessions sent yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Day</th><th style={{ textAlign: 'right' }}>Expected</th><th style={{ textAlign: 'right' }}>Came</th><th style={{ width: '40%' }}>Take-up</th></tr></thead>
              <tbody>{d.breakfast_trend.slice().reverse().map(t => {
                const p = pct(t.came || 0, t.expected);
                return (
                  <tr key={t.date}><td>{fmtShort(t.date)}</td><td style={{ textAlign: 'right' }}>{t.expected ?? '—'}</td><td style={{ textAlign: 'right' }}>{t.came ?? '—'}</td>
                    <td>{p == null ? '—' : <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 8, background: 'var(--surface-2, #eee)', borderRadius: 4 }}><div style={{ width: `${Math.min(100, p)}%`, height: 8, borderRadius: 4, background: 'var(--primary)' }} /></div>
                      <span style={{ fontSize: 12, minWidth: 34 }}>{p}%</span></div>}</td></tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-title">Top items · last 7 days</div>
          {!d.top_items.length ? <div className="text-muted" style={{ fontSize: 13 }}>Shows once sessions with bill details are sent from the POS.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>{d.top_items.map(i => <tr key={i.name}><td>{i.name}</td><td style={{ textAlign: 'right' }}>{i.qty}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(i.amount)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
        Takings are what guests paid (incl. service & tax where the POS adds it). The hotel's reports count restaurant sales before service & tax.
        <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={() => onTab('room-charges')}>Check room charges →</button>
      </div>
    </>
  );
}

// ─── SESSIONS ───────────────────────────────────────────────────────────
function SessionsTab({ selected, onOpen, onClose }) {
  const [from, setFrom] = useState(shiftDate(propertyToday(), -13));
  const [to, setTo] = useState(propertyToday());
  const { data, error, loading } = useLoad('/api/restaurant/sessions', { from, to }, [from, to]);
  return (
    <>
      {selected && <SessionDetail id={selected} onClose={onClose} />}
      <div className="flex gap-2 mb-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: 13 }}>From</span>
        <input className="form-input" type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 160 }} />
        <span className="text-muted" style={{ fontSize: 13 }}>to</span>
        <input className="form-input" type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 160 }} />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data ? <Loading /> : data && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap"><table>
            <thead><tr><th>Day</th><th>Session</th><th style={{ textAlign: 'right' }}>Bills</th><th style={{ textAlign: 'right' }}>Paid at the restaurant</th>
              <th style={{ textAlign: 'right' }}>Charged to rooms</th><th>Breakfast</th><th>Sent</th></tr></thead>
            <tbody>
              {!data.sessions.length && <tr><td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No sessions sent in this period.</td></tr>}
              {data.sessions.map(s => (
                <tr key={s.id} onClick={() => onOpen(s.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(s.date)}</td>
                  <td>{s.label}</td>
                  <td style={{ textAlign: 'right' }}>{s.bills}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(s.outlet_total)}<div className="text-muted" style={{ fontSize: 11 }}>{fmtIDR(s.outlet_net)} before tax</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(s.room_charge_total)}</td>
                  <td>{s.session === 'breakfast' && s.breakfast_pax_expected != null ? `${s.breakfast_pax_came} / ${s.breakfast_pax_expected} came` : ''}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(s.sent_at)}{s.sent_by ? ` · ${s.sent_by}` : ''}
                    {s.send_count > 1 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{s.send_count} sends</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </>
  );
}

function ChangeLines({ c }) {
  if (!c) return <div className="text-muted" style={{ fontSize: 12 }}>First send</div>;
  const lines = [];
  c.bills_added.forEach(b => lines.push(`+ bill …${b.id.slice(-6)}${b.where ? ` (${b.where})` : ''} ${fmtIDR(b.total)} · ${b.method}`));
  c.bills_removed.forEach(b => lines.push(`− bill …${b.id.slice(-6)}${b.where ? ` (${b.where})` : ''} ${fmtIDR(b.total)} removed`));
  c.bills_changed.forEach(b => b.what.forEach(w => lines.push(`bill …${b.id.slice(-6)}: ${w.field} ${w.field === 'total' ? `${fmtIDR(w.from)} → ${fmtIDR(w.to)}` : `${w.from} → ${w.to}`}`)));
  c.totals.forEach(t => lines.push(`${t.label}: ${typeof t.from === 'number' && t.label !== 'Bills' && t.label !== 'Breakfast came' ? `${fmtIDR(t.from)} → ${fmtIDR(t.to)}` : `${t.from ?? '—'} → ${t.to ?? '—'}`}`));
  if (!lines.length) return <div className="text-muted" style={{ fontSize: 12 }}>Sent again — nothing changed</div>;
  return <div style={{ fontSize: 12, lineHeight: 1.6 }}>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>;
}

function SessionDetail({ id, onClose }) {
  const { data: s, error, loading } = useLoad(`/api/restaurant/sessions/${id}`, {}, [id]);
  const [open, setOpen] = useState(null);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860, padding: 20 }}>
        {loading && !s ? <Loading /> : error ? <div className="alert alert-error">{error}</div> : s && (
          <>
            <div className="flex-between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
              <div>
                <div className="page-title" style={{ fontSize: 22 }}>{s.label} · {fmtLong(s.date)}</div>
                <div className="text-muted" style={{ fontSize: 13 }}>{fmtTime(s.started_at)}–{fmtTime(s.ended_at)} · {plural(s.bills, 'bill')} · last sent {fmtWhen(s.sent_at)}{s.sent_by ? ` by ${s.sent_by}` : ''}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
            </div>

            <div className="stat-grid">
              <Stat label="Paid at the restaurant" value={fmtIDR(s.outlet_total)} sub={`${fmtIDR(s.outlet_net)} before service & tax → F&B`} />
              <Stat label="Charged to rooms" value={fmtIDR(s.room_charge_total)} sub="Already on the folios" />
              {s.breakfast && <Stat label="Breakfast came" value={`${s.breakfast.pax_came} / ${s.breakfast.pax_expected}`}
                sub={!s.breakfast.pax_expected ? 'No guests with breakfast'
                  : s.breakfast.not_came?.length ? `Didn't come: ${s.breakfast.not_came.map(r => r.room).join(', ')}` : 'Everyone came'} />}
              {s.discounts > 0 && <Stat label="Discounts" value={fmtIDR(s.discounts)} />}
            </div>

            {s.by_method.length > 0 && (
              <div className="card mb-3">
                <div className="card-title">By payment method</div>
                {s.by_method.map(m => <div key={m.method} className="flex-between" style={{ fontSize: 13, padding: '3px 0' }}><span>{m.method} · {m.bills}</span><span>{fmtIDR(m.total)}</span></div>)}
              </div>
            )}

            <div className="card mb-3" style={{ padding: 0 }}>
              <div className="card-title" style={{ padding: '14px 16px 0' }}>Bills</div>
              {!s.bill_list ? <div className="text-muted" style={{ fontSize: 13, padding: 16 }}>This session was sent by an older POS version without bill details.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Paid</th><th>Bill</th><th>Table / room</th><th>Method</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {!s.bill_list.length && <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center' }}>No bills.</td></tr>}
                    {s.bill_list.map(b => (
                      <Fragment key={b.id}>
                        <tr onClick={() => setOpen(o => (o === b.id ? null : b.id))} style={{ cursor: 'pointer' }}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(b.paid_at)}</td>
                          <td className="text-muted">…{b.id.slice(-6)}</td>
                          <td>{b.room ? `Room ${b.room}${b.guest ? ` · ${b.guest}` : ''}` : b.table || 'Walk-in'}</td>
                          <td>{b.method}</td>
                          <td style={{ textAlign: 'right' }}>{b.items.reduce((a, i) => a + i.qty, 0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtIDR(b.total)}</td>
                        </tr>
                        {open === b.id && (
                          <tr><td colSpan={6} style={{ background: 'var(--surface-2, #faf7f2)', fontSize: 13 }}>
                            {b.items.map((i, n) => (
                              <div key={n} className="flex-between"><span>{i.qty}× {i.name}{i.addons?.length ? ` + ${i.addons.join(', ')}` : ''}{i.note ? <span className="text-muted"> — {i.note}</span> : null}</span><span>{fmtIDR(i.amount)}</span></div>
                            ))}
                            {b.discount > 0 && <div className="flex-between text-muted"><span>Discount</span><span>−{fmtIDR(b.discount)}</span></div>}
                            {!b.tax_included && b.service > 0 && <div className="flex-between text-muted"><span>Service</span><span>{fmtIDR(b.service)}</span></div>}
                            {!b.tax_included && b.tax > 0 && <div className="flex-between text-muted"><span>Tax</span><span>{fmtIDR(b.tax)}</span></div>}
                            <div className="text-muted" style={{ fontSize: 12 }}>Cashier {b.cashier} · opened {fmtTime(b.opened_at)}</div>
                          </td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>

            <div className="card">
              <div className="card-title">History · {plural(s.versions.length, 'send')}</div>
              {s.versions.map(v => (
                <div key={v.version} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>#{v.version} · {fmtWhen(v.sent_at)}{v.sent_by ? ` · ${v.sent_by}` : ''}
                    <span className="text-muted" style={{ fontWeight: 400 }}> — {plural(v.bills || 0, 'bill')}, {fmtIDR(v.outlet_total)} paid here</span></div>
                  <ChangeLines c={v.changes} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── KITCHEN (moved from Guest Lists) ───────────────────────────────────
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
      {meal.rows.length === 0 ? <div className="text-muted" style={{ fontSize: 13, padding: '8px 0' }}>{empty}</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Room</th><th>Guest</th><th style={{ textAlign: 'right' }}>Pax</th><th>Plan</th><th>Special requests</th></tr></thead>
          <tbody>{meal.rows.map(r => (
            <tr key={r.id} onClick={onOpen ? () => onOpen(r.id) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
              <td><div style={{ fontWeight: 700 }}>{r.unit_name}</div>{r.unit_type && <div className="text-muted" style={{ fontSize: 11 }}>{r.unit_type}</div>}</td>
              <td><div style={{ fontWeight: 600 }}>{r.guest_name}</div>
                {r.status !== 'checked_in' && r.status !== 'checked_out' && <div className="text-muted" style={{ fontSize: 11 }}>Not checked in yet</div>}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>{r.meal_pax ?? r.num_guests}
                {r.extra_breakfast > 0 && <div className="text-muted" style={{ fontSize: 11, fontWeight: 400 }}>incl. {r.extra_breakfast} extra bed</div>}</td>
              <td>{r.rate_plan_code || '—'}</td>
              <td style={{ fontSize: 12, maxWidth: 280 }}>{r.special_requests || <span className="text-muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function KitchenTab({ date }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const { data: k, error, loading } = useLoad('/api/restaurant/kitchen', { date }, [date]);
  const [downloading, setDownloading] = useState(false);
  const openBooking = can('reservations') ? id => nav(`/reservations/${id}`) : null;
  async function downloadPdf() {
    setDownloading(true);
    try {
      const r = await api.get('/api/bookings/kitchen/pdf', { params: { date }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = `kitchen-${date}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { alert('Failed to generate the PDF'); } finally { setDownloading(false); }
  }
  if (loading && !k) return <Loading />;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!k) return null;
  const came = k.breakfast.came;
  return (
    <>
      <div className="flex-between mb-3" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="text-muted" style={{ fontSize: 12, flex: 1, minWidth: 260 }}>
          From each booking's meal plan (BB = breakfast, HB = breakfast + dinner, FB = all meals), counted in guests.
          Breakfast = guests who slept here the night before (incl. those checking out); dinner = guests sleeping here that night. Use → to see tomorrow.
        </div>
        <button className="btn btn-secondary" onClick={downloadPdf} disabled={downloading}>{downloading ? 'Generating…' : '⬇ Download PDF'}</button>
      </div>
      {came && (
        <div className="alert alert-success mb-3">
          <div><b>{came.pax} of {k.breakfast.pax} guests came to breakfast</b> (from the POS, sent {fmtTime(came.sent_at)})
            {came.not_came.length > 0 && <> · didn't come: {came.not_came.map(r => r.room).join(', ')}</>}</div>
        </div>
      )}
      <MealSection title={`Breakfast — ${fmtLong(date)} morning`} icon="🍳" meal={k.breakfast} onOpen={openBooking}
        empty="No guests with breakfast included." withoutLabel="In house without breakfast" />
      <MealSection title={`Dinner — ${fmtLong(date)} night`} icon="🍽" meal={k.dinner} onOpen={openBooking}
        empty="No guests with dinner included." withoutLabel="In house without dinner" />
    </>
  );
}

// ─── ROOM CHARGES ───────────────────────────────────────────────────────
function RoomChargesTab() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [from, setFrom] = useState(shiftDate(propertyToday(), -6));
  const [to, setTo] = useState(propertyToday());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const { data, error, loading } = useLoad('/api/restaurant/room-charges', { from, to }, [from, to]);
  const rows = (data?.charges || []).filter(c => !onlyProblems || c.problems.length);
  const badge = f => (f === 'posted' ? <span className="badge badge-green">On the folio</span>
    : f === 'voided' ? <span className="badge badge-red">Voided on the folio</span> : <span className="badge badge-red">Not on the folio</span>);
  return (
    <>
      <div className="flex gap-2 mb-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: 13 }}>From</span>
        <input className="form-input" type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 160 }} />
        <span className="text-muted" style={{ fontSize: 13 }}>to</span>
        <input className="form-input" type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 160 }} />
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
          <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only problems
        </label>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className={`alert ${data.problems ? 'alert-warn' : 'alert-success'} mb-3`}>
            <div>{data.problems
              ? <><b>{plural(data.problems, 'problem')}</b> — check them with the restaurant before night audit.</>
              : <>All {plural(data.charges.length, 'room charge')} from the POS are on the guests' folios.</>}</div>
          </div>
          {data.missing_in_pms.length > 0 && (
            <div className="card mb-3">
              <div className="card-title">In a POS session but never reached the hotel</div>
              {data.missing_in_pms.map(m => (
                <div key={m.pos_ref} className="flex-between" style={{ fontSize: 13, padding: '4px 0' }}>
                  <span>{m.session} {fmtShort(m.date)} · Room {m.room || '—'}{m.guest ? ` · ${m.guest}` : ''} · POS bill …{String(m.pos_ref).slice(-6)}</span><b>{fmtIDR(m.total)}</b>
                </div>
              ))}
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Room · guest</th><th>What</th><th style={{ textAlign: 'right' }}>Amount</th><th>Folio</th><th>POS session</th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>{onlyProblems ? 'No problems.' : 'No room charges from the POS in this period.'}</td></tr>}
                {rows.map(c => (
                  <tr key={c.id} onClick={can('reservations') && c.booking_id ? () => nav(`/reservations/${c.booking_id}`) : undefined} style={{ cursor: can('reservations') && c.booking_id ? 'pointer' : 'default' }}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtWhen(c.created_at)}</td>
                    <td><b>{c.room || '—'}</b>{c.guest_name ? ` · ${c.guest_name}` : ''}</td>
                    <td style={{ fontSize: 12, maxWidth: 300 }}>{c.description}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(c.gross)}{c.gross !== c.net && <div className="text-muted" style={{ fontSize: 11 }}>{fmtIDR(c.net)} before tax</div>}</td>
                    <td>{badge(c.folio)}{c.problems.filter(p => p.startsWith('POS says')).map(p => <div key={p} className="text-muted" style={{ fontSize: 11 }}>{p}</div>)}</td>
                    <td style={{ fontSize: 12 }}>{c.session || <span className="text-muted">not sent yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </>
  );
}
