import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import { useSettings, SourceBadge } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import ActionMenu from '../components/ActionMenu';
import PageHeader from '../components/PageHeader';
import RegistrationCardModal from '../components/RegistrationCardModal';
import GuestPicker from '../components/GuestPicker';
import GuestIdDocument from '../components/GuestIdDocument';
import EarlyDepartureOption from '../components/EarlyDepartureOption';
import ComplimentaryModal from '../components/ComplimentaryModal';
import StayExtrasCard, { AddStayItemModal } from '../components/StayExtras';
import RecordPaymentModal from '../components/RecordPaymentModal';
import ActivityBookingModal, { activityPaidTotal } from '../components/ActivityBookingModal';
import ActivityPaymentModal from '../components/ActivityPaymentModal';
import BookingAgentFields from '../components/BookingAgentFields';
import { CITY_LEDGER, HAS_COMMISSION, commissionText, AGENT_SOURCE_TYPES, agentBody, agentValueFromBooking, agentRoleLabel } from '../lib/agents';
import { checkinTemplate, checkoutTemplate } from '../lib/messageTemplates';

import { lineShown, includesText, shownTotal, shownAmount, priceFactor } from '../lib/priceBasis';
const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };
// bookings.folio_status — set when a city-ledger stay is checked out billed
// to the agent (migrations 042/043); tracked on the Agent Billing page.
const AGENT_BILLING = {
  pending_agent_invoice: { label: 'Not invoiced yet', badge: 'amber' },
  invoiced:              { label: 'Invoiced — awaiting payment', badge: 'blue' },
  paid:                  { label: 'Paid by agent', badge: 'green' },
};
const ACTIVITY_STATUS_BADGE = { requested: 'amber', confirmed: 'blue', completed: 'green', cancelled: 'gray', no_show: 'red' };
// Same list NewBooking.jsx uses for the same field.
const EDIT_BED_PREFS = [
  ['', 'No preference'],
  ['double', 'Double bed'],
  ['twin', 'Twin beds'],
];


function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
const COMP_LABEL = { room: 'Room free', room_meals: 'Room + meals free', all: 'Everything free' };
// YYYY-MM-DD date math on local calendar dates (not UTC).
function addDaysYmd(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function nightsBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); }
// '2026-09-25' → '25 Sep' (local date, no UTC shift)
// ── Folio: what isn't charged yet ────────────────────────────────────────
// Room / meal nights and per-night extras (extra bed) post one night at a
// time at night audit, so the ledger only has the nights already posted. The
// estimate projects the whole stay; the difference is listed as "Not charged
// yet", one row per item per run of nights at the same rate (like the invoice).
function stayLabel(b, roomPart, mealPart) {
  const bf = b?.includes_breakfast, lu = b?.includes_lunch, di = b?.includes_dinner;
  const meals = bf && lu && di ? 'Full Board' : bf && di ? 'Half Board' : bf && !lu && !di ? 'Breakfast'
    : (bf || lu || di) ? (b?.rate_plan_name || 'meals') : null;
  if (roomPart && mealPart) return meals ? `Room with ${meals}` : 'Room with meals';
  if (roomPart) return 'Room';
  return meals || 'Meals';
}
const ymdNext = d => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
function notChargedRows(folio, estimate, booking) {
  if (!folio || !estimate || ['cancelled', 'no_show'].includes(booking?.status)) return [];
  const b = estimate.booking || booking;
  const postedNights = new Set(folio.charges.filter(c => c.type === 'room' || c.type === 'fnb').map(c => String(c.service_date || '').slice(0, 10)));
  const postedAddons = new Set(folio.charges.filter(c => c.addon_id).map(c => c.addon_id));
  const rows = [];

  const nightly = new Map();   // date → { room, meal }
  for (const c of estimate.charges || []) {
    if (c.type !== 'room' && c.type !== 'fnb') continue;
    const d = String(c.service_date).slice(0, 10);
    if (postedNights.has(d)) continue;
    const n = nightly.get(d) || { room: 0, meal: 0 };
    if (c.type === 'room') n.room += parseFloat(c.amount); else n.meal += parseFloat(c.amount);
    nightly.set(d, n);
  }
  for (const d of [...nightly.keys()].sort()) {
    const n = nightly.get(d);
    const rate = n.room + n.meal;
    const label = stayLabel(b, n.room > 0, n.meal > 0);
    const last = rows[rows.length - 1];
    // < Rp 1 apart = the same rate (the last night carries the rounding cent).
    if (last && last.kind === 'room' && last.label === label && Math.abs(last.rate - rate) < 1 && ymdNext(last.to) === d) {
      last.to = d; last.nights++; last.amount += rate;
    } else rows.push({ kind: 'room', label, from: d, to: d, nights: 1, rate, qty: 1, amount: rate });
  }

  const addons = (estimate.charges || [])
    .filter(c => c.type === 'addon' && c.addon_id && !postedAddons.has(c.addon_id))
    .map(c => ({ ...c, name: String(c.description).replace(/ — \d{4}-\d{2}-\d{2}$/, ''), d: String(c.service_date).slice(0, 10) }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.d.localeCompare(y.d));
  for (const c of addons) {
    const qty = parseFloat(c.quantity) || 1;
    const rate = parseFloat(c.amount);
    const paid = c.paid_method || null, free = !!c.complimentary;
    const last = rows[rows.length - 1];
    if (last && last.kind === 'addon' && last.label === c.name && last.qty === qty && Math.abs(last.rate - rate) < 1
        && last.paid === paid && last.free === free && ymdNext(last.to) === c.d) {
      last.to = c.d; last.nights++; last.amount += rate;
    } else rows.push({ kind: 'addon', label: c.name, from: c.d, to: c.d, nights: 1, rate, qty, amount: rate, paid, free });
  }

  // Activities booked "Not paid yet" — on the folio once a payment is chosen.
  for (const c of (estimate.charges || []).filter(c => c.type === 'activity' && c.not_paid)) {
    const d = String(c.service_date).slice(0, 10);
    rows.push({ kind: 'activity', label: c.name, from: d, to: d, qty: parseFloat(c.quantity) || 1,
      rate: parseFloat(c.unit_price), amount: parseFloat(c.amount), tax_mode: c.tax_mode, free: !!c.complimentary });
  }
  return rows;
}
// What the rows still add to the bill (paid-ahead / free extras left out),
// with service & tax — not on activities priced tax-included / without tax.
function notChargedTotal(rows, rates) {
  return Math.round(rows.filter(r => !r.paid && !r.free)
    .reduce((t, r) => t + r.amount * (r.tax_mode && r.tax_mode !== 'added' ? 1 : priceFactor(rates)), 0));
}

function NotChargedYet({ rows, rates }) {
  if (!rows.length) return null;
  const roomNights = rows.filter(r => r.kind === 'room').reduce((t, r) => t + r.nights, 0);
  const extras = new Map();
  for (const r of rows.filter(r => r.kind === 'addon')) extras.set(r.label, (extras.get(r.label) || 0) + r.nights);
  const counts = [
    roomNights ? `${roomNights} room-night${roomNights > 1 ? 's' : ''}` : null,
    ...[...extras].map(([name, n]) => `${name} ${n} night${n > 1 ? 's' : ''}`),
    (() => { const n = rows.filter(r => r.kind === 'activity').length; return n ? `${n} activit${n > 1 ? 'ies' : 'y'} not paid yet` : null; })(),
  ].filter(Boolean).join(' · ');
  const show = (v, r) => fmtIDR(r?.tax_mode && r.tax_mode !== 'added' ? parseFloat(v) || 0 : shownAmount(v, rates));
  return (
    <div>
      <div className="flex-between" style={{ alignItems: 'baseline', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ fontSize: 13, margin: 0 }}>Not posted yet</div>
        <span className="text-muted" style={{ fontSize: 11 }}>
          {rows.some(r => r.kind !== 'activity') ? 'nights post at night audit, one at a time' : 'posts once a payment is chosen'}
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 8 }}>
          <div>
            <div>
              {r.label}
              {r.paid && <span className="badge badge-green" style={{ marginLeft: 6 }}>Paid · {r.paid}</span>}
              {r.free && <span className="badge badge-green" style={{ marginLeft: 6 }}>Free</span>}
              {r.kind === 'activity' && <span className="badge badge-yellow" style={{ marginLeft: 6 }}>activity · not paid yet</span>}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {r.kind === 'activity'
                ? <>{fmtShortDate(r.from)} · {r.qty} pax × {show(r.rate, r)}{r.tax_mode === 'included' ? ' · tax incl.' : r.tax_mode === 'none' ? ' · no tax' : ''} — choose Charge to room or Paid now on the Activities tab</>
                : <>{fmtShortDate(r.from)}{r.nights > 1 ? ` – ${fmtShortDate(r.to)}` : ''} · {r.nights} night{r.nights > 1 ? 's' : ''} × {show(r.rate)}{r.qty > 1 ? ` (${r.qty} per night)` : ''}</>}
            </div>
          </div>
          <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
            {r.paid || r.free ? <s className="text-muted">{show(r.amount, r)}</s> : show(r.amount, r)}
          </span>
        </div>
      ))}
      <div className="flex-between" style={{ fontWeight: 700, paddingTop: 6, gap: 8 }}>
        <span>Not posted yet <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>· {counts}</span></span>
        <span style={{ whiteSpace: 'nowrap' }}>{fmtIDR(notChargedTotal(rows, rates))}</span>
      </div>
      {!rates.prices_include_tax && priceFactor(rates) > 1 && (
        <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>incl. service &amp; tax</div>
      )}
    </div>
  );
}

function fmtShortDate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

