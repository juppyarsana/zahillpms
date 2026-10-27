// The period bar of the Insights pages Rooms, Guests and Bookings: Month /
// 3 months / Year, ‹ › to move, kept in the address (?period=&at=) so a link
// opens the same view. The server works out the dates and comparisons
// (server/services/insightPeriod.js); this only picks what to ask for.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import Icon from './Icon';
import { propertyToday } from '../lib/propertyTime';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function useInsightPeriod() {
  const [params, setParams] = useSearchParams();
  const today = propertyToday();
  const p = ['month', 'quarter', 'year'].includes(params.get('period')) ? params.get('period') : 'month';
  const raw = params.get('at') || '';
  const at = p === 'year'
    ? (/^\d{4}$/.test(raw) && raw <= today.slice(0, 4) ? raw : today.slice(0, 4))
    : (/^\d{4}-\d{2}$/.test(raw) && raw <= today.slice(0, 7) ? raw : today.slice(0, 7));
  const current = p === 'year' ? today.slice(0, 4) : today.slice(0, 7);
  const set = (period, a) => setParams(prev => {
    const n = new URLSearchParams(prev);
    if (period === 'month') n.delete('period'); else n.set('period', period);
    const cur = period === 'year' ? today.slice(0, 4) : today.slice(0, 7);
    if (a === cur) n.delete('at'); else n.set('at', a);
    return n;
  }, { replace: true });
  const setPeriod = period => set(period, period === 'year' ? at.slice(0, 4) : (at.length === 4 ? (at === today.slice(0, 4) ? today.slice(0, 7) : `${at}-12`) : at));
  const shift = n => set(p, p === 'year' ? String(Number(at) + n) : shiftMonth(at, n * (p === 'quarter' ? 3 : 1)));
  const label = p === 'year' ? at
    : p === 'quarter' ? (() => { const f = shiftMonth(at, -2); return `${MONTHS[+f.slice(5) - 1].slice(0, 3)} ${f.slice(0, 4) !== at.slice(0, 4) ? f.slice(0, 4) + ' ' : ''}– ${MONTHS[+at.slice(5) - 1].slice(0, 3)} ${at.slice(0, 4)}`; })()
      : `${MONTHS[+at.slice(5) - 1]} ${at.slice(0, 4)}`;
  return { period: p, at, label, isCurrent: at === current, setPeriod, shift, goCurrent: () => set(p, current), apiParams: { period: p, at } };
}

export default function InsightPeriodBar({ P, data }) {
  const fmt = d => { const [y, m, day] = d.split('-').map(Number); return `${day} ${MONTHS[m - 1].slice(0, 3)}${P.period === 'month' ? '' : ' ' + y}`; };
  return (
    <div className="page-toolbar">
      <div className="seg">
        {[['month', 'Month'], ['quarter', '3 months'], ['year', 'Year']].map(([k, l]) => (
          <button key={k} type="button" className={P.period === k ? 'active' : ''} onClick={() => P.setPeriod(k)}>{l}</button>
        ))}
      </div>
      <div className="date-nav">
        <button type="button" onClick={() => P.shift(-1)} aria-label="Earlier"><Icon name="chevronLeft" /></button>
        <span className="date-nav-label">{P.label}</span>
        <button type="button" onClick={() => P.shift(1)} disabled={P.isCurrent} aria-label="Later"><Icon name="chevronRight" /></button>
      </div>
      {!P.isCurrent && <button type="button" className="btn btn-secondary btn-sm" onClick={P.goCurrent}>Now</button>}
      {data?.period && (
        <span className="text-muted" style={{ fontSize: 13 }}>
          {data.period.partial ? `${fmt(data.period.from)} – ${fmt(data.period.to)} so far · ` : ''}
          compared with {fmt(data.period.prev.from)} – {fmt(data.period.prev.to)}{P.period !== 'year' && ' and last year'}
        </span>
      )}
    </div>
  );
}

// Shared bits of the Insights pages.
export const idr = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); };
export const jt = n => (Math.round((Number(n) || 0) / 100000) / 10).toLocaleString('id-ID') + ' jt';

// A change: up = green (good), down = amber; `pts` for percentage points.
export function Up({ pct, pts, invert }) {
  const v = pts ?? pct;
  if (v == null) return <span className="text-muted">—</span>;
  const up = v >= 0;
  const good = invert ? !up : up;
  const text = pts != null ? `${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })} pts` : `${Math.abs(Math.round(v))}%`;
  return <span className={good ? 'ins-down' : 'ins-up'}>{up ? '▲' : '▼'} {text}</span>;
}

export const Bar = ({ pct, strong, color }) => (
  <div className="ins-bar"><div className={`ins-bar-fill${strong ? ' strong' : ''}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { background: color, opacity: 1 } : {}) }} /></div>
);

// Loads one Insights page for the chosen period.
export function useInsightFetch(path, P) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    let off = false;
    setState(s => ({ ...s, loading: true, error: '' }));
    api.get(path, { params: P.apiParams })
      .then(r => { if (!off) setState({ data: r.data, loading: false, error: '' }); })
      .catch(err => { if (!off) setState(s => ({ ...s, loading: false, error: err.response?.data?.error || 'Failed to load' })); });
    return () => { off = true; };
  }, [path, P.apiParams.period, P.apiParams.at]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
