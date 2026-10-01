import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// The audit report for one business date — same content as its PDF
// (server/services/nightAuditPdf.js), from GET /api/night-audit/:date/detail.
// Opened from the Night Audit page's history list.

const idr = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const n0 = n => Math.round(Number(n || 0)).toLocaleString('id-ID');

function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Section({ title, right, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
        {right && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{children}</div>;
}

function Tile({ label, value, sub }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

const TD = { padding: '7px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const TH = { ...TD, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };

export default function NightAuditDetailModal({ date, onClose }) {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get(`/api/night-audit/${date}/detail`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Could not load the audit'));
  }, [date]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const r = await api.get(`/api/night-audit/${date}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `night-audit-${date}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { alert('Could not download the PDF'); }
    setDownloading(false);
  }

  const d = data?.detail;
  const s = d?.summary;
  const found = d ? [
    ...d.actions.no_shows.map(x => ({ what: 'No-show', badge: 'badge-red', room: x.unit_name, id: x.booking_id,
      text: `${x.guest_name} — marked no-show (never checked in on the arrival day)` })),
    ...(d.actions.overdue || []).map(x => ({ what: 'Past check-out', badge: 'badge-red', room: x.unit_name, id: x.booking_id,
      text: `${x.guest_name} — still checked in, was due out ${fmtDate(x.check_out_date)}` })),
    ...d.not_posted.map(x => ({ what: 'Not posted', badge: 'badge-amber', room: x.unit_name, id: x.booking_id,
      text: `${x.guest_name} — ${x.reason}` })),
    ...d.never_arrived.map(x => ({ what: 'Never arrived', badge: 'badge-amber', room: x.unit_name, id: x.booking_id,
      text: `${x.guest_name} — booked ${fmtDate(x.check_in_date)} – ${fmtDate(x.check_out_date)}, not checked in. Counts as sold until marked no-show or cancelled.` })),
  ] : [];

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 820, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Night Audit — {fmtDate(date)}</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {error && <div className="alert alert-error">{error}</div>}
          {!d && !error && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
          {d && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Run {fmtDateTime(data.run.run_at)} · {String(data.run.triggered_by).startsWith('manual') ? 'by hand' : 'automatic'} · amounts are net (before service &amp; tax)
                </div>
                <button className="btn btn-secondary btn-sm" onClick={downloadPdf} disabled={downloading}>
                  {downloading ? 'Preparing…' : '⬇ PDF'}
                </button>
              </div>
              {!d.snapshot && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  <div>This audit ran before details were saved, so this report is rebuilt from the data as it is now — later changes (price edits, cancellations) are included.</div>
                </div>
              )}

              <Section title="The day">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  <Tile label="Rooms sold" value={`${s.rooms_sold} / ${s.sellable}`} sub={`${s.occupancy}% occupancy`} />
                  <Tile label="ADR" value={idr(s.adr)} sub={s.comp_nights ? `excl. ${s.comp_nights} free night(s)` : 'paid nights'} />
                  <Tile label="RevPAR" value={idr(s.revpar)} />
                  <Tile label="Total revenue" value={idr(s.total)} sub="net" />
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                  <tbody>
                    {[['Rooms', s.room], ['F&B', s.fnb], ['Extras', s.extras], ['Activities', s.activities]].map(([l, v]) => (
                      <tr key={l}><td style={TD}>{l}</td><td style={{ ...TD, ...R }}>{idr(v)}</td></tr>
                    ))}
                    <tr><td style={{ ...TD, fontWeight: 700 }}>Total</td><td style={{ ...TD, ...R, fontWeight: 700 }}>{idr(s.total)}</td></tr>
                  </tbody>
                </table>
                {s.comp_nights > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    🎁 Complimentary: {s.comp_nights} night(s) · value {idr(s.comp_value)} (not in revenue)
                  </div>
                )}
              </Section>

              <Section title="Charges posted for the night" right={`${d.posted.rooms} room(s)`}>
                {!d.posted.rows.length ? <Empty>No room charges were posted for this night.</Empty> : (
                  <div className="table-wrap">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={TH}>Room</th><th style={TH}>Guest</th><th style={TH}>Plan</th>
                        <th style={{ ...TH, ...R }}>Room</th><th style={{ ...TH, ...R }}>Meals</th>
                        <th style={{ ...TH, ...R }}>Extras</th><th style={{ ...TH, ...R }}>Total</th>
                      </tr></thead>
                      <tbody>
                        {d.posted.rows.map(r => (
                          <tr key={r.booking_id}>
                            <td style={{ ...TD, fontWeight: 700 }}>{r.unit_name}</td>
                            <td style={TD}>
                              <Link to={`/reservations/${r.booking_id}`} onClick={onClose}>{r.guest_name}</Link>
                              {r.extras.length > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.extras.map(e => `${e.quantity}× ${e.description}`).join(', ')}</div>
                              )}
                              {r.complimentary && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🎁 Complimentary</div>}
                            </td>
                            <td style={TD}>{r.rate_plan}</td>
                            <td style={{ ...TD, ...R }}>{n0(r.room)}</td>
                            <td style={{ ...TD, ...R }}>{n0(r.meals)}</td>
                            <td style={{ ...TD, ...R }}>{n0(r.extras_total)}</td>
                            <td style={{ ...TD, ...R, fontWeight: 700 }}>{n0(r.total)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 700 }}>
                          <td style={TD} /><td style={TD}>Total</td><td style={TD} />
                          <td style={{ ...TD, ...R }}>{n0(d.posted.totals.room)}</td>
                          <td style={{ ...TD, ...R }}>{n0(d.posted.totals.meals)}</td>
                          <td style={{ ...TD, ...R }}>{n0(d.posted.totals.extras)}</td>
                          <td style={{ ...TD, ...R }}>{n0(d.posted.totals.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {s.rooms_sold !== d.posted.rooms && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {s.rooms_sold} room(s) sold, {d.posted.rooms} posted. Revenue above counts every room sold (the Reports rule), including
                    stays never checked in or free; posted = charged to the guest's folio. Extras in revenue count on the day they were sold.
                  </div>
                )}
              </Section>

              <Section title="Found by the audit">
                {!found.length ? <Empty>Nothing to follow up.</Empty> : found.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span className={`badge ${f.badge}`} style={{ whiteSpace: 'nowrap' }}>{f.what}</span>
                    <b style={{ minWidth: 40 }}>{f.room}</b>
                    <span style={{ flex: 1 }}>{f.text}</span>
                    {f.id && <Link to={`/reservations/${f.id}`} onClick={onClose} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>Open →</Link>}
                  </div>
                ))}
                {(d.actions.tasks_created != null || d.actions.folio_failed > 0) && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {d.actions.tasks_created != null && `${d.actions.tasks_created} housekeeping task(s) created for the next day's check-outs`}
                    {d.actions.folio_failed > 0 && ` · ⚠ ${d.actions.folio_failed} room(s) failed to post`}
                  </div>
                )}
              </Section>

              <Section title="Money received that day" right={idr(d.collected.total)}>
                {can('cashier_closing') && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}><Link to={`/cashier-closing?date=${date}&user=all`}>Every payment, by user — Cashier closing →</Link></div>
                )}
                {!d.collected.by_method.length ? <Empty>No payments received.</Empty> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {d.collected.by_method.map(m => (
                        <tr key={m.method}><td style={TD}>{m.method}</td><td style={{ ...TD, ...R }}>{idr(m.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title="Reservations that day">
                <div style={{ fontSize: 13 }}>
                  Made: <b>{d.bookings.made?.bookings ?? 0}</b> booking(s) · {d.bookings.made?.nights ?? 0} night(s) · {idr(d.bookings.made?.value)}
                  <span style={{ color: 'var(--text-muted)' }}> · </span>
                  Cancelled: <b>{d.bookings.cancelled}</b> · {idr(d.bookings.cancelled_value)}
                </div>
              </Section>

              <Section title={`Next day — ${fmtDate(d.next_day.date)}`}
                right={`${d.next_day.arrivals?.rooms ?? 0} arriving · ${d.next_day.departures?.rooms ?? 0} departing`}>
                {!d.next_day.to_collect.rows.length ? <Empty>Nothing to collect from guests leaving.</Empty> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={TH}>Room</th><th style={TH}>Guest leaving</th><th style={{ ...TH, ...R }}>To collect</th></tr></thead>
                    <tbody>
                      {d.next_day.to_collect.rows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ ...TD, fontWeight: 700 }}>{r.unit_name}</td>
                          <td style={TD}>{r.guest_name}</td>
                          <td style={{ ...TD, ...R, color: '#B91C1C', fontWeight: 700 }}>{idr(r.balance_due)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={TD} /><td style={{ ...TD, fontWeight: 700 }}>Total</td>
                        <td style={{ ...TD, ...R, fontWeight: 700 }}>{idr(d.next_day.to_collect.amount)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