export default function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { paymentMethods, sources, branding } = useSettings();
  const { hasModule, user, can } = useAuth();
  const isOwner = user?.role === 'owner';
  const { callRoom } = useCall();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(null);
  const [payForm, setPayForm] = useState({ method: 'bank_transfer', received_at: new Date().toISOString().slice(0,10), notes: '' });
  const [editingAmount, setEditingAmount] = useState(null);
  const [newAmount, setNewAmount] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutNotes, setCheckoutNotes] = useState('');
  const [earlyCo, setEarlyCo] = useState({ early: false, valid: true, early_departure: null }); // leaving before the booked date
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [billToAgent, setBillToAgent] = useState(false);
  const [checkoutCredit, setCheckoutCredit] = useState(null);
  const [transferring, setTransferring] = useState(false);
  const [transferUnits, setTransferUnits] = useState([]);
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  // Change Room (upgrade / downgrade / move): quote for the picked room and
  // how to charge the difference.
  const [changeQuote, setChangeQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [chargeMode, setChargeMode] = useState('difference'); // difference | complimentary
  const [customAmount, setCustomAmount] = useState(''); // Change Room: the NEW room's price for the stay (pre-filled with its normal rate)
  const [changeReason, setChangeReason] = useState('');
  const [changeError, setChangeError] = useState('');
  const [amending, setAmending] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editDetailsForm, setEditDetailsForm] = useState({});
  const [editDetailsLoading, setEditDetailsLoading] = useState(false);
  const [editAgent, setEditAgent] = useState(null);   // BookingAgentFields value
  const [changingGuest, setChangingGuest] = useState(null); // null = closed, else GuestPicker value
  const [guestSaving, setGuestSaving] = useState(false);
  const [guestError, setGuestError] = useState('');
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceForm, setPriceForm] = useState({ total_amount: '', reason: '', received_was_typo: null });
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceResult, setPriceResult] = useState(null); // { old_total, new_total, received, credit }
  const [amendCheckIn, setAmendCheckIn] = useState('');
  const [amendCheckOut, setAmendCheckOut] = useState('');
  const [amendAvailability, setAmendAvailability] = useState(null);
  const [amendChecking, setAmendChecking] = useState(false);
  const [amendLoading, setAmendLoading] = useState(false);
  // Amend Dates pricing (normal-rate difference) + how to charge it.
  const [amendQuote, setAmendQuote] = useState(null);
  const [amendCharge, setAmendCharge] = useState('difference'); // difference | complimentary
  const [amendCustom, setAmendCustom] = useState(''); // Amend Dates: the price for the NEW dates (pre-filled at the booked nightly price)
  const [amendReason, setAmendReason] = useState('');
  const [amendError, setAmendError] = useState('');
  const [messaging, setMessaging] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showRegCard, setShowRegCard] = useState(false);
  // Complimentary stay: 'grant' | 'remove' | null. compInitial = scope + reason
  // ticked on New Booking (passed in the navigation state).
  const [compMode, setCompMode] = useState(null);
  const [compInitial, setCompInitial] = useState(null);
  const [tab, setTab] = useState('details');
  const [folio, setFolio] = useState(null);
  const [folioLoading, setFolioLoading] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [payingActivity, setPayingActivity] = useState(null);
  // Folio "+ Add item" — the same window as "Extras for this stay" (Sales items
  // charged to the room; no free-text folio charges since migration 077).
  const [addingItem, setAddingItem] = useState(false);
  const [bookingActivity, setBookingActivity] = useState(false);   // "+ Book activity"
  const [activityBookings, setActivityBookings] = useState(null);
  // Record Payment on the folio — settles what's owed on the stay incl.
  // extras charged to the room (room lines first, the rest as extras).
  const [recording, setRecording] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/api/bookings/${id}`);
      setBooking(r.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  // Arriving from New Booking with "Complimentary stay" ticked.
  useEffect(() => {
    const init = location.state?.complimentary;
    if (!booking || !init) return;
    setCompInitial(init);
    setCompMode('grant');
    nav(`/reservations/${id}${location.hash}`, { replace: true, state: null });
  }, [booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened via Balance Due's "Record payment →": Folio tab + the form open.
  useEffect(() => {
    if (!booking || location.hash !== '#record-payment') return;
    setTab('folio');
  }, [booking?.id, location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record Payment (components/RecordPaymentModal.jsx): room lines + extras.
  function openRecordPayment() {
    setRecording(true);
  }
  function closeRecordPayment() {
    setRecording(false);
    if (location.hash === '#record-payment') nav(`/reservations/${id}`, { replace: true });
  }

  async function downloadLinesReceipt(paymentId) {
    await downloadPdf(`/api/folio/payment/${paymentId}/receipt`, `receipt-${String(paymentId).slice(0, 8)}.pdf`);
  }
  // Any payment's receipt (receipt_kind from the server): specific items paid
  // from Record Payment, an extra paid with Pay now, an activity paid directly.
  async function downloadPaymentReceipt(p) {
    if (p.receipt_kind === 'lines') return downloadLinesReceipt(p.id);
    if (p.receipt_kind === 'sale') return downloadPdf(`/api/sales/${p.sale_id}/receipt`, `receipt-sale-${String(p.sale_id).slice(0, 8)}.pdf`);
    if (p.receipt_kind === 'activity') return downloadPdf(`/api/activities/bookings/${p.activity_booking_id}/receipt`, `receipt-activity-${String(p.activity_booking_id).slice(0, 8)}.pdf`);
  }

  // Opened via Balance Due's "Record payment →" once the estimate is in.
  useEffect(() => {
    if (location.hash === '#record-payment' && estimate && parseFloat(estimate.balance_due) > 0 && !recording) openRecordPayment();
  }, [estimate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened via "+ Extra bed / item" (e.g. from the Dashboard room window):
  // Details tab, the Add item window open.
  const openAddItem = location.hash === '#add-item';
  useEffect(() => {
    if (!booking || !openAddItem) return;
    setTab('details');
    requestAnimationFrame(() => document.getElementById('stay-extras')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [booking?.id, openAddItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened via a "Pay →" shortcut (e.g. from the group page): jump straight
  // to Payment Tracking once the booking has loaded.
  useEffect(() => {
    if (!booking || location.hash !== '#payment') return;
    setTab('details');
    requestAnimationFrame(() => document.getElementById('payment-tracking')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [booking?.id, location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFolio() {
    setFolioLoading(true);
    try {
      const [f, e] = await Promise.all([
        api.get(`/api/folio/${id}`),
        api.get(`/api/folio/${id}/estimate`).catch(() => null),
      ]);
      setFolio(f.data);
      if (e) setEstimate(e.data);
    } catch {}
    setFolioLoading(false);
  }

  useEffect(() => { if (tab === 'folio' && !folio) loadFolio(); }, [tab]);
  const notCharged = notChargedRows(folio, estimate, booking);

  async function loadActivityBookings() {
    try {
      const r = await api.get('/api/activities/bookings', { params: { booking_id: id } });
      setActivityBookings(r.data);
    } catch {}
  }

  useEffect(() => { if (tab === 'activities' && !activityBookings) loadActivityBookings(); }, [tab]);
  // Tours / transport / spa are Activities, not Sales items: the Add item
  // windows link here, and the Activities tab books one for this stay.
  function startBookActivity() {
    setAddingItem(false);
    setTab('activities');
    setBookingActivity(true);
  }

  async function voidCharge(charge) {
    const chargeId = charge.id;
    // A Pay-now line's payment stays on the folio (no refund flow yet).
    const msg = charge.paid_method
      ? `Void this charge?

