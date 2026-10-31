// Food & drink by the inventory method (migration 148): the switch, and each
// month's cost of sales = stock at the start + bought − stock at the end.
import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';

const money = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const TH = { padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' };
const TD = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' };
const LEFT = { textAlign: 'left' };

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export default function CostOfSalesTab() {
  const today = propertyToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState({});
  const [date, setDate] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: d } = await api.get(`/api/accounting/cost-of-sales?month=${month}`);
      setData(d);
      setClosing(Object.fromEntries((d.lines || []).map(l => [l.key, String(Math.round(l.closing * 100) / 100)])));
      setDate(d.last_day);
      setFromInput(d.from || d.books_start || '');
      setConfirm(false);
    } catch (err) {
      setData(null);
      setError(err.response?.data?.error || 'Could not load');
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const saveFrom = async value => {
    setBusy(true); setError('');
    try {
      await api.put('/api/accounting/cost-of-sales/settings', { from: value });
      await load();
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
    setBusy(false);
  };

  const post = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      const { data: r } = await api.post('/api/accounting/cost-of-sales', { month, date, closing });
      setDone(`Posted as ${r.entry_no}.`);
      await load();
    } catch (err) { setError(err.response?.data?.error || 'Could not post'); setConfirm(false); }
    setBusy(false);
  };

  const rows = (data?.lines || []).map(l => {
    const end = Number(closing[l.key]);
    const typed = Number.isFinite(end) ? end : l.closing;
    return { ...l, end: typed, result: l.start + l.bought - typed };
  });
  const total = rows.reduce((s, r) => s + r.result, 0);

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
      {done && <div className="alert alert-success" style={{ marginBottom: 12 }}><div>{done}</div></div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Food &amp; drink: inventory method</div>
        {data?.from ? (
          <div style={{ fontSize: 13 }}>
            On from <b>{data.from}</b>. Food and drinks bought go to inventory, and reach cost when you post cost of sales below.
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} disabled={busy} onClick={() => saveFrom(null)}>Switch off</button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>Off: food and drinks bought go straight to cost. Switched on, they go to inventory, and each month you post what was used.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13 }}>From</label>
              <input type="date" className="form-control" style={{ width: 170 }} value={fromInput} onChange={e => setFromInput(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={busy || !fromInput} onClick={() => saveFrom(fromInput)}>Switch on</button>
            </div>
          </div>
        )}
      </div>

      {data?.enabled && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>Cost of sales</div>
            <div className="date-nav">
              <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Month before">‹</button>
              <span className="date-nav-label">{monthLabel(month)}</span>
              <button className="btn btn-secondary btn-sm" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
            </div>
          </div>

          {data.before_method ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>The inventory method starts on {data.from}, after this month.</div>
          ) : (
            <>
              {(data.warnings || []).map(w => <div key={w} className="alert alert-warn" style={{ marginBottom: 8 }}><div>{w}</div></div>)}
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, ...LEFT }} />
                      <th style={TH}>Stock at the start</th>
                      <th style={TH}>+ Bought</th>
                      <th style={TH}>Hotel stock</th>
                      <th style={TH}>Restaurant stock</th>
                      <th style={TH}>− Stock at the end</th>
                      <th style={TH}>= Cost of sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key}>
                        <td style={{ ...TD, ...LEFT, whiteSpace: 'normal' }}>
                          <b>{r.label}</b>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.cost_account}</div>
                        </td>
                        <td style={TD}>{money(r.start)}</td>
                        <td style={TD}>{money(r.bought)}</td>
                        <td style={{ ...TD, color: 'var(--text-muted)' }}>{money(r.closing_hotel)}</td>
                        <td style={{ ...TD, color: 'var(--text-muted)' }}>{money(r.closing_pos)}</td>
                        <td style={TD}>
                          {data.entry ? money(r.closing) : (
                            <input type="number" min="0" className="form-control" style={{ width: 130, textAlign: 'right', marginLeft: 'auto' }}
                              aria-label={`${r.label} stock at the end`} value={closing[r.key] ?? ''}
                              onChange={e => { setClosing(c => ({ ...c, [r.key]: e.target.value })); setConfirm(false); }} />
                          )}
                        </td>
                        <td style={{ ...TD, fontWeight: 600, color: r.result < 0 ? 'var(--danger)' : undefined }}>{money(data.entry ? r.posted : r.result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.entry ? (
                <div style={{ fontSize: 13, marginTop: 12 }}>
                  Posted as <b>{data.entry.entry_no}</b> on {data.entry.date}. To change it, void or reverse it under Journal entries, then post again.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                  <label style={{ fontSize: 13 }}>Entry date</label>
                  <input type="date" className="form-control" style={{ width: 170 }} min={data.last_day} value={date}
                    onChange={e => { setDate(e.target.value); setConfirm(false); }} />
                  {!confirm ? (
                    <button className="btn btn-primary" disabled={!data.can_post || busy} onClick={() => setConfirm(true)}>Post to the journal</button>
                  ) : (
                    <>
                      <span style={{ fontSize: 13 }}>{total >= 0 ? `Move Rp ${money(total)} from inventory to cost on ${date}?` : `Move Rp ${money(-total)} from cost back to inventory on ${date}?`}</span>
                      <button className="btn btn-primary" disabled={busy} onClick={post}>Yes, post</button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
