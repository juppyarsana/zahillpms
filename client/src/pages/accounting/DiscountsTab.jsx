// Discounts given (accountant, 2026-10-30): revenue stays net in the books;
// this shows what was taken off. Read only.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';
import Icon from '../../components/Icon';

const money = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const TH = { padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const TD = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };
const short = ymd => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
function monthRange(offset) {
  const [y, m] = propertyToday().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default function DiscountsTab() {
  const [range, setRange] = useState(() => monthRange(0));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    api.get(`/api/accounting/discounts?from=${range.from}&to=${range.to}`)
      .then(r => { if (live) setData(r.data); })
      .catch(err => { if (live) { setData(null); setError(err.response?.data?.error || 'Could not load'); } });
    return () => { live = false; };
  }, [range]);

  const download = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.get(`/api/accounting/discounts/xlsx?from=${range.from}&to=${range.to}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `discounts-${range.from}_to_${range.to}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Could not download'); }
    setBusy(false);
  };

  const preset = o => { const m = monthRange(o); return range.from === m.from && range.to === m.to; };

  return (
    <div>
      <div className="page-toolbar">
        <div className="seg">
          <button className={preset(0) ? 'active' : ''} onClick={() => setRange(monthRange(0))}>This month</button>
          <button className={preset(-1) ? 'active' : ''} onClick={() => setRange(monthRange(-1))}>Last month</button>
        </div>
        <input type="date" className="form-control" style={{ width: 160 }} aria-label="From" value={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} />
        <input type="date" className="form-control" style={{ width: 160 }} aria-label="To" value={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} />
        <div className="page-toolbar-end">
          <button className="btn btn-secondary btn-sm" disabled={busy || !data} onClick={download}><Icon name="download" size={14} /> Excel</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}

      {data && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Discounts given</div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={TH} />
                    <th style={{ ...TH, ...R }}>Before discount</th>
                    <th style={{ ...TH, ...R }}>Discount</th>
                    <th style={{ ...TH, ...R }}>Revenue (net)</th>
                    <th style={{ ...TH, ...R }}>Discount %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map(l => (
                    <tr key={l.key}>
                      <td style={TD}>{l.label}</td>
                      <td style={{ ...TD, ...R }}>{money(l.before)}</td>
                      <td style={{ ...TD, ...R }}>{money(l.discount)}</td>
                      <td style={{ ...TD, ...R }}>{money(l.net)}</td>
                      <td style={{ ...TD, ...R }}>{l.pct == null ? '–' : `${l.pct.toLocaleString('id-ID')}%`}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td style={TD}>Total</td>
                    <td style={{ ...TD, ...R }}>{money(data.total.before)}</td>
                    <td style={{ ...TD, ...R }}>{money(data.total.discount)}</td>
                    <td style={{ ...TD, ...R }}>{money(data.total.net)}</td>
                    <td style={TD} />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              Before service charge and tax. Revenue is by the rules of the Reports page, so it can differ from the journal while nights are not posted yet.
              A price typed lower without using the discount field is not listed here.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Rooms ({data.rooms.length})</div>
            {data.rooms.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No room discounts in this period.</div> : (
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Guest</th><th style={TH}>Room</th><th style={TH}>Stay</th><th style={TH}>Source</th><th style={TH}>Discount</th>
                      <th style={{ ...TH, ...R }}>In period, incl. tax</th><th style={{ ...TH, ...R }}>In period, net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rooms.map(r => (
                      <tr key={r.id}>
                        <td style={TD}>
                          <Link to={`/reservations/${r.id}`}>{r.guest}</Link>
                          {r.group_booker && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Group: {r.group_booker}</div>}
                        </td>
                        <td style={TD}>{r.room}</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          {short(r.check_in)} – {short(r.check_out)}
                          {r.nights_in_period !== r.nights && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.nights_in_period} of {r.nights} nights</div>}
                        </td>
                        <td style={TD}>{r.agent || r.source}</td>
                        <td style={TD}>
                          {r.rule}
                          {r.created_by && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Booked by {r.created_by}</div>}
                        </td>
                        <td style={{ ...TD, ...R }}>{money(r.amount)}</td>
                        <td style={{ ...TD, ...R }}>{money(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Restaurant ({data.restaurant.bills.length})</div>
            {data.restaurant.without_detail > 0 && (
              <div className="alert alert-warn" style={{ marginBottom: 10 }}>
                <div>Rp {money(data.restaurant.without_detail)} of discounts came from sessions sent without a list of bills, so they are in the total but not listed.</div>
              </div>
            )}
            {data.restaurant.bills.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {data.restaurant.sessions ? 'No restaurant discounts in this period.' : 'No restaurant sessions were sent for this period.'}
              </div>
            ) : (
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Day</th><th style={TH}>Bill</th><th style={TH}>Table / room</th><th style={TH}>Reason</th><th style={TH}>Cashier</th>
                      <th style={{ ...TH, ...R }}>Before discount</th><th style={{ ...TH, ...R }}>Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.restaurant.bills.map(b => (
                      <tr key={`${b.day}-${b.id}`}>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{short(b.day)}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.session}</div></td>
                        <td style={TD}>{b.bill_no || '–'}</td>
                        <td style={TD}>{b.where || '–'}{b.guest && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.guest}</div>}</td>
                        <td style={TD}>{b.label || '–'}</td>
                        <td style={TD}>{b.cashier || '–'}</td>
                        <td style={{ ...TD, ...R }}>{money(b.before)}</td>
                        <td style={{ ...TD, ...R }}>{money(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
