// Bank check: money in and out of each account, line by line, to tick off
// against the bank statement. Read only; the Excel has a column to tick.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';
import Icon from '../../components/Icon';

const money = n => {
  const v = Math.round(Number(n) || 0);
  return v === 0 ? '–' : v.toLocaleString('id-ID');
};
const TH = { padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const TD = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };
const short = ymd => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
function monthRange(offset) {
  const [y, m] = propertyToday().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
function lastDays(n) {
  const to = propertyToday();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (n - 1));
  return { from: d.toISOString().slice(0, 10), to };
}
function linkFor(l) {
  if (l.booking_id) return `/reservations/${l.booking_id}`;
  if (l.group_id) return `/reservations/group/${l.group_id}`;
  if (l.event_id) return `/events/${l.event_id}`;
  return null;
}

export default function BankCheckTab() {
  const [range, setRange] = useState(() => lastDays(7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState('');   // account id, '' = all

  useEffect(() => {
    let live = true;
    setError(''); setLoading(true);
    api.get(`/api/accounting/bank-check?from=${range.from}&to=${range.to}`)
      .then(r => { if (live) setData(r.data); })
      .catch(err => { if (live) { setData(null); setError(err.response?.data?.error || 'Could not load'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range]);

  const download = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.get(`/api/accounting/bank-check/xlsx?from=${range.from}&to=${range.to}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `bank-check-${range.from}_to_${range.to}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Could not download'); }
    setBusy(false);
  };

  const is = (a, b) => range.from === a && range.to === b;
  const m0 = monthRange(0), m1 = monthRange(-1), l7 = lastDays(7);
  const shown = data ? data.accounts.filter(a => !pick || (a.account_id || 'none') === pick) : [];

  return (
    <div>
      <div className="page-toolbar">
        <div className="seg">
          <button className={is(l7.from, l7.to) ? 'active' : ''} onClick={() => setRange(l7)}>Last 7 days</button>
          <button className={is(m0.from, m0.to) ? 'active' : ''} onClick={() => setRange(m0)}>This month</button>
          <button className={is(m1.from, m1.to) ? 'active' : ''} onClick={() => setRange(m1)}>Last month</button>
        </div>
        <input type="date" className="form-control" style={{ width: 160 }} aria-label="From" value={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} />
        <input type="date" className="form-control" style={{ width: 160 }} aria-label="To" value={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} />
        {data && (
          <select className="form-control" style={{ width: 240 }} aria-label="Account" value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">All accounts</option>
            {data.accounts.map(a => <option key={a.account_id || 'none'} value={a.account_id || 'none'}>{(a.code + ' ' + a.name).trim()}</option>)}
          </select>
        )}
        <div className="page-toolbar-end">
          <button className="btn btn-secondary btn-sm" disabled={busy || !data} onClick={download}><Icon name="download" size={14} /> Excel</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
      {loading && !data && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      {data && (
        <>
          {data.unmapped > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: 12 }}>
              <div>{data.unmapped} line(s) have no account. Choose one for each payment method in <Link to="/accounting?tab=accounts">Accounting → Accounts</Link>.</div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">By account</div>
            {data.accounts.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No money moved in this period.</div> : (
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Account</th><th style={TH}>Methods</th>
                      <th style={{ ...TH, ...R }}>Money in</th><th style={{ ...TH, ...R }}>Money out</th>
                      <th style={{ ...TH, ...R }}>Bank fees</th><th style={{ ...TH, ...R }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map(a => (
                      <tr key={a.account_id || 'none'}>
                        <td style={TD}><b>{(a.code + ' ' + a.name).trim()}</b></td>
                        <td style={{ ...TD, color: 'var(--text-muted)' }}>{a.methods.join(', ')}</td>
                        <td style={{ ...TD, ...R }}>{money(a.in)}</td>
                        <td style={{ ...TD, ...R }}>{money(a.out)}</td>
                        <td style={{ ...TD, ...R }}>{money(a.fee)}</td>
                        <td style={{ ...TD, ...R }}><b>{money(a.net)}</b></td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600 }}>
                      <td style={TD}>Total</td><td style={TD} />
                      <td style={{ ...TD, ...R }}>{money(data.totals.in)}</td>
                      <td style={{ ...TD, ...R }}>{money(data.totals.out)}</td>
                      <td style={{ ...TD, ...R }}>{money(data.totals.fee)}</td>
                      <td style={{ ...TD, ...R }}>{money(data.totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12, marginTop: 8, color: data.check.difference === 0 ? 'var(--text-muted)' : 'var(--red, #b91c1c)' }}>
              {data.check.difference === 0
                ? `✓ Money in (${money(data.check.money_in)}) equals "money received" on Daily Close for these days.`
                : `Money in (${money(data.check.money_in)}) differs from Daily Close (${money(data.check.daily_close)}) by ${money(data.check.difference)}.`}
              {' '}Fee and the day the bank pays are set per method in Settings → Sources &amp; Payments.
            </div>
          </div>

          {shown.map(a => (
            <div className="card" style={{ marginBottom: 16 }} key={a.account_id || 'none'}>
              <div className="card-title">{(a.code + ' ' + a.name).trim()} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>· {a.lines.length} lines</span></div>
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Date</th><th style={TH}>Bank pays</th><th style={TH}>What</th><th style={TH}>Method</th>
                      <th style={TH}>Room / guest / supplier</th><th style={TH}>Reference</th>
                      <th style={{ ...TH, ...R }}>Gross</th><th style={{ ...TH, ...R }}>Fee</th><th style={{ ...TH, ...R }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.days.map(d => (
                      <DayRows key={d.day} d={d} lines={a.lines.filter(l => l.day === d.day)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DayRows({ d, lines }) {
  return (
    <>
      {lines.map((l, i) => {
        const to = linkFor(l);
        return (
          <tr key={i}>
            <td style={TD}>{i === 0 ? short(l.day) : ''}</td>
            <td style={{ ...TD, color: l.settle_on !== l.day ? 'inherit' : 'var(--text-muted)' }}>{l.kind === 'in' && l.settle_on !== l.day ? short(l.settle_on) : ''}</td>
            <td style={TD}>{l.what}{l.time ? <span style={{ color: 'var(--text-muted)' }}> · {l.time}</span> : null}</td>
            <td style={TD}>{l.method}</td>
            <td style={TD}>{to ? <Link to={to}>{l.party || 'Open'}</Link> : l.party}{l.notes ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.notes}</div> : null}</td>
            <td style={TD}>{l.reference}</td>
            <td style={{ ...TD, ...R, color: l.gross < 0 ? 'var(--red, #b91c1c)' : 'inherit' }}>{money(l.gross)}</td>
            <td style={{ ...TD, ...R }}>{money(l.fee)}</td>
            <td style={{ ...TD, ...R }}>{money(l.net)}</td>
          </tr>
        );
      })}
      <tr style={{ background: 'var(--cream)', fontWeight: 600 }}>
        <td style={TD} colSpan={6}>Total {short(d.day)}</td>
        <td style={{ ...TD, ...R }}>{money(d.in + d.out)}</td>
        <td style={{ ...TD, ...R }}>{money(d.fee)}</td>
        <td style={{ ...TD, ...R }}>{money(d.net)}</td>
      </tr>
    </>
  );
}
