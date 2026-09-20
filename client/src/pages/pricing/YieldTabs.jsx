import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const fmtIDR = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const errMsg = e => e.response?.data?.error || 'Something went wrong';
const sign = n => (n > 0 ? '+' : '') + n;

const SOURCE_STATE = {
  in_use:        { icon: '✅', label: 'In use',           cls: 'badge-green' },
  waiting:       { icon: '⏳', label: 'Waiting for data', cls: 'badge-amber' },
  report_only:   { icon: '📊', label: 'Report only',      cls: 'badge-blue' },
  off:           { icon: '⏸', label: 'Off',              cls: 'badge-gray' },
  coming_soon:   { icon: '🔜', label: 'Coming soon',      cls: 'badge-purple' },
  not_connected: { icon: '✖',  label: 'Not connected',    cls: 'badge-gray' },
};

// Always shown at the top of the Automatic tab: what the engine is analysing right now.
function SourcesPanel({ sources, lastRun, schedule }) {
  return (
    <div className="card mb-3">
      <div className="card-title">How rates are calculated right now</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Each night the system builds one rate per room type per date from the signals below, then keeps it inside your floor/ceiling.
        Any rule you create under <strong>My rules</strong> always overrides the automatic rate for that date.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sources.map(s => {
          const st = SOURCE_STATE[s.status] || SOURCE_STATE.off;
          return (
            <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 22 }}>{st.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {s.label} <span className={`badge ${st.cls}`} style={{ marginLeft: 6 }}>{st.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        Formula: base rate × day-of-week × occupancy tier × holiday/event, limited to your floor and ceiling.
        &nbsp;·&nbsp; Schedule: {schedule}
        &nbsp;·&nbsp; Last run: {lastRun ? new Date(lastRun).toLocaleString('en-GB') : 'never'}
      </div>
    </div>
  );
}

// ── Automatic tab ─────────────────────────────────────────────

function TypeSettings({ s, onSaved }) {
  const [d, setD] = useState(s);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setD(s); }, [s]);

  const key = d.tier_mode === 'percent' ? 'from' : 'left';
  const setTier = (i, k, v) => setD(x => ({ ...x, tiers: x.tiers.map((t, j) => (j === i ? { ...t, [k]: v === '' ? '' : Number(v) } : t)) }));
  const setDow = (i, v) => setD(x => ({ ...x, dow_factors: x.dow_factors.map((f, j) => (j === i ? (v === '' ? '' : 1 + Number(v) / 100) : f)) }));

  // Same limits the server enforces, checked first so the bad field can be highlighted.
  const tierBad = t => {
    const k = t[key]; const p = t.pct;
    const kNum = Number(k);
    const kBad = k === '' || (d.tier_mode === 'percent' ? kNum < 0 || kNum > 100 : kNum < 1 || kNum > 500);
    const pBad = p === '' || Number(p) < -90 || Number(p) > 200;
    return { kBad, pBad };
  };
  const anyTierBad = d.tiers.some(t => { const b = tierBad(t); return b.kBad || b.pBad; });

  async function save() {
    if (anyTierBad) {
      setMsg({ ok: false, text: d.tier_mode === 'percent'
        ? 'Fix the tiers marked in red: occupancy must be 0–100% and the price change between −90% and +200%.'
        : 'Fix the tiers marked in red: rooms left must be 1–500 and the price change between −90% and +200%.' });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      await api.put(`/api/yield/settings/${encodeURIComponent(d.room_type)}`, {
        enabled: d.enabled, tier_mode: d.tier_mode, tiers: d.tiers, dow_factors: d.dow_factors.map(f => (f === '' ? 1 : Number(f))),
        floor_pct: Number(d.floor_pct), ceiling_pct: Number(d.ceiling_pct), lookahead_days: Number(d.lookahead_days),
        discount_window_days: d.discount_window_days === '' || d.discount_window_days == null ? null : Number(d.discount_window_days),
      });
      setMsg({ ok: true, text: 'Saved. Rates change on the next run — use "Apply now" above, or wait for the nightly run.' });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setSaving(false);
  }

  async function switchMode(mode) {
    // Switching mode swaps in that mode's default tiers (the two shapes aren't interchangeable).
    const defaults = mode === 'percent'
      ? [{ from: 0, pct: 0 }, { from: 40, pct: 0 }, { from: 70, pct: 15 }, { from: 90, pct: 30 }]
      : [{ left: 1, pct: 25 }, { left: 2, pct: 10 }, { left: 3, pct: 0 }];
    setD(x => ({ ...x, tier_mode: mode, tiers: defaults }));
  }

  return (
    <div className="card mb-3" style={{ opacity: d.enabled ? 1 : 0.85 }}>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{d.room_type}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.rooms} rooms · base {fmtIDR(d.base_rate)}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={d.enabled} onChange={e => setD({ ...d, enabled: e.target.checked })} />
          Automatic pricing {d.enabled ? 'on' : 'off'}
        </label>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Occupancy tiers by</label>
          <select className="form-select" value={d.tier_mode} onChange={e => switchMode(e.target.value)}>
            <option value="rooms_left">Rooms left (best for small room types)</option>
            <option value="percent">% occupied (best for larger room types)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Look ahead (days)</label>
          <input className="form-input" type="number" min={7} max={365} value={d.lookahead_days}
            onChange={e => setD({ ...d, lookahead_days: e.target.value })} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Apply quiet-night discounts only within (days of arrival)</label>
          <input className="form-input" type="number" min={0} max={365} placeholder="empty = no limit"
            value={d.discount_window_days ?? ''} onChange={e => setD({ ...d, discount_window_days: e.target.value })} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            Far-future nights are almost always empty, so a discount tier would hit nearly every date. With 14, a tier with a negative % only applies to nights up to 14 days away. Price increases, day-of-week and holiday changes are never limited by this.
          </div>
        </div>
      </div>

      <div className="form-label" style={{ marginBottom: 4 }}>
        {d.tier_mode === 'percent' ? 'When occupancy is at least… price changes by' : 'When this many rooms (or fewer) are left… price changes by'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {d.tiers.map((t, i) => { const bad = tierBad(t); return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
            <input className="form-input" style={{ width: 84, ...(bad.kBad ? { borderColor: '#dc2626', background: '#fef2f2' } : {}) }} type="number" value={t[key]} onChange={e => setTier(i, key, e.target.value)} />
            <span style={{ fontSize: 12 }}>{d.tier_mode === 'percent' ? '% →' : 'left →'}</span>
            <input className="form-input" style={{ width: 84, ...(bad.pBad ? { borderColor: '#dc2626', background: '#fef2f2' } : {}) }} type="number" value={t.pct} onChange={e => setTier(i, 'pct', e.target.value)} />
            <span style={{ fontSize: 12 }}>%</span>
            {d.tiers.length > 1 && (
              <button className="btn btn-icon" title="Remove tier" onClick={() => setD(x => ({ ...x, tiers: x.tiers.filter((_, j) => j !== i) }))}>✕</button>
            )}
          </div>
        ); })}
        <button className="btn btn-sm btn-secondary" onClick={() => setD(x => ({ ...x, tiers: [...x.tiers, { [key]: 0, pct: 0 }] }))}>+ Tier</button>
      </div>

      <div className="form-label" style={{ marginBottom: 4 }}>Day of week (% change for that day — e.g. 15 on Fri/Sat)</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {DOW.map((n, i) => (
          <div key={n} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{n}</div>
            <input className="form-input" style={{ width: 72 }} type="number"
              value={d.dow_factors[i] === '' ? '' : Math.round((Number(d.dow_factors[i]) - 1) * 1000) / 10}
              onChange={e => setDow(i, e.target.value)} />
          </div>
        ))}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Floor (max discount, %)</label>
          <input className="form-input" type="number" max={0} min={-90} value={d.floor_pct} onChange={e => setD({ ...d, floor_pct: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Ceiling (max increase, %)</label>
          <input className="form-input" type="number" min={0} max={200} value={d.ceiling_pct} onChange={e => setD({ ...d, ceiling_pct: e.target.value })} />
        </div>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 8 }}>{msg.text}</div>}
      <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save ${d.room_type}`}</button>
    </div>
  );
}

function RunPanel({ onApplied }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);

  async function run(dry) {
    setBusy(true); setErr('');
    try { const { data } = await api.post('/api/yield/run', { dry_run: dry }); setRes(data); if (!dry) onApplied(); }
    catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }

  const types = res?.room_types.filter(t => t.enabled) || [];
  const dates = types[0]?.rows.map(r => r.date) || [];
  const shown = showAll ? dates : dates.slice(0, 14);

  return (
    <div className="card mb-3">
      <div className="flex-between">
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>Preview &amp; apply</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <strong>Preview</strong> shows what would change without touching any rate. <strong>Apply now</strong> writes the automatic rates (the nightly run does the same).
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(true)}>Preview</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(false)}>Apply now</button>
        </div>
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 8 }}>{err}</div>}
      {res && (
        <div style={{ marginTop: 10 }}>
          <div className={`alert ${res.dry_run ? 'alert-info' : 'alert-success'}`}>
            {res.dry_run ? 'Preview only — nothing was changed.' : 'Applied. Rates and the change log are updated.'}
            {types.length === 0 && ' No room type has automatic pricing turned on — tick "Automatic pricing" on a room type card below, press its Save button, then try again.'}
          </div>
          {types.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th>{types.map(t => <th key={t.room_type}>{t.room_type}</th>)}</tr></thead>
                <tbody>
                  {shown.map((d, i) => (
                    <tr key={d}>
                      <td>{d} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{DOW[new Date(d + 'T00:00:00Z').getUTCDay()]}</span></td>
                      {types.map(t => {
                        const r = t.rows[i];
                        const pct = Math.round((r.multiplier - 1) * 1000) / 10;
                        return (
                          <td key={t.room_type} title={`${r.factors.occupancy.label} · day ×${r.factors.dow.factor} · event ${sign(r.factors.event.pct)}%`}>
                            {pct === 0 ? <span style={{ color: 'var(--text-muted)' }}>no change</span> : <strong style={{ color: pct > 0 ? '#15803d' : '#b91c1c' }}>{sign(pct)}%</strong>}
                            {r.factors.event.name && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {r.factors.event.name}</span>}
                            {r.clamped && <span className="badge badge-amber" style={{ marginLeft: 4 }}>limit</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {dates.length > 14 && (
                <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${dates.length} days`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AutomaticTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get('/api/yield/overview').then(r => setData(r.data)).catch(e => setErr(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data) return <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading…</div>;
  return (
    <>
      <SourcesPanel sources={data.sources} lastRun={data.last_run_at} schedule={data.schedule} />
      <RunPanel onApplied={load} />
      {data.settings.map(s => <TypeSettings key={s.room_type} s={s} onSaved={load} />)}
    </>
  );
}

// ── Rate calendar tab ─────────────────────────────────────────

const ORIGIN = {
  base:   { label: 'base',   color: 'var(--text-muted)' },
  manual: { label: 'rule',   color: '#b45309' },
  auto:   { label: 'auto',   color: '#1d4ed8' },
};

// "500,000 × 1.15 (Sat) × 1.10 (3 of 3 rooms left) × 1.00 = 632,500"
function explain(cell, base) {
  if (cell.origin === 'base') return `Base rate — no rule or automatic adjustment applies to this date.`;
  if (cell.origin === 'manual') {
    const p = cell.period;
    return `Your rule "${p.name}" sets this date (${p.type === 'fixed' ? `fixed ${fmtIDR(p.value)}` : `× ${p.value}`}). It overrides any automatic rate.`;
  }
  const f = cell.factors;
  if (!f) return `Automatic adjustment × ${cell.period?.value} applied. (Detailed factors are recorded when a rate changes — none logged for this date yet.)`;
  const dowName = DOW[new Date(cell.date + 'T00:00:00Z').getUTCDay()];
  const parts = [
    `${fmtIDR(base)}`,
    `× ${Number(f.dow.factor).toFixed(2)} (${dowName})`,
    `× ${(1 + f.occupancy.pct / 100).toFixed(2)} (${f.occupancy.label}${f.occupancy.discount_held_back ? `; quiet-night discount not applied — more than ${f.occupancy.window_days} days ahead` : ''})`,
    `× ${(1 + f.event.pct / 100).toFixed(2)} (${f.event.name || 'no holiday/event'})`,
  ];
  const tail = f.clamped ? ` — limited from ${sign(f.raw_pct)}% to ${sign(f.final_pct)}% by your floor/ceiling` : '';
  return `${parts.join(' ')} = ${fmtIDR(cell.rate)}${tail}`;
}

// Compact rate for a calendar cell: 575k / 632.5k / 1.15M. Full amount stays in the tooltip.
function shortIDR(n) {
  n = Math.round(Number(n) || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}M`;
  if (n % 1000 === 0) return `${n / 1000}k`;
  return `${(n / 1000).toFixed(1)}k`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Green tint = above base rate, red tint = below, none = base. Layered over white so cells stay solid.
function tint(rate, base) {
  const c = rate > base ? 'rgba(21,128,61,0.13)' : rate < base ? 'rgba(185,28,28,0.12)' : 'transparent';
  return `linear-gradient(${c}, ${c}), #fff`;
}
const DOT = { auto: '#1d4ed8', manual: '#b45309' };
const GRID_LINE = '#d6d3cd';   // solid, visible grid lines
const HEAD_BG = '#f3f1ec';
const VIEWS = [
  { key: 'calendar', label: 'Month calendar' },
  { key: 'grid',     label: 'Compare room types' },
  { key: 'list',     label: 'List' },
];
const savedView = () => { try { const v = localStorage.getItem('yieldRateView'); return VIEWS.some(x => x.key === v) ? v : 'calendar'; } catch { return 'calendar'; } };

export function RateCalendarTab() {
  const [month, setMonth] = useState(null);      // 'YYYY-MM'; null until the first response tells us "today"
  const [data, setData] = useState(null);
  const [view, setViewState] = useState(savedView);
  const [type, setType] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');
  const setView = v => { setViewState(v); try { localStorage.setItem('yieldRateView', v); } catch { /* per-viewer convenience only */ } };

  useEffect(() => {
    setErr('');
    api.get('/api/yield/rates', { params: month ? { month } : {} })
      .then(r => { setData(r.data); if (!month) setMonth(r.data.month); setSel(null); })
      .catch(e => setErr(errMsg(e)));
  }, [month]);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data || !month) return <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading…</div>;

  const types = data.room_types;
  if (!types.length) return <div style={{ padding: 30, color: 'var(--text-muted)' }}>No rooms with a room type yet.</div>;
  const active = types.find(t => t.room_type === type) || types[0];
  const [yy, mm] = month.split('-').map(Number);
  const isPast = date => date < data.today;
  const isSel = (t, cell) => sel && sel.type === t.room_type && sel.cell.date === cell.date;
  const pick = (t, cell) => setSel({ type: t.room_type, cell, base: t.base_rate });
  const cellTitle = cell => `${cell.date} · ${fmtIDR(cell.rate)}${cell.origin === 'auto' ? ' · automatic' : cell.origin === 'manual' ? ' · your rule' : ' · base rate'}`;
  const selRing = 'inset 0 0 0 2px var(--green-dark)';
  const todayRing = 'inset 0 0 0 1px #6b7280';

  const RateText = ({ cell, size }) => (
    <span style={{ fontWeight: cell.origin === 'base' ? 500 : 700, fontSize: size }}>
      {shortIDR(cell.rate)}
      {cell.origin !== 'base' && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: DOT[cell.origin], marginLeft: 4, verticalAlign: 'middle' }} />}
    </span>
  );

  // ── Month calendar: one room type, Monday-first 7-column grid with solid lines ──
  const firstDow = (new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 6) % 7;
  const monthGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: GRID_LINE, border: `1px solid ${GRID_LINE}`, borderRadius: 8, overflow: 'hidden' }}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(n => (
        <div key={n} style={{ background: HEAD_BG, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>{n}</div>
      ))}
      {Array.from({ length: firstDow }).map((_, i) => <div key={'b' + i} style={{ background: '#faf9f6' }} />)}
      {active.dates.map(cell => (
        <div key={cell.date} onClick={() => pick(active, cell)} title={cellTitle(cell)}
          style={{ cursor: 'pointer', background: tint(cell.rate, active.base_rate), minHeight: 64, padding: '6px 8px', opacity: isPast(cell.date) ? 0.5 : 1,
            boxShadow: isSel(active, cell) ? selRing : cell.date === data.today ? todayRing : 'none' }}>
          <div style={{ fontSize: 11, fontWeight: cell.date === data.today ? 700 : 500, color: 'var(--text-muted)', marginBottom: 4 }}>{Number(cell.date.slice(8))}</div>
          <RateText cell={cell} size={14} />
        </div>
      ))}
      {/* pad the last row so the outer frame closes cleanly */}
      {Array.from({ length: (7 - ((firstDow + active.dates.length) % 7)) % 7 }).map((_, i) => <div key={'e' + i} style={{ background: '#faf9f6' }} />)}
    </div>
  );

  // ── Compare: all room types × days, sticky first column, sideways scroll ──
  const th = { border: `1px solid ${GRID_LINE}`, background: HEAD_BG, textAlign: 'center', fontSize: 11, padding: '4px 6px' };
  const allGrid = (
    <div style={{ overflowX: 'auto', border: `1px solid ${GRID_LINE}`, borderRadius: 8 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...th, position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: 110 }}>Room type</th>
            {types[0].dates.map(c => {
              const dow = new Date(c.date + 'T00:00:00Z').getUTCDay();
              return (
                <th key={c.date} style={{ ...th, background: dow === 5 || dow === 6 ? '#e9e5dc' : HEAD_BG, minWidth: 52 }}>
                  {Number(c.date.slice(8))}<div style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{DOW[dow]}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {types.map(t => (
            <tr key={t.room_type}>
              <td style={{ border: `1px solid ${GRID_LINE}`, position: 'sticky', left: 0, zIndex: 1, background: HEAD_BG, padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {t.room_type}<div style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>base {shortIDR(t.base_rate)}</div>
              </td>
              {t.dates.map(c => (
                <td key={c.date} onClick={() => pick(t, c)} title={cellTitle(c)}
                  style={{ border: `1px solid ${GRID_LINE}`, cursor: 'pointer', textAlign: 'center', padding: '8px 2px', background: tint(c.rate, t.base_rate),
                    opacity: isPast(c.date) ? 0.5 : 1, boxShadow: isSel(t, c) ? selRing : c.date === data.today ? todayRing : 'none' }}>
                  <RateText cell={c} size={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ── List: one row per date, one column per room type ──
  const lth = { ...th, textAlign: 'left', padding: '8px 10px', fontSize: 12 };
  const listView = (
    <div style={{ overflowX: 'auto', border: `1px solid ${GRID_LINE}`, borderRadius: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={lth}>Date</th>
            {types.map(t => <th key={t.room_type} style={lth}>{t.room_type}<div style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>base {fmtIDR(t.base_rate)}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {types[0].dates.map((d, i) => {
            const dow = new Date(d.date + 'T00:00:00Z').getUTCDay();
            const weekend = dow === 5 || dow === 6;
            return (
              <tr key={d.date} style={{ opacity: isPast(d.date) ? 0.5 : 1 }}>
                <td style={{ border: `1px solid ${GRID_LINE}`, padding: '7px 10px', whiteSpace: 'nowrap', background: weekend ? '#f3f1ec' : '#fff' }}>
                  {d.date} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{DOW[dow]}</span>
                </td>
                {types.map(t => {
                  const cell = t.dates[i];
                  return (
                    <td key={t.room_type} onClick={() => pick(t, cell)} title={cellTitle(cell)}
                      style={{ border: `1px solid ${GRID_LINE}`, padding: '7px 10px', cursor: 'pointer', background: tint(cell.rate, t.base_rate),
                        boxShadow: isSel(t, cell) ? selRing : cell.date === data.today ? todayRing : 'none' }}>
                      <span style={{ fontWeight: cell.origin === 'base' ? 400 : 700 }}>{fmtIDR(cell.rate)}</span>
                      {cell.origin !== 'base' && <span style={{ fontSize: 10, marginLeft: 6, color: DOT[cell.origin], textTransform: 'uppercase' }}>{cell.origin === 'auto' ? 'auto' : 'rule'}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">◀</button>
          <div style={{ fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{MONTHS[mm - 1]} {yy}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">▶</button>
          {month !== data.today.slice(0, 7) && <button className="btn btn-sm btn-secondary" onClick={() => setMonth(data.today.slice(0, 7))}>Today</button>}
        </div>
        <div className="tab-bar" style={{ margin: 0, borderBottom: 'none' }}>
          {VIEWS.map(v => (
            <button key={v.key} className={`tab-bar-item${view === v.key ? ' active' : ''}`} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
      </div>

      {view === 'calendar' && (
        <div className="flex gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
          {types.map(t => (
            <button key={t.room_type} className={`btn btn-sm ${t.room_type === active.room_type ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setType(t.room_type); setSel(null); }}>
              {t.room_type} <span style={{ opacity: 0.7, fontWeight: 400 }}>· base {shortIDR(t.base_rate)}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        <span style={{ color: DOT.auto }}>●</span> automatic &nbsp; <span style={{ color: DOT.manual }}>●</span> your rule &nbsp;
        <span style={{ background: 'rgba(21,128,61,0.2)', padding: '0 6px', borderRadius: 4 }}>above base</span>{' '}
        <span style={{ background: 'rgba(185,28,28,0.18)', padding: '0 6px', borderRadius: 4 }}>below base</span> &nbsp;
        Past days are dimmed. Click a day to see why.
      </div>

      {sel && (
        <div className="alert alert-info" style={{ marginBottom: 10 }}>
          <strong>{sel.type} · {sel.cell.date}:</strong> {explain(sel.cell, sel.base)}
        </div>
      )}

      {view === 'calendar' ? monthGrid : view === 'grid' ? allGrid : listView}
    </div>
  );
}

// ── Events tab ────────────────────────────────────────────────

function HolidayRow({ h, onChanged }) {
  const [val, setVal] = useState(h.uplift_pct);
  useEffect(() => { setVal(h.uplift_pct); }, [h.uplift_pct]);
  async function commit() {
    const n = Number(val);
    if (val === '' || Number.isNaN(n) || n === h.uplift_pct) { setVal(h.uplift_pct); return; }
    await api.put('/api/yield/holiday-uplift', { holiday_date: h.holiday_date, uplift_pct: n });
    onChanged();
  }
  async function reset() {
    await api.put('/api/yield/holiday-uplift', { holiday_date: h.holiday_date, uplift_pct: null });
    onChanged();
  }
  return (
    <tr>
      <td>{h.holiday_date} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{DOW[new Date(h.holiday_date + 'T00:00:00Z').getUTCDay()]}</span></td>
      <td>{h.name}</td>
      <td>
        <span className={`badge ${h.category === 'balinese' ? 'badge-purple' : h.is_joint_leave ? 'badge-amber' : 'badge-blue'}`}>
          {h.category === 'balinese' ? 'Balinese' : h.is_joint_leave ? 'Joint leave' : 'National'}
        </span>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input className="form-input" style={{ width: 70, display: 'inline-block' }} type="number" value={val}
          onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.target.blur()} /> %
        {h.is_custom
          ? <button className="btn btn-sm btn-secondary" style={{ marginLeft: 6 }} onClick={reset} title={`Default is ${sign(h.default_uplift)}%`}>Reset</button>
          : <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>default</span>}
      </td>
    </tr>
  );
}

export function EventsTab() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: '', date_from: '', date_to: '', uplift_pct: 15 });
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get('/api/yield/events').then(r => setData(r.data)), []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setErr('');
    try {
      await api.post('/api/yield/events', { ...form, date_to: form.date_to || form.date_from, uplift_pct: Number(form.uplift_pct) });
      setForm({ name: '', date_from: '', date_to: '', uplift_pct: 15 });
      load();
    } catch (e) { setErr(errMsg(e)); }
  }
  async function remove(id) { await api.delete(`/api/yield/events/${id}`); load(); }

  if (!data) return <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading…</div>;
  return (
    <div>
      <div className="card mb-3">
        <div className="card-title">Your local events</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Festivals, weddings, conferences — anything that lifts (or lowers) demand around your property. An AI events finder that <em>suggests</em> events for you to approve is planned for the next version.
        </div>
        {data.events.map(e => (
          <div key={e.id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div>{e.name} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>· {e.date_from} → {e.date_to} · {sign(Number(e.uplift_pct))}%</span></div>
            <button className="btn btn-sm btn-danger" onClick={() => remove(e.id)}>✕</button>
          </div>
        ))}
        <div className="form-row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <div className="form-group"><label className="form-label">Event name</label>
            <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kintamani Festival" /></div>
          <div className="form-group"><label className="form-label">From</label>
            <input className="form-input" type="date" value={form.date_from} onChange={e => setForm({ ...form, date_from: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">To</label>
            <input className="form-input" type="date" min={form.date_from} value={form.date_to} onChange={e => setForm({ ...form, date_to: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Price change %</label>
            <input className="form-input" type="number" value={form.uplift_pct} onChange={e => setForm({ ...form, uplift_pct: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={add} disabled={!form.name || !form.date_from}>Add</button>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
      </div>

      <div className="card">
        <div className="card-title">Holidays</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Official Indonesian national holidays and joint leave (SKB 3 Menteri) plus Balinese Hindu days. The % is what the yield engine adds
          to that date — the starting values are our assumptions, not measured demand. Edit them to match what you see; if a date has several, the strongest one applies.
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>Price change</th></tr></thead>
            <tbody>{data.holidays.map(h => <HolidayRow key={h.holiday_date + h.name} h={h} onChanged={load} />)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Reports tab ───────────────────────────────────────────────

export function ReportsTab() {
  const [rep, setRep] = useState(null);
  const [log, setLog] = useState([]);
  useEffect(() => {
    api.get('/api/yield/report/dow').then(r => setRep(r.data));
    api.get('/api/yield/log?limit=30').then(r => setLog(r.data));
  }, []);
  if (!rep) return <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading…</div>;
  return (
    <div>
      <div className="card mb-3">
        <div className="card-title">Weekday vs weekend (from your past stays)</div>
        <div className={`alert ${rep.history_weeks >= rep.min_weeks ? 'alert-success' : 'alert-warn'}`}>
          {rep.history_weeks >= rep.min_weeks
            ? `${rep.history_weeks} weeks of history. Room types with enough nights on every weekday show a suggestion below — suggestions are never applied automatically.`
            : `Not enough history yet: ${rep.history_weeks} of ${rep.min_weeks} weeks. Until there are at least ${rep.min_weeks} weeks and ${rep.min_nights_per_dow} nights per weekday for a room type, numbers below are a sample only and no suggestion is made.`}
        </div>
        {rep.types.map(t => {
          const occ = i => Number(t.days.find(d => d.dow === i)?.occ_pct || 0);
          const wkend = (occ(5) + occ(6)) / 2;
          const wkday = [0, 1, 2, 3, 4].reduce((a, i) => a + occ(i), 0) / 5;
          const suggestion = wkday > 0 ? Math.max(0, Math.min(30, Math.round((wkend / wkday - 1) * 25))) : 0;
          return (
            <div key={t.room_type} style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>{t.room_type}</div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th></th>{DOW.map(n => <th key={n}>{n}</th>)}</tr></thead>
                  <tbody>
                    <tr><td>Occupancy</td>{DOW.map((_, i) => { const d = t.days.find(x => x.dow === i); return <td key={i}>{d ? `${d.occ_pct}%` : '—'}</td>; })}</tr>
                    <tr><td>Nights sampled</td>{DOW.map((_, i) => { const d = t.days.find(x => x.dow === i); return <td key={i} style={{ color: 'var(--text-muted)' }}>{d ? d.room_nights : 0}</td>; })}</tr>
                  </tbody>
                </table>
              </div>
              {t.enough_data
                ? <div style={{ fontSize: 13 }}>Weekend occupancy {wkend.toFixed(0)}% vs weekday {wkday.toFixed(0)}%. Suggested Fri/Sat change: <strong>+{suggestion}%</strong> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(simple rule: ¼ of the relative occupancy gap, max 30% — a starting point, not a forecast)</span></div>
                : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sample too small for a suggestion.</div>}
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-title">Change log (latest automatic changes)</div>
        {log.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No automatic changes yet.</div>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Room type</th><th>Night</th><th>Change</th><th>Why</th></tr></thead>
                <tbody>
                  {log.map((l, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString('en-GB')}</td>
                      <td>{l.room_type}</td>
                      <td>{l.stay_date}</td>
                      <td>{sign(Math.round((Number(l.old_multiplier ?? 1) - 1) * 1000) / 10)}% → <strong>{sign(Math.round((Number(l.multiplier) - 1) * 1000) / 10)}%</strong></td>
                      <td style={{ fontSize: 12 }}>
                        {l.factors.occupancy.label}{l.factors.occupancy.discount_held_back ? ' (discount held back)' : ''} · day ×{Number(l.factors.dow.factor).toFixed(2)}
                        {l.factors.event.name ? ` · ${l.factors.event.name} ${sign(l.factors.event.pct)}%` : ''}
                        {l.factors.clamped ? ' · limited by floor/ceiling' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
