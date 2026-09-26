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
import { checkinTemplate, checkoutTemplate } from '../lib/messageTemplates';

const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };
// bookings.folio_status — set when a city-ledger stay is checked out billed
// to the agent (migrations 042/043); tracked on the Agent Billing page.
const AGENT_BILLING = {
  pending_agent_invoice: { label: 'Not invoiced yet', badge: 'amber' },
  invoiced:              { label: 'Invoiced — awaiting payment', badge: 'blue' },
  paid:                  { label: 'Paid by agent', badge: 'green' },
};
const CHARGE_TYPES = ['room', 'fnb', 'sale', 'activity', 'misc', 'discount', 'tax', 'service_charge'];
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
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ type: 'misc', description: '', quantity: 1, unit_price: '' });
  const [chargeError, setChargeError] = useState('');
  const [activityBookings, setActivityBookings] = useState(null);
  // Record Payment on the folio — settles what's owed on the stay incl.
  // extras charged to the room (room lines first, the rest as extras).
  const [recording, setRecording] = useState(false);
  const [recForm, setRecForm] = useState({ amount: '', method: '', received_at: '', notes: '' });
  const [recSaving, setRecSaving] = useState(false);
  const [recError, setRecError] = useState('');

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
  useEffect(() => {
    if (location.hash === '#record-payment' && estimate && parseFloat(estimate.balance_due) > 0 && !recording) openRecordPayment();
  }, [estimate]); // eslint-disable-line react-hooks/exhaustive-deps

  function openRecordPayment() {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const methods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
    setRecForm({
      amount: estimate ? String(Math.max(0, Math.round(parseFloat(estimate.balance_due)))) : '',
      method: methods.find(m => m.id === 'bank_transfer')?.id || methods[0]?.id || '',
      received_at: today,
      notes: '',
    });
    setRecError('');
    setRecording(true);
  }

  async function saveRecordPayment() {
    setRecSaving(true);
    setRecError('');
    try {
      await api.post(`/api/folio/${id}/payment`, {
        amount: parseFloat(recForm.amount), method: recForm.method, received_at: recForm.received_at, notes: recForm.notes,
      });
      setRecording(false);
      if (location.hash === '#record-payment') nav(`/reservations/${id}`, { replace: true });
      loadFolio();
      load();
    } catch (err) {
      setRecError(err.response?.data?.error || 'Could not record the payment');
    } finally {
      setRecSaving(false);
    }
  }

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

  async function loadActivityBookings() {
    try {
      const r = await api.get('/api/activities/bookings', { params: { booking_id: id } });
      setActivityBookings(r.data);
    } catch {}
  }

  useEffect(() => { if (tab === 'activities' && !activityBookings) loadActivityBookings(); }, [tab]);

  async function addCharge() {
    setChargeError('');
    if (!chargeForm.description.trim()) { setChargeError('Description required'); return; }
    try {
      await api.post(`/api/folio/${id}/charge`, chargeForm);
      setChargeForm({ type: 'misc', description: '', quantity: 1, unit_price: '' });
      setAddingCharge(false);
      loadFolio();
    } catch (err) {
      setChargeError(err.response?.data?.error || 'Failed to add charge');
    }
  }

  async function voidCharge(chargeId) {
    if (!confirm('Void this charge?')) return;
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

  async function downloadInvoice() {
    await downloadPdf(`/api/folio/${id}/invoice`, `invoice-${id}.pdf`);
  }

  async function downloadProforma() {
    await downloadPdf(`/api/folio/${id}/proforma`, `proforma-${id}.pdf`);
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
    const src = sources.find(s => s.id === booking.source);
    const cityLedger = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'].includes(src?.payment_status);
    setBillToAgent(cityLedger);
    if (src && src.credit_limit != null) {
      api.get(`/api/settings/booking-sources/${src.id}/credit-check?amount=0`)
        .then(r => setCheckoutCredit(r.data))
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
    setEditingDetails(true);
  }

  async function doEditDetails() {
    setEditDetailsLoading(true);
    try {
      await api.put(`/api/bookings/${id}`, editDetailsForm);
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
  const bookingSource = sources.find(s => s.id === booking.source);
  const cityLedgerSource = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'].includes(bookingSource?.payment_status);

  // Modify Booking (moderate consequence) and Danger Zone (rare, destructive)
  // stay collapsed behind ⋮, visually separated by a divider — Communication
  // (Call/Message/WhatsApp) is high-frequency enough to live as visible icon
  // buttons instead, and Download earns its own always-visible button since
  // it's a different kind of action (produces a guest-facing document).
  const modifyItems = [
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) && !booking.group &&
      { label: 'Amend Dates', icon: '📅', onClick: openAmend },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Change Room', icon: '🔀', onClick: openTransfer },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Edit Details', icon: '📝', onClick: openEditDetails },
    ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) &&
      { label: 'Change Guest', icon: '👤', onClick: openChangeGuest },
    isOwner && !['cancelled', 'no_show'].includes(booking.status) && !booking.group &&
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
                { label: 'Invoice', icon: '🧾', hint: 'What has actually been charged so far', onClick: downloadInvoice },
                { divider: true },
                { label: 'Pro Forma', icon: '📋', hint: 'Estimate — projected total for the whole stay', onClick: downloadProforma },
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
                  <div style={{ fontSize: 12 }}><Link to={`/agents/${booking.source}`}>Agent statement →</Link></div>
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
                    <span>{fmtIDR(estimate.total)}</span>
                  </div>
                  <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                    <span>Estimated Balance Due</span>
                    <span style={{ color: parseFloat(estimate.balance_due) > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                      {fmtIDR(estimate.balance_due)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Projected for the whole stay, including room/meal nights not yet posted below. Use this to know what the guest actually still owes.
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
              <div style={{ marginBottom: 10 }}>
                {[
                  ['Accommodation', c => c.type === 'room'],
                  // 'fnb' = the rate plan's included meal (per-night, migration 044);
                  // a 'sale' (migration 049) is F&B only when it contains
                  // food/drinks (c.is_fnb from the server) — a front-desk extra
                  // like an extra bed (migration 067) goes under Other.
                  // Same grouping as server/routes/folio.js's invoice.
                  ['Food & Beverage', c => c.type === 'fnb' || (c.type === 'sale' && c.is_fnb)],
                  ['Other', c => c.type !== 'room' && c.type !== 'fnb' && !(c.type === 'sale' && c.is_fnb)],
                ].map(([groupLabel, match]) => {
                  const lines = folio.charges.filter(match);
                  if (!lines.length) return null;
                  const grouped = folio.charges.some(c => c.type === 'room' || c.type === 'fnb' || c.type === 'sale');
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
                              {c.type.replace('_', ' ')} · {parseFloat(c.quantity)} × {fmtIDR(c.unit_price)}
                              {c.posted_by_name && ` · ${c.posted_by_name}`}
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            {c.complimentary
                              ? <span title={`${fmtIDR(c.amount)} — complimentary stay, not charged`}><s className="text-muted">{fmtIDR(c.amount)}</s> <span className="badge badge-green">Free</span></span>
                              : <span style={{ fontWeight: 600 }}>{fmtIDR(c.amount)}</span>}
                            <button className="btn btn-icon btn-sm" title="Void charge" onClick={() => voidCharge(c.id)}>🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {folio.charges.length === 0 && <div className="text-muted" style={{ padding: '10px 0' }}>No charges posted yet.</div>}
              </div>

              {addingCharge ? (
                <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Type</label>
                      <select className="form-select" value={chargeForm.type} onChange={e => setChargeForm(f => ({ ...f, type: e.target.value }))}>
                        {CHARGE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 2 }}>
                      <label className="form-label">Description</label>
                      <input className="form-input" value={chargeForm.description} onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Quantity</label>
                      <input className="form-input" type="number" value={chargeForm.quantity} onChange={e => setChargeForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Unit Price</label>
                      <input className="form-input" type="number" value={chargeForm.unit_price} onChange={e => setChargeForm(f => ({ ...f, unit_price: e.target.value }))} />
                    </div>
                  </div>
                  {chargeError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{chargeError}</div>}
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm" onClick={addCharge}>Add Charge</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setAddingCharge(false); setChargeError(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm mb-3" onClick={() => setAddingCharge(true)}>+ Add Charge</button>
              )}

              <div className="divider" />
              {(parseFloat(folio.service_charge_rate) > 0 || parseFloat(folio.tax_rate) > 0) && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Subtotal</span><span>{fmtIDR(folio.subtotal)}</span>
                </div>
              )}
              {parseFloat(folio.service_charge_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Service Charge ({folio.service_charge_rate}%)</span><span>{fmtIDR(folio.service_charge_amount)}</span>
                </div>
              )}
              {parseFloat(folio.tax_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Tax ({folio.tax_rate}%)</span><span>{fmtIDR(folio.tax_amount)}</span>
                </div>
              )}
              <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 10 }}>
                <span>Total</span><span>{fmtIDR(folio.total)}</span>
              </div>

              {folio.payments.filter(p => p.status === 'received').length > 0 && (
                <>
                  <div className="card-title" style={{ fontSize: 13 }}>Payments Received</div>
                  {folio.payments.filter(p => p.status === 'received').map(p => (
                    <div key={p.id} className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                      <span className="text-muted" style={{ textTransform: 'capitalize' }}>{p.type === 'incidental' ? 'Extras (paid at desk)' : p.type} · {p.method?.replace('_', ' ')}</span>
                      <span>{fmtIDR(p.amount)}</span>
                    </div>
                  ))}
                </>
              )}

              <div className="flex-between mt-3" style={{ fontWeight: 700, fontSize: 16 }}>
                <span>Posted Balance</span>
                <span style={{ color: parseFloat(folio.balance_due) > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                  {fmtIDR(folio.balance_due)}
                </span>
              </div>
              {(() => {
                // Room/meal nights post one at a time at night audit, so until
                // then the ledger above is missing them and Posted Balance can
                // even look like a credit. Say which nights are still to come.
                if (!estimate || ['cancelled', 'no_show'].includes(booking.status)) return null;
                const postedDates = new Set(folio.charges
                  .filter(c => c.type === 'room' || c.type === 'fnb')
                  .map(c => String(c.service_date || '').slice(0, 10)));
                const pending = (estimate.charges || []).filter(c =>
                  (c.type === 'room' || c.type === 'fnb') && !postedDates.has(String(c.service_date || '').slice(0, 10)));
                if (!pending.length) return null;
                const net = pending.reduce((s, c) => s + parseFloat(c.amount), 0);
                const gross = net * (1 + (parseFloat(estimate.service_charge_rate) || 0) / 100) * (1 + (parseFloat(estimate.tax_rate) || 0) / 100);
                const dates = [...new Set(pending.map(c => String(c.service_date).slice(0, 10)))].sort();
                const d = new Date();
                const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const what = dates.length === 1
                  ? (dates[0] === today ? 'Tonight’s room charge' : `The room charge for ${fmtShortDate(dates[0])}`)
                  : `Room charges for ${dates.length} nights (${fmtShortDate(dates[0])} – ${fmtShortDate(dates[dates.length - 1])})`;
                return (
                  <div style={{ fontSize: 12, marginTop: 6, padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
                    🌙 {what} — <b>{fmtIDR(Math.round(gross))}</b> — {dates.length === 1 ? 'posts' : 'post'} at night audit, one night at a time.
                    Estimated Balance Due above already includes {dates.length === 1 ? 'it' : 'them'}.
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Based only on charges already posted to the ledger above — see "Estimated Balance Due" up top for what the guest actually still owes overall.
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'activities' && (
        <div className="card mt-3">
          <div className="card-title">Activity Bookings</div>
          {!activityBookings ? <div className="text-muted">Loading…</div> : activityBookings.length === 0 ? (
            <div className="text-muted" style={{ padding: '10px 0' }}>No activity bookings for this stay yet — guests can request one from the Room Display, or add one from the Activities page.</div>
          ) : (
            activityBookings.map(ab => (
              <div key={ab.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{ab.activity_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {String(ab.scheduled_date).slice(0, 10)}{ab.scheduled_time ? ` ${ab.scheduled_time.slice(0, 5)}` : ''} · {ab.num_participants} pax
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <span style={{ fontWeight: 600 }}>{fmtIDR(ab.total_amount)}</span>
                  <span className={`badge badge-${ACTIVITY_STATUS_BADGE[ab.status]}`}>{ab.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
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
              {booking.folio_status && editDetailsForm.source !== booking.source && (
                <div className="alert alert-error">
                  This booking already has agent billing activity ({booking.folio_status.replace('_', ' ')}) tied to its current source — changing the source now won't move that billing history, so double-check with whoever handles Agent Billing before saving.
                </div>
              )}
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
        const newDiscount = !Number.isFinite(newGross) ? 0
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
                      <label className="form-label">New total amount (IDR)</label>
                      <input className="form-input" type="number" min="0" value={priceForm.total_amount} autoFocus
                        onChange={e => setPriceForm(f => ({ ...f, total_amount: e.target.value }))} />
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Same field as on New Booking — the whole stay, tax included
                        {booking.discount_type ? `, before the ${booking.discount_type === 'percentage' ? `${booking.discount_value}%` : 'fixed'} discount (it's applied again)` : ''}.
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
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Record Payment — {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setRecording(false)}>✕</button>
            </div>
            <div className="modal-body">
              {estimate && (
                <div className="flex-between" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  <span>Still owed on this stay</span><span style={{ color: 'var(--color-danger, #dc2626)' }}>{fmtIDR(estimate.balance_due)}</span>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Amount received</label>
                  <input className="form-input" type="number" min={1} value={recForm.amount} onChange={e => setRecForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Method</label>
                  <select className="form-select" value={recForm.method} onChange={e => setRecForm(f => ({ ...f, method: e.target.value }))}>
                    {paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Date received</label>
                  <input className="form-input" type="date" value={recForm.received_at} onChange={e => setRecForm(f => ({ ...f, received_at: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={recForm.notes} placeholder="e.g. BCA ref 1234 — extra beds" onChange={e => setRecForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              {(() => {
                // Quick amounts: one night of the room (the booking's price ÷
                // nights, incl. tax — e.g. a guest paying night by night) and
                // the full balance still owed.
                const nights = Math.max(1, parseInt(booking.nights, 10) || 1);
                const perNight = Math.round((parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0)) / nights);
                const full = estimate ? Math.max(0, Math.round(parseFloat(estimate.balance_due))) : null;
                return (
                  <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                    {nights > 1 && perNight > 0 && (
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRecForm(f => ({ ...f, amount: String(perNight) }))}>
                        1 night · {fmtIDR(perNight)}
                      </button>
                    )}
                    {full != null && full > 0 && (
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRecForm(f => ({ ...f, amount: String(full) }))}>
                        Full balance · {fmtIDR(full)}
                      </button>
                    )}
                  </div>
                );
              })()}
              <div className="text-muted" style={{ fontSize: 12 }}>
                Settles the room's unpaid deposit/balance first, then extras charged to the room (extra bed, laundry, activities…). A smaller amount is recorded as a part payment.
              </div>
              {recError && <div className="alert alert-error" style={{ marginTop: 10 }}>{recError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRecording(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRecordPayment}
                disabled={recSaving || !(parseFloat(recForm.amount) > 0) || !recForm.method}>
                {recSaving ? 'Saving…' : `Record ${fmtIDR(parseFloat(recForm.amount) || 0)}`}
              </button>
            </div>
          </div>
        </div>
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
                      Bill <strong>{bookingSource?.label || 'the agent'}</strong> for this stay — the folio closes as
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
        <ComplimentaryModal booking={{ id: booking.id, guest_name: booking.guest_name }} mode={compMode} initial={compInitial}
          onClose={() => { setCompMode(null); load(); }}
          onDone={() => { setCompMode(null); load(); if (tab === 'folio') loadFolio(); }} />
      )}
      {showRegCard && (
        <RegistrationCardModal bookingId={id} onClose={() => setShowRegCard(false)} />
      )}
    </div>
  );
}
