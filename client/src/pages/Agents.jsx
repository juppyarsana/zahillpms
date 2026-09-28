import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import AgentFormModal from '../components/AgentFormModal';
import { AGENT_TYPE_LABEL, PAYMENT_MODE_SHORT, PAYMENT_MODE_LABEL, HAS_COMMISSION, commissionText } from '../lib/agents';

function fmtIDR(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}
function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const BUCKETS = [
  ['current', 'Current'],
  ['d1_30', '1–30'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90_plus', '90+'],
];

const TH = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
};
const TD = { padding: '10px 14px', fontSize: 13 };

export default function Agents() {
  const { agentId } = useParams();
  return agentId ? <AgentDetail agentId={agentId} /> : <AgentList />;
}

// ─────────────────────────────────────────── agents list + what they owe ──
// Every agent / company (migration 084), with its billing terms and what it
// owes (city-ledger AR aging). Rows open the agent's statement.

function AgentList() {
  const nav = useNavigate();
  const [agents, setAgents] = useState([]);
  const [aging, setAging] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);   // agent row | 'new'

  function load() {
    return Promise.all([api.get('/api/agent-directory'), api.get('/api/agents')])
      .then(([d, a]) => { setAgents(d.data); setAging(a.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const owed = Object.fromEntries(aging.filter(r => r.agent_id).map(r => [r.agent_id, r]));
  const noAgent = aging.find(r => !r.agent_id && r.total_outstanding > 0);
  const overdue = r => r ? Number(r.total_outstanding || 0) - Number(r.current || 0) : 0;
  const totals = aging.reduce((t, r) => ({
    owed: t.owed + Number(r.total_outstanding || 0),
    overdue: t.overdue + overdue(r),
    commission: t.commission + Number(r.unpaid_commission || 0),
  }), { owed: 0, overdue: 0, commission: 0 });

  const needle = q.trim().toLowerCase();
  const rows = agents.filter(a =>
    (showInactive || a.is_active || Number(owed[a.id]?.total_outstanding) > 0 || Number(owed[a.id]?.unpaid_commission) > 0)
    && (!needle || [a.name, a.contact_name, a.contact_phone].some(v => v && v.toLowerCase().includes(needle))));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Agent Billing</div>
          <div className="page-subtitle">Travel agents, companies and wholesalers — billing terms and what they owe · Owner only</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New agent</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label">Owed by agents</div><div className="stat-value">{fmtIDR(totals.owed)}</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{ color: totals.overdue > 0 ? '#DC2626' : undefined }}>{fmtIDR(totals.overdue)}</div></div>
        <div className="stat-card"><div className="stat-label">Commission to pay</div><div className="stat-value" style={{ color: totals.commission > 0 ? '#D97706' : undefined }}>{fmtIDR(totals.commission)}</div></div>
      </div>

      <div className="flex gap-2 items-center" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="form-input" style={{ maxWidth: 280 }} placeholder="Search name or contact…" value={q} onChange={e => setQ(e.target.value)} />
        <label className="flex gap-2 items-center" style={{ fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading…</div>
      ) : rows.length === 0 && !noAgent ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
          {agents.length === 0 ? 'No agents yet. Add one here, or from a booking (New Booking → Agent).' : 'No agent matches.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <th style={TH}>Agent</th>
                <th style={TH}>How they pay</th>
                <th style={{ ...TH, textAlign: 'right' }}>Bookings</th>
                <th style={{ ...TH, textAlign: 'right' }}>Owed</th>
                <th style={{ ...TH, textAlign: 'right' }}>Overdue</th>
                <th style={{ ...TH, textAlign: 'right' }}>Commission to pay</th>
                <th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const r = owed[a.id];
                return (
                  <tr key={a.id} onClick={() => nav(`/agents/${a.id}`)} style={{ borderBottom: '1px solid #E5E7EB', cursor: 'pointer', opacity: a.is_active ? 1 : 0.6 }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }} onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                    <td style={TD}>
                      <div style={{ fontWeight: 600 }}>{a.name}{!a.is_active && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Inactive</span>}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>{[AGENT_TYPE_LABEL[a.agent_type], a.contact_name, a.contact_phone].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={TD}>
                      {PAYMENT_MODE_SHORT[a.payment_status] || 'Guest pays'}
                      {HAS_COMMISSION.includes(a.payment_status) && commissionText(a.commission_type, a.commission_value) && (
                        <span style={{ color: '#6B7280' }}> · {commissionText(a.commission_type, a.commission_value)}</span>
                      )}
                      {a.publish_rate && a.publish_rate !== 'auto' && (
                        <div style={{ fontSize: 11, color: '#6B7280' }}>Rate {a.publish_rate === 'show' ? 'always shown' : 'always hidden'} on guest documents</div>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', color: '#6B7280' }}>{a.booking_count || '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{Number(r?.total_outstanding) > 0 ? fmtIDR(r.total_outstanding) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', color: overdue(r) > 0 ? '#DC2626' : '#9CA3AF' }}>{overdue(r) > 0 ? fmtIDR(overdue(r)) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', color: Number(r?.unpaid_commission) > 0 ? '#D97706' : '#9CA3AF' }}>{Number(r?.unpaid_commission) > 0 ? fmtIDR(r.unpaid_commission) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setEditing(a); }}>Edit</button>
                    </td>
                  </tr>
                );
              })}
              {noAgent && (
                <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={TD} colSpan={3}><span style={{ fontWeight: 600 }}>No agent</span> <span style={{ fontSize: 11, color: '#9CA3AF' }}>· billed stays without an agent — set one on the booking</span></td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmtIDR(noAgent.total_outstanding)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{overdue(noAgent) > 0 ? fmtIDR(overdue(noAgent)) : '—'}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table></div>
        </div>
      )}

      {editing && (
        <AgentFormModal agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={a => { setEditing(null); if (editing === 'new') nav(`/agents/${a.id}`); else load(); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────── per-agent statement ──

function AgentDetail({ agentId }) {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  function load() {
    return api.get(`/api/agents/${agentId}`)
      .then(r => setData(r.data))
      .catch(err => showToast(err.response?.data?.error || 'Failed to load', 'error'))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [agentId]);

  async function downloadInvoicePdf(invoiceId, number) {
    try {
      const r = await api.get(`/api/agents/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${number}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { showToast('Failed to download invoice', 'error'); }
  }

  async function voidPayment(id) {
    if (!confirm('Void this payment? Allocations are removed and affected bookings revert.')) return;
    try {
      await api.delete(`/api/agents/payments/${id}`);
      showToast('Payment voided');
      load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed', 'error'); }
  }

  async function setCommission(id, status) {
    try {
      await api.patch(`/api/agents/commissions/${id}`, { status });
      load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed', 'error'); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;
  if (!data) return <div className="alert alert-error">Agent not found</div>;

  const { agent, aging, open_items, payments, invoices, commissions } = data;

  return (
    <div>
      {toast && (
        <div className={`alert ${toast.type === 'error' ? 'alert-error' : toast.type === 'warning' ? 'alert-warning' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          {toast.msg}
        </div>
      )}

      <div className="page-header">
        <div>
          <div className="page-title">
            <span style={{ cursor: 'pointer', color: '#6B7280' }} onClick={() => nav('/agents')}>Agent Billing</span>
            {' / '}{agent.label}
            {!agent.is_active && <span className="badge badge-gray" style={{ marginLeft: 8, fontSize: 11 }}>Inactive</span>}
          </div>
          <div className="page-subtitle">
            {[AGENT_TYPE_LABEL[agent.agent_type], agent.contact_name, agent.contact_phone, agent.contact_email, agent.tax_id && `NPWP ${agent.tax_id}`].filter(Boolean).join(' · ') || '—'}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {PAYMENT_MODE_LABEL[agent.payment_status] || 'Guest pays the hotel'}
            {HAS_COMMISSION.includes(agent.payment_status) && commissionText(agent.commission_type, agent.commission_value) ? ` · default commission ${commissionText(agent.commission_type, agent.commission_value)}` : ''}
            {agent.credit_terms_days != null ? ` · ${agent.credit_terms_days} days to pay` : ''}
            {agent.credit_limit != null ? ` · limit ${fmtIDR(agent.credit_limit)}` : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>Edit</button>
          <button className="btn btn-secondary" onClick={() => setInvOpen(true)} disabled={!open_items.some(i => i.folio_status === 'pending_agent_invoice')}>
            Generate Invoice
          </button>
          <button className="btn btn-primary" onClick={() => setPayOpen(true)} disabled={aging.total_outstanding <= 0}>
            Record Payment
          </button>
        </div>
      </div>

      {/* aging cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
        {BUCKETS.map(([k, l]) => (
          <div key={k} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: k === 'd90_plus' && aging[k] > 0 ? '#DC2626' : '#111' }}>{fmtIDR(aging[k])}</div>
          </div>
        ))}
        <div className="card" style={{ padding: 14, background: '#F9FAFB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Outstanding</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{fmtIDR(aging.total_outstanding)}</div>
        </div>
      </div>

      <Section title={`Open Items (${open_items.length})`}>
        {open_items.length === 0 ? <Empty>Nothing outstanding.</Empty> : (
          <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {['Booking', 'Dates', 'Status', 'Folio', 'Allocated', 'Balance', 'Due'].map(h => <th key={h} style={{ ...TH, textAlign: h === 'Booking' || h === 'Dates' || h === 'Status' ? 'left' : 'right' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {open_items.map(it => (
                <tr key={it.booking_id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={TD}>
                    <a href={`/reservations/${it.booking_id}`} onClick={e => { e.preventDefault(); nav(`/reservations/${it.booking_id}`); }} style={{ fontWeight: 600 }}>
                      {it.guest_name}
                    </a>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>{it.unit_name}{it.invoice_number ? ` · ${it.invoice_number}` : ''}</div>
                  </td>
                  <td style={TD}>{fmtDate(it.check_in_date)} → {fmtDate(it.check_out_date)}</td>
                  <td style={TD}><span className={`badge ${it.folio_status === 'invoiced' ? 'badge-blue' : 'badge-amber'}`}>{it.folio_status === 'invoiced' ? 'Invoiced' : 'Un-invoiced'}</span></td>
                  <td style={{ ...TD, textAlign: 'right' }}>{fmtIDR(it.folio_total)}</td>
                  <td style={{ ...TD, textAlign: 'right', color: '#6B7280' }}>{it.allocated > 0 ? fmtIDR(it.allocated) : '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmtIDR(it.balance)}</td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', color: it.age_days > 60 ? '#DC2626' : it.age_days > 0 ? '#D97706' : '#6B7280' }}>
                    {fmtDate(it.due_date)}
                    <div style={{ fontSize: 11 }}>{it.age_days > 0 ? `${it.age_days} day${it.age_days === 1 ? '' : 's'} overdue` : it.age_days === 0 ? 'due today' : `in ${-it.age_days} day${it.age_days === -1 ? '' : 's'}`}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Section>

      <Section title={`Payments (${payments.length})`}>
        {payments.length === 0 ? <Empty>No payments recorded.</Empty> : payments.map(p => (
          <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <strong>{fmtIDR(p.amount)}</strong>
                <span style={{ color: '#6B7280', fontSize: 13 }}> · {fmtDate(p.received_on)}{p.method ? ` · ${p.method.replace('_', ' ')}` : ''}{p.reference ? ` · ${p.reference}` : ''}</span>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => voidPayment(p.id)}>Void</button>
            </div>
            {(p.allocations || []).length > 0 && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {p.allocations.map((a, i) => (
                  <span key={i}>{i > 0 && ' · '}{a.guest_name}: {fmtIDR(a.amount)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title={`Invoices (${invoices.length})`}>
        {invoices.length === 0 ? <Empty>No invoices generated.</Empty> : invoices.map(inv => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
            <div>
              <strong>{inv.invoice_number}</strong>
              <span style={{ color: '#6B7280', fontSize: 13 }}> · {fmtDate(inv.issued_on)} · {inv.booking_count} booking(s) · {fmtIDR(inv.total)}</span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => downloadInvoicePdf(inv.id, inv.invoice_number)}>⬇ PDF</button>
          </div>
        ))}
      </Section>

      <Section title={`Commissions (${commissions.length})`}>
        {commissions.length === 0 ? <Empty>No commissions.</Empty> : commissions.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
            <div>
              <strong>{fmtIDR(c.amount)}</strong>
              <span style={{ color: '#6B7280', fontSize: 13 }}> · {c.guest_name} · {fmtDate(c.check_out_date)}</span>
            </div>
            <label style={{ fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={c.status === 'paid'} onChange={e => setCommission(c.id, e.target.checked ? 'paid' : 'unpaid')} />
              {' '}paid
            </label>
          </div>
        ))}
      </Section>

      {editOpen && <AgentFormModal agent={agent} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); showToast('Saved'); load(); }} />}
      {payOpen && <RecordPaymentModal agentId={agentId} openItems={open_items} outstanding={aging.total_outstanding} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); showToast('Payment recorded'); load(); }} onError={m => showToast(m, 'error')} />}
      {invOpen && <GenerateInvoiceModal agentId={agentId} openItems={open_items.filter(i => i.folio_status === 'pending_agent_invoice')} onClose={() => setInvOpen(false)} onDone={(inv) => { setInvOpen(false); showToast(`Invoice ${inv.invoice_number} created`); downloadInvoicePdf(inv.id, inv.invoice_number); load(); }} onError={m => showToast(m, 'error')} />}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Empty({ children }) {
  return <div style={{ fontSize: 13, color: '#9CA3AF', padding: '6px 0' }}>{children}</div>;
}

// ─────────────────────────────────────────── modals ──

function RecordPaymentModal({ agentId, openItems, outstanding, onClose, onDone, onError }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [allocations, setAllocations] = useState({}); // booking_id -> string amount
  const [saving, setSaving] = useState(false);

  const amt = parseFloat(amount || 0);

  // auto-fill allocations oldest-first whenever amount changes
  useEffect(() => {
    let remaining = amt;
    const next = {};
    for (const it of openItems) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, it.balance);
      next[it.booking_id] = String(Math.round(take));
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setAllocations(next);
  }, [amount]); // eslint-disable-line

  const allocSum = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  async function submit() {
    setSaving(true);
    try {
      const allocationArr = Object.entries(allocations)
        .map(([booking_id, v]) => ({ booking_id, amount: parseFloat(v) || 0 }))
        .filter(a => a.amount > 0);
      const { data } = await api.post(`/api/agents/${agentId}/payments`, {
        amount: amt, method, received_on: receivedOn, reference,
        allocations: allocationArr.length ? allocationArr : undefined,
      });
      onDone(data);
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">Record Agent Payment</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount received *</label>
              <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`up to ${fmtIDR(outstanding)}`} />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={receivedOn} onChange={e => setReceivedOn(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="qris">QRIS</option>
                <option value="wise">Wise</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Reference</label>
              <input className="form-input" value={reference} onChange={e => setReference(e.target.value)} placeholder="transfer ref / note" />
            </div>
          </div>

          <div className="form-label" style={{ marginTop: 8 }}>Allocation (auto oldest-first — adjust as needed)</div>
          <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {openItems.map(it => (
                <tr key={it.booking_id}>
                  <td style={{ padding: '4px 0' }}>{it.guest_name} <span style={{ color: '#9CA3AF' }}>· {fmtDate(it.check_out_date)} · bal {fmtIDR(it.balance)}</span></td>
                  <td style={{ padding: '4px 0', width: 130 }}>
                    <input className="form-input" type="number" style={{ padding: '4px 8px' }}
                      value={allocations[it.booking_id] || ''}
                      onChange={e => setAllocations(a => ({ ...a, [it.booking_id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div style={{ fontSize: 12, marginTop: 6, color: Math.abs(allocSum - amt) > 0.5 && amt > 0 ? '#D97706' : '#6B7280' }}>
            Allocated {fmtIDR(allocSum)} of {fmtIDR(amt)}{allocSum > amt + 0.5 ? ' — over the payment amount' : ''}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || amt <= 0 || allocSum > amt + 0.5}>
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GenerateInvoiceModal({ agentId, openItems, onClose, onDone, onError }) {
  const [selected, setSelected] = useState(() => new Set(openItems.map(i => i.booking_id)));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const total = openItems.filter(i => selected.has(i.booking_id)).reduce((s, i) => s + i.folio_total, 0);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function submit() {
    setSaving(true);
    try {
      const { data } = await api.post(`/api/agents/${agentId}/invoices`, {
        booking_ids: [...selected], notes,
      });
      onDone(data.invoice);
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">Generate Consolidated Invoice</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-label">Un-invoiced bookings</div>
          {openItems.map(it => (
            <label key={it.booking_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
              <input type="checkbox" checked={selected.has(it.booking_id)} onChange={() => toggle(it.booking_id)} />
              <span style={{ flex: 1 }}>{it.guest_name} · {it.unit_name} · {fmtDate(it.check_out_date)}</span>
              <span style={{ fontWeight: 600 }}>{fmtIDR(it.folio_total)}</span>
            </label>
          ))}
          <div style={{ fontWeight: 700, marginTop: 8, textAlign: 'right' }}>Invoice total: {fmtIDR(total)}</div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment terms, PO number…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || selected.size === 0}>
            {saving ? 'Creating…' : 'Create & Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
