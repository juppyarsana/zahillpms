import { useState, useEffect } from 'react';
import api from '../services/api';

function fmtIDR(n) {
  return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

// Same blob-then-click download pattern as BackOffice.jsx's downloadCsv —
// duplicated rather than shared, matching this codebase's house style for
// small per-file helpers.
async function downloadCsv(url, filename) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

// Compact form for axis labels — e.g. Rp 5.2jt / Rp 850rb — Indonesian-standard
// abbreviations (juta/ribu) rather than the K/M convention.
function fmtIDRShort(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return 'Rp ' + (v / 1_000_000).toFixed(1).replace('.0', '') + 'jt';
  if (v >= 1_000) return 'Rp ' + (v / 1_000).toFixed(0) + 'rb';
  return fmtIDR(v);
}

function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=Sun … 6=Sat
}

function fmtDay(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtDayFull(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Local calendar date as YYYY-MM-DD (not toISOString — that's UTC, which is
// the previous day before 08:00 in Bali).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const PRESETS = [
  { key: 'today',      label: 'Today' },
  { key: 'yesterday',  label: 'Yesterday' },
  { key: 'this_week',  label: 'This week' },
  { key: 'last_7',     label: 'Last 7 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'month',      label: 'Pick a month…' },
  { key: 'custom',     label: 'Custom range…' },
];

// Inclusive { from, to } for a preset, relative to today.
function periodFor(preset, { month, year, customFrom, customTo }) {
  const today = new Date();
  switch (preset) {
    case 'today':      return { from: ymd(today), to: ymd(today) };
    case 'yesterday':  { const y = addDays(today, -1); return { from: ymd(y), to: ymd(y) }; }
    case 'this_week':  { const mon = addDays(today, -((today.getDay() + 6) % 7)); return { from: ymd(mon), to: ymd(addDays(mon, 6)) }; }
    case 'last_7':     return { from: ymd(addDays(today, -6)), to: ymd(today) };
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: ymd(first), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) };
    }
    case 'month':      return { from: ymd(new Date(year, month - 1, 1)), to: ymd(new Date(year, month, 0)) };
    case 'custom':     return { from: customFrom, to: customTo };
    case 'this_month':
    default:           return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  }
}

function parseYmd(str) { const [y, m, d] = String(str).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }

// "Thursday, 24 September 2026" / "September 2026" / "1 Sep – 7 Sep 2026"
function periodLabel(from, to) {
  if (!from || !to) return '';
  const a = parseYmd(from), b = parseYmd(to);
  if (from === to) return a.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const wholeMonth = a.getDate() === 1 && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    && addDays(b, 1).getDate() === 1;
  if (wholeMonth) return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const fa = a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const fb = b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fa} – ${fb}`;
}

const TH = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
};
const TD = { padding: '10px 14px', fontSize: 13 };

const SOURCE_COLORS = ['#2563EB', '#7C3AED', '#0D9488', '#D97706', '#DB2777', '#6B7280'];

const pct1 = n => `${(Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const num = n => (Number(n) || 0).toLocaleString('id-ID');
const plural = (n, w) => `${num(n)} ${w}${Number(n) === 1 ? '' : 's'}`;
// Big amounts stay on one line, sized to the screen.
const AMOUNT = { fontSize: 'clamp(15px, 4.2vw, 20px)', whiteSpace: 'nowrap' };
const SECTIONS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'channels', label: 'Channels' },
  { id: 'money', label: 'Money' },
];

