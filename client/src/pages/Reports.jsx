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
  const [hoverIdx, setHoverIdx] = useState(null);

  useEffect(() => {
    if (!rangeValid) return;
    setLoading(true);
    setError(null);
    setHoverIdx(null);
    api.get('/api/reports/revenue', { params: { from, to } })
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = periodLabel(from, to);
  const singleDay = from === to;

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);
  const maxDaily = data ? Math.max(1, ...data.daily_revenue.map(d => Number(d.room_revenue))) : 1;
  const bySource = data ? [...data.by_source].sort((a, b) => Number(b.revenue) - Number(a.revenue)) : [];
  const sourceTotal = bySource.reduce((s, r) => s + Number(r.revenue), 0);
  // Complimentary nights (migration 072) count as occupied but not in ADR.
  const paidNights = data ? (data.paid_nights ?? data.total_nights) : 0;
  const adr = data && paidNights > 0 ? data.room_revenue / paidNights : 0;
  const hasDailyRevenue = data && data.daily_revenue.some(d => Number(d.room_revenue) > 0);
  const dayCount = data ? data.daily_revenue.length : 0;
  const xLabelStep = dayCount > 60 ? 14 : dayCount > 20 ? 5 : dayCount > 10 ? 3 : 1;
  // Day numbers when the chart stays inside one month, "3 Sep" otherwise.
  const chartOneMonth = from && to && from.slice(0, 7) === to.slice(0, 7);
  const dailyStats = data && hasDailyRevenue ? (() => {
    const days = data.daily_revenue;
    const total = days.reduce((s, d) => s + Number(d.room_revenue), 0);
    const peak = days.reduce((max, d) => Number(d.room_revenue) > Number(max.room_revenue) ? d : max, days[0]);
    return { total, peak };
  })() : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">{label} · Owner only</div>
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
      ) : !data ? null : (
        <>
          {/* ── Revenue composition ── */}
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card" style={{ borderTop: '3px solid #2563EB' }}>
              <div className="stat-label">Room Revenue</div>
              <div className="stat-value" style={{ fontSize: 21 }}>{fmtIDR(data.room_revenue)}</div>
              <div className="stat-sub">Net, post-discount</div>
            </div>
            <div className="stat-card" style={{ borderTop: '3px solid #0D9488' }}>
              <div className="stat-label">F&amp;B Revenue</div>
              <div className="stat-value" style={{ fontSize: 21 }}>{fmtIDR(data.fnb_revenue)}</div>
              <div className="stat-sub">From room arrangements</div>
            </div>
            <div className="stat-card" style={{ borderTop: '3px solid #D97706' }}>
              <div className="stat-label">Ancillary Revenue</div>
              <div className="stat-value" style={{ fontSize: 21 }}>{fmtIDR(data.ancillary_revenue)}</div>
              <div className="stat-sub">Sales / POS, excl. rejected</div>
            </div>
            <div className="stat-card" style={{ borderTop: '3px solid #111827', background: '#111827' }}>
              <div className="stat-label" style={{ color: 'rgba(255,255,255,0.6)' }}>Total Revenue</div>
              <div className="stat-value" style={{ fontSize: 21, color: 'white' }}>{fmtIDR(data.total_revenue)}</div>
              <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.5)' }}>All sources combined</div>
            </div>
          </div>

          {/* ── Operational metrics, compact strip ── */}
          <div className="card" style={{ display: 'flex', padding: 0, marginBottom: 20, overflow: 'hidden' }}>
            {[
              ['Bookings', data.bookings_count, 'checked-in / confirmed'],
              ['Room Nights', data.total_nights, singleDay ? 'occupied that night' : 'sold in this period'],
              ['ADR', fmtIDR(adr), data.comp_nights > 0 ? 'room revenue ÷ paid nights' : 'room revenue ÷ nights'],
              (data.comp_nights > 0 || data.comp_value > 0) &&
                ['🎁 Complimentary', `${data.comp_nights} night${data.comp_nights === 1 ? '' : 's'}`, `value ${fmtIDR(data.comp_value)} before tax`],
            ].filter(Boolean).map(([label, value, sub], i) => (
              <div
                key={label}
                style={{ flex: 1, padding: '16px 20px', borderLeft: i > 0 ? '1px solid #E5E7EB' : 'none' }}
              >
                <div className="stat-label">{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{value}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Daily room revenue (not useful for a single day) ── */}
          {!singleDay && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div className="card-title">Daily Room Revenue</div>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>{label}</div>
            </div>
            {!hasDailyRevenue ? (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: '20px 0', textAlign: 'center' }}>
                No room revenue in this period.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
                  Total <strong style={{ color: '#111' }}>{fmtIDR(dailyStats.total)}</strong>
                  {' · '}ADR <strong style={{ color: '#111' }}>{fmtIDR(adr)}</strong>
                  {' · '}Best day <strong style={{ color: '#111' }}>{fmtDay(dailyStats.peak.date)}</strong> ({fmtIDR(dailyStats.peak.room_revenue)})
                </div>

                <div style={{ display: 'flex' }}>
                  {/* y-axis scale */}
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 140, paddingRight: 10, fontSize: 10, color: '#9CA3AF', textAlign: 'right' }}>
                    <span>{fmtIDRShort(maxDaily)}</span>
                    <span>{fmtIDRShort(maxDaily / 2)}</span>
                    <span>0</span>
                  </div>

                  <div style={{ flex: 1, position: 'relative' }}>
                    {/* ADR reference line — what one room-night at the property's average
                        rate is worth, so a bar's height above it reads as "more than one
                        room-night sold (or sold above rate)" at a glance */}
                    <div
                      style={{
                        position: 'absolute', left: 0, right: 0,
                        bottom: `${Math.min(100, (adr / maxDaily) * 100)}%`,
                        borderTop: '1px dashed #D1D5DB', zIndex: 1,
                      }}
                    >
                      <span style={{ position: 'absolute', right: 0, top: -14, fontSize: 10, color: '#9CA3AF', background: 'var(--white, #fff)', padding: '0 4px' }}>ADR</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140, borderBottom: '1px solid #E5E7EB', position: 'relative', zIndex: 2 }}>
                      {data.daily_revenue.map((d, i) => {
                        const v = Number(d.room_revenue);
                        const isWeekend = weekdayOf(d.date) === 0 || weekdayOf(d.date) === 6;
                        const isHovered = hoverIdx === i;
                        return (
                          <div
                            key={d.date}
                            onMouseEnter={() => setHoverIdx(i)}
                            onMouseLeave={() => setHoverIdx(null)}
                            style={{
                              flex: 1,
                              alignSelf: 'stretch',
                              display: 'flex',
                              alignItems: 'flex-end',
                              cursor: 'default',
                              background: isHovered ? 'rgba(37,99,235,0.08)' : isWeekend ? 'rgba(37,99,235,0.04)' : 'transparent',
                            }}
                          >
                            <div style={{
                              width: '100%',
                              height: `${Math.max(2, (v / maxDaily) * 100)}%`,
                              background: v > 0 ? (isHovered ? '#1E40AF' : isWeekend ? '#1D4ED8' : '#2563EB') : (isHovered ? '#D1D5DB' : '#E5E7EB'),
                              borderRadius: '2px 2px 0 0',
                              minWidth: 3,
                            }} />
                          </div>
                        );
                      })}
                    </div>

                    {/* hover tooltip */}
                    {hoverIdx !== null && (() => {
                      const d = data.daily_revenue[hoverIdx];
                      const v = Number(d.room_revenue);
                      const nightsSold = Number(d.paid_nights_sold ?? d.nights_sold) || 0;
                      const count = data.daily_revenue.length;
                      const leftPct = ((hoverIdx + 0.5) / count) * 100;
                      const barTopPx = Math.max(2, (v / maxDaily) * 100) / 100 * 140;
                      // Compare this day's own implied rate (its revenue ÷ its own
                      // room-nights sold) against ADR — not the day's raw total
                      // against ADR, which would be misleading on any day with more
                      // than one room occupied (ADR is a per-room-night rate).
                      const impliedRate = nightsSold > 0 ? v / nightsSold : 0;
                      const vsAdr = adr > 0 && nightsSold > 0 ? ((impliedRate - adr) / adr) * 100 : 0;
                      return (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${Math.min(92, Math.max(8, leftPct))}%`,
                            bottom: `${barTopPx + 14}px`,
                            transform: 'translateX(-50%)',
                            background: '#111827',
                            color: 'white',
                            borderRadius: 8,
                            padding: '8px 12px',
                            fontSize: 12,
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                            zIndex: 3,
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{fmtDayFull(d.date)}</div>
                          <div style={{ marginTop: 2 }}>
                            {fmtIDR(v)}{nightsSold > 0 ? ` · ${nightsSold} room-night${nightsSold !== 1 ? 's' : ''}` : ''}
                          </div>
                          <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
                            {nightsSold === 0 ? 'No rooms sold'
                              : `${fmtIDR(impliedRate)}/night` + (
                                adr <= 0 ? ''
                                : Math.abs(vsAdr) < 1 ? ' · in line with ADR'
                                : ` · ${vsAdr > 0 ? '+' : ''}${vsAdr.toFixed(0)}% vs. ADR`
                              )}
                            {dailyStats.peak.date === d.date && v > 0 ? ' · Best day' : ''}
                          </div>
                        </div>
                      );
                    })()}

                    {/* x-axis day labels */}
                    <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                      {data.daily_revenue.map((d, i) => {
                        const day = Number(String(d.date).slice(8, 10));
                        const showLabel = i === 0 || i === data.daily_revenue.length - 1
                          || (chartOneMonth ? day % xLabelStep === 0 : i % xLabelStep === 0);
                        return (
                          <div key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap', overflow: 'visible' }}>
                            {showLabel ? (chartOneMonth ? day : fmtDay(d.date)) : ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#9CA3AF', marginTop: 12 }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#2563EB', marginRight: 5 }} />Weekday</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#1D4ED8', marginRight: 5 }} />Weekend</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#E5E7EB', marginRight: 5 }} />No revenue</span>
                </div>
              </>
            )}
          </div>
          )}

          {/* ── Revenue by source ── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-title" style={{ padding: '14px 14px 0' }}>Revenue by Source</div>
            {bySource.length === 0 ? (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: 14 }}>No room nights in this period.</div>
            ) : (
              <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <th style={TH}>Source</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Bookings</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...TH, width: 160 }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map((r, i) => {
                    const pct = sourceTotal > 0 ? (Number(r.revenue) / sourceTotal) * 100 : 0;
                    return (
                      <tr key={r.source || i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{r.source || 'Unspecified'}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{r.count}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fmtIDR(r.revenue)}</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: SOURCE_COLORS[i % SOURCE_COLORS.length], borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, color: '#6B7280', width: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #E5E7EB', fontWeight: 700 }}>
                    <td style={TD}>Total</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{bySource.reduce((s, r) => s + Number(r.count), 0)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmtIDR(sourceTotal)}</td>
                    <td style={TD}></td>
                  </tr>
                </tfoot>
              </table></div>
            )}
          </div>

          {/* ── Net income — lightweight P&L, not a full accounting system.
              Expenses come from Back Office's Expenses log (if the property
              uses it); degrades quietly to "= Total Revenue" for properties
              that don't. ── */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>Net Income</div>
            <div className="grid-3">
              <div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Total Revenue</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtIDR(data.total_revenue)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Expenses</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: data.expenses_total > 0 ? '#DC2626' : '#111' }}>
                  {data.expenses_total > 0 ? `− ${fmtIDR(data.expenses_total)}` : fmtIDR(0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Net Income</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: data.net_income >= 0 ? '#16A34A' : '#DC2626' }}>
                  {fmtIDR(data.net_income)}
                </div>
              </div>
            </div>
            {data.expenses_total === 0 && (
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 10 }}>
                No expenses logged in this period — Net Income currently just mirrors Total Revenue. Record costs under Back Office → Expenses to see a real profit figure here.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
