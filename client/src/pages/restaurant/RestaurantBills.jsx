// Restaurant → Bills: every POS bill of a period in bill-number order, so the
// accountant can tick off the printed bills and see why a number is missing
// (GET /api/restaurant/bills, server/services/restaurantBills.js). Room / event
// charges, included breakfasts and complimentary bills are numbered too; a bill
// deleted in the POS shows who deleted it and why.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDate = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtDay = s => (s ? parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const fmtWhen = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const monthStartOf = d => `${d.slice(0, 7)}-01`;
const SESSION = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const NO = /^(.*)-(\d+)\/(\d{2}\/\d{2})$/;

// A run of missing numbers reads as one line: "ZKR-00001 – 00012".
function collapse(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const m = r.kind === 'missing' && NO.exec(r.bill_no);
    if (m && last?.kind === 'missing' && last.unchecked === r.unchecked && last.prefix === m[1] && last.month === m[3] && +m[2] === last.toSeq + 1) {
      last.toSeq = +m[2]; last.toNo = r.bill_no; last.count++;
      continue;
    }
    out.push(m ? { ...r, prefix: m[1], month: m[3], fromSeq: +m[2], toSeq: +m[2], toNo: r.bill_no, count: 1 } : r);
  }
  return out;
}

function MethodBadge({ r }) {
  if (r.kind === 'missing') return <span className="badge badge-red">Missing</span>;
  if (r.kind === 'deleted') return <span className="badge badge-red">Deleted</span>;
  if (r.kind === 'open') return <span className="badge badge-amber">Reopened</span>;
  if (r.group === 'room') return <span className="badge badge-blue">🛏 Room charge</span>;
  if (r.group === 'event') return <span className="badge badge-purple">🗓 Event charge</span>;
  if (r.group === 'breakfast') return <span className="badge badge-gray">Included breakfast</span>;
  if (r.group === 'comp') return <span className="badge badge-pink">🎁 Complimentary</span>;
  return <span className="badge badge-green">{r.method}</span>;
}

// What the row is, in words — matches describe() in restaurantBills.js.
function What({ r }) {
  if (r.kind === 'missing') {
    return r.unchecked
      ? <span>Not in any session sent to the hotel — the POS could not be asked</span>
      : <span>No record in the POS — deleted before the POS kept deleted bills (5 Nov 2026)</span>;
  }
  if (r.kind === 'deleted') {
    return <span>Deleted in the POS by <b>{r.deleted.by || 'someone'}</b>{r.deleted.role ? ` (${r.deleted.role})` : ''} · {fmtWhen(r.deleted.at)} — “{r.deleted.reason}”</span>;
  }
  if (r.kind === 'open') {
    return <span>The hotel voided its charge{r.hotel_void?.reason ? ` (“${r.hotel_void.reason}”)` : ''} and the POS reopened it — not settled again yet</span>;
  }
  const bits = [];
  if (r.group === 'room') bits.push(<span key="w">Room {r.charge?.room || r.room}{(r.charge?.guest || r.guest) ? ` · ${r.charge?.guest || r.guest}` : ''}</span>);
  else if (r.group === 'event') bits.push(<span key="w">{r.charge?.event || 'Event'}{r.charge?.name ? ` · ${r.charge.name}` : ''}</span>);
  else if (r.group === 'comp') bits.push(<span key="w">{r.comp?.department}{r.comp?.for ? ` · for ${r.comp.for}` : ''}{r.comp?.value ? ` · value ${fmtIDR(r.comp.value)}` : ''}</span>);
  else if (r.group === 'breakfast') bits.push(<span key="w">No payment · {r.table || 'breakfast'}</span>);
  else bits.push(<span key="w">{r.table || 'Paid at the restaurant'}</span>);
  if (r.charge?.status === 'voided') bits.push(<span key="v" className="badge badge-amber">Charge voided by the hotel</span>);
  if (r.charge?.status === 'not_in_pms') bits.push(<span key="n" className="badge badge-red">Never reached the PMS</span>);
  if (r.counts_on) bits.push(<span key="c" className="text-muted">counts on {fmtDay(r.counts_on)}</span>);
  if (!r.in_session && r.group !== 'breakfast' && r.group !== 'comp') {
    bits.push(<span key="s" className="badge badge-amber">{r.gone_from_pos ? 'No longer in the POS' : 'Session not sent yet'}</span>);
  }
  return <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{bits}</span>;
}

const needsLook = r => r.kind !== 'bill' || (r.charge && r.charge.status !== 'posted') || (!r.in_session && r.group !== 'breakfast' && r.group !== 'comp');

