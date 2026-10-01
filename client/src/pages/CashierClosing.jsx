// Cashier closing (migration 093): every payment received on a day, by method
// and by the user who took it — checked against the EDC slips, the transfers
// and the cash drawer at the end of a shift. Stays billed to an agent at
// check-out are the last group, "Agent ledger": in the grand total, but not
// money received.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday } from '../lib/propertyTime';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function shiftDate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function fmtLong(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const TH = { textAlign: 'left', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const TD = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };

export default function CashierClosing() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [date, setDate] = useState(DATE_RE.test(params.get('date') || '') ? params.get('date') : propertyToday());
  // Starts on the person looking at it; "All users" is one click away.
  const [userId, setUserId] = useState(params.get('user') === 'all' ? '' : (user?.id || ''));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/cashier-closing', { params: { date, ...(userId ? { user_id: userId } : {}) } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [date, userId]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const r = await api.get('/api/cashier-closing/pdf', { params: { date, ...(userId ? { user_id: userId } : {}) }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cashier-closing-${date}.pdf`;
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

  const isToday = date === propertyToday();
  const openBooking = can('reservations') ? id => nav(`/reservations/${id}`) : null;
  // The picker lists everyone who took money that day, plus the viewer.
  const users = data ? [...data.users] : [];
  if (user?.id && !users.some(u => u.id === user.id)) users.unshift({ id: user.id, name: user.name, total: 0, count: 0 });

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Cashier Closing</div>
          <div className="page-subtitle">{fmtLong(date)}{isToday ? ' · Today' : ''} — payments received, to check against slips, transfers and cash</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day">←</button>
          <input className="form-input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 170 }} aria-label="Date" />
          <button className="btn btn-secondary" onClick={() => setDate(d => shiftDate(d, 1))} aria-label="Next day">→</button>
          {!isToday && <button className="btn btn-secondary" onClick={() => setDate(propertyToday())}>Today</button>}
          <button className="btn btn-secondary" onClick={downloadPdf} disabled={loading || !data || downloading}>
            {downloading ? 'Generating…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span className="text-muted" style={{ fontSize: 13 }}>User</span>
        <select className="form-select" value={userId} onChange={e => setUserId(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>
          <option value="">All users{data ? ` — ${idr(data.day_total)}` : ''}</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === user?.id ? ' (me)' : ''} — {idr(u.total)}</option>)}
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? <div className="text-muted">Loading…</div> : data && (<>
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Grand total</div>
            <div className="stat-value">{idr(data.total)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {data.count} line{data.count === 1 ? '' : 's'}{userId ? ` · whole day ${idr(data.day_total)}` : ''}
              {data.ledger_total > 0 && <div>Money received {idr(data.money_total)}</div>}
            </div>
          </div>
          {data.by_method.map(m => (
            <div className="stat-card" key={m.method}>
              <div className="stat-label">{m.method}</div>
              <div className="stat-value">{idr(m.amount)}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{m.count} {m.ledger ? 'stay' : 'payment'}{m.count === 1 ? '' : 's'}{m.ledger ? ' · not received' : ''}</div>
            </div>
          ))}
        </div>

        <div className="card">
          {!data.groups.length ? (
            <div className="text-muted" style={{ fontSize: 13 }}>
              Nothing recorded{userId ? ' by this user' : ''} on this day.
            </div>
          ) : (
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Time</th><th style={TH}>Room</th><th style={TH}>Guest</th><th style={TH}>For</th>
                    <th style={TH}>Reference</th><th style={TH}>By</th><th style={{ ...TH, ...R }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map(g => [
                    <tr key={`h-${g.method}`}>
                      <td colSpan={7} style={{ ...TD, fontWeight: 700, background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
                        {g.method}{g.ledger && <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}> — billed to agents at check-out: the agent owes it, no money received</span>}
                      </td>
                    </tr>,
                    ...g.lines.map((l, i) => (
                      <tr key={`${g.method}-${i}`} onClick={openBooking && l.booking_id ? () => openBooking(l.booking_id) : undefined}
                        style={openBooking && l.booking_id ? { cursor: 'pointer' } : undefined}>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{l.time || (l.recorded_on ? <span className="text-muted" title="Recorded on another day">{l.recorded_on.slice(5).split('-').reverse().join('/')}</span> : '—')}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{l.room || '—'}</td>
                        <td style={TD}>{l.guest}</td>
                        <td style={TD}>{l.what}</td>
                        <td style={TD}>
                          {l.reference || <span className="text-muted">—</span>}
                          {l.notes && l.notes !== l.reference && <div className="text-muted" style={{ fontSize: 11 }}>{l.notes}</div>}
                        </td>
                        <td style={TD}>{l.user_name}</td>
                        <td style={{ ...TD, ...R }}>{idr(l.amount)}</td>
                      </tr>
                    )),
                    <tr key={`s-${g.method}`}>
                      <td colSpan={6} style={{ ...TD, ...R, fontWeight: 600 }}>Sub total — {g.method}</td>
                      <td style={{ ...TD, ...R, fontWeight: 700 }}>{idr(g.subtotal)}</td>
                    </tr>,
                  ])}
                  <tr>
                    <td colSpan={6} style={{ ...TD, ...R, fontWeight: 700, fontSize: 15, borderBottom: 'none' }}>Grand total</td>
                    <td style={{ ...TD, ...R, fontWeight: 700, fontSize: 15, borderBottom: 'none' }}>{idr(data.total)}</td>
                  </tr>
                  {data.ledger_total > 0 && (
                    <tr>
                      <td colSpan={7} className="text-muted" style={{ ...TD, ...R, fontSize: 12, borderBottom: 'none', paddingTop: 0 }}>
                        Money received {idr(data.money_total)} · Agent ledger {idr(data.ledger_total)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!userId && data.by_user.length > 1 && (
          <div className="card mt-3">
            <div className="card-title">By user</div>
            {data.by_user.map(u => (
              <div key={u.id || 'none'} className="flex-between" style={{ fontSize: 13, padding: '4px 0' }}>
                <span>{u.name} <span className="text-muted">· {u.count} line{u.count === 1 ? '' : 's'}</span></span>
                <span style={{ fontWeight: 600 }}>{idr(u.total)}</span>
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  );
}
