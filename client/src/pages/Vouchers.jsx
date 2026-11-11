import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import Icon from '../components/Icon';
import GuestPicker from '../components/GuestPicker';
import ReasonModal from '../components/ReasonModal';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { propertyToday } from '../lib/propertyTime';

// Sales → Vouchers (migration 167, VOUCHERS_PLAN.md): a fixed stay (nights, room
// type, meal plan) sold at a set price and used once at New Booking. Selling one
// is not revenue — the money is held until the stay (Guide → Vouchers).

const idr = n => n == null ? '—' : 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDate = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const errText = err => err.response?.data?.error || err.message || 'Something went wrong';
const STATUS = {
  active: ['Active', 'green'], reserved: ['Booked', 'blue'], redeemed: ['Used', 'gray'], expired: ['Expired', 'red'], voided: ['Cancelled', 'gray'],
};
const FREE_SCOPES = { room: 'Room only — meals and extras are paid', room_meals: 'Room + meals — extras are paid', all: 'Everything — room, meals and extras' };
const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];

async function openPdf(url, name) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  const w = window.open(blobUrl, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name || 'voucher.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

export default function Vouchers() {
  const { user, can } = useAuth();
  const isOwner = user?.role === 'owner';
  const canException = isOwner || can('corrections');
  const [tab, setTab] = useState('vouchers');
  const [selling, setSelling] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion(v => v + 1);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Vouchers</div>
          <div className="page-subtitle">A fixed stay sold at a set price and used once when booking · <Link to="/guide/vouchers">📘 Guide</Link></div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => setSelling(true)}><Icon name="plus" size={15} /> Sell voucher</button>
        </div>
      </div>
      <div className="tab-bar">
        {[['vouchers', 'Vouchers'], ...(isOwner ? [['types', 'Voucher types']] : []), ['report', 'Report']].map(([k, l]) => (
          <button key={k} className={`tab-bar-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'vouchers' && <VoucherList version={version} onOpen={setOpenId} onChanged={refresh} />}
      {tab === 'types' && isOwner && <Types />}
      {tab === 'report' && <Report version={version} onOpen={id => { setOpenId(id); }} />}
      {selling && <SellModal onClose={() => setSelling(false)} onSold={id => { setSelling(false); refresh(); if (id) setOpenId(id); }} />}
      {openId && <VoucherModal id={openId} canException={canException} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

// ── The list ──

function VoucherList({ version, onOpen, onChanged }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/vouchers', { params: { q, status } }).then(r => { setRows(r.data); setError(''); }).catch(e => setError(errText(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, status, version]);

  return (
    <>
      <div className="page-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="form-input" style={{ maxWidth: 280 }} placeholder="Search code, buyer, guest…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg">
          {[['active', 'Active'], ['reserved', 'Booked'], ['redeemed', 'Used'], ['expired', 'Expired'], ['voided', 'Cancelled'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      <FreeRequests version={version} onChanged={onChanged} />
      {error && <div className="alert alert-danger"><div>{error}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 900 }}>
            <thead><tr><th>No.</th><th>Code</th><th>Voucher</th><th>Bought by / for</th><th>Sold</th><th>Valid until</th><th>Status</th><th>Booking</th></tr></thead>
            <tbody>
              {(rows || []).map(v => (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(v.id)}>
                  <td style={{ fontWeight: 600 }}>{v.voucher_label}</td>
                  <td style={{ fontFamily: 'monospace' }}>{v.pretty_code}</td>
                  <td>{v.name}{v.is_free && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Free</span>}<div className="text-muted" style={{ fontSize: 11 }}>{v.snapshot?.nights} night{v.snapshot?.nights === 1 ? '' : 's'} · {v.room_type_name}</div></td>
                  <td>{v.buyer_name}{v.recipient_name && <div className="text-muted" style={{ fontSize: 11 }}>for {v.recipient_name}</div>}</td>
                  <td>{fmtDate(v.sold_on)}<div className="text-muted" style={{ fontSize: 11 }}>{v.is_free ? 'given free' : idr(v.price)}</div></td>
                  <td>{fmtDate(v.expires_on)}</td>
                  <td><span className={`badge badge-${STATUS[v.status]?.[1] || 'gray'}`}>{STATUS[v.status]?.[0] || v.status}</span></td>
                  <td>{v.booking_id ? <>{v.booking_guest}<div className="text-muted" style={{ fontSize: 11 }}>{v.booking_unit} · {fmtDate(v.check_in_date)}</div></> : '—'}</td>
                </tr>
              ))}
              {rows && !rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No vouchers</td></tr>}
              {!rows && !error && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Free vouchers waiting for an approver, or turned down in the last day ──

function FreeRequests({ version, onChanged }) {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.get('/api/vouchers/free-requests').then(r => setRows(r.data)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load, version]);
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      {rows.map(r => (
        <div key={r.id} className={`alert ${r.status === 'pending' ? 'alert-warning' : 'alert-danger'}`} style={{ marginBottom: 6 }}>
          <div className="flex-between" style={{ gap: 10, alignItems: 'center' }}>
            <div>
              {r.status === 'pending'
                ? <>🕐 <b>Waiting for approval</b> — free voucher "{r.template_name}" for {r.given_to}{r.approver_names?.length ? ` · asked ${r.approver_names.join(', ')}` : ''}</>
                : <>❌ <b>Declined by {r.declined_by_name}</b> — free voucher "{r.template_name}" for {r.given_to}</>}
              <div className="text-muted" style={{ fontSize: 12 }}>{FREE_SCOPES[r.scope]} · {r.reason}{r.requested_by_name ? ` · asked by ${r.requested_by_name}` : ''}</div>
            </div>
            {r.status === 'pending' && <button className="btn btn-sm btn-secondary" onClick={async () => { await api.post(`/api/vouchers/free-requests/${r.id}/cancel`).catch(() => {}); load(); onChanged?.(); }}>Withdraw</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Selling ──

function SellModal({ onClose, onSold }) {
  const { user, can } = useAuth();
  const direct = user?.role === 'owner' || can('grant_complimentary');
  const { paymentMethods } = useSettings();
  const methods = (paymentMethods || []).filter(m => m.is_active !== false && !['ota_managed', 'voucher'].includes(m.id));
  const [types, setTypes] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [buyer, setBuyer] = useState(null);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [recipient, setRecipient] = useState('');
  const [method, setMethod] = useState('');
  const [paidOn, setPaidOn] = useState(propertyToday());
  const [reference, setReference] = useState('');
  const [free, setFree] = useState(false);
  const [scope, setScope] = useState('room_meals');
  const [freeReason, setFreeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [waiting, setWaiting] = useState(null);       // a free voucher asked on Telegram: { id, approver_names }
  const [outcome, setOutcome] = useState(null);       // declined / expired

  useEffect(() => { api.get('/api/vouchers/templates').then(r => { setTypes(r.data); if (r.data.length === 1) setTypeId(r.data[0].id); }).catch(e => setError(errText(e))); }, []);
  useEffect(() => { if (!method && methods.length) setMethod(methods[0].id); }, [methods.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // While waiting for an approver, watch the request.
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/vouchers/free-requests/${waiting.id}`);
        if (data.status === 'approved' && data.voucher) { setWaiting(null); setDone({ id: data.voucher.id, voucher_no: data.voucher.voucher_no, pretty_code: data.voucher.pretty_code, approved_by: data.approved_by_name }); }
        else if (['declined', 'expired', 'cancelled'].includes(data.status)) { setWaiting(null); setOutcome(data); }
      } catch { /* keep trying */ }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]);
  const t = (types || []).find(x => x.id === typeId);
  const fee = !free && t && t.fee_pct != null && t.fee_payer === 'guest' ? Math.round(t.price * t.fee_pct / 100) : 0;

  async function sell() {
    if (!t) { setError('Choose the voucher type'); return; }
    if (!buyer) { setError(free ? 'Who is it for? Pick a guest or type a new one' : 'Who is buying it? Pick a guest or type a new one'); return; }
    if (free && freeReason.trim().length < 3) { setError('Give a reason for the free voucher'); return; }
    setBusy(true); setError('');
    try {
      const who = buyer.guest_id ? { buyer_guest_id: buyer.guest_id } : { buyer_name: buyer.new_guest.name, buyer_phone: buyer.new_guest.whatsapp };
      const body = free
        ? { free: true, template_id: t.id, recipient_name: recipient, buyer_email: buyerEmail, free_scope: scope, free_reason: freeReason, ...who }
        : { template_id: t.id, recipient_name: recipient, payment_method: method, received_on: paidOn, reference, buyer_email: buyerEmail, ...who };
      const { data, status } = await api.post('/api/vouchers', body);
      if (status === 202 && data.request) setWaiting(data.request); else setDone(data);
    } catch (e) { setError(errText(e)); }
    setBusy(false);
  }

  if (waiting) {
    return (
      <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">Waiting for approval</div><button className="btn btn-icon" onClick={() => onSold(null)}>✕</button></div>
        <div className="modal-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>🕐</div>
          <div style={{ margin: '8px 0' }}>The request is on Telegram for <b>{(waiting.approver_names || []).join(', ')}</b>.</div>
          <div className="text-muted" style={{ fontSize: 13 }}>This window updates by itself when someone presses Approve or Decline. You can close it — the request stays listed on the Vouchers page, and the voucher is issued the moment it is approved.</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={async () => { await api.post(`/api/vouchers/free-requests/${waiting.id}/cancel`).catch(() => {}); onSold(null); }}>Withdraw the request</button>
          <button className="btn btn-primary" onClick={() => onSold(null)}>Close</button>
        </div>
      </div></div>
    );
  }
  if (outcome) {
    return (
      <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">Not given</div><button className="btn btn-icon" onClick={() => onSold(null)}>✕</button></div>
        <div className="modal-body">
          {outcome.status === 'declined' ? <>❌ <b>{outcome.declined_by_name}</b> declined the free voucher.</> : 'The request expired or was withdrawn — nothing was issued.'}
        </div>
        <div className="modal-footer"><button className="btn btn-primary" onClick={() => onSold(null)}>Close</button></div>
      </div></div>
    );
  }
  if (done) {
    return (
      <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">{free || done.approved_by ? 'Free voucher given' : 'Voucher sold'}</div><button className="btn btn-icon" onClick={() => onSold(done.id)}>✕</button></div>
        <div className="modal-body" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: 12 }}>{done.voucher_no}{done.approved_by ? ` · approved by ${done.approved_by}` : ''}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, letterSpacing: 1, margin: '8px 0' }}>{done.pretty_code}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>Give the guest the PDF — it has the code, what it covers and the terms.</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => onSold(done.id)}>Done</button>
          <button className="btn btn-primary" onClick={() => openPdf(`/api/vouchers/${done.id}/pdf`, `voucher-${done.voucher_no}.pdf`).catch(e => setError(errText(e)))}>⬇ Voucher PDF</button>
        </div>
      </div></div>
    );
  }

  return (
    <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 560, width: '100%' }}>
      <div className="modal-header"><div className="modal-title">{free ? 'Give a free voucher' : 'Sell a voucher'}</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
      <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {error && <div className="alert alert-danger" style={{ marginBottom: 10 }}><div>{error}</div></div>}
        <div className="form-group"><label className="form-label">Voucher type *</label>
          <select className="form-select" value={typeId} onChange={e => setTypeId(e.target.value)}>
            <option value="">{types ? (types.length ? 'Choose…' : 'No voucher types yet — the owner adds them under Voucher types') : 'Loading…'}</option>
            {(types || []).map(x => <option key={x.id} value={x.id}>{x.name} — {idr(x.price)}</option>)}
          </select>
          {t && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            {t.nights} night{t.nights === 1 ? '' : 's'} · {t.room_type_name} · {t.rate_plan_name} · up to {t.max_guests} guests · valid {t.validity_months} months
          </div>}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, margin: '0 0 12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={free} onChange={e => { setFree(e.target.checked); setError(''); }} /> 🎁 Give it free (complimentary)
        </label>
        {free && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'var(--cream)' }}>
            <div className="form-group"><label className="form-label">What does it cover? *</label>
              <select className="form-select" value={scope} onChange={e => setScope(e.target.value)}>
                {Object.entries(FREE_SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div className="form-group" style={{ marginBottom: 6 }}><label className="form-label">Reason *</label>
              <input className="form-input" value={freeReason} onChange={e => setFreeReason(e.target.value)} placeholder="e.g. Travel agent site inspection" /></div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {direct
                ? 'You can give it at once. The owner is told.'
                : 'It needs approval: the approvers get a message on Telegram and the voucher is issued when one presses Approve.'}
              {' '}No money is taken and nothing is held; when it is used, the stay is booked at its normal price and made complimentary, so the value given away shows in the reports.
            </div>
          </div>
        )}
        <div className="form-group"><label className="form-label">{free ? 'Given to *' : 'Bought by *'}</label>
          <GuestPicker value={buyer?.guest_id ? buyer : buyer?.new_guest ? { new_guest: buyer.new_guest } : null} onChange={setBuyer} />
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="optional" /></div>
          <div className="form-group"><label className="form-label">For (guest who will stay)</label><input className="form-input" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="optional — if not the same person" /></div>
        </div>
        {!free && <>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Paid with *</label>
              <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Day paid</label><input className="form-input" type="date" max={propertyToday()} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Reference</label><input className="form-input" value={reference} onChange={e => setReference(e.target.value)} placeholder="Transfer / slip number (optional)" /></div>
        </>}
        {t && !free && (
          <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 13 }}>
            <div className="flex-between"><span>{t.name}</span><span>{idr(t.price)}</span></div>
            {fee > 0 && <div className="flex-between text-muted"><span>{t.fee_label || 'Fee'} ({t.fee_pct}%)</span><span>{idr(fee)}</span></div>}
            <div className="flex-between" style={{ fontWeight: 700, marginTop: 4 }}><span>To collect now</span><span>{idr(t.price + fee)}</span></div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>The money is held until the guest stays — it is not revenue today. A voucher carries no service charge or tax.</div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !t || !buyer || (!free && !method)} onClick={sell}>
          {busy ? 'Saving…' : free ? (direct ? 'Give free voucher' : 'Ask for approval') : 'Sell voucher'}
        </button>
      </div>
    </div></div>
  );
}

