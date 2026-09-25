import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import ActionMenu from '../components/ActionMenu';
import PageHeader from '../components/PageHeader';
import GuestPicker from '../components/GuestPicker';
import { useSettings } from '../context/SettingsContext';

const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
// '2026-10-01' → '1 Oct' (withYear → '1 Oct 2026')
function fmtDate(s, withYear = false) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export default function GroupDetail() {
  const { groupId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('details');
  const [folio, setFolio] = useState(null);
  const [folioLoading, setFolioLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinResults, setCheckinResults] = useState(null);

  async function load() {
    try {
      const r = await api.get(`/api/bookings/group/${groupId}`);
      setData(r.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [groupId]);

  async function loadFolio() {
    setFolioLoading(true);
    try {
      const r = await api.get(`/api/folio/group/${groupId}`);
      setFolio(r.data);
    } catch {}
    setFolioLoading(false);
  }

  useEffect(() => { if (tab === 'folio' && !folio) loadFolio(); }, [tab]);

  async function downloadGroupProforma() {
    try {
      const r = await api.get(`/api/folio/group/${groupId}/proforma`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `proforma-group-${groupId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download pro forma');
    }
  }

  async function checkInGroup() {
    setCheckingIn(true);
    setCheckinResults(null);
    try {
      const r = await api.post(`/api/checkin/group/${groupId}/start`);
      setCheckinResults(r.data);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to check in group');
    } finally {
      setCheckingIn(false);
    }
  }

  // Assign the guest actually staying in each room (the group is usually
  // booked under one name; the guest list arrives later). Room / TV Display,
  // Registration Card and the police Guest Report all follow the room's guest.
  // Group payment: one payment from the group (e.g. the booker's single
  // transfer) marks several rooms' deposit/balance lines received at once;
  // each room's status updates like "Mark Received" on the room itself.
  const { paymentMethods } = useSettings();
  const payMethods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [paying, setPaying] = useState(false);
  const [paySel, setPaySel] = useState(new Set());
  const [payForm, setPayForm] = useState({ method: '', received_at: todayStr, notes: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  // Every unpaid room payment line in the group, room by room.
  function pendingLines() {
    if (!data) return [];
    return data.bookings
      .filter(b => !['cancelled', 'no_show'].includes(b.status))
      .flatMap(b => (b.payments || [])
        .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status !== 'received' && parseFloat(p.amount) > 0)
        .map(p => ({ ...p, unit_name: b.unit_name, guest_name: b.guest_name })));
  }

  function openGroupPayment() {
    const lines = pendingLines();
    // Start with the deposits ticked when any are open (the usual first
    // transfer), otherwise everything that's left.
    const deposits = lines.filter(l => l.type === 'deposit');
    setPaySel(new Set((deposits.length ? deposits : lines).map(l => l.id)));
    setPayForm({ method: payMethods.find(m => m.id === 'bank_transfer')?.id || payMethods[0]?.id || '', received_at: todayStr, notes: '' });
    setPayError('');
    setPaying(true);
  }

  async function saveGroupPayment() {
    setPaySaving(true);
    setPayError('');
    try {
      await api.post(`/api/bookings/group/${groupId}/payments`, {
        payment_ids: [...paySel], method: payForm.method, received_at: payForm.received_at, notes: payForm.notes,
      });
      setPaying(false);
      load();
    } catch (err) {
      setPayError(err.response?.data?.error || 'Could not record the payment');
    } finally {
      setPaySaving(false);
    }
  }

  const [assigning, setAssigning] = useState(false);
  const [assignments, setAssignments] = useState({}); // booking_id -> GuestPicker value
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');

  function openAssign() {
    setAssignments({});
    setAssignError('');
    setAssigning(true);
  }

  async function saveAssignments() {
    const list = Object.entries(assignments)
      .filter(([, v]) => v)
      .map(([booking_id, v]) => v.guest_id ? { booking_id, guest_id: v.guest_id } : { booking_id, new_guest: v.new_guest });
    if (!list.length) { setAssigning(false); return; }
    setAssignSaving(true);
    setAssignError('');
    try {
      await api.put(`/api/bookings/group/${groupId}/guests`, { assignments: list });
      setAssigning(false);
      load();
    } catch (err) {
      setAssignError(err.response?.data?.error || 'Could not save the guests');
    } finally {
      setAssignSaving(false);
    }
  }

  // ── Add Room (the group asked for one more room) ──
  const { ratePlans = [] } = useSettings();
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(null);
  const [addUnits, setAddUnits] = useState([]);
  const [addSuggest, setAddSuggest] = useState(null);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  function addDates() {
    if (!data) return null;
    const ci = data.group.check_in_date?.slice(0, 10);
    const co = data.group.check_out_date?.slice(0, 10);
    return { check_in: ci < todayStr ? todayStr : ci, check_out: co };
  }

  function openAddRoom() {
    const d = addDates();
    setAddForm({
      unit_id: '', num_guests: 2, bed_preference: '', total_amount: '', deposit_pct: '50', reason: '',
      rate_plan_id: (ratePlans.find(p => p.is_default) || ratePlans[0])?.id || '',
    });
    setAddSuggest(null); setAddError(''); setAdding(true);
    api.get('/api/bookings/transfer-availability', { params: d })
      .then(r => setAddUnits(r.data)).catch(() => setAddUnits([]));
  }

  useEffect(() => {
    if (!adding || !addForm?.unit_id) { setAddSuggest(null); return; }
    const d = addDates();
    api.get('/api/pricing/suggest', { params: { unit_id: addForm.unit_id, ...d, rate_plan_id: addForm.rate_plan_id || '', num_guests: addForm.num_guests || 1 } })
      .then(r => setAddSuggest(r.data)).catch(() => setAddSuggest(null));
  }, [adding, addForm?.unit_id, addForm?.rate_plan_id, addForm?.num_guests]);

  async function saveAddRoom() {
    setAddSaving(true); setAddError('');
    try {
      const price = addForm.total_amount !== '' ? parseFloat(addForm.total_amount) : (addSuggest?.grand_total || 0);
      await api.post(`/api/bookings/group/${groupId}/rooms`, {
        unit_id: addForm.unit_id,
        num_guests: addForm.num_guests,
        rate_plan_id: addForm.rate_plan_id || null,
        bed_preference: addForm.bed_preference || null,
        total_amount: addForm.total_amount !== '' ? addForm.total_amount : undefined,
        deposit_amount: Math.round(price * (parseFloat(addForm.deposit_pct) || 0) / 100),
        reason: addForm.reason,
      });
      setAdding(false);
      await load();
      if (folio) loadFolio();
    } catch (e) {
      setAddError(e.response?.data?.error || 'Could not add the room');
    }
    setAddSaving(false);
  }

  // ── Amend Dates for the whole group ──
  const [amending, setAmending] = useState(false);
  const [amendForm, setAmendForm] = useState(null);
  const [amendQuote, setAmendQuote] = useState(null);
  const [amendQuoteError, setAmendQuoteError] = useState('');
  const [amendSaving, setAmendSaving] = useState(false);
  const [amendError, setAmendError] = useState('');

  function addDaysYmd(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function nightsBetween(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  function openAmendGroup() {
    const ci = data.group.check_in_date?.slice(0, 10);
    const co = data.group.check_out_date?.slice(0, 10);
    setAmendForm({ check_in: ci, check_out: co, charge: 'difference', amount: '', reason: '' });
    setAmendQuote(null); setAmendQuoteError(''); setAmendError(''); setAmending(true);
  }

  useEffect(() => {
    if (!amending || !amendForm?.check_in || !amendForm?.check_out || amendForm.check_out <= amendForm.check_in) { setAmendQuote(null); return; }
    let live = true;
    api.get(`/api/bookings/group/${groupId}/dates/quote`, { params: { check_in: amendForm.check_in, check_out: amendForm.check_out } })
      .then(r => { if (live) { setAmendQuote(r.data); setAmendQuoteError(''); } })
      .catch(e => { if (live) { setAmendQuote(null); setAmendQuoteError(e.response?.data?.error || 'Could not price the new dates'); } });
    return () => { live = false; };
  }, [amending, amendForm?.check_in, amendForm?.check_out]);

  async function saveAmendGroup() {
    setAmendSaving(true); setAmendError('');
    try {
      await api.put(`/api/bookings/group/${groupId}/dates`, {
        check_in_date: amendForm.check_in, check_out_date: amendForm.check_out,
        charge: amendForm.charge, amount: amendForm.charge === 'custom' ? amendForm.amount : undefined,
        reason: amendForm.reason,
      });
      setAmending(false);
      await load();
      if (folio) loadFolio();
    } catch (e) {
      setAmendError(e.response?.data?.error || 'Could not change the dates');
    }
    setAmendSaving(false);
  }

  // ── Remove one room from the group ──
  const [removing, setRemoving] = useState(null); // booking row
  const [removeReason, setRemoveReason] = useState('');
  const [removeSaving, setRemoveSaving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  async function saveRemoveRoom() {
    setRemoveSaving(true); setRemoveError('');
    try {
      await api.post(`/api/bookings/group/${groupId}/rooms/${removing.id}/cancel`, { reason: removeReason });
      setRemoving(null);
      await load();
      if (folio) loadFolio();
    } catch (e) {
      setRemoveError(e.response?.data?.error || 'Could not remove the room');
    }
    setRemoveSaving(false);
  }

  async function cancelGroup() {
    if (!confirm('Cancel this entire group booking? All rooms not already checked out will be cancelled.')) return;
    try {
      await api.delete(`/api/bookings/group/${groupId}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel group');
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!data) return <div className="alert alert-error">Group not found</div>;

  const { group, bookings, rollup } = data;
  const anyEligibleForCheckin = bookings.some(b => !['cancelled', 'no_show', 'checked_in', 'checked_out'].includes(b.status));
  const assignableRooms = bookings.filter(b => !['cancelled', 'no_show', 'checked_out'].includes(b.status));
  const roomsWithBooker = assignableRooms.filter(b => b.guest_id === group.primary_guest_id).length;
  const canAddRoom = group.status !== 'cancelled' && group.check_out_date?.slice(0, 10) > todayStr;
  const amendableRooms = bookings.filter(b => ['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(b.status));
  const activeRoomCount = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status)).length;
  const activeRooms = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status));
  const groupNights = Math.max(0, Math.round((new Date(group.check_out_date?.slice(0, 10)) - new Date(group.check_in_date?.slice(0, 10))) / 86400000));
  const groupPax = activeRooms.reduce((sum, b) => sum + (parseInt(b.num_guests, 10) || 0), 0);
  const inHouse = activeRooms.filter(b => b.status === 'checked_in').length;
  const groupState = group.status === 'cancelled' || activeRooms.length === 0 ? { label: 'Cancelled', color: 'red' }
    : activeRooms.every(b => b.status === 'checked_out') ? { label: 'Checked out', color: 'gray' }
    : inHouse > 0 ? { label: `In house · ${inHouse}/${activeRooms.length}`, color: 'blue' }
    : { label: 'Upcoming', color: 'green' };
  // Modify (moderate) above a divider, Cancel Group (destructive) below it —
  // same layout as the booking page's ⋮ menu.
  const groupModify = [
    group.status !== 'cancelled' && amendableRooms.length > 0 && { label: 'Amend Dates', icon: '📅', onClick: openAmendGroup },
    canAddRoom && { label: 'Add Room', icon: '➕', onClick: openAddRoom },
    roomsWithBooker === 0 && assignableRooms.length > 0 && { label: 'Assign Guests', icon: '👥', onClick: openAssign },
  ].filter(Boolean);
  const groupDanger = [
    group.status === 'active' && { label: 'Cancel Group', icon: '✕', onClick: cancelGroup, danger: true },
  ].filter(Boolean);
  const groupMenu = [...groupModify, groupModify.length && groupDanger.length ? { divider: true } : null, ...groupDanger].filter(Boolean);
  function whatsappBooker() {
    const raw = (group.guest_whatsapp || '').trim();
    let num = raw.replace(/\D/g, '');
    if (!raw.startsWith('+')) {
      if (num.startsWith('0')) num = '62' + num.slice(1);
      else if (!num.startsWith('62')) num = '62' + num;
    }
    window.open(`https://wa.me/${num}`, '_blank');
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <PageHeader
        back={{ to: '/reservations', label: 'Reservations' }}
        kind="Group booking"
        title={group.guest_name}
        meta={[
          `${fmtDate(group.check_in_date)} → ${fmtDate(group.check_out_date, true)}`,
          `${groupNights} night${groupNights === 1 ? '' : 's'}`,
          `${rollup.room_count} room${rollup.room_count === 1 ? '' : 's'}`,
          `${groupPax} guest${groupPax === 1 ? '' : 's'}`,
        ]}
        badge={<span className={`badge badge-${groupState.color}`}>{groupState.label}</span>}
        actions={<>
          {anyEligibleForCheckin && (
            <button className="btn btn-primary" onClick={checkInGroup} disabled={checkingIn}>
              {checkingIn ? 'Checking in…' : 'Check In Group'}
            </button>
          )}
          {roomsWithBooker > 0 && (
            <button className="btn btn-secondary" onClick={openAssign} title="Rooms still under the booker's name">
              👥 Assign Guests <span className="badge badge-amber" style={{ marginLeft: 4 }}>{roomsWithBooker}</span>
            </button>
          )}
          <div className="icon-group">
            {group.guest_whatsapp && (
              <button title={`WhatsApp ${group.guest_name}`} onClick={whatsappBooker}>💬</button>
            )}
            <ActionMenu
              bare
              icon="⬇"
              ariaLabel="Download documents"
              items={[{ label: 'Pro Forma', icon: '📋', hint: 'Estimate — projected total across every room in the group', onClick: downloadGroupProforma }]}
            />
          </div>
          {groupMenu.length > 0 && <div className="header-divider" />}
          {groupMenu.length > 0 && <ActionMenu items={groupMenu} />}
        </>}
      />

      {checkinResults && (
        <div className="card mb-3">
          <div className="card-title">Check-in Results</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {checkinResults.succeeded} of {checkinResults.attempted} rooms checked in
            {checkinResults.failed > 0 && ` — ${checkinResults.failed} failed`}
          </div>
          {checkinResults.results.map(r => {
            const b = bookings.find(x => x.id === r.booking_id);
            return (
              <div key={r.booking_id} className="flex-between" style={{ fontSize: 13, padding: '4px 0' }}>
                <span>{b?.unit_name || r.booking_id.slice(0, 8)}</span>
                {r.ok ? (
                  <span style={{ color: 'var(--color-success, #16a34a)' }}>✓ Checked in</span>
                ) : (
                  <span style={{ color: 'var(--color-danger, #dc2626)' }}>✕ {r.error}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="tab-bar">
        <button className={`tab-bar-item${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        <button className={`tab-bar-item${tab === 'folio' ? ' active' : ''}`} onClick={() => setTab('folio')}>Master Folio</button>
      </div>

      {tab === 'details' && (
        <>
          <div className="card mb-3">
            <div className="card-title">Booked by</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{group.guest_name}</div>
            {group.guest_whatsapp && <div style={{ fontSize: 13 }}>📱 {group.guest_whatsapp}</div>}
            {group.guest_email && <div style={{ fontSize: 13 }}>✉️ {group.guest_email}</div>}
          </div>

          <div className="card mb-3">
            <div className="flex-between" style={{ alignItems: 'center', marginBottom: 8 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Rooms ({rollup.room_count}){rollup.cancelled_count > 0 && <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}> · {rollup.cancelled_count} cancelled</span>}
              </div>
              {canAddRoom && <button className="btn btn-sm btn-secondary" onClick={openAddRoom}>+ Add Room</button>}
            </div>
            {roomsWithBooker > 0 && (
              <div className="alert alert-success" style={{ fontSize: 13, marginBottom: 8 }}>
                <div>{roomsWithBooker} room{roomsWithBooker === 1 ? ' is' : 's are'} still under the booker's name. Use <b>Assign Guests</b> once the guest list arrives — Room Display, TV and the police guest report show each room's guest.</div>
              </div>
            )}
            {bookings.map(b => (
              <div key={b.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                  <Link to={`/reservations/${b.id}`} style={{ fontWeight: 600 }}>{b.unit_name}</Link>
                  <span style={{ marginLeft: 8, fontSize: 13 }}>
                    {b.guest_name}
                    {b.guest_id === group.primary_guest_id && <span className="text-muted" style={{ fontSize: 11 }}> (booker)</span>}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.num_guests} guest{b.num_guests !== 1 ? 's' : ''} · {fmtIDR(b.total_amount)}</div>
                </div>
                <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {(() => {
                    // Unpaid room payment lines → shortcut to that room's
                    // Payment Tracking to mark them received.
                    const unpaid = (b.payments || [])
                      .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status !== 'received' && parseFloat(p.amount) > 0)
                      .reduce((s, p) => s + parseFloat(p.amount), 0);
                    if (unpaid <= 0 || ['cancelled', 'no_show'].includes(b.status)) return null;
                    return (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--color-danger, #dc2626)', fontWeight: 600 }}>{fmtIDR(unpaid)} unpaid</span>
                        <Link to={`/reservations/${b.id}#payment`} className="btn btn-sm btn-secondary">Pay →</Link>
                      </>
                    );
                  })()}
                  <span className={`badge badge-${STATUS_BADGE[b.status] || 'gray'}`}>{STATUS_LABEL[b.status] || b.status}</span>
                  {['pending', 'deposit_paid', 'confirmed'].includes(b.status) && activeRoomCount > 1 && (
                    <button className="btn btn-sm btn-secondary" title="The group needs one room fewer — cancel this room only"
                      onClick={() => { setRemoving(b); setRemoveReason(''); setRemoveError(''); }}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card mb-3">
            <div className="card-title">Group Payment Summary</div>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className="text-muted">Total ({rollup.room_count} rooms)</span><span>{fmtIDR(rollup.total_amount)}</span>
            </div>
            {rollup.discount_amount > 0 && (
              <div className="flex-between" style={{ fontSize: 13, marginBottom: 4, color: 'var(--color-success, #16a34a)' }}>
                <span>Group Discount</span><span>− {fmtIDR(rollup.discount_amount)}</span>
              </div>
            )}
            <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 6 }}>
              <span>Net Total</span><span>{fmtIDR(rollup.net_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className="text-muted">Paid</span><span>{fmtIDR(rollup.paid_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
              <span>Balance Due</span>
              <span style={{ color: rollup.balance_due > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                {fmtIDR(rollup.balance_due)}
              </span>
            </div>
            {rollup.paid_on_cancelled > 0 && (
              <div className="alert alert-error" style={{ fontSize: 12, marginTop: 8 }}>
                {fmtIDR(rollup.paid_on_cancelled)} was already received on a cancelled room and isn't counted above — refund it or record it on another room by hand.
              </div>
            )}
            {pendingLines().length > 0 && (
              <div className="flex gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={openGroupPayment}>💳 Record Group Payment</button>
                <span className="text-muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                  One payment for several rooms — each room's status updates.
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {paying && (() => {
        const lines = pendingLines();
        const total = lines.filter(l => paySel.has(l.id)).reduce((sum, l) => sum + parseFloat(l.amount), 0);
        const toggle = lineId => setPaySel(sel => { const n = new Set(sel); if (n.has(lineId)) n.delete(lineId); else n.add(lineId); return n; });
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Record Group Payment</div>
                <button className="btn btn-icon" onClick={() => setPaying(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="flex gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                  <span className="text-muted" style={{ fontSize: 13, alignSelf: 'center' }}>This payment covers:</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set(lines.filter(l => l.type === 'deposit').map(l => l.id)))}>All deposits</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set(lines.map(l => l.id)))}>Everything unpaid</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set())}>Clear</button>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
                  {lines.map(l => (
                    <label key={l.id} className="flex-between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                      <span className="flex gap-2" style={{ alignItems: 'center' }}>
                        <input type="checkbox" checked={paySel.has(l.id)} onChange={() => toggle(l.id)} />
                        <b>{l.unit_name}</b>
                        <span style={{ textTransform: 'capitalize' }}>{l.type}</span>
                        <span className="text-muted" style={{ fontSize: 11 }}>{l.guest_name}</span>
                      </span>
                      <span style={{ fontWeight: 600 }}>{fmtIDR(l.amount)}</span>
                    </label>
                  ))}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Method</label>
                    <select className="form-select" value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                      {payMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date received</label>
                    <input className="form-input" type="date" value={payForm.received_at} onChange={e => setPayForm(f => ({ ...f, received_at: e.target.value }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={payForm.notes} placeholder="e.g. BCA transfer ref 1234" onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                  <span>Total received</span><span>{fmtIDR(total)}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Should match what the group actually paid. For a different amount, adjust that room's line on its booking first.
                </div>
                {payError && <div className="alert alert-error" style={{ marginTop: 10 }}>{payError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setPaying(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveGroupPayment} disabled={paySaving || paySel.size === 0 || !payForm.method}>
                  {paySaving ? 'Saving…' : `Record ${fmtIDR(total)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {amending && amendForm && (() => {
        const nights = amendForm.check_in && amendForm.check_out ? nightsBetween(amendForm.check_in, amendForm.check_out) : 0;
        const set = (k, v) => setAmendForm(f => ({ ...f, [k]: v }));
        const setCheckIn = v => setAmendForm(f => ({ ...f, check_in: v, check_out: v && nights > 0 ? addDaysYmd(v, nights) : f.check_out }));
        const setNights = n => { const k = parseInt(n, 10); if (k >= 1 && amendForm.check_in) set('check_out', addDaysYmd(amendForm.check_in, k)); };
        const q = amendQuote;
        const moving = q ? q.rooms.filter(r => !r.unchanged) : [];
        const chargeTotal = !q ? 0 : amendForm.charge === 'difference' ? q.total_difference : amendForm.charge === 'custom' ? (parseFloat(amendForm.amount) || 0) : 0;
        const canSave = q && q.ok && moving.length > 0 && amendForm.reason.trim()
          && (amendForm.charge !== 'custom' || amendForm.amount !== '');
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 600, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Amend Dates — {group.guest_name}'s group</div>
                <button className="btn btn-icon" onClick={() => setAmending(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Changes every room in the group at once. Cancelled and checked-out rooms are left as they are; a checked-in room can only change its check-out date.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Check-in</label>
                    <input className="form-input" type="date" value={amendForm.check_in} onChange={e => setCheckIn(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nights</label>
                    <input className="form-input" type="number" min="1" value={nights > 0 ? nights : ''} onChange={e => setNights(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Check-out</label>
                    <input className="form-input" type="date" value={amendForm.check_out} min={amendForm.check_in} onChange={e => set('check_out', e.target.value)} />
                  </div>
                </div>

                {amendQuoteError && <div className="alert alert-error" style={{ fontSize: 13 }}>{amendQuoteError}</div>}
                {q && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                    {q.rooms.map(r => (
                      <div key={r.booking_id} className="flex-between" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                        <div>
                          <b>{r.unit_name}</b>
                          <span className="text-muted"> · {r.old.nights} → {r.new.nights} night{r.new.nights === 1 ? '' : 's'}</span>
                          {r.problem && <div style={{ color: 'var(--color-danger, #dc2626)', fontSize: 12 }}>✕ {r.problem}</div>}
                          {!r.problem && r.unchanged && <div className="text-muted" style={{ fontSize: 12 }}>No change</div>}
                        </div>
                        <span style={{ whiteSpace: 'nowrap', color: r.difference < 0 ? 'var(--color-success, #16a34a)' : undefined }}>
                          {r.difference === 0 ? '—' : `${r.difference > 0 ? '+' : '−'}${fmtIDR(Math.abs(r.difference))}`}
                        </span>
                      </div>
                    ))}
                    <div className="flex-between" style={{ padding: '6px 10px', fontWeight: 700 }}>
                      <span>Normal price difference</span>
                      <span>{q.total_difference === 0 ? fmtIDR(0) : `${q.total_difference > 0 ? '+' : '−'}${fmtIDR(Math.abs(q.total_difference))}`}</span>
                    </div>
                  </div>
                )}

                {q && q.ok && moving.length > 0 && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Price</label>
                      {[
                        ['difference', q.total_difference > 0 ? `Charge the difference (+${fmtIDR(q.total_difference)})` : q.total_difference < 0 ? `Credit the difference (−${fmtIDR(-q.total_difference)})` : 'Keep the price (no difference)'],
                        ['complimentary', 'No charge — keep the current price'],
                        ['custom', 'Custom amount for the whole group'],
                      ].map(([v, l]) => (
                        <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                          <input type="radio" name="group-charge" checked={amendForm.charge === v} onChange={() => set('charge', v)} /> {l}
                        </label>
                      ))}
                      {amendForm.charge === 'custom' && (
                        <>
                          <input className="form-input" type="number" style={{ marginTop: 6 }} value={amendForm.amount}
                            placeholder="Extra for the group, e.g. 1500000 (negative = credit)" onChange={e => set('amount', e.target.value)} />
                          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Split over the rooms by each room's share of the new price.</div>
                        </>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Reason</label>
                      <input className="form-input" value={amendForm.reason} placeholder="e.g. Group extended by one night"
                        onChange={e => set('reason', e.target.value)} />
                    </div>
                    <div className="flex-between" style={{ fontSize: 14, fontWeight: 700 }}>
                      <span>{moving.length} room{moving.length === 1 ? '' : 's'} change · {chargeTotal < 0 ? 'credit' : 'added to the bill'}</span>
                      <span>{fmtIDR(Math.abs(chargeTotal))}</span>
                    </div>
                  </>
                )}
                {amendError && <div className="alert alert-error" style={{ marginTop: 10 }}>{amendError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setAmending(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveAmendGroup} disabled={amendSaving || !canSave}>
                  {amendSaving ? 'Saving…' : 'Change Dates'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {removing && (() => {
        const paid = (removing.payments || [])
          .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status === 'received')
          .reduce((sum, p) => sum + parseFloat(p.amount), 0);
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 460, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Remove Room {removing.unit_name}</div>
                <button className="btn btn-icon" onClick={() => setRemoving(null)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  Cancels room <b>{removing.unit_name}</b> ({removing.guest_name}, {fmtIDR(removing.total_amount)}) — the rest of the group stays booked. The room becomes free for other bookings and leaves the group's totals.
                </div>
                {paid > 0 && (
                  <div className="alert alert-error" style={{ fontSize: 12 }}>
                    {fmtIDR(paid)} was already received on this room. It won't count toward the group any more — refund it or record it on another room by hand.
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <input className="form-input" value={removeReason} placeholder="e.g. Group needs one room fewer" onChange={e => setRemoveReason(e.target.value)} />
                </div>
                {removeError && <div className="alert alert-error">{removeError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setRemoving(null)}>Keep Room</button>
                <button className="btn btn-danger" onClick={saveRemoveRoom} disabled={removeSaving || !removeReason.trim()}>
                  {removeSaving ? 'Removing…' : 'Remove Room'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {adding && addForm && (() => {
        const d = addDates();
        const nights = Math.max(1, Math.round((new Date(d.check_out) - new Date(d.check_in)) / 86400000));
        const suggested = addSuggest?.grand_total || 0;
        const price = addForm.total_amount !== '' ? parseFloat(addForm.total_amount) || 0 : suggested;
        const deposit = Math.round(price * (parseFloat(addForm.deposit_pct) || 0) / 100);
        const set = (k, v) => setAddForm(f => ({ ...f, [k]: v }));
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 520, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Add Room — {group.guest_name}'s group</div>
                <button className="btn btn-icon" onClick={() => setAdding(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  {d.check_in} → {d.check_out} · {nights} night{nights === 1 ? '' : 's'} (the group's dates). The room is booked under {group.guest_name} — use Assign Guests for the real guest. The group discount isn't applied to an added room.
                </div>
                <div className="form-group">
                  <label className="form-label">Room</label>
                  <select className="form-select" value={addForm.unit_id} onChange={e => set('unit_id', e.target.value)}>
                    <option value="">Select a room…</option>
                    {addUnits.map(u => (
                      <option key={u.id} value={u.id} disabled={!u.available}>
                        {u.name}{u.type ? ` · ${u.type}` : ''}{!u.available ? (u.conflict?.overdue ? ' — still checked in (overdue)' : ` — booked${u.conflict?.guest_name ? ` (${u.conflict.guest_name})` : ''}`) : u.status === 'out_of_order' ? ' — out of order now' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Guests</label>
                    <input className="form-input" type="number" min="1" value={addForm.num_guests} onChange={e => set('num_guests', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rate plan</label>
                    <select className="form-select" value={addForm.rate_plan_id} onChange={e => set('rate_plan_id', e.target.value)}>
                      {ratePlans.length === 0 && <option value="">Room Only</option>}
                      {ratePlans.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Bed preference</label>
                    <select className="form-select" value={addForm.bed_preference} onChange={e => set('bed_preference', e.target.value)}>
                      <option value="">No preference</option>
                      <option value="double">Double bed</option>
                      <option value="twin">Twin beds</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Deposit</label>
                    <select className="form-select" value={addForm.deposit_pct} onChange={e => set('deposit_pct', e.target.value)}>
                      {['0', '30', '50', '100'].map(v => <option key={v} value={v}>{v}%{price > 0 ? ` — ${fmtIDR(Math.round(price * v / 100))}` : ''}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Price for the stay (tax included)</label>
                  <input className="form-input" type="number" min="0" value={addForm.total_amount}
                    placeholder={suggested ? `Normal rate: ${suggested}` : 'Pick a room first'}
                    onChange={e => set('total_amount', e.target.value)} />
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {addForm.total_amount === ''
                      ? (suggested ? `Leave empty to charge the normal rate: ${fmtIDR(suggested)}.` : 'Leave empty to charge the room\'s normal rate.')
                      : suggested ? `Normal rate would be ${fmtIDR(suggested)}.` : ''}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Note (optional)</label>
                  <input className="form-input" value={addForm.reason} placeholder="e.g. Group asked for one more room"
                    onChange={e => set('reason', e.target.value)} />
                </div>
                {price > 0 && (
                  <div style={{ fontSize: 13, background: 'var(--surface-2, #F9FAFB)', borderRadius: 8, padding: '8px 12px' }}>
                    <div className="flex-between"><span>Room price</span><b>{fmtIDR(price)}</b></div>
                    <div className="flex-between text-muted"><span>Deposit to collect</span><span>{fmtIDR(deposit)}</span></div>
                  </div>
                )}
                {addError && <div className="alert alert-error" style={{ marginTop: 10 }}>{addError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveAddRoom}
                  disabled={addSaving || !addForm.unit_id || !(parseInt(addForm.num_guests, 10) >= 1)}>
                  {addSaving ? 'Adding…' : 'Add Room'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {assigning && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 640, width: '100%' }}>
            <div className="modal-header">
              <div className="modal-title">Assign Guests — {group.guest_name}'s group</div>
              <button className="btn btn-icon" onClick={() => setAssigning(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Pick the guest staying in each room, or add them as a new guest. Rooms you leave alone keep their current guest. {group.guest_name} stays the group's contact and billing is unchanged.
              </div>
              {assignableRooms.map(b => (
                <div key={b.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontWeight: 700 }}>{b.unit_name}</span>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      Now: {b.guest_name}{b.guest_id === group.primary_guest_id ? ' (booker)' : ''} · {b.num_guests} pax
                    </span>
                  </div>
                  <GuestPicker value={assignments[b.id] || null} onChange={v => setAssignments(a => ({ ...a, [b.id]: v }))} />
                </div>
              ))}
              {assignError && <div className="alert alert-error" style={{ marginTop: 10 }}>{assignError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAssigning(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAssignments}
                disabled={assignSaving || !Object.values(assignments).some(Boolean)}>
                {assignSaving ? 'Saving…' : `Save ${Object.values(assignments).filter(Boolean).length || ''} room${Object.values(assignments).filter(Boolean).length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'folio' && (
        <div className="card mt-3">
          <div className="card-title">Master Folio</div>
          {folioLoading && !folio ? <div className="text-muted">Loading…</div> : folio && (
            <>
              {folio.rooms.map(room => (
                <div key={room.booking_id} style={{ marginBottom: 14 }}>
                  <div className="flex-between" style={{ fontWeight: 600, marginBottom: 4 }}>
                    <Link to={`/reservations/${room.booking_id}`}>{room.unit_name}</Link>
                    <span>{fmtIDR(room.total)}</span>
                  </div>
                  {room.charges.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 12 }}>No charges posted</div>
                  ) : room.charges.map(c => (
                    <div key={c.id} className="flex-between" style={{ fontSize: 12, padding: '3px 0', color: 'var(--text-muted)' }}>
                      <span>{c.description}</span><span>{fmtIDR(c.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="divider" />
              {folio.by_type && (folio.by_type.room + folio.by_type.fnb) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Net revenue — Room {fmtIDR(folio.by_type.room)} · F&amp;B {fmtIDR(folio.by_type.fnb)}
                </div>
              )}
              {(parseFloat(folio.service_charge_rate) > 0 || parseFloat(folio.tax_rate) > 0) && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Subtotal</span><span>{fmtIDR(folio.subtotal)}</span>
                </div>
              )}
              {parseFloat(folio.service_charge_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Service Charge</span><span>{fmtIDR(folio.service_charge_amount)}</span>
                </div>
              )}
              {parseFloat(folio.tax_rate) > 0 && (
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="text-muted">Tax</span><span>{fmtIDR(folio.tax_amount)}</span>
                </div>
              )}
              <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 10 }}>
                <span>Total</span><span>{fmtIDR(folio.total)}</span>
              </div>
              <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                <span>Balance Due</span>
                <span style={{ color: parseFloat(folio.balance_due) > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                  {fmtIDR(folio.balance_due)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                To post a new charge, open the individual room's Folio tab.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