It was already paid at the desk (${charge.paid_method}). The payment stays on the folio as a credit — return the money by hand if needed.`
      : 'Void this charge?';
    if (!confirm(msg)) return;
    try {
      await api.delete(`/api/folio/charge/${chargeId}`);
      loadFolio();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to void charge');
    }
  }

  async function downloadPdf(url, filename) {
    try {
      const r = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      alert('Failed to download PDF');
    }
  }

  async function downloadInvoice(copy) {
    await downloadPdf(`/api/folio/${id}/invoice${copy ? '?copy=guest' : ''}`, `invoice-${copy ? 'guest-' : ''}${id}.pdf`);
  }

  async function downloadProforma(copy) {
    await downloadPdf(`/api/folio/${id}/proforma${copy ? '?copy=guest' : ''}`, `proforma-${copy ? 'guest-' : ''}${id}.pdf`);
  }

  async function markPaid(payment) {
    setPaying(payment);
  }

  async function saveAmount(payment) {
    const amount = parseFloat(newAmount);
    if (!amount || amount < 0) return;
    try {
      await api.put(`/api/payments/${payment.id}`, { amount });
      setEditingAmount(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  async function confirmPayment() {
    try {
      await api.put(`/api/payments/${paying.id}`, { status: 'received', ...payForm });
      setPaying(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  function openCheckout() {
    setCheckingOut(true);
    setCheckoutNotes('');
    setEarlyCo({ early: false, valid: true, early_departure: null });
    setCheckoutCredit(null);
    // Billing terms belong to the booking's agent (migration 084).
    setBillToAgent(CITY_LEDGER.includes(booking.agent_payment_status));
    if (booking.agent_id && booking.agent_credit_limit != null) {
      api.get(`/api/agent-directory/${booking.agent_id}/credit-check?amount=0`)
        .then(r => setCheckoutCredit({ ...r.data, label: r.data.name }))
        .catch(() => {});
    }
  }

  async function doCheckout() {
    setCheckoutLoading(true);
    try {
      await api.put(`/api/checkin/checkout/${id}/complete`, {
        condition_notes: checkoutNotes, bill_to_agent: billToAgent,
        ...(earlyCo.early ? { early_departure: earlyCo.early_departure } : {}),
      });
      setCheckingOut(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Checkout failed');
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function confirmBooking() {
    if (!confirm('Confirm this booking? No payment is required.')) return;
    try {
      await api.put(`/api/bookings/${id}/confirm`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to confirm booking');
    }
  }

  async function cancel() {
    if (!confirm('Cancel this booking?')) return;
    await api.delete(`/api/bookings/${id}`);
    nav('/reservations');
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/api/bookings/${id}/note`, { content: note }).catch(() => {});
    setNote('');
    load();
  }

  async function openTransfer() {
    setTransferTarget(null);
    setChangeQuote(null);
    setChargeMode('difference');
    setCustomAmount('');
    setChangeReason('');
    setChangeError('');
    setTransferring(true);
    try {
      const r = await api.get('/api/bookings/transfer-availability', {
        params: {
          check_in: booking.check_in_date?.slice(0, 10),
          check_out: booking.check_out_date?.slice(0, 10),
          exclude_booking_id: id,
        },
      });
      setTransferUnits(r.data.filter(u => u.id !== booking.unit_id));
    } catch {
      alert('Failed to load unit availability');
      setTransferring(false);
    }
  }

  async function pickChangeRoom(unitId) {
    setTransferTarget(unitId);
    setChangeQuote(null);
    setChangeError('');
    setQuoteLoading(true);
    try {
      const r = await api.get(`/api/bookings/${id}/change-room/quote`, { params: { unit_id: unitId } });
      setChangeQuote(r.data);
      setCustomAmount(String(Math.round(r.data.next.total)));
      setChargeMode('difference');
    } catch (err) {
      setChangeError(err.response?.data?.error || 'Could not price this room');
    } finally {
      setQuoteLoading(false);
    }
  }

  async function doTransfer() {
    if (!transferTarget || !changeQuote) return;
    setTransferLoading(true);
    setChangeError('');
    try {
      await api.put(`/api/bookings/${id}/change-room`, {
        unit_id: transferTarget,
        // Normal rate kept → 'difference'; a typed price → 'custom' with the
        // difference to what the guest pays now (Edit History still shows the
        // normal difference next to it).
        ...(chargeMode === 'complimentary' ? { charge: 'complimentary' }
          : Math.abs(parseFloat(customAmount) - changeQuote.next.total) < 1 ? { charge: 'difference' }
          : { charge: 'custom', amount: Math.round((parseFloat(customAmount) - changeQuote.current.total) * 100) / 100 }),
        reason: changeReason.trim(),
      });
      setTransferring(false);
      setFolio(null);
      setEstimate(null);
      load();
    } catch (err) {
      setChangeError(err.response?.data?.error || 'Could not change the room');
    } finally {
      setTransferLoading(false);
    }
  }

  function openAmend() {
    setAmendCheckIn(booking.check_in_date?.slice(0, 10) || '');
    setAmendCheckOut(booking.check_out_date?.slice(0, 10) || '');
    setAmendAvailability(null);
    setAmendQuote(null);
    setAmendCharge('difference');
    setAmendCustom('');
    setAmendReason('');
    setAmendError('');
    setAmending(true);
  }

  useEffect(() => {
    if (!amending || !amendCheckIn || !amendCheckOut) return;
    if (new Date(amendCheckOut) <= new Date(amendCheckIn)) { setAmendAvailability(null); return; }
    let cancelled = false;
    setAmendChecking(true);
    api.get('/api/bookings/availability', {
      params: { unit_id: booking.unit_id, check_in: amendCheckIn, check_out: amendCheckOut, exclude_booking_id: id },
    }).then(r => { if (!cancelled) setAmendAvailability(r.data); })
      .catch(() => { if (!cancelled) setAmendAvailability(null); })
      .finally(() => { if (!cancelled) setAmendChecking(false); });
    setAmendQuote(null);
    api.get(`/api/bookings/${id}/dates/quote`, { params: { check_in: amendCheckIn, check_out: amendCheckOut } })
      .then(r => { if (!cancelled) { setAmendQuote(r.data); setAmendCustom(String(Math.round(r.data.new.total))); setAmendCharge('difference'); } })
      .catch(() => { if (!cancelled) setAmendQuote(null); });
    return () => { cancelled = true; };
  }, [amending, amendCheckIn, amendCheckOut]);

  async function doAmendDates() {
    setAmendLoading(true);
    try {
      await api.put(`/api/bookings/${id}/dates`, {
        check_in_date: amendCheckIn, check_out_date: amendCheckOut,
        // Suggested price kept → 'difference'; a typed price → 'custom' with the
        // difference to the current price (same as Change Room).
        ...(amendCharge === 'complimentary' ? { charge: 'complimentary' }
          : Math.abs(parseFloat(amendCustom) - amendQuote.new.total) < 1 ? { charge: 'difference' }
          : { charge: 'custom', amount: Math.round((parseFloat(amendCustom) - amendQuote.old.total) * 100) / 100 }),
        reason: amendReason.trim(),
      });
      setAmending(false);
      setFolio(null);
      setEstimate(null);
      load();
    } catch (err) {
      setAmendError(err.response?.data?.error || 'Failed to amend dates');
    } finally {
      setAmendLoading(false);
    }
  }

  // "Edit Details" covers every plain field PUT /api/bookings/:id already
  // accepts with no availability/conflict checking involved — Source,
  // Guests, Purpose of Stay, Special Requests, Internal Notes, Bed
  // Preference. Deliberately excludes total_amount (money stays under
  // Payment Tracking, same convention Amend Dates already notes) and
  // status (has its own dedicated Check In/Confirm/Cancel/No-Show flows
  // that shouldn't be bypassed by a generic field edit). Dates and unit
  // stay their own separate flows (Amend Dates / Transfer Room) since
  // those genuinely need availability checking and folio reposting, not
  // just a field update.
  function openEditDetails() {
    setEditDetailsForm({
      source: booking.source,
      num_guests: booking.num_guests,
      purpose_of_stay: booking.purpose_of_stay || '',
      special_requests: booking.special_requests || '',
      internal_notes: booking.internal_notes || '',
      bed_preference: booking.bed_preference || '',
    });
    setEditAgent(agentValueFromBooking(booking));
    setEditingDetails(true);
  }

  async function doEditDetails() {
    setEditDetailsLoading(true);
    try {
      await api.put(`/api/bookings/${id}`, { ...editDetailsForm, ...agentBody(editAgent) });
      setEditingDetails(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update booking details');
    } finally {
      setEditDetailsLoading(false);
    }
  }

  // Owner-only correction of a wrongly-entered price. The server recomputes
  // everything derived from it (room/F&B split, posted folio nights, pending
  // deposit/balance lines, discount) — see PUT /api/bookings/:id/price.
  function openEditPrice() {
    setPriceForm({ total_amount: String(parseFloat(booking.total_amount) || ''), reason: '', received_was_typo: null });
    setPriceError('');
    setPriceResult(null);
    setEditingPrice(true);
  }

  async function doEditPrice() {
    setPriceError('');
    setPriceLoading(true);
    try {
      const { data } = await api.put(`/api/bookings/${id}/price`, {
        total_amount: parseFloat(priceForm.total_amount),
        reason: priceForm.reason.trim(),
        ...(priceForm.received_was_typo !== null ? { received_was_typo: priceForm.received_was_typo } : {}),
      });
      setPriceResult(data);
      setFolio(null);
      setEstimate(null);
      load();
    } catch (err) {
      setPriceError(err.response?.data?.error || 'Failed to change the price');
    } finally {
      setPriceLoading(false);
    }
  }

  // Point this booking at the guest actually staying (booked by an agent,
  // company or group contact under another name). Room / TV Display,
  // Registration Card and the police Guest Report follow the booking's guest.
  function openChangeGuest() {
    setGuestError('');
    setChangingGuest(false); // open, nothing picked yet
  }

  async function doChangeGuest() {
    if (!changingGuest) return;
    setGuestSaving(true);
    setGuestError('');
    try {
      await api.put(`/api/bookings/${id}/guest`, changingGuest.guest_id
        ? { guest_id: changingGuest.guest_id }
        : { new_guest: changingGuest.new_guest });
      setChangingGuest(null);
      load();
    } catch (err) {
      setGuestError(err.response?.data?.error || 'Could not change the guest');
    } finally {
      setGuestSaving(false);
    }
  }

  async function markNoShow() {
    if (!confirm('Mark this booking as a no-show? The guest never checked in.')) return;
    try {
      await api.put(`/api/bookings/${id}/no-show`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to mark as no-show');
    }
  }

  async function undoNoShow() {
    if (!confirm('Put this booking back? Use this when the guest did arrive (or is still coming). The status goes back to Pending / Deposit Paid / Confirmed from its payments.')) return;
    try {
      await api.put(`/api/bookings/${id}/undo-no-show`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not undo the no-show');
    }
  }

  async function callRoomAction() {
    try {
      await callRoom({ id: booking.unit_id, name: booking.unit_name });
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Could not place call');
    }
  }

  function openMessage() {
    setMessageBody('');
    setMessaging(true);
  }

  async function doSendMessage() {
    if (!messageBody.trim()) return;
    setSendingMessage(true);
    try {
      await api.post(`/api/bookings/${id}/message`, { body: messageBody.trim() });
      setMessaging(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send message');
    }
    setSendingMessage(false);
  }

  function waLink() {
    const msg = encodeURIComponent(`Hi ${booking.guest_name}! 🌿 Thank you for booking at ${branding?.name || 'our hotel'}${branding?.area ? `, ${branding.area}` : ''}.\n\nBooking details:\n📍 Unit: ${booking.unit_name}\n📅 Check-in: ${booking.check_in_date?.slice(0,10)}\n📅 Check-out: ${booking.check_out_date?.slice(0,10)}\n🌙 ${booking.nights} nights\n💰 Total: ${fmtIDR(booking.total_amount)}\n\nWe look forward to welcoming you! 🌄`);
    const rawWa = (booking.guest_whatsapp || '').trim();
    let waNum = rawWa.replace(/\D/g, '');
    if (!rawWa.startsWith('+')) {
      if (waNum.startsWith('0')) waNum = '62' + waNum.slice(1);
      else if (!waNum.startsWith('62')) waNum = '62' + waNum;
    }
    window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
  }

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!booking) return <div className="alert alert-error">Booking not found</div>;

  // Room payment lines. Usually one deposit + one balance, but a price
  // correction on a fully-paid booking adds a second balance line for the
  // difference — so render and total every line, not just the first.
  const roomPaymentLines = (booking.payments || []).filter(p => (p.type === 'deposit' || p.type === 'balance') && parseFloat(p.amount) > 0);
  const roomPaid = roomPaymentLines.filter(p => p.status === 'received').reduce((s, p) => s + parseFloat(p.amount), 0);
  const bookingNet = parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0);
  const pendingBalance = roomPaymentLines
    .filter(p => p.type === 'balance' && p.status !== 'received')
    .reduce((s, p) => s + parseFloat(p.amount), 0);
  // Billed to the booking's agent at checkout (city ledger, migration 084).
  const cityLedgerSource = CITY_LEDGER.includes(booking.agent_payment_status);
  const bookingCommission = booking.agent_id && HAS_COMMISSION.includes(booking.agent_payment_status)
    ? (commissionText(booking.commission_type, booking.commission_value)
        ? `${commissionText(booking.commission_type, booking.commission_value)} (this booking)`
        : commissionText(booking.agent_commission_type, booking.agent_commission_value))
    : '';

  // Modify Booking (moderate consequence) and Danger Zone (rare, destructive)
  // stay collapsed behind ⋮, visually separated by a divider — Communication
  // (Call/Message/WhatsApp) is high-frequency enough to live as visible icon
  // buttons instead, and Download earns its own always-visible button since
  // it's a different kind of action (produces a guest-facing document).
  const modifyItems = [
    booking.status === 'no_show' &&
      { label: 'Undo No-Show', icon: '↩️', onClick: undoNoShow, hint: 'The guest did arrive — put the booking back' },
    // A group room can have its own dates too (the group page moves them all).
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Amend Dates', icon: '📅', onClick: openAmend },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Change Room', icon: '🔀', onClick: openTransfer },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Edit Details', icon: '📝', onClick: openEditDetails },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Change Guest', icon: '👤', onClick: openChangeGuest },
    isOwner && !['cancelled', 'no_show'].includes(booking.status) &&
      !['invoiced', 'paid'].includes(booking.folio_status) && !booking.complimentary_scope &&
      { label: 'Edit Price', icon: '💰', onClick: openEditPrice },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) && !booking.folio_status &&
      !booking.complimentary_scope &&
      { label: booking.complimentary_request_pending ? 'Complimentary — waiting for approval' : 'Make Complimentary', icon: '🎁',
        onClick: () => { setCompInitial(null); setCompMode('grant'); } },
    booking.complimentary_scope && can('grant_complimentary') &&
      ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Remove Complimentary', icon: '🎁', onClick: () => { setCompInitial(null); setCompMode('remove'); } },
  ].filter(Boolean);
  const dangerItems = [
    ['pending', 'deposit_paid', 'confirmed'].includes(booking.status) &&
      { label: 'Mark No-Show', icon: '🚫', onClick: markNoShow },
    ['pending', 'deposit_paid', 'confirmed'].includes(booking.status) &&
      { label: 'Cancel Booking', icon: '✕', onClick: cancel, danger: true },
  ].filter(Boolean);
  const moreItems = [
    ...modifyItems,
    modifyItems.length > 0 && dangerItems.length > 0 && { divider: true },
    ...dangerItems,
  ];

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <PageHeader
        back={{ to: '/reservations', label: 'Reservations' }}
        kind={`Booking #${id.slice(0, 8).toUpperCase()}`}
        title={booking.guest_name}
        meta={[
          `Room ${booking.unit_name}`,
          `${fmtShortDate(booking.check_in_date)} → ${fmtShortDate(booking.check_out_date)} ${String(booking.check_out_date).slice(0, 4)}`,
          `${booking.nights} night${booking.nights === 1 ? '' : 's'}`,
          `${booking.num_guests} guest${booking.num_guests === 1 ? '' : 's'}`,
        ]}
        badge={<span className={`badge badge-${STATUS_BADGE[booking.status] || 'gray'}`}>{STATUS_LABEL[booking.status] || booking.status}</span>}
        actions={<>
          {(() => {
            const isOTA = sources.find(s => s.id === booking.source)?.is_ota;
            const canCheckin = isOTA
              ? ['pending','deposit_paid','confirmed'].includes(booking.status)
              : booking.status === 'confirmed';
            return canCheckin && (
              <button className="btn btn-primary" onClick={() => nav(`/checkin?checkin=${id}`)}>Check In</button>
            );
          })()}
          {booking.status === 'checked_in' && (
            <button className="btn btn-primary" onClick={openCheckout}>Check Out</button>
          )}
          {booking.status === 'pending' &&
            parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0) === 0 && (
            <button className="btn btn-primary" onClick={confirmBooking}>Confirm Booking</button>
          )}
          <div className="icon-group">
            {hasModule('calling') && (
              <button title="Call Room" onClick={callRoomAction}>📞</button>
            )}
            <button title="Send Message" onClick={openMessage}>✉️</button>
            {booking.guest_whatsapp && (
              <button title="WhatsApp Guest" onClick={waLink}>💬</button>
            )}
            <ActionMenu
              bare
              icon="⬇"
              ariaLabel="Download documents"
              items={[
                { label: 'Registration Card', icon: '📝', hint: 'Printable check-in form for the guest to sign', onClick: () => setShowRegCard(true) },
                { divider: true },
                // OTA / agent stay (source Publish Rate off): an accounting copy
                // with everything, and a guest copy without the room rate.
                // Every receipt for this stay (payments that have one), newest first.
                ...(() => {
                  const withReceipt = (booking.payments || [])
                    .filter(p => p.receipt_kind && p.status === 'received')
                    .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
                  if (!withReceipt.length) return [];
                  return [
                    ...withReceipt.map(p => ({
                      label: `Receipt · ${p.received_at ? new Date(p.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''} · ${fmtIDR(p.amount)}`,
                      icon: '🖨',
                      hint: `${{ lines: 'Items paid on their own', sale: 'Extra paid at the Sales till', activity: 'Activity paid directly' }[p.receipt_kind]} · ${(paymentMethods.find(m => m.id === p.method)?.label) || p.method}`,
                      onClick: () => downloadPaymentReceipt(p),
                    })),
                    { divider: true },
                  ];
                })(),
                ...(booking.source_publish_rate === false ? [
                  { label: 'Invoice — accounting', icon: '🧾', hint: 'Everything, incl. the room rate — for accounting / the agent', onClick: () => downloadInvoice(false) },
                  { label: 'Invoice — guest copy', icon: '🧾', hint: `Room shown as arranged by ${booking.arranged_by || booking.source_label || 'the agent'}, without its rate; the guest's own charges and payments`, onClick: () => downloadInvoice(true) },
                  { divider: true },
                  { label: 'Pro Forma — accounting', icon: '📋', hint: 'Estimate for the whole stay, incl. the room rate', onClick: () => downloadProforma(false) },
                  { label: 'Pro Forma — guest copy', icon: '📋', hint: 'Estimate of the guest\'s own charges, room rate hidden', onClick: () => downloadProforma(true) },
                ] : [
                  { label: 'Invoice', icon: '🧾', hint: 'What has actually been charged so far', onClick: () => downloadInvoice(false) },
                  { divider: true },
                  { label: 'Pro Forma', icon: '📋', hint: 'Estimate — projected total for the whole stay', onClick: () => downloadProforma(false) },
                ]),
              ]}
            />
          </div>
          {moreItems.filter(Boolean).length > 0 && <div className="header-divider" />}
          {moreItems.filter(Boolean).length > 0 && <ActionMenu items={moreItems} />}
        </>}
      />

      {booking.group && (
        <div className="alert alert-success mb-3" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Part of a group booking ({booking.group.room_count} rooms)</span>
          <Link to={`/reservations/group/${booking.group.id}`} className="btn btn-sm btn-secondary">View Group →</Link>
        </div>
      )}

      <div className="tab-bar">
        <button className={`tab-bar-item${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        <button className={`tab-bar-item${tab === 'folio' ? ' active' : ''}`} onClick={() => setTab('folio')}>Folio</button>
        {hasModule('activities') && <button className={`tab-bar-item${tab === 'activities' ? ' active' : ''}`} onClick={() => setTab('activities')}>Activities</button>}
      </div>

      {tab === 'details' && (
      <>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="card">
          <div className="card-title">Guest</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{booking.guest_name}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{booking.nationality}</div>
          {booking.guest_whatsapp && <div style={{ fontSize: 13 }}>📱 {booking.guest_whatsapp}</div>}
          {booking.guest_email && <div style={{ fontSize: 13 }}>✉️ {booking.guest_email}</div>}
          <div className="mt-2">
            <Link to={`/guests/${booking.guest_id}`} className="btn btn-sm btn-secondary">View Profile</Link>
          </div>
          <GuestIdDocument guestId={booking.guest_id} hasDocument={!!booking.guest_has_id_document} onChanged={load} compact />
        </div>

        <div className="card">
          <div className="card-title">Stay Details</div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Unit</span><span style={{ fontWeight: 600 }}>{booking.unit_name}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Check-in</span><span>{booking.check_in_date?.slice(0,10)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Check-out</span><span>{booking.check_out_date?.slice(0,10)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Nights</span><span>{booking.nights}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Guests</span><span>{booking.num_guests}</span>
          </div>
          {(booking.rate_plan_code || booking.rate_plan_name) && (
            <div className="flex-between" style={{ marginBottom: 6 }}>
              <span className="text-muted">Rate Plan</span>
              <span>{booking.rate_plan_code}{booking.rate_plan_name ? ` — ${booking.rate_plan_name}` : ''}</span>
            </div>
          )}
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Bed</span>
            <span>
              {booking.bed_preference
                ? `${booking.bed_preference === 'twin' ? 'Twin' : booking.bed_preference === 'double' ? 'Double' : booking.bed_preference} (requested)`
                : booking.bed_config === 'twin' ? 'Twin'
                : booking.bed_config === 'twin_or_double' ? 'Twin or double'
                : booking.bed_config === 'other' ? '—'
                : 'Double'}
            </span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Source</span>
            <SourceBadge sourceId={booking.source} />
          </div>
          {booking.agent_id && (
            <div className="flex-between" style={{ marginBottom: 6, gap: 8, alignItems: 'flex-start' }}>
              <span className="text-muted">{agentRoleLabel(booking.agent_type)}</span>
              <span style={{ textAlign: 'right' }}>
                {isOwner ? <Link to={`/agents/${booking.agent_id}`} style={{ fontWeight: 600 }}>{booking.agent_name}</Link> : <b>{booking.agent_name}</b>}
                {bookingCommission && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Commission {bookingCommission}</div>}
              </span>
            </div>
          )}
          <div className="flex-between">
            <span className="text-muted">Status</span>
            <span className={`badge badge-${STATUS_BADGE[booking.status]||'gray'}`}>{STATUS_LABEL[booking.status]||booking.status}</span>
          </div>
          {booking.complimentary_scope && (
            <div className="flex-between" style={{ marginTop: 6, gap: 8, alignItems: 'flex-start' }}>
              <span className="text-muted">Complimentary</span>
              <span style={{ textAlign: 'right' }}>
                <span className="badge badge-green">🎁 {COMP_LABEL[booking.complimentary_scope]}</span>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {booking.complimentary_reason}
                  {booking.complimentary_approved_by && booking.complimentary_approved_by !== booking.complimentary_by_name
                    ? ` · approved by ${booking.complimentary_approved_by} (code)`
                    : booking.complimentary_by_name ? ` · by ${booking.complimentary_by_name}` : ''}
                </div>
                {parseFloat(booking.complimentary_night_value) > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Value {fmtIDR(parseFloat(booking.complimentary_night_value) * booking.nights)} before tax
                  </div>
                )}
              </span>
            </div>
          )}
          {!booking.complimentary_scope && booking.complimentary_request_pending && (
            <div className="flex-between" style={{ marginTop: 6, gap: 8 }}>
              <span className="text-muted">Complimentary</span>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCompInitial(null); setCompMode('grant'); }}>
                ⏳ Waiting for approval
              </button>
            </div>
          )}
          {AGENT_BILLING[booking.folio_status] && (
            <div className="flex-between" style={{ marginTop: 6, gap: 8 }}>
              <span className="text-muted">Agent billing</span>
              <span style={{ textAlign: 'right' }}>
                <span className={`badge badge-${AGENT_BILLING[booking.folio_status].badge}`}>{AGENT_BILLING[booking.folio_status].label}</span>
                {booking.agent_invoice_number && <span style={{ fontSize: 12, marginLeft: 6 }}>{booking.agent_invoice_number}</span>}
                {booking.folio_status === 'invoiced' && parseFloat(booking.agent_paid_amount) > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtIDR(booking.agent_paid_amount)} received so far</div>
                )}
                {isOwner && (
                  <div style={{ fontSize: 12 }}>{booking.agent_id ? <Link to={`/agents/${booking.agent_id}`}>Agent statement →</Link> : <span className="text-muted">No agent on this booking</span>}</div>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-3" id="payment-tracking" style={{ scrollMarginTop: 16 }}>
        <div className="card-title">Payment Tracking</div>
        {parseFloat(booking.fnb_revenue || 0) > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Net revenue split — Room {fmtIDR(booking.room_revenue)} · F&amp;B {fmtIDR(booking.fnb_revenue)}
          </div>
        )}
        {parseFloat(booking.discount_amount) > 0 && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--cream, #fffbeb)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className="text-muted">Rack Rate</span>
              <span>{fmtIDR(booking.total_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4, color: 'var(--color-success, #16a34a)' }}>
              <span>
                Discount{booking.discount_type === 'percentage' ? ` (${booking.discount_value}%)` : ' (fixed)'}
              </span>
              <span>− {fmtIDR(booking.discount_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontSize: 14, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <span>Net Total</span>
              <span>{fmtIDR(parseFloat(booking.total_amount) - parseFloat(booking.discount_amount))}</span>
            </div>
          </div>
        )}
        <div className="grid-2">
          {roomPaymentLines.map(p => (
            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div className="flex-between mb-3">
                <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{p.type}</span>
                <span className={`badge badge-${p.status === 'received' ? 'green' : 'orange'}`}>{p.status}</span>
              </div>
              {p.status === 'pending' && p.notes && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 8 }}>{p.notes}</div>
              )}
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Amount</div>
              {editingAmount === p.id ? (
                <div className="flex gap-2 flex-center" style={{ marginBottom: 8 }}>
                  <input className="form-input" type="number" value={newAmount} autoFocus
                    style={{ maxWidth: 160 }} onChange={e => setNewAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveAmount(p)} />
                  <button className="btn btn-sm btn-primary" onClick={() => saveAmount(p)}>Save</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setEditingAmount(null)}>✕</button>
                </div>
              ) : (
                <div className="flex-center gap-2" style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 18 }}>{fmtIDR(p.amount)}</span>
                  {p.status === 'pending' && (
                    <button className="btn btn-icon btn-sm" title="Edit amount"
                      onClick={() => { setEditingAmount(p.id); setNewAmount(p.amount); }}>✏️</button>
                  )}
                </div>
              )}
              {p.status === 'received' ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  {/* received_at is a timestamp — show the local (Bali) date, not the UTC one */}
                  ✓ {p.method?.replace('_',' ')} · {p.received_at ? new Date(p.received_at).toLocaleDateString('en-CA') : ''}
                </div>
              ) : (
                <button className="btn btn-sm btn-primary mt-2" onClick={() => markPaid(p)}>Mark Received</button>
              )}
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="flex-between" style={{ fontWeight: 700 }}>
          <span>Total</span>
          <span>{fmtIDR(bookingNet)}</span>
        </div>
        {roomPaymentLines.length > 0 && (
          <>
            <div className="flex-between" style={{ fontSize: 13, marginTop: 6 }}>
              <span className="text-muted">Paid</span>
              <span>{fmtIDR(roomPaid)}</span>
            </div>
            {Math.abs(bookingNet - roomPaid) >= 1 && (
              <div className="flex-between" style={{ fontSize: 13, fontWeight: 700, marginTop: 4,
                color: roomPaid > bookingNet ? 'var(--color-danger, #dc2626)' : undefined }}>
                <span>{roomPaid > bookingNet ? 'Overpaid — refund to guest' : 'Balance due'}</span>
                <span>{fmtIDR(Math.abs(bookingNet - roomPaid))}</span>
              </div>
            )}
          </>
        )}
      </div>

      <StayExtrasCard booking={booking} openAdd={openAddItem}
        onBookActivity={hasModule('activities') ? startBookActivity : null}
        onChanged={() => { load(); if (folio) loadFolio(); }} />

      {booking.special_requests && (
        <div className="card mt-3">
          <div className="card-title">Special Requests</div>
          <p>{booking.special_requests}</p>
        </div>
      )}

      {booking.checkin_record && (
        <div className="card mt-3">
          <div className="card-title">Check-in / Check-out Record</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {booking.checkin_record.checkin_time && (
              <div className="flex-between" style={{ fontSize: 13 }}>
                <span className="text-muted">Checked in</span>
                <span>{new Date(booking.checkin_record.checkin_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            )}
            {booking.checkin_record.checkout_time && (
              <div className="flex-between" style={{ fontSize: 13 }}>
                <span className="text-muted">Checked out</span>
                <span>{new Date(booking.checkin_record.checkout_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            )}
            <div className="flex-between" style={{ fontSize: 13 }}>
              <span className="text-muted">ID captured</span>
              <span>{booking.checkin_record.id_captured ? '✓ Yes' : '— No'}</span>
            </div>
            {booking.checkin_record.condition_notes && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Unit condition notes</div>
                  <div style={{ fontSize: 13, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px' }}>
                    {booking.checkin_record.condition_notes}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="card mt-3">
        <div className="card-title">Staff Notes</div>
        {booking.notes?.map(n => (
          <div key={n.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.author_name} · {n.created_at?.slice(0,10)}</div>
            <div>{n.content}</div>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input className="form-input" placeholder="Add a note…" value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNote()} />
          <button className="btn btn-secondary" onClick={addNote}>Add</button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">Edit History</div>
        {booking.events?.length > 0 ? booking.events.map(ev => (
          <div key={ev.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {ev.author_name || 'System'} · {new Date(ev.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            <div style={{ fontSize: 13 }}>{ev.note}</div>
          </div>
        )) : (
          <div className="text-muted" style={{ fontSize: 13 }}>No changes logged yet.</div>
        )}
      </div>
      </>
      )}

      {tab === 'folio' && (
        <div className="card mt-3">
          <div className="card-title">Folio</div>

          {folioLoading && !folio ? <div className="text-muted">Loading…</div> : folio && (
            <>
              {estimate && (
                <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                    <span className="text-muted">Estimated Total (full stay)</span>
                    <span>{fmtIDR(shownTotal(estimate.total, estimate))}</span>
                  </div>
                  <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                    <span>Estimated Balance Due</span>
                    <span style={{ color: parseFloat(estimate.balance_due) > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                      {fmtIDR(shownTotal(estimate.balance_due, estimate))}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Projected for the whole stay: posted + not posted yet − paid. Use this to know what the guest actually still owes.
                  </div>
                  {parseFloat(estimate.balance_due) > 0 && !['cancelled', 'no_show'].includes(booking.status) && (
                    <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={openRecordPayment}>💳 Record Payment</button>
                  )}
                </div>
              )}
              {(() => {
                const roomSum = folio.charges.filter(c => c.type === 'room').reduce((s, c) => s + parseFloat(c.amount), 0);
                const fnbSum = folio.charges.filter(c => c.type === 'fnb').reduce((s, c) => s + parseFloat(c.amount), 0);
                if (roomSum + fnbSum === 0) return null;
                return (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Net revenue — Room {fmtIDR(roomSum)} · F&amp;B {fmtIDR(fnbSum)}
                  </div>
                );
              })()}
              <div className="flex-between" style={{ alignItems: 'baseline', marginBottom: 2 }}>
                <div className="card-title" style={{ fontSize: 13, margin: 0 }}>Posted</div>
                <span className="text-muted" style={{ fontSize: 11 }}>on the bill — see Balance due for what's unpaid</span>
              </div>
              <div style={{ marginBottom: 10 }}>
                {[
                  ['Accommodation', c => c.type === 'room' || c.type === 'addon'],
                  // 'fnb' = the rate plan's included meal (per-night, migration 044);
                  // a 'sale' (migration 049) is F&B only when it contains
                  // food/drinks (c.is_fnb from the server) — a front-desk extra
                  // like an extra bed (migration 067) goes under Other.
                  // Same grouping as server/routes/folio.js's invoice.
                  ['Food & Beverage', c => c.type === 'fnb' || (c.type === 'sale' && c.is_fnb)],
                  ['Other', c => c.type !== 'room' && c.type !== 'addon' && c.type !== 'fnb' && !(c.type === 'sale' && c.is_fnb)],
                ].map(([groupLabel, match]) => {
                  const lines = folio.charges.filter(match);
                  if (!lines.length) return null;
                  const grouped = folio.charges.some(c => c.type === 'room' || c.type === 'addon' || c.type === 'fnb' || c.type === 'sale');
                  return (
                    <div key={groupLabel}>
                      {grouped && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 2px' }}>
                          {groupLabel}
                        </div>
                      )}
                      {lines.map(c => (
                        <div key={c.id} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{c.description}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {c.type.replace('_', ' ')} · {parseFloat(c.quantity)} × {fmtIDR(lineShown(c.unit_price, c, folio))}
                              {c.tax_mode === 'included' && !folio.prices_include_tax && ' · tax & service included'}
                              {c.tax_mode === 'none' && ' · no tax or service'}
                              {c.posted_by_name && ` · ${c.posted_by_name}`}
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            {c.complimentary
                              ? <span title={`${fmtIDR(lineShown(c.amount, c, folio))} — complimentary stay, not charged`}><s className="text-muted">{fmtIDR(lineShown(c.amount, c, folio))}</s> <span className="badge badge-green">Free</span></span>
                              : <span style={{ fontWeight: 600 }}>{fmtIDR(lineShown(c.amount, c, folio))}</span>}
                            {c.paid_method && (
                              <span className="badge badge-green" title="Paid at the front desk — its payment is under Payments, so it isn't owed again">
                                Paid · {c.paid_method}
                              </span>
                            )}
                            {c.paid_payment_id && (
                              <button className="btn btn-icon btn-sm" title="Receipt for this payment" onClick={() => downloadLinesReceipt(c.paid_payment_id)}>🖨</button>
                            )}
                            <button className="btn btn-icon btn-sm" title="Void charge" onClick={() => voidCharge(c)}>🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {folio.charges.length === 0 && <div className="text-muted" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>Nothing posted yet.</div>}
              </div>

              {/* Prices incl. service & tax (migration 079): lines above are all-in, so just the total and what's inside it. */}
              {!folio.prices_include_tax && (parseFloat(folio.service_charge_rate) > 0 || parseFloat(folio.tax_rate) > 0) && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Subtotal</span><span>{fmtIDR(folio.subtotal)}</span>
                </div>
              )}
              {!folio.prices_include_tax && (parseFloat(folio.service_charge_rate) > 0 || parseFloat(folio.tax_rate) > 0) && parseFloat(folio.untaxed_subtotal) > 0 && (
                <div className="text-muted" style={{ fontSize: 11, marginBottom: 4, textAlign: 'right' }}>
                  Service &amp; tax on {fmtIDR(folio.subtotal - folio.untaxed_subtotal)} — activities priced tax-included / without tax excluded
                </div>
              )}
              {!folio.prices_include_tax && parseFloat(folio.service_charge_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Service Charge ({folio.service_charge_rate}%)</span><span>{fmtIDR(folio.service_charge_amount)}</span>
                </div>
              )}
              {!folio.prices_include_tax && parseFloat(folio.tax_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Tax ({folio.tax_rate}%)</span><span>{fmtIDR(folio.tax_amount)}</span>
                </div>
              )}
              <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 12 }}>
                <span>Total posted</span><span>{fmtIDR(shownTotal(folio.total, folio))}</span>
              </div>
              {folio.prices_include_tax && includesText(folio, fmtIDR) && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: -6, marginBottom: 10, textAlign: 'right' }}>{includesText(folio, fmtIDR)}</div>
              )}

              {!['cancelled', 'no_show'].includes(booking.status) && (
                <button className="btn btn-secondary btn-sm" onClick={() => setAddingItem(true)}
                  title="Extra bed, transport, laundry… or Other charge for anything not in the list">+ Add item</button>
              )}
              {addingItem && (
                <AddStayItemModal booking={booking} onClose={() => setAddingItem(false)}
                  onBookActivity={hasModule('activities') ? startBookActivity : null}
                  onDone={() => { setAddingItem(false); load(); loadFolio(); }} />
              )}

              {notCharged.length > 0 && <div className="divider" />}
              <NotChargedYet rows={notCharged} rates={estimate || folio} />

              <div className="divider" />
              {folio.payments.filter(p => p.status === 'received').length > 0 && (
                <>
                  <div className="card-title" style={{ fontSize: 13 }}>Payments Received</div>
                  {folio.payments.filter(p => p.status === 'received').map(p => (
                    <div key={p.id} className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                      <span className="text-muted" style={{ textTransform: 'capitalize' }}>{p.type === 'incidental' ? 'Extras (paid at desk)' : p.type} · {p.method?.replace('_', ' ')}</span>
                      <span className="flex gap-2 items-center">
                        {p.receipt_kind && (
                          <button className="btn btn-icon btn-sm" style={{ padding: '0 6px' }} title="Print the receipt for this payment" onClick={() => downloadPaymentReceipt(p)}>🖨</button>
                        )}
                        {fmtIDR(p.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {(() => {
                // Charged − paid, + what isn't charged yet = the whole-stay
                // balance (the Estimated Balance Due up top).
                const posted = shownTotal(folio.balance_due, folio);
                const due = estimate ? shownTotal(estimate.balance_due, estimate) : posted;
                const color = due > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)';
                return (
                  <div style={{ marginTop: folio.payments.some(p => p.status === 'received') ? 12 : 0 }}>
                    {notCharged.length > 0 && (
                      <>
                        <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                          <span className="text-muted">Posted − paid</span><span>{fmtIDR(posted)}</span>
                        </div>
                        <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                          <span className="text-muted">+ Not posted yet</span><span>{fmtIDR(notChargedTotal(notCharged, estimate || folio))}</span>
                        </div>
                      </>
                    )}
                    <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, borderTop: '2px solid var(--border)', paddingTop: 6 }}>
                      <span>Balance due</span><span style={{ color }}>{fmtIDR(due)}</span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {tab === 'activities' && (
        <div className="card mt-3">
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Activity Bookings</div>
            {['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) && (
              <button className="btn btn-sm btn-secondary" onClick={() => setBookingActivity(true)}>+ Book activity</button>
            )}
          </div>
          {!activityBookings ? <div className="text-muted">Loading…</div> : activityBookings.length === 0 ? (
            <div className="text-muted" style={{ padding: '10px 0' }}>No activity bookings for this stay yet. Book one here, or the guest can request one from the Room Display.</div>
          ) : (
            activityBookings.map(ab => (
              <div key={ab.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{ab.activity_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {String(ab.scheduled_date).slice(0, 10)}{ab.scheduled_time ? ` ${ab.scheduled_time.slice(0, 5)}` : ''} · {ab.num_participants} pax
                    {' · '}{ab.payment_method === 'room_charge' ? 'charged to room' : ab.payment_method ? `paid · ${paymentMethods.find(m => m.id === ab.payment_method)?.label || ab.payment_method}` : 'not paid yet'}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {!ab.payment_method && !['cancelled', 'no_show'].includes(ab.status) && (
                    <button className="btn btn-sm btn-primary" onClick={() => setPayingActivity({ ...ab, booking_id: ab.booking_id || booking.id })}>Take payment</button>
                  )}
                  <span style={{ fontWeight: 600 }}>{fmtIDR(activityPaidTotal(ab))}</span>
                  <span className={`badge badge-${ACTIVITY_STATUS_BADGE[ab.status]}`}>{ab.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {payingActivity && (
        <ActivityPaymentModal activityBooking={payingActivity} onClose={() => setPayingActivity(null)}
          onDone={() => { setPayingActivity(null); loadActivityBookings(); loadFolio(); load(); }} />
      )}

      {bookingActivity && (
        <ActivityBookingModal reservation={booking} onClose={() => setBookingActivity(false)}
          onDone={() => { setBookingActivity(false); loadActivityBookings(); if (folio) loadFolio(); load(); }} />
      )}

      {amending && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Amend Dates — {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setAmending(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                {booking.unit_name} · currently {booking.check_in_date?.slice(0,10)} → {booking.check_out_date?.slice(0,10)}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Check-in</label>
                  <input className="form-input" type="date" value={amendCheckIn} onChange={e => {
                    // keep the number of nights when check-in moves
                    const n = amendCheckIn && amendCheckOut ? nightsBetween(amendCheckIn, amendCheckOut) : 1;
                    setAmendCheckIn(e.target.value);
                    if (e.target.value && n > 0) setAmendCheckOut(addDaysYmd(e.target.value, n));
                  }} />
                </div>
                <div className="form-group" style={{ maxWidth: 100 }}>
                  <label className="form-label">Nights</label>
                  <input className="form-input" type="number" min={1} max={365}
                    value={amendCheckIn && amendCheckOut && amendCheckOut > amendCheckIn ? nightsBetween(amendCheckIn, amendCheckOut) : ''}
                    onChange={e => { const n = parseInt(e.target.value, 10); if (n >= 1 && amendCheckIn) setAmendCheckOut(addDaysYmd(amendCheckIn, n)); }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Check-out</label>
                  <input className="form-input" type="date" value={amendCheckOut} onChange={e => setAmendCheckOut(e.target.value)} />
                </div>
              </div>
              {amendCheckOut && amendCheckIn && new Date(amendCheckOut) <= new Date(amendCheckIn) && (
                <div className="alert alert-error">Check-out must be after check-in.</div>
              )}
              {amendChecking && <div className="text-muted" style={{ fontSize: 13 }}>Checking availability…</div>}
              {!amendChecking && amendAvailability && !amendAvailability.available && (
                <div className="alert alert-error">
                  Unit is not available for these dates — conflicts with {amendAvailability.conflicts.map(c => c.guest_name).join(', ')}.
                </div>
              )}
              {amendQuote && (amendCheckIn !== booking.check_in_date?.slice(0,10) || amendCheckOut !== booking.check_out_date?.slice(0,10)) && (() => {
                const q = amendQuote;
                const newPrice = parseFloat(amendCustom);
                const priceOk = Number.isFinite(newPrice) && newPrice >= 0;
                const diff = priceOk ? Math.round((newPrice - q.old.total) * 100) / 100 : 0;
                const edited = priceOk && Math.abs(newPrice - q.new.total) >= 1;
                const charge = amendCharge === 'complimentary' ? 0 : diff;
                return (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: '12px 0' }}>
                    <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Price for the stay, incl. meals, service &amp; tax</div>
                    <div className="flex-between" style={{ fontSize: 13 }}>
                      <span>Current dates · {q.old.nights} night{q.old.nights === 1 ? '' : 's'} — booked price</span><span>{fmtIDR(q.old.total)}</span>
                    </div>
                    <div className="flex-between" style={{ fontSize: 13, alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span>New dates · {q.new.nights} night{q.new.nights === 1 ? '' : 's'} — new price</span>
                      <input className="form-input" type="number" min="0" value={amendCustom}
                        onChange={e => setAmendCustom(e.target.value)} disabled={amendCharge === 'complimentary'}
                        style={{ maxWidth: 160, padding: '4px 8px', textAlign: 'right' }} aria-label="Price for the new dates" />
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>
                      {edited
                        ? <>Suggested {fmtIDR(q.new.total)} · <a href="#" onClick={e => { e.preventDefault(); setAmendCustom(String(Math.round(q.new.total))); }}>use suggested</a></>
                        : <>At the booked {fmtIDR(q.new.per_night)}/night</>}
                      {' · '}normal rate would be {fmtIDR(q.new.normal_total)}
                    </div>
                    <div className="flex-between" style={{ fontSize: 14, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                      <span>Difference</span><span>{diff >= 0 ? '+' : '−'}{fmtIDR(Math.abs(diff))}</span>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                      <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
                        <input type="radio" name="amendCharge" checked={amendCharge === 'difference'} onChange={() => setAmendCharge('difference')} />
                        {diff > 0 ? `Charge the difference (+${fmtIDR(diff)})`
                          : diff < 0 ? `Give the difference back as credit (−${fmtIDR(-diff)})`
                          : 'No price change'}
                      </label>
                      <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
                        <input type="radio" name="amendCharge" checked={amendCharge === 'complimentary'} onChange={() => setAmendCharge('complimentary')} />
                        Keep the current price (no charge)
                      </label>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                      {charge > 0 ? `The booking price goes up by ${fmtIDR(charge)} — added to the balance still to pay.`
                        : charge < 0 ? `The booking price goes down by ${fmtIDR(-charge)}. If the guest already paid more, it shows as a credit to refund.`
                        : 'The booking price stays the same.'}
                    </div>
                  </div>
                );
              })()}
              <div className="form-group">
                <label className="form-label">Reason *</label>
                <input className="form-input" value={amendReason} onChange={e => setAmendReason(e.target.value)} placeholder="e.g. Guest extended 2 nights" />
              </div>
              {amendError && <div className="alert alert-error">{amendError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAmending(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doAmendDates}
                disabled={
                  amendLoading || amendChecking ||
                  !amendCheckIn || !amendCheckOut ||
                  new Date(amendCheckOut) <= new Date(amendCheckIn) ||
                  (amendCheckIn === booking.check_in_date?.slice(0,10) && amendCheckOut === booking.check_out_date?.slice(0,10)) ||
                  (amendAvailability && !amendAvailability.available) ||
                  !amendQuote || !amendReason.trim() ||
                  (amendCharge !== 'complimentary' && !(parseFloat(amendCustom) >= 0))
                }
              >
                {amendLoading ? 'Saving…' : 'Save New Dates'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingDetails && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Edit Details — {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setEditingDetails(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Source</label>
                  <select className="form-select" value={editDetailsForm.source || ''} onChange={e => setEditDetailsForm(f => ({ ...f, source: e.target.value }))}>
                    {sources.filter(s => s.is_active || s.id === booking.source).map(s => <option key={s.id} value={s.id}>{s.label}{!s.is_active ? ' (inactive)' : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Number of Guests</label>
                  <input className="form-input" type="number" min="1" value={editDetailsForm.num_guests ?? ''}
                    onChange={e => setEditDetailsForm(f => ({ ...f, num_guests: e.target.value }))} />
                </div>
              </div>
              {editAgent && (booking.folio_status
                ? <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>Agent: <b>{booking.agent_name || '—'}</b> — already billed to the agent, so it can't be changed here.</div>
                : <BookingAgentFields value={editAgent} onChange={setEditAgent} sourceType={sources.find(s => s.id === editDetailsForm.source)?.source_type}
                    hint={AGENT_SOURCE_TYPES.includes(sources.find(s => s.id === editDetailsForm.source)?.source_type) && !editAgent.agent ? 'This source usually comes with an agent — pick one so it shows in Agent Billing.' : null} />)}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Bed Preference</label>
                  <select className="form-select" value={editDetailsForm.bed_preference || ''} onChange={e => setEditDetailsForm(f => ({ ...f, bed_preference: e.target.value }))}>
                    {EDIT_BED_PREFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Purpose of Stay</label>
                  <input className="form-input" value={editDetailsForm.purpose_of_stay || ''}
                    onChange={e => setEditDetailsForm(f => ({ ...f, purpose_of_stay: e.target.value }))} placeholder="e.g. Leisure" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Special Requests</label>
                <textarea className="form-textarea" value={editDetailsForm.special_requests || ''}
                  onChange={e => setEditDetailsForm(f => ({ ...f, special_requests: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Internal Notes</label>
                <textarea className="form-textarea" value={editDetailsForm.internal_notes || ''}
                  onChange={e => setEditDetailsForm(f => ({ ...f, internal_notes: e.target.value }))} />
              </div>
              <div className="alert alert-success" style={{ marginTop: 12 }}>
                Dates and room assignment aren't edited here — use Amend Dates / Transfer Room for those.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingDetails(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doEditDetails} disabled={editDetailsLoading || !editDetailsForm.num_guests}>
                {editDetailsLoading ? 'Saving…' : 'Save Details'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingPrice && (() => {
        // Preview only — the server does the real calculation (and may differ
        // by a rupiah or two from rounding the room/F&B split).
        const oldNet = parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0);
        const newGross = parseFloat(priceForm.total_amount);
        const dValue = parseFloat(booking.discount_value || 0);
        // A group room with a fixed group discount keeps its prorated share.
        const keepShare = !!booking.group && booking.discount_type !== 'percentage';
        const newDiscount = !Number.isFinite(newGross) ? 0
          : keepShare ? Math.min(parseFloat(booking.discount_amount || 0), newGross)
          : booking.discount_type === 'fixed' ? Math.min(dValue, newGross)
          : booking.discount_type === 'percentage' ? Math.round(newGross * dValue / 100)
          : 0;
        const newNet = Number.isFinite(newGross) ? newGross - newDiscount : null;
        const received = roomPaymentLines.filter(p => p.status === 'received').reduce((s, p) => s + parseFloat(p.amount), 0);
        const overReceived = newNet !== null && received > 0 && newNet < received;
        const valid = Number.isFinite(newGross) && newGross >= 0 && priceForm.reason.trim().length > 0
          && (!overReceived || priceForm.received_was_typo !== null);
        return (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <div className="modal-title">Edit Price — {booking.guest_name}</div>
                <button className="btn btn-icon" onClick={() => setEditingPrice(false)}>✕</button>
              </div>
              {priceResult ? (
                <>
                  <div className="modal-body">
                    <div className="alert alert-success" style={{ marginBottom: 12 }}>
                      Price changed from {fmtIDR(priceResult.old_total)} to <strong>{fmtIDR(priceResult.new_total)}</strong>.
                      {priceResult.received_corrected && ' The received payment was corrected to match.'}
                    </div>
                    {priceResult.credit > 0 ? (
                      <div className="alert alert-error">
                        The guest has already paid {fmtIDR(priceResult.received)} — <strong>{fmtIDR(priceResult.credit)}</strong> more than the new price.
                        It shows as a credit on the folio. Refunds aren't handled in the system yet, so return it by hand.
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Payment lines, the folio and the revenue figures now use the new price.
                      </div>
                    )}
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-primary" onClick={() => setEditingPrice(false)}>Done</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="modal-body">
                    <div className="flex-between" style={{ fontSize: 13, marginBottom: 12 }}>
                      <span className="text-muted">Current price{parseFloat(booking.discount_amount) > 0 ? ' (after discount)' : ''}</span>
                      <strong>{fmtIDR(oldNet)}</strong>
                    </div>
                    <div className="form-group">
                      <label className="form-label">New total for the whole stay ({booking.nights} night{booking.nights === 1 ? '' : 's'}) — IDR</label>
                      <input className="form-input" type="number" min="0" value={priceForm.total_amount} autoFocus
                        onChange={e => setPriceForm(f => ({ ...f, total_amount: e.target.value }))} />
                      {newGross > 0 && booking.nights > 0 && (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          = <strong>{fmtIDR(newGross / booking.nights)} per night</strong> × {booking.nights} night{booking.nights === 1 ? '' : 's'}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Same field as on New Booking — the whole stay, tax included
                        {booking.discount_type ? `, before the ${booking.discount_type === 'percentage' ? `${booking.discount_value}%` : 'fixed'} discount (${booking.group && booking.discount_type !== 'percentage' ? "this room's share is kept" : "it's applied again"})` : ''}.
                      </div>
                    </div>
                    {newNet !== null && booking.discount_type && (
                      <div className="flex-between" style={{ fontSize: 13, marginBottom: 12 }}>
                        <span className="text-muted">New price after discount</span>
                        <strong>{fmtIDR(newNet)}</strong>
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Reason *</label>
                      <textarea className="form-textarea" value={priceForm.reason} placeholder="e.g. FO typed 1,500,000 instead of 1,050,000"
                        onChange={e => setPriceForm(f => ({ ...f, reason: e.target.value }))} />
                    </div>
                    {overReceived && (
                      <div className="form-group" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 13, marginBottom: 8 }}>
                          <strong>{fmtIDR(received)}</strong> is recorded as received — more than the new price. What did the guest actually pay?
                        </div>
                        <label className="flex gap-2" style={{ fontSize: 13, cursor: 'pointer', marginBottom: 6, alignItems: 'flex-start' }}>
                          <input type="radio" name="received_was_typo" checked={priceForm.received_was_typo === true}
                            onChange={() => setPriceForm(f => ({ ...f, received_was_typo: true }))} />
                          <span>Guest paid {fmtIDR(newNet)} — the received amount was the same typo. <b>Correct it to {fmtIDR(newNet)}.</b></span>
                        </label>
                        <label className="flex gap-2" style={{ fontSize: 13, cursor: 'pointer', alignItems: 'flex-start' }}>
                          <input type="radio" name="received_was_typo" checked={priceForm.received_was_typo === false}
                            onChange={() => setPriceForm(f => ({ ...f, received_was_typo: false }))} />
                          <span>Guest really paid {fmtIDR(received)} — keep it. {fmtIDR(received - newNet)} is owed back to the guest (refund by hand).</span>
                        </label>
                      </div>
                    )}
                    <div className="alert alert-success">
                      Payments already received stay as they are (unless corrected above); unpaid deposit/balance amounts, the folio's room charges and the revenue reports are updated to the new price. The change and reason are saved in Edit History.
                    </div>
                    {priceError && <div className="alert alert-error" style={{ marginTop: 8 }}>{priceError}</div>}
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={() => setEditingPrice(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={doEditPrice} disabled={priceLoading || !valid}>
                      {priceLoading ? 'Saving…' : 'Save New Price'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {changingGuest !== null && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Change Guest — {booking.unit_name}</div>
              <button className="btn btn-icon" onClick={() => setChangingGuest(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Currently: <b>{booking.guest_name}</b>. Pick the guest actually staying in this room, or add them as a new guest.
                Room Display, TV, the Registration Card and the police guest report will show this guest. Charges and payments stay on this booking.
              </div>
              <GuestPicker value={changingGuest || null} onChange={v => setChangingGuest(v || false)} />
              {guestError && <div className="alert alert-error" style={{ marginTop: 10 }}>{guestError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setChangingGuest(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doChangeGuest} disabled={guestSaving || !changingGuest}>
                {guestSaving ? 'Saving…' : 'Save Guest'}
              </button>
            </div>
          </div>
        </div>
      )}

      {recording && (
        <RecordPaymentModal booking={booking} estimate={estimate}
          onClose={closeRecordPayment}
          onPaid={() => { loadFolio(); load(); }}
          printReceipt={downloadLinesReceipt} />
      )}

      {messaging && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Send Message — {booking.unit_name}</div>
              <button className="btn btn-icon" onClick={() => setMessaging(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Shown full-screen on the room's tablet until the guest dismisses it.
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkinTemplate(booking.guest_name))}>
                    🔑 Check-in Welcome
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkoutTemplate(booking.guest_name))}>
                    🧳 Check-out Reminder
                  </button>
                </div>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Friendly reminder: check-out is at 12:00 today"
                  value={messageBody}
                  onChange={e => setMessageBody(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMessaging(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doSendMessage}
                disabled={sendingMessage || !messageBody.trim()}
              >
                {sendingMessage ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transferring && (() => {
        const q = changeQuote;
        const newPrice = parseFloat(customAmount);
        const priceOk = Number.isFinite(newPrice) && newPrice >= 0;
        const diff = q && priceOk ? Math.round((newPrice - q.current.total) * 100) / 100 : 0;
        const edited = q && priceOk && Math.abs(newPrice - q.next.total) >= 1;
        const charge = chargeMode === 'complimentary' ? 0 : diff;
        const canSave = !!q && !quoteLoading && changeReason.trim().length > 0 && (chargeMode === 'complimentary' || priceOk);
        const fmtStay = (a, b) => `${fmtShortDate(a)} – ${fmtShortDate(b)}`;
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 600, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Change Room — {booking.guest_name}</div>
                <button className="btn btn-icon" onClick={() => setTransferring(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Current room: <strong>{booking.unit_name}</strong> · {booking.check_in_date?.slice(0, 10)} → {booking.check_out_date?.slice(0, 10)}
                  {booking.status === 'checked_in' && ' · guest is in house'}
                </div>

                <label className="form-label">New room</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                  {[...transferUnits].sort((a, b) => Number(b.available) - Number(a.available)).map(u => {
                    const isAvailable = u.available;
                    const isSelected = transferTarget === u.id;
                    return (
                      <button key={u.id} type="button"
                        onClick={() => isAvailable && pickChangeRoom(u.id)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 8, cursor: isAvailable ? 'pointer' : 'not-allowed',
                          border: isSelected ? '2px solid var(--green-dark)' : '1px solid var(--border)',
                          background: isSelected ? 'var(--green-light)' : isAvailable ? 'var(--bg-card)' : 'var(--bg-muted, #f9fafb)',
                          opacity: isAvailable ? 1 : 0.55, textAlign: 'left', width: '100%',
                        }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</span>
                          {u.type && <span className="text-muted" style={{ fontSize: 12 }}> · {u.type}</span>}
                          {!isAvailable && u.conflict && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {u.conflict.overdue ? `${u.conflict.guest_name} still checked in (overdue)` : `Booked by ${u.conflict.guest_name}`}
                            </div>
                          )}
                          {isAvailable && u.status === 'out_of_order' && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Out of order now</div>
                          )}
                        </div>
                        <span className={`badge badge-${isAvailable ? 'green' : 'red'}`}>{isAvailable ? 'Available' : 'Booked'}</span>
                      </button>
                    );
                  })}
                </div>

                {quoteLoading && <div className="text-muted" style={{ fontSize: 13 }}>Calculating price difference…</div>}

                {q && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      Room price for the {q.nights} {q.nights === 1 ? 'night' : 'nights'} {booking.status === 'checked_in' ? 'still to come' : 'of the stay'}
                      {q.nights > 0 && ` (${fmtStay(q.from, q.to)})`}, incl. service & tax
                    </div>
                    <div className="flex-between" style={{ fontSize: 13 }}>
                      <span>{q.current.name}{q.current.type ? ` · ${q.current.type}` : ''} — booked price</span>
                      <span>{fmtIDR(q.current.total)}</span>
                    </div>
                    {q.current.normal_total != null && Math.abs(q.current.normal_total - q.current.total) >= 1 && (
                      <div className="text-muted" style={{ fontSize: 11, marginTop: -2, marginBottom: 2 }}>
                        Normal rate for this room would be {fmtIDR(q.current.normal_total)}
                      </div>
                    )}
                    <div className="flex-between" style={{ fontSize: 13, alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span>{q.next.name}{q.next.type ? ` · ${q.next.type}` : ''} — new price</span>
                      <input className="form-input" type="number" min="0" value={customAmount}
                        onChange={e => setCustomAmount(e.target.value)} disabled={chargeMode === 'complimentary'}
                        style={{ maxWidth: 160, padding: '4px 8px', textAlign: 'right' }} aria-label="New room price for the stay" />
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>
                      {edited
                        ? <>Normal rate {fmtIDR(q.next.total)} · <a href="#" onClick={e => { e.preventDefault(); setCustomAmount(String(Math.round(q.next.total))); }}>use normal rate</a></>
                        : 'Normal rate — type another price for a special rate'}
                    </div>
                    <div className="flex-between" style={{ fontSize: 14, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                      <span>{diff >= 0 ? 'Difference' : 'Difference (cheaper)'}</span>
                      <span>{diff >= 0 ? '+' : '−'}{fmtIDR(Math.abs(diff))}</span>
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                      <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
                        <input type="radio" name="charge" checked={chargeMode === 'difference'} onChange={() => setChargeMode('difference')} />
                        {diff > 0 ? `Charge the difference (+${fmtIDR(diff)})`
                          : diff < 0 ? `Give the difference back as credit (−${fmtIDR(-diff)})`
                          : 'No price change'}
                      </label>
                      <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
                        <input type="radio" name="charge" checked={chargeMode === 'complimentary'} onChange={() => setChargeMode('complimentary')} />
                        Complimentary — keep the current price
                      </label>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Reason *</label>
                  <input className="form-input" value={changeReason} onChange={e => setChangeReason(e.target.value)}
                    placeholder="e.g. Guest requested a villa for their anniversary / AC broken" />
                </div>

                {q && (
                  <div className="alert alert-success" style={{ fontSize: 13 }}><div>
                    {charge > 0
                      ? <>The booking price goes up by <b>{fmtIDR(charge)}</b> — it's added to the balance still to pay.</>
                      : charge < 0
                        ? <>The booking price goes down by <b>{fmtIDR(-charge)}</b>. If the guest has already paid more, it shows as a credit to refund.</>
                        : <>The booking price stays the same.</>}
                    {booking.status === 'checked_in' && ' The old room is marked for cleaning.'}
                  </div></div>
                )}
                {changeError && <div className="alert alert-error">{changeError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setTransferring(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={doTransfer} disabled={!canSave || transferLoading}>
                  {transferLoading ? 'Saving…' : 'Change Room'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {checkingOut && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Check Out: {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setCheckingOut(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <strong>{booking.unit_name}</strong> · Check-out {booking.check_out_date?.slice(0,10)}
              </div>
              {cityLedgerSource && (
                <div style={{ marginBottom: 12, fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '10px 12px' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={billToAgent} onChange={e => setBillToAgent(e.target.checked)} />
                    <span>
                      Bill <strong>{booking.agent_name || 'the agent'}</strong> for this stay — the folio closes as
                      billed-to-agent (settled later via the agent statement) instead of collecting from the guest.
                    </span>
                  </label>
                </div>
              )}
              {!cityLedgerSource && pendingBalance > 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  ⚠ Balance of <strong>{fmtIDR(pendingBalance)}</strong> not received. Collect before completing check-out.
                </div>
              )}
              {checkoutCredit && checkoutCredit.would_exceed && (
                <div style={{ marginBottom: 12, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 10px' }}>
                  ⚠ {checkoutCredit.label} is over its credit limit — {fmtIDR(checkoutCredit.current_outstanding)} outstanding vs {fmtIDR(checkoutCredit.credit_limit)} limit.
                </div>
              )}
              <EarlyDepartureOption booking={booking} onChange={setEarlyCo} />
              <div className="form-group">
                <label className="form-label">Unit Condition Notes</label>
                <textarea
                  className="form-textarea"
                  placeholder="Any damage, issues, or items left behind…"
                  value={checkoutNotes}
                  onChange={e => setCheckoutNotes(e.target.value)}
                />
              </div>
              <div className="alert alert-success" style={{ marginTop: 0 }}>
                Completing check-out will free the unit and auto-generate a housekeeping task.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCheckingOut(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doCheckout} disabled={checkoutLoading || !earlyCo.valid}>
                {checkoutLoading ? 'Processing…' : 'Complete Check-out ✓'}
              </button>
            </div>
          </div>
        </div>
      )}

      {paying && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Record {paying.type} Payment</div>
              <button className="btn btn-icon" onClick={() => setPaying(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{fmtIDR(paying.amount)}</div>
              <div className="form-group">
                <label className="form-label">Method</label>
                <select className="form-select" value={payForm.method} onChange={e => setPayForm(f=>({...f,method:e.target.value}))}>
                  {paymentMethods.filter(m => m.is_active).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date Received</label>
                <input className="form-input" type="date" value={payForm.received_at} onChange={e => setPayForm(f=>({...f,received_at:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input" value={payForm.notes} onChange={e => setPayForm(f=>({...f,notes:e.target.value}))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPaying(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmPayment}>Confirm Received</button>
            </div>
          </div>
        </div>
      )}
      {compMode && (
        <ComplimentaryModal booking={{ id: booking.id, guest_name: booking.guest_name, status: booking.status }} mode={compMode} initial={compInitial}
          onClose={() => { setCompMode(null); load(); }}
          onCancelled={() => nav('/reservations')}
          onDone={() => { setCompMode(null); load(); if (tab === 'folio') loadFolio(); }} />
      )}
      {showRegCard && (
        <RegistrationCardModal bookingId={id} onClose={() => setShowRegCard(false)} />
      )}
    </div>
  );
}