// ── One voucher ──

function VoucherModal({ id, canException, onClose, onChanged }) {
  const navigate = useNavigate();
  const { paymentMethods } = useSettings();
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);       // 'void' | 'extend'
  const [refund, setRefund] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [extendTo, setExtendTo] = useState('');
  const load = useCallback(() => api.get(`/api/vouchers/${id}`).then(r => setV(r.data)).catch(e => setError(errText(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const methods = (paymentMethods || []).filter(m => m.is_active !== false && !['ota_managed', 'voucher'].includes(m.id));
  if (!v) return <div className="modal-backdrop"><div className="modal"><div className="modal-body">{error || 'Loading…'}</div></div></div>;
  const s = v.snapshot || {};

  return (
    <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 620, width: '100%' }}>
      <div className="modal-header">
        <div className="modal-title">{v.voucher_label} · {v.name} <span className={`badge badge-${STATUS[v.status]?.[1] || 'gray'}`} style={{ marginLeft: 6 }}>{STATUS[v.status]?.[0]}</span></div>
        <button className="btn btn-icon" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        {error && <div className="alert alert-danger" style={{ marginBottom: 10 }}><div>{error}</div></div>}
        <div style={{ textAlign: 'center', margin: '4px 0 14px' }}>
          <div className="text-muted" style={{ fontSize: 11 }}>VOUCHER CODE</div>
          <div style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>{v.pretty_code}</div>
        </div>
        <div className="kv-rows" style={{ marginBottom: 12 }}>
          <Row k="Covers" v={`${s.nights} night${s.nights === 1 ? '' : 's'} · ${s.room_type_name} · ${s.rate_plan_name || 'meal plan not set'} · up to ${s.max_guests} guests`} />
          {v.is_free
            ? <Row k="Free voucher" v={`${FREE_SCOPES[v.free_scope] || ''} · ${v.free_reason || ''}${v.free_approved_by ? ` · approved by ${v.free_approved_by}` : ''}`} />
            : <Row k="Price" v={`${idr(v.price)}${v.fee_amount ? ` + fee ${idr(v.fee_amount)}` : ''}`} />}
          <Row k={v.is_free ? 'Given to' : 'Bought by'} v={`${v.buyer_name || '—'}${v.buyer_email ? ` · ${v.buyer_email}` : ''}${v.buyer_phone ? ` · ${v.buyer_phone}` : ''}`} />
          <Row k="For" v={v.recipient_name || '—'} />
          <Row k={v.is_free ? 'Given' : 'Sold'} v={v.is_free ? `${fmtDate(v.sold_on)}${v.sold_by_name ? ` · by ${v.sold_by_name}` : ''}` : `${fmtDate(v.sold_on)} · ${v.payment_label || v.payment_method}${v.reference ? ` · ${v.reference}` : ''}${v.sold_by_name ? ` · by ${v.sold_by_name}` : ''}`} />
          <Row k="Valid until" v={fmtDate(v.expires_on)} />
          {v.booking_id && <Row k="Booking" v={<a href={`/reservations/${v.booking_id}`} onClick={e => { e.preventDefault(); navigate(`/reservations/${v.booking_id}`); }}>{v.booking_guest} · {v.booking_unit} · {fmtDate(v.check_in_date)} → {fmtDate(v.check_out_date)}</a>} />}
          {v.status === 'voided' && <Row k="Cancelled" v={`${v.void_reason || ''}${v.refunded_amount ? ` · ${idr(v.refunded_amount)} given back` : ' · no money given back'}`} />}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, margin: '8px 0 4px' }}>History</div>
        {(v.events || []).map((e, i) => (
          <div key={i} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="text-muted">{new Date(e.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> · {e.note || e.kind}{e.by_name ? <span className="text-muted"> · {e.by_name}</span> : ''}
          </div>
        ))}
      </div>
      <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
        {canException && v.status === 'active' && <button className="btn btn-secondary" style={{ marginRight: 'auto' }} onClick={() => { setRefund(''); setRefundMethod(methods[0]?.id || ''); setAction('void'); }}>Cancel voucher…</button>}
        {canException && ['active', 'reserved'].includes(v.status) && <button className="btn btn-secondary" onClick={() => { setExtendTo(''); setAction('extend'); }}>Extend…</button>}
        {v.status !== 'voided' && <button className="btn btn-primary" onClick={() => openPdf(`/api/vouchers/${v.id}/pdf`, `voucher-${v.voucher_label}.pdf`).catch(e => setError(errText(e)))}>⬇ PDF</button>}
      </div>
      {action === 'void' && (
        <ReasonModal title={`Cancel ${v.voucher_label}`} danger confirmLabel="Cancel voucher" placeholder="Why is it cancelled?"
          onClose={() => setAction(null)}
          onConfirm={async reason => {
            await api.post(`/api/vouchers/${v.id}/void`, { reason, refund_amount: refund === '' ? 0 : refund, refund_method: refundMethod });
            setAction(null); load(); onChanged();
          }}>
          {v.is_free ? <div>The free voucher can't be used any more. No money is involved.</div> : <>
            <div>The voucher can't be used any more. If the money goes back to the buyer, type the amount and how; if not, the hotel keeps it as income.</div>
            <div className="form-row" style={{ marginTop: 10 }}>
              <input className="form-input" type="number" min="0" placeholder="Money given back (Rp)" value={refund} onChange={e => setRefund(e.target.value)} />
              <select className="form-select" value={refundMethod} onChange={e => setRefundMethod(e.target.value)}>
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </>}
        </ReasonModal>
      )}
      {action === 'extend' && (
        <ReasonModal title={`Extend ${v.voucher_label}`} confirmLabel="Extend" placeholder="Why is it extended?"
          onClose={() => setAction(null)}
          onConfirm={async reason => {
            if (!extendTo) throw new Error('Choose the new last day');
            await api.post(`/api/vouchers/${v.id}/extend`, { expires_on: extendTo, reason });
            setAction(null); load(); onChanged();
          }}>
          <div>Now valid until {fmtDate(v.expires_on)}. Choose the new last day to check in:</div>
          <input className="form-input" type="date" style={{ marginTop: 8 }} min={String(v.expires_on).slice(0, 10)} value={extendTo} onChange={e => setExtendTo(e.target.value)} />
        </ReasonModal>
      )}
    </div></div>
  );
}
const Row = ({ k, v }) => <div style={{ display: 'flex', gap: 10, padding: '3px 0', fontSize: 13 }}><div className="text-muted" style={{ width: 90, flexShrink: 0 }}>{k}</div><div style={{ flex: 1 }}>{v}</div></div>;

// ── Voucher types (owner) ──

const EMPTY_TYPE = { name: '', description: '', nights: 2, room_type_id: '', rate_plan_id: '', max_guests: 2, price: '', validity_months: 12, terms: '',
  blackout: [], allowed_weekdays: [], min_notice_days: 0, no_show_consumes: true, transferable: true, is_active: true, fee_label: '', fee_pct: '', fee_payer: 'guest' };

function Types() {
  const [types, setTypes] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/api/vouchers/templates', { params: { all: 1 } }).then(r => setTypes(r.data)).catch(e => setError(errText(e)));
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="page-toolbar"><div className="page-toolbar-end"><button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...EMPTY_TYPE })}><Icon name="plus" size={14} /> New voucher type</button></div></div>
      {error && <div className="alert alert-danger"><div>{error}</div></div>}
      <div className="card"><div className="table-wrap">
        <table style={{ minWidth: 720 }}>
          <thead><tr><th>Name</th><th>Covers</th><th style={{ textAlign: 'right' }}>Price</th><th>Valid</th><th>Rules</th><th></th></tr></thead>
          <tbody>
            {(types || []).map(t => (
              <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
                <td style={{ fontWeight: 600 }}>{t.name}{!t.is_active && <span className="badge badge-gray" style={{ marginLeft: 6 }}>off</span>}</td>
                <td>{t.nights} night{t.nights === 1 ? '' : 's'} · {t.room_type_name} · {t.rate_plan_name}<div className="text-muted" style={{ fontSize: 11 }}>up to {t.max_guests} guests</div></td>
                <td style={{ textAlign: 'right' }}>{idr(t.price)}</td>
                <td>{t.validity_months} months</td>
                <td style={{ fontSize: 12 }}>
                  {t.blackout?.length ? `${t.blackout.length} blackout period${t.blackout.length === 1 ? '' : 's'}` : 'No blackout'}
                  {t.allowed_weekdays?.length ? ` · check-in ${t.allowed_weekdays.map(d => DAYS.find(x => x[0] === String(d))?.[1]).join(', ')}` : ''}
                  {t.min_notice_days ? ` · ${t.min_notice_days} days notice` : ''}
                </td>
                <td><button className="btn btn-sm btn-secondary" onClick={() => setEdit({
                  ...EMPTY_TYPE, ...t, rate_plan_id: t.rate_plan_id || '', description: t.description || '', terms: t.terms || '',
                  blackout: (t.blackout || []).map(b => ({ ...b, from: String(b.from).slice(0, 10), to: String(b.to).slice(0, 10) })),
                  allowed_weekdays: (t.allowed_weekdays || []).map(String), fee_label: t.fee_label || '', fee_pct: t.fee_pct ?? '', fee_payer: t.fee_payer || 'guest',
                })}>Edit</button></td>
              </tr>
            ))}
            {types && !types.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No voucher types yet — add the first one</td></tr>}
          </tbody>
        </table>
      </div></div>
      {edit && <TypeModal initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function TypeModal({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [roomTypes, setRoomTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = patch => setF(x => ({ ...x, ...patch }));
  useEffect(() => {
    api.get('/api/room-types').then(r => setRoomTypes(r.data)).catch(() => {});
    api.get('/api/rate-plans').then(r => setPlans((r.data || []).filter(p => p.is_active !== false))).catch(() => {});
  }, []);
  const toggleDay = d => set({ allowed_weekdays: f.allowed_weekdays.includes(d) ? f.allowed_weekdays.filter(x => x !== d) : [...f.allowed_weekdays, d] });
  const setBlackout = (i, patch) => set({ blackout: f.blackout.map((b, j) => j === i ? { ...b, ...patch } : b) });

  async function save() {
    setBusy(true); setError('');
    const body = { ...f, allowed_weekdays: f.allowed_weekdays.map(Number), fee_pct: f.fee_pct === '' ? null : f.fee_pct };
    try {
      if (f.id) await api.put(`/api/vouchers/templates/${f.id}`, body); else await api.post('/api/vouchers/templates', body);
      onSaved();
    } catch (e) { setError(errText(e)); setBusy(false); }
  }

  return (
    <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 680, width: '100%' }}>
      <div className="modal-header"><div className="modal-title">{f.id ? 'Edit voucher type' : 'New voucher type'}</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
      <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {error && <div className="alert alert-danger" style={{ marginBottom: 10 }}><div>{error}</div></div>}
        <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e => set({ name: e.target.value })} placeholder="2 nights Deluxe Pool View with breakfast" /></div>
        <div className="form-group"><label className="form-label">Short description</label><input className="form-input" value={f.description} onChange={e => set({ description: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Nights *</label><input className="form-input" type="number" min="1" max="60" value={f.nights} onChange={e => set({ nights: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Room type *</label>
            <select className="form-select" value={f.room_type_id} onChange={e => set({ room_type_id: e.target.value })}>
              <option value="">Choose…</option>{roomTypes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Meal plan *</label>
            <select className="form-select" value={f.rate_plan_id} onChange={e => set({ rate_plan_id: e.target.value })}>
              <option value="">Choose…</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Up to guests *</label><input className="form-input" type="number" min="1" value={f.max_guests} onChange={e => set({ max_guests: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Price (Rp) *</label><input className="form-input" type="number" min="0" value={f.price} onChange={e => set({ price: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Valid for (months)</label><input className="form-input" type="number" min="1" max="60" value={f.validity_months} onChange={e => set({ validity_months: e.target.value })} /></div>
        </div>
        <div className="text-muted" style={{ fontSize: 12, margin: '-4px 0 10px' }}>A voucher carries no service charge or tax: the guest pays the price, and the stay is fully covered — room and meal plan. Extras the guest buys are paid at the normal rates.</div>
        <div className="form-group"><label className="form-label">Terms & conditions (printed on the voucher)</label><textarea className="form-textarea" rows={5} value={f.terms} onChange={e => set({ terms: e.target.value })} /></div>

        <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0' }}>Rules</div>
        <div className="form-group"><label className="form-label">Blackout dates (nights it can't be used)</label>
          {f.blackout.map((b, i) => (
            <div key={i} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <input className="form-input" type="date" value={b.from} onChange={e => setBlackout(i, { from: e.target.value })} />
              <span>to</span>
              <input className="form-input" type="date" value={b.to} onChange={e => setBlackout(i, { to: e.target.value })} />
              <input className="form-input" placeholder="Label (e.g. New Year)" value={b.label || ''} onChange={e => setBlackout(i, { label: e.target.value })} />
              <button className="btn btn-icon btn-sm" onClick={() => set({ blackout: f.blackout.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={() => set({ blackout: [...f.blackout, { from: '', to: '', label: '' }] })}>+ Add a blackout period</button>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Check-in days (none ticked = any day)</label>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {DAYS.map(([k, l]) => <label key={k} style={{ fontSize: 13 }}><input type="checkbox" checked={f.allowed_weekdays.includes(k)} onChange={() => toggleDay(k)} /> {l}</label>)}
            </div></div>
          <div className="form-group"><label className="form-label">Minimum notice (days)</label><input className="form-input" type="number" min="0" value={f.min_notice_days} onChange={e => set({ min_notice_days: e.target.value })} /></div>
        </div>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.no_show_consumes} onChange={e => set({ no_show_consumes: e.target.checked })} /> A no-show uses the voucher up</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.transferable} onChange={e => set({ transferable: e.target.checked })} /> Can be given to someone else</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} /> On sale</label>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0' }}>Extra fee on the sale (optional — e.g. a card fee)</div>
        <div className="form-row">
          <input className="form-input" placeholder="Label (e.g. Card fee)" value={f.fee_label} onChange={e => set({ fee_label: e.target.value })} />
          <input className="form-input" type="number" min="0" max="20" step="0.1" placeholder="%" value={f.fee_pct} onChange={e => set({ fee_pct: e.target.value })} />
          <select className="form-select" value={f.fee_payer} onChange={e => set({ fee_payer: e.target.value })}>
            <option value="guest">The buyer pays it on top</option><option value="hotel">The hotel absorbs it</option>
          </select>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div></div>
  );
}

// ── Report ──

function Report({ version, onOpen }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/vouchers/report').then(x => setR(x.data)).catch(e => setError(errText(e))); }, [version]);
  if (error) return <div className="alert alert-danger"><div>{error}</div></div>;
  if (!r) return <div className="text-muted" style={{ padding: 16 }}>Loading…</div>;
  const diff = r.ledger && r.ledger.balance != null ? Math.round((r.ledger.balance - r.outstanding.amount) * 100) / 100 : null;
  return (
    <>
      <div className="stat-grid stat-grid-money" style={{ margin: '12px 0' }}>
        <div className="stat-card"><div className="stat-label">Sold, not booked yet</div><div className="stat-value">{idr(r.outstanding.amount)}</div><div className="text-muted" style={{ fontSize: 12 }}>{r.outstanding.count} voucher{r.outstanding.count === 1 ? '' : 's'} — money held</div></div>
        <div className="stat-card"><div className="stat-label">Booked, stay to come</div><div className="stat-value">{idr(r.booked.amount)}</div><div className="text-muted" style={{ fontSize: 12 }}>{r.booked.count} voucher{r.booked.count === 1 ? '' : 's'}</div></div>
        <div className="stat-card"><div className="stat-label">Free vouchers</div><div className="stat-value">{r.free.active + r.free.booked}</div><div className="text-muted" style={{ fontSize: 12 }}>{r.free.active} not booked · {r.free.booked} booked · {r.free.used} used · {r.period.free_given_n} given in the period</div></div>
        <div className="stat-card"><div className="stat-label">Sold {fmtDate(r.from)} – {fmtDate(r.to)}</div><div className="stat-value">{idr(r.period.sold_amount)}</div><div className="text-muted" style={{ fontSize: 12 }}>{r.period.sold_n} sold · {r.period.redeemed_n} used · {r.period.expired_n} expired ({idr(r.period.expired_amount)})</div></div>
      </div>
      {r.ledger && (
        <div className={`alert ${diff === 0 ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: 12 }}>
          <div>
            {r.ledger.balance == null
              ? 'The accounts have no account for vouchers yet — open Accounting → Accounts.'
              : diff === 0
                ? <>✓ Matches the books: the account <b>Deferred Income (vouchers)</b> holds {idr(r.ledger.balance)}, the same as the vouchers sold and not booked yet.</>
                : <>⚠ The books and this page differ by {idr(Math.abs(diff))}: Deferred Income (vouchers) holds {idr(r.ledger.balance)}, the vouchers sold and not booked yet add up to {idr(r.outstanding.amount)}. A journal entry on that account, or a closed day that needs its next close, can cause this.</>}
          </div>
        </div>
      )}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ padding: '12px 14px', fontWeight: 700 }}>Expiring in the next 60 days</div>
        <div className="table-wrap"><table style={{ minWidth: 560 }}>
          <thead><tr><th>Voucher</th><th>Bought by</th><th>Valid until</th><th style={{ textAlign: 'right' }}>Held</th></tr></thead>
          <tbody>
            {r.expiring.map(v => (
              <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(v.id)}>
                <td>{v.voucher_label} · {v.name}</td><td>{v.buyer_name}{v.recipient_name ? ` (for ${v.recipient_name})` : ''}</td>
                <td>{fmtDate(v.expires_on)} <span className="text-muted" style={{ fontSize: 11 }}>({v.days_left} day{v.days_left === 1 ? '' : 's'})</span></td>
                <td style={{ textAlign: 'right' }}>{idr(v.amount)}</td>
              </tr>
            ))}
            {!r.expiring.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>None</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <div style={{ padding: '12px 14px', fontWeight: 700 }}>Sold, not booked — by the month they expire</div>
        <div className="table-wrap"><table style={{ minWidth: 420 }}>
          <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Vouchers</th><th style={{ textAlign: 'right' }}>Held</th></tr></thead>
          <tbody>
            {r.by_expiry_month.map(m => <tr key={m.month}><td>{m.month}</td><td style={{ textAlign: 'right' }}>{m.count}</td><td style={{ textAlign: 'right' }}>{idr(m.amount)}</td></tr>)}
            {!r.by_expiry_month.length && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>None</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