export default function RestaurantBills({ onOpenSession, onTab }) {
  const today = propertyToday();
  const yesterday = shiftDate(today, -1);
  const lastMonthEnd = shiftDate(monthStartOf(today), -1);
  const presets = [
    ['yesterday', 'Yesterday', yesterday, yesterday],
    ['today', 'Today', today, today],
    ['this', 'This month', monthStartOf(today), today],
    ['last', 'Last month', monthStartOf(lastMonthEnd), lastMonthEnd],
  ];
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || yesterday;
  const to = params.get('to') || yesterday;
  const setRange = (f, t) => setParams(p => { const n = new URLSearchParams(p); n.set('from', f); n.set('to', t); return n; });
  const day = from === to ? from : null;

  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => {
    setLoading(true); setError(''); setOpen(null);
    api.get('/api/restaurant/bills', { params: { from, to } })
      .then(res => setB(res.data)).catch(e => setError(e.response?.data?.error || 'Could not load'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true);
    try {
      const res = await api.get('/api/restaurant/bills/xlsx', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `restaurant-bills-${from}_to_${to}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      let msg = 'Could not download';
      try { msg = JSON.parse(await e.response.data.text()).error || msg; } catch { /* not JSON */ }
      setError(msg);
    } finally { setDownloading(false); }
  }

  const rows = useMemo(() => {
    if (!b) return [];
    const s = q.trim().toLowerCase();
    const list = b.rows.filter(r => {
      if (filter === 'look' && !needsLook(r)) return false;
      if (filter === 'room' && !(r.group === 'room' || r.group === 'event')) return false;
      if (s) {
        const hay = [r.bill_no, r.id, r.table, r.room, r.guest, r.charge?.room, r.charge?.guest, r.cashier, r.method, r.deleted?.reason].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    return collapse(list);
  }, [b, filter, q]);

  const active = presets.find(p => p[2] === from && p[3] === to)?.[0];
  const sm = b?.summary;
  const gaps = sm ? sm.missing + sm.deleted + sm.open : 0;

  return (
    <>
      <div className="page-toolbar">
        <div className="seg">
          {presets.map(([id, label, f, t]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setRange(f, t)}>{label}</button>)}
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {day && <button className="btn btn-secondary btn-sm" onClick={() => setRange(shiftDate(day, -1), shiftDate(day, -1))} aria-label="Day before">‹</button>}
          <input className="form-input" type="date" value={from} max={to} onChange={e => e.target.value && setRange(e.target.value, e.target.value > to ? e.target.value : to)} style={{ width: 150 }} />
          <span className="text-muted" style={{ fontSize: 13 }}>to</span>
          <input className="form-input" type="date" value={to} min={from} onChange={e => e.target.value && setRange(from, e.target.value)} style={{ width: 150 }} />
          {day && <button className="btn btn-secondary btn-sm" onClick={() => setRange(shiftDate(day, 1), shiftDate(day, 1))} disabled={day >= today} aria-label="Next day">›</button>}
        </div>
        <div className="page-toolbar-end">
          <button className="btn btn-primary" onClick={download} disabled={downloading || !b}>{downloading ? 'Preparing…' : '⬇ Download Excel'}</button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !b && <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
      {b && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {!b.pos_checked && (
            <div className="alert alert-warn mb-3"><div><b>Only the bills in sessions sent to the hotel are listed.</b> {b.pos_error}. Missing numbers can't be explained until the POS answers.</div></div>
          )}
          <div className={`alert ${gaps || sm.not_in_session || sm.charge_problems ? 'alert-warn' : 'alert-success'} mb-3`}>
            <div>
              {b.first
                ? <><b>{b.first} → {b.last}</b> · {plural(sm.bills, 'bill')}</>
                : <><b>No numbered bills</b> in this period</>}
              {sm.missing > 0 && <> · <b>{sm.missing} missing</b></>}
              {sm.deleted > 0 && <> · {sm.deleted} deleted</>}
              {sm.open > 0 && <> · {sm.open} reopened</>}
              {sm.not_in_session > 0 && <> · {sm.not_in_session} not sent to the hotel yet</>}
              {sm.charge_problems > 0 && <> · {plural(sm.charge_problems, 'charge')} to check</>}
              {!gaps && b.first && <> · every number accounted for</>}
              {b.sessions_not_sent.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  Sessions not sent yet: {b.sessions_not_sent.slice(0, 6).map(s => `${fmtDay(s.date)} ${s.label}`).join(', ')}{b.sessions_not_sent.length > 6 ? ` and ${b.sessions_not_sent.length - 6} more` : ''}.
                </div>
              )}
            </div>
          </div>

          <div className="stat-grid stat-grid-money">
            <div className="stat-card"><div className="stat-label">Paid at the restaurant</div><div className="stat-value">{fmtIDR(sm.outlet.total)}</div><div className="stat-sub">{plural(sm.outlet.bills, 'bill')}</div></div>
            <div className="stat-card"><div className="stat-label">Charged to rooms</div><div className="stat-value">{fmtIDR(sm.room.total)}</div><div className="stat-sub">{plural(sm.room.bills, 'bill')} · signed by the guest</div></div>
            <div className="stat-card"><div className="stat-label">Charged to events</div><div className="stat-value">{fmtIDR(sm.event.total)}</div><div className="stat-sub">{plural(sm.event.bills, 'bill')}</div></div>
            <div className="stat-card"><div className="stat-label">No payment</div><div className="stat-value">{sm.breakfast + sm.comp}</div><div className="stat-sub">{sm.breakfast} included breakfast · {sm.comp} complimentary</div></div>
          </div>

          <div className="page-toolbar" style={{ marginTop: 4 }}>
            <div className="seg">
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'look' ? 'active' : ''} onClick={() => setFilter('look')}>Needs a look</button>
              <button className={filter === 'room' ? 'active' : ''} onClick={() => setFilter('room')}>Room & event charges</button>
            </div>
            <input className="form-input" placeholder="Search number, room, guest, cashier…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 820 }}>
                <thead>
                  <tr><th>Bill no.</th><th>Paid</th><th>Method</th><th>Details</th><th>Cashier</th><th style={right}>Total</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ padding: 24, textAlign: 'center' }}>Nothing to show</td></tr>}
                  {rows.map((r, i) => {
                    const key = r.id || r.bill_no || i;
                    const canOpen = r.kind !== 'missing';
                    const isOpen = open === key;
                    const bad = r.kind !== 'bill';
                    return (
                      <Fragment key={key}>
                        <tr onClick={() => canOpen && setOpen(isOpen ? null : key)} style={{ cursor: canOpen ? 'pointer' : 'default', background: bad ? 'var(--danger-bg)' : undefined }}>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {r.kind === 'missing' && r.count > 1 ? <>{r.bill_no} – {String(r.toSeq).padStart(5, '0')} <span className="text-muted" style={{ fontWeight: 400 }}>({r.count})</span></> : (r.bill_no || <span className="text-muted" style={{ fontWeight: 400 }}>no number</span>)}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{r.paid_at ? <>{day ? '' : `${fmtDay(r.date)} · `}{fmtTime(r.paid_at)}{r.session && <span className="text-muted"> · {SESSION[r.session]}</span>}</> : ''}</td>
                          <td><MethodBadge r={r} /></td>
                          <td><What r={r} /></td>
                          <td>{r.cashier || ''}</td>
                          <td style={right}>{r.total != null && r.kind !== 'missing' ? fmtIDR(r.total) : ''}</td>
                        </tr>
                        {isOpen && (
                          <tr><td colSpan={6} style={{ background: 'var(--surface-2, #faf7f2)' }}>
                            <div style={{ display: 'grid', gap: 6, fontSize: 13, padding: '4px 0' }}>
                              {(r.items || []).length > 0 && (
                                <table style={{ width: '100%', maxWidth: 520 }}>
                                  <tbody>
                                    {r.items.map((it, j) => (
                                      <tr key={j}><td>{it.qty} × {it.name}{it.included ? ' (included)' : ''}{it.addons?.length ? <span className="text-muted"> + {it.addons.join(', ')}</span> : ''}</td><td style={right}>{fmtIDR(it.amount)}</td></tr>
                                    ))}
                                    {r.discount > 0 && <tr><td className="text-muted">Discount{r.discount_label ? ` · ${r.discount_label}` : ''}</td><td style={right}>− {fmtIDR(r.discount)}</td></tr>}
                                    {(r.service > 0 || r.tax > 0) && <tr><td className="text-muted">Service & tax</td><td style={right}>{fmtIDR((r.service || 0) + (r.tax || 0))}</td></tr>}
                                    <tr><td><b>Total</b></td><td style={right}><b>{fmtIDR(r.total)}</b></td></tr>
                                  </tbody>
                                </table>
                              )}
                              <div className="text-muted">
                                POS bill {r.id}{r.opened_at ? ` · opened ${fmtWhen(r.opened_at)}` : ''}{r.paid_at ? ` · paid ${fmtWhen(r.paid_at)}` : ''}
                                {r.deleted?.status === 'open' ? ' · it was a reopened bill' : ''}
                              </div>
                              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                                {r.session_id && <button className="btn btn-secondary btn-sm" onClick={() => onOpenSession(r.session_id)}>Open the session</button>}
                                {r.charge?.booking_id && <Link className="btn btn-secondary btn-sm" to={`/reservations/${r.charge.booking_id}`}>Open the reservation</Link>}
                                {r.charge?.event_id && <Link className="btn btn-secondary btn-sm" to={`/events/${r.charge.event_id}`}>Open the event</Link>}
                                {r.charge && r.charge.status !== 'posted' && onTab && <button className="btn btn-secondary btn-sm" onClick={() => onTab('room-charges')}>Room charges tab</button>}
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Every bill gets its number when it is paid, counted per month. A room or event charge, an included breakfast and a complimentary bill have a number too.
            {' '}<Link to="/guide/restaurant-report">📘 Guide</Link>
          </p>
        </div>
      )}
    </>
  );
}