function Section({ id, title, subtitle, children }) {
  return (
    <section id={`report-${id}`} style={{ marginBottom: 28, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h2>
        {subtitle && <span style={{ fontSize: 12, color: '#6B7280' }}>{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

// A plain table card: columns = [{ key, label, align, render }]
function TableCard({ title, note, columns, rows, footer, empty = 'Nothing in this period.' }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      {title && <div className="card-title" style={{ padding: '14px 14px 0' }}>{title}</div>}
      {note && <div style={{ fontSize: 12, color: '#6B7280', padding: '4px 14px 0' }}>{note}</div>}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#9CA3AF', padding: 14 }}>{empty}</div>
      ) : (
        <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {columns.map(c => <th key={c.key} style={{ ...TH, textAlign: c.align || 'left' }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', ...(r._style || {}) }}>
                {columns.map(c => <td key={c.key} style={{ ...TD, textAlign: c.align || 'left', ...(c.align === 'right' ? { whiteSpace: 'nowrap' } : {}), ...(r._cell || {}) }}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr style={{ borderTop: '2px solid #E5E7EB', fontWeight: 700 }}>
                {columns.map(c => <td key={c.key} style={{ ...TD, textAlign: c.align || 'left', whiteSpace: 'nowrap' }}>{footer[c.key] ?? ''}</td>)}
              </tr>
            </tfoot>
          )}
        </table></div>
      )}
    </div>
  );
}

function ShareBar({ pct, color = '#2563EB' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, color: '#6B7280', width: 44, textAlign: 'right' }}>{pct1(pct)}</span>
    </div>
  );
}

function Kpis({ items }) {
  return (
    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      {items.filter(Boolean).map(([label, value, sub], i) => (
        <div key={label} style={{ flex: '1 1 150px', padding: '14px 18px', borderLeft: i > 0 ? '1px solid #E5E7EB' : 'none' }}>
          <div className="stat-label">{label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{value}</div>
          {sub && <div className="stat-sub">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// Daily room revenue bar chart (not shown for a single day).
function DailyChart({ daily, adr, label, from, to }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const maxDaily = Math.max(1, ...daily.map(d => Number(d.room_revenue)));
  const hasDailyRevenue = daily.some(d => Number(d.room_revenue) > 0);
  const dayCount = daily.length;
  const xLabelStep = dayCount > 60 ? 14 : dayCount > 20 ? 5 : dayCount > 10 ? 3 : 1;
  const chartOneMonth = from && to && from.slice(0, 7) === to.slice(0, 7);
  const total = daily.reduce((s, d) => s + Number(d.room_revenue), 0);
  const peak = daily.reduce((max, d) => Number(d.room_revenue) > Number(max.room_revenue) ? d : max, daily[0]);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div className="card-title">Daily Room Revenue</div>
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>{label}</div>
      </div>
      {!hasDailyRevenue ? (
        <div style={{ fontSize: 13, color: '#9CA3AF', padding: '20px 0', textAlign: 'center' }}>No room revenue in this period.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
            Total <strong style={{ color: '#111' }}>{fmtIDR(total)}</strong>
            {' · '}ADR <strong style={{ color: '#111' }}>{fmtIDR(adr)}</strong>
            {' · '}Best day <strong style={{ color: '#111' }}>{fmtDay(peak.date)}</strong> ({fmtIDR(peak.room_revenue)})
          </div>
          <div style={{ display: 'flex' }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 140, paddingRight: 10, fontSize: 10, color: '#9CA3AF', textAlign: 'right' }}>
              <span>{fmtIDRShort(maxDaily)}</span><span>{fmtIDRShort(maxDaily / 2)}</span><span>0</span>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${Math.min(100, (adr / maxDaily) * 100)}%`, borderTop: '1px dashed #D1D5DB', zIndex: 1 }}>
                <span style={{ position: 'absolute', right: 0, top: -14, fontSize: 10, color: '#9CA3AF', background: 'var(--white, #fff)', padding: '0 4px' }}>ADR</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140, borderBottom: '1px solid #E5E7EB', position: 'relative', zIndex: 2 }}>
                {daily.map((d, i) => {
                  const v = Number(d.room_revenue);
                  const isWeekend = weekdayOf(d.date) === 0 || weekdayOf(d.date) === 6;
                  const isHovered = hoverIdx === i;
                  return (
                    <div key={d.date} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}
                      style={{ flex: 1, alignSelf: 'stretch', display: 'flex', alignItems: 'flex-end', cursor: 'default',
                        background: isHovered ? 'rgba(37,99,235,0.08)' : isWeekend ? 'rgba(37,99,235,0.04)' : 'transparent' }}>
                      <div style={{ width: '100%', height: `${Math.max(2, (v / maxDaily) * 100)}%`, minWidth: 3, borderRadius: '2px 2px 0 0',
                        background: v > 0 ? (isHovered ? '#1E40AF' : isWeekend ? '#1D4ED8' : '#2563EB') : (isHovered ? '#D1D5DB' : '#E5E7EB') }} />
                    </div>
                  );
                })}
              </div>
              {hoverIdx !== null && (() => {
                const d = daily[hoverIdx];
                const v = Number(d.room_revenue);
                const nightsSold = Number(d.paid_nights_sold ?? d.nights_sold) || 0;
                const leftPct = ((hoverIdx + 0.5) / daily.length) * 100;
                const barTopPx = Math.max(2, (v / maxDaily) * 100) / 100 * 140;
                const impliedRate = nightsSold > 0 ? v / nightsSold : 0;
                const vsAdr = adr > 0 && nightsSold > 0 ? ((impliedRate - adr) / adr) * 100 : 0;
                return (
                  <div style={{ position: 'absolute', left: `${Math.min(92, Math.max(8, leftPct))}%`, bottom: `${barTopPx + 14}px`, transform: 'translateX(-50%)',
                    background: '#111827', color: 'white', borderRadius: 8, padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 3 }}>
                    <div style={{ fontWeight: 700 }}>{fmtDayFull(d.date)}</div>
                    <div style={{ marginTop: 2 }}>{fmtIDR(v)}{nightsSold > 0 ? ` · ${nightsSold} room-night${nightsSold !== 1 ? 's' : ''}` : ''}</div>
                    <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
                      {nightsSold === 0 ? 'No rooms sold' : `${fmtIDR(impliedRate)}/night` + (adr <= 0 ? '' : Math.abs(vsAdr) < 1 ? ' · in line with ADR' : ` · ${vsAdr > 0 ? '+' : ''}${vsAdr.toFixed(0)}% vs. ADR`)}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                {daily.map((d, i) => {
                  const day = Number(String(d.date).slice(8, 10));
                  const showLabel = i === 0 || i === daily.length - 1 || (chartOneMonth ? day % xLabelStep === 0 : i % xLabelStep === 0);
                  return <div key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>{showLabel ? (chartOneMonth ? day : fmtDay(d.date)) : ''}</div>;
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Reports() {
  const now = new Date();
  const [preset, setPreset] = useState('this_month');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(ymd(addDays(now, -6)));
  const [customTo, setCustomTo] = useState(ymd(now));
  const { from, to } = periodFor(preset, { month, year, customFrom, customTo });
  const rangeValid = !!from && !!to && from <= to;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allNationalities, setAllNationalities] = useState(false);

  useEffect(() => {
    if (!rangeValid) return;
    setLoading(true);
    setError(null);
    api.get('/api/reports/full', { params: { from, to } })
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = periodLabel(from, to);
  const singleDay = from === to;
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);
  const jump = id => document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">{label} · Owner only · amounts are net (after discounts, before service charge &amp; tax)</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <select className="form-select" style={{ width: 160 }} value={preset} onChange={e => setPreset(e.target.value)} aria-label="Period">
            {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {preset === 'month' && (
            <>
              <select className="form-select" style={{ width: 150 }} value={month} onChange={e => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select className="form-select" style={{ width: 100 }} value={year} onChange={e => setYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          {preset === 'custom' && (
            <>
              <input className="form-input" type="date" style={{ width: 160 }} value={customFrom} max={customTo || undefined}
                onChange={e => setCustomFrom(e.target.value)} aria-label="From" />
              <input className="form-input" type="date" style={{ width: 160 }} value={customTo} min={customFrom || undefined}
                onChange={e => setCustomTo(e.target.value)} aria-label="To" />
            </>
          )}
          <button className="btn btn-secondary" disabled={!rangeValid}
            onClick={() => downloadCsv(`/api/reports/revenue/export?from=${from}&to=${to}`, `revenue-${singleDay ? from : `${from}_to_${to}`}.csv`)}>⬇ Export CSV</button>
        </div>
      </div>

      {!rangeValid && <div className="alert alert-error">Choose a start date on or before the end date.</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading…</div>
      ) : !data ? null : (() => {
        const { revenue: rev, rooms, channels, money } = data;
        const total = rev.total;
        const share = n => (total > 0 ? (Number(n) / total) * 100 : 0);
        const sub = { _cell: { paddingLeft: 30, color: '#4B5563' } };
        const group = { _style: { background: '#F9FAFB' }, _cell: { fontWeight: 700 } };
        const breakdown = [
          { item: 'Rooms', detail: plural(rooms.nights_sold, 'room-night'), amount: rev.room, ...group },
          { item: 'Food & beverage', detail: '', amount: rev.fnb.total, ...group },
          { item: 'Meals in the rate plan', detail: 'breakfast / half / full board', amount: rev.fnb.rate_plan, ...sub },
          { item: 'Breakfast in extras', detail: 'e.g. extra bed with breakfast', amount: rev.fnb.extras, ...sub },
          { item: 'Restaurant & POS', detail: 'resto app, room dining, external POS', amount: rev.fnb.outlets, ...sub },
          { item: 'Extras', detail: 'Sales items', amount: rev.extras.total, ...group },
          ...rev.extras.by_category.map(c => ({ item: c.label, detail: plural(c.qty, 'unit'), amount: c.amount, ...sub })),
          { item: 'Activities', detail: plural(rev.activities.bookings, 'booking'), amount: rev.activities.total, ...group },
          ...rev.activities.by_activity.map(a => ({ item: a.name, detail: `${plural(a.bookings, 'booking')} · ${num(a.pax)} pax`, amount: a.amount, ...sub })),
        ];
        const natRows = allNationalities ? rooms.by_nationality : rooms.by_nationality.slice(0, 10);
        const owed = money.owed_now;
        const guestOwed = owed.guests.checked_out.amount + owed.guests.in_house.amount + owed.guests.upcoming.amount;
        const st = money.service_tax;
        const hasRates = st.service_charge_rate > 0 || st.tax_rate > 0;
        const receivedTotal = money.received.total;
        return (
          <>
            <div className="flex gap-2" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              {SECTIONS.map(s => <button key={s.id} className="btn btn-sm btn-secondary" onClick={() => jump(s.id)}>{s.label}</button>)}
            </div>

            {/* ── 1. Revenue ── */}
            <Section id="revenue" title="Revenue" subtitle={label}>
              <div className="grid-4" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                {[['Rooms', rev.room, '#2563EB'], ['Food & beverage', rev.fnb.total, '#0D9488'], ['Extras', rev.extras.total, '#D97706'], ['Activities', rev.activities.total, '#7C3AED']].map(([l, v, c]) => (
                  <div key={l} className="stat-card" style={{ borderTop: `3px solid ${c}` }}>
                    <div className="stat-label">{l}</div>
                    <div className="stat-value" style={AMOUNT}>{fmtIDR(v)}</div>
                    <div className="stat-sub">{pct1(share(v))} of revenue</div>
                  </div>
                ))}
                <div className="stat-card" style={{ borderTop: '3px solid #111827', background: '#111827' }}>
                  <div className="stat-label" style={{ color: 'rgba(255,255,255,0.6)' }}>Total revenue</div>
                  <div className="stat-value" style={{ ...AMOUNT, color: 'white' }}>{fmtIDR(total)}</div>
                  <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.5)' }}>net, before service &amp; tax</div>
                </div>
              </div>
              <TableCard title="Revenue breakdown" rows={breakdown}
                columns={[
                  { key: 'item', label: 'Item' },
                  { key: 'detail', label: '', render: r => <span style={{ fontSize: 12, color: '#6B7280' }}>{r.detail}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: r => fmtIDR(r.amount) },
                  { key: 'share', label: 'Share', render: r => <ShareBar pct={share(r.amount)} /> },
                ]}
                footer={{ item: 'Total revenue', amount: fmtIDR(total) }} />
              {rev.complimentary.nights > 0 || rev.complimentary.value > 0 ? (
                <div className="alert" style={{ marginBottom: 16 }}>
                  <div>🎁 Complimentary: {plural(rev.complimentary.nights, 'night')} and extras worth <b>{fmtIDR(rev.complimentary.value)}</b> (net) were given away — not included in revenue.</div>
                </div>
              ) : null}
              {!singleDay && <DailyChart daily={data.daily} adr={rooms.adr} label={label} from={from} to={to} />}
            </Section>

            {/* ── 2. Rooms ── */}
            <Section id="rooms" title="Rooms" subtitle={`${rooms.sellable_rooms} rooms in service × ${plural(rooms.days, 'day')} = ${num(rooms.available_nights)} room-nights available`}>
              <Kpis items={[
                ['Occupancy', pct1(rooms.occupancy), `${num(rooms.nights_sold)} of ${num(rooms.available_nights)} room-nights`],
                ['ADR', fmtIDR(rooms.adr), rooms.comp_nights > 0 ? 'room revenue ÷ paid nights' : 'room revenue ÷ nights sold'],
                ['RevPAR', fmtIDR(rooms.revpar), 'room revenue ÷ room-nights available'],
                ['Guests', num(rooms.guest_nights), 'guest-nights (people × nights)'],
                ['Arrivals', num(rooms.arrivals.bookings), `${plural(rooms.arrivals.guests, 'guest')} checking in`],
                rooms.comp_nights > 0 && ['Complimentary', plural(rooms.comp_nights, 'night'), 'counted in occupancy, not in ADR'],
              ]} />
              <TableCard title="By room type" rows={rooms.by_room_type}
                note="Rooms in service = not out of order today."
                columns={[
                  { key: 'room_type', label: 'Room type', render: r => <b>{r.room_type}</b> },
                  { key: 'sellable', label: 'Rooms', align: 'right' },
                  { key: 'nights', label: 'Nights sold', align: 'right', render: r => num(r.nights) },
                  { key: 'occupancy', label: 'Occupancy', align: 'right', render: r => pct1(r.occupancy) },
                  { key: 'revenue', label: 'Room revenue', align: 'right', render: r => fmtIDR(r.revenue) },
                  { key: 'adr', label: 'ADR', align: 'right', render: r => fmtIDR(r.adr) },
                  { key: 'revpar', label: 'RevPAR', align: 'right', render: r => fmtIDR(r.revpar) },
                ]}
                footer={{ room_type: 'All rooms', sellable: rooms.sellable_rooms, nights: num(rooms.nights_sold), occupancy: pct1(rooms.occupancy),
                  revenue: fmtIDR(rev.room), adr: fmtIDR(rooms.adr), revpar: fmtIDR(rooms.revpar) }} />
              <TableCard title="By rate plan" rows={rooms.by_rate_plan}
                columns={[
                  { key: 'rate_plan', label: 'Rate plan', render: r => <b>{r.rate_plan}{r.code ? <span style={{ color: '#9CA3AF', fontWeight: 400 }}> · {r.code}</span> : ''}</b> },
                  { key: 'nights', label: 'Nights', align: 'right', render: r => num(r.nights) },
                  { key: 'guest_nights', label: 'Guest-nights', align: 'right', render: r => num(r.guest_nights) },
                  { key: 'room_revenue', label: 'Room revenue', align: 'right', render: r => fmtIDR(r.room_revenue) },
                  { key: 'meal_revenue', label: 'Meals', align: 'right', render: r => fmtIDR(r.meal_revenue) },
                  { key: 'adr', label: 'ADR', align: 'right', render: r => fmtIDR(r.adr) },
                ]} />
              <TableCard title="By nationality" rows={natRows}
                note={rooms.by_nationality.length > 10 && !allNationalities
                  ? <>Top 10 of {rooms.by_nationality.length}. <button className="btn btn-sm btn-ghost" style={{ padding: '0 4px' }} onClick={() => setAllNationalities(true)}>Show all</button></> : null}
                columns={[
                  { key: 'nationality', label: 'Nationality', render: r => <b>{r.nationality}</b> },
                  { key: 'bookings', label: 'Bookings', align: 'right' },
                  { key: 'room_nights', label: 'Room-nights', align: 'right', render: r => num(r.room_nights) },
                  { key: 'guest_nights', label: 'Guest-nights', align: 'right', render: r => num(r.guest_nights) },
                  { key: 'revenue', label: 'Room & meals', align: 'right', render: r => fmtIDR(r.revenue) },
                ]} />
            </Section>

            {/* ── 3. Channels ── */}
            <Section id="channels" title="Channels" subtitle="where the stays in this period were booked">
              <TableCard rows={channels}
                note="Revenue = room + meals in the rate plan for the nights in this period."
                columns={[
                  { key: 'source', label: 'Source', render: r => <b>{r.source}</b> },
                  { key: 'bookings', label: 'Bookings', align: 'right' },
                  { key: 'nights', label: 'Nights', align: 'right', render: r => num(r.nights) },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: r => fmtIDR(r.revenue) },
                  { key: 'adr', label: 'ADR', align: 'right', render: r => fmtIDR(r.adr) },
                  { key: 'share', label: 'Share', render: r => <ShareBar pct={r.share} color={SOURCE_COLORS[channels.indexOf(r) % SOURCE_COLORS.length]} /> },
                ]}
                footer={{ source: 'Total', bookings: channels.reduce((s, r) => s + r.bookings, 0), nights: num(channels.reduce((s, r) => s + r.nights, 0)),
                  revenue: fmtIDR(channels.reduce((s, r) => s + r.revenue, 0)) }} />
            </Section>

            {/* ── 4. Money ── */}
            <Section id="money" title="Money">
              <div className="grid-2" style={{ alignItems: 'start' }}>
                <TableCard title={`Received — ${fmtIDR(receivedTotal)}`} rows={money.received.by_method}
                  note="Payments received in this period (guests, extras & activities paid at the desk, agents)."
                  empty="No payments received in this period."
                  columns={[
                    { key: 'method', label: 'Method', render: r => <b>{r.method}</b> },
                    { key: 'amount', label: 'Amount', align: 'right', render: r => fmtIDR(r.amount) },
                    { key: 'share', label: 'Share', render: r => <ShareBar pct={receivedTotal ? (r.amount / receivedTotal) * 100 : 0} color="#16A34A" /> },
                  ]} />
                <div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-title">Service charge &amp; tax</div>
                    {!hasRates && st.included_in_activities.tax === 0 && st.included_in_activities.service_charge === 0 ? (
                      <div style={{ fontSize: 13, color: '#6B7280' }}>Your service charge and tax rates are 0% (Property Details), so none is added.</div>
                    ) : (
                      <>
                        {[['Service charge', st.service_charge, `${st.service_charge_rate}%`], ['Tax', st.tax, `${st.tax_rate}%`]].map(([l, v, r]) => (
                          <div key={l} className="flex-between" style={{ fontSize: 14, padding: '4px 0' }}><span>{l} <span className="text-muted">({r})</span></span><b>{fmtIDR(v)}</b></div>
                        ))}
                        <div className="flex-between" style={{ fontSize: 14, padding: '6px 0', borderTop: '1px solid #E5E7EB', marginTop: 4 }}><span>Total</span><b>{fmtIDR(st.service_charge + st.tax)}</b></div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>
                          On {fmtIDR(st.taxable_revenue)} of revenue, at today's rates
                          {(st.included_in_activities.tax > 0 || st.included_in_activities.service_charge > 0) && `, plus ${fmtIDR(st.included_in_activities.service_charge + st.included_in_activities.tax)} inside tax-included activities`}.
                          An estimate for setting money aside — check the filing with your accountant.
                        </div>
                      </>
                    )}
                  </div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-title">Discounts given</div>
                    <div className="flex-between" style={{ fontSize: 14 }}>
                      <span>{plural(money.discounts.bookings, 'booking')}</span><b>{fmtIDR(money.discounts.amount)}</b>
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>Discounts on room prices for the nights in this period, as entered (incl. tax). Revenue above is already after them.</div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Still owed — as of today</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>Not tied to the period above: what's unpaid right now.</div>
                <div className="grid-3" style={{ marginBottom: 14 }}>
                  {[['Guests who left', owed.guests.checked_out, '#DC2626'], ['Guests in house', owed.guests.in_house, '#D97706'], ['Upcoming stays', owed.guests.upcoming, '#6B7280']].map(([l, g, c]) => (
                    <div key={l}>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: g.amount > 0 ? c : '#111' }}>{fmtIDR(g.amount)}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>{plural(g.bookings, 'booking')} · deposits &amp; balances not received</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>
                  Guests: {fmtIDR(guestOwed)} in room deposit / balance lines (extras charged to a room are on each Balance Due). Agents: {fmtIDR(owed.agents.total)}{owed.agents.overdue > 0 && `, ${fmtIDR(owed.agents.overdue)} overdue`}.
                </div>
                {owed.agents.rows.length > 0 && (
                  <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                      {['Agent', 'Open bookings', 'Owed', 'Not due yet', 'Overdue', 'Over 60 days'].map((h, i) => <th key={h} style={{ ...TH, textAlign: i ? 'right' : 'left' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {owed.agents.rows.map(a => (
                        <tr key={a.agent} style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td style={{ ...TD, fontWeight: 600 }}>{a.agent}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{a.open_bookings}</td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmtIDR(a.outstanding)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{fmtIDR(a.current)}</td>
                          <td style={{ ...TD, textAlign: 'right', color: a.overdue > 0 ? '#DC2626' : undefined }}>{fmtIDR(a.overdue)}</td>
                          <td style={{ ...TD, textAlign: 'right', color: a.over_60 > 0 ? '#DC2626' : undefined }}>{fmtIDR(a.over_60)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>

              <div className="card">
                <div className="card-title" style={{ marginBottom: 12 }}>Net income</div>
                <div className="grid-3">
                  <div><div style={{ fontSize: 12, color: '#6B7280' }}>Total revenue</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmtIDR(total)}</div></div>
                  <div><div style={{ fontSize: 12, color: '#6B7280' }}>Expenses</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: data.expenses_total > 0 ? '#DC2626' : '#111' }}>{data.expenses_total > 0 ? `− ${fmtIDR(data.expenses_total)}` : fmtIDR(0)}</div></div>
                  <div><div style={{ fontSize: 12, color: '#6B7280' }}>Net income</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: data.net_income >= 0 ? '#16A34A' : '#DC2626' }}>{fmtIDR(data.net_income)}</div></div>
                </div>
                {data.expenses_total === 0 && (
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 10 }}>No expenses logged in this period — record costs under Back Office → Expenses to see a real profit figure.</div>
                )}
              </div>
            </Section>
          </>
        );
      })()}
    </div>
  );
}
