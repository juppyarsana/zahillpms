import { useState, useEffect } from 'react';
import api from '../services/api';

// The "Meeting / event" part of Record Payment and Record Group Payment
// (migration 153): the meetings / events linked to the stay or group that still
// owe money. Shown only when there is one — otherwise the window is unchanged.
// Each is unticked at first (a company may pay its meeting on its own); ticked,
// its amount is added to the total and recorded on the event itself.
//   url: GET …/events-due of the booking or group.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDay = s => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

const TH = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const TD = { padding: '8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };

// → [due, sel, setSel]. sel = { [event id]: { on, amount } }.
export function useEventsDue(url) {
  const [due, setDue] = useState([]);
  const [sel, setSel] = useState({});
  useEffect(() => {
    if (!url) return;
    api.get(url).then(r => {
      setDue(r.data);
      setSel(Object.fromEntries(r.data.map(e => [e.id, { on: false, amount: String(Math.round(e.balance_due)) }])));
    }).catch(() => setDue([]));
  }, [url]);
  return [due, sel, setSel];
}

const chosen = (due, sel) => due.filter(e => sel[e.id]?.on);
export const eventsTotal = (due, sel) => chosen(due, sel).reduce((s, e) => s + (parseFloat(sel[e.id].amount) || 0), 0);
export const eventsBad = (due, sel) => chosen(due, sel).some(e => {
  const a = parseFloat(sel[e.id].amount);
  return !(a > 0 && a <= e.balance_due + 1);
});
export const eventsPayload = (due, sel) => chosen(due, sel).map(e => ({ event_id: e.id, amount: parseFloat(sel[e.id].amount) }));

export default function LinkedEventsPay({ due, sel, setSel }) {
  if (!due.length) return null;
  const set = (id, patch) => setSel(x => ({ ...x, [id]: { ...x[id], ...patch } }));
  return (
    <div className="table-wrap" style={{ marginBottom: 14 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...TH, width: 28 }} /><th style={TH}>Meeting / event</th>
          <th style={{ ...TH, textAlign: 'right' }}>Still owed</th><th style={{ ...TH, textAlign: 'right', width: 150 }}>Pay now</th>
        </tr></thead>
        <tbody>
          {due.map(e => {
            const s = sel[e.id] || { on: false, amount: String(Math.round(e.balance_due)) };
            return (
              <tr key={e.id}>
                <td style={TD}><input type="checkbox" checked={s.on} onChange={() => set(e.id, { on: !s.on })} /></td>
                <td style={TD}><b>#{e.event_no} {e.name}</b> <span className="text-muted" style={{ fontSize: 11 }}>· {fmtDay(e.event_date)}</span></td>
                <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(e.balance_due)}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <input className="form-input" type="number" min={1} max={Math.round(e.balance_due)} disabled={!s.on}
                    style={{ maxWidth: 140, textAlign: 'right', padding: '4px 8px' }}
                    value={s.amount} onChange={ev => set(e.id, { amount: ev.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
        Tick it when the guest pays the meeting together with the room — it is recorded on the event, with the same method, date and reference.
      </div>
    </div>
  );
}
