import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import ActionMenu from '../components/ActionMenu';
import PageHeader from '../components/PageHeader';
import GuestPicker from '../components/GuestPicker';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import GroupAmendDatesModal from '../components/GroupAmendDatesModal';
import MasterFolio from '../components/MasterFolio';
import GroupBillingCard, { GroupPaymentModal } from '../components/GroupBillingCard';

const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID'); }
// '2026-10-01' → '1 Oct' (withYear → '1 Oct 2026')
function fmtDate(s, withYear = false) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

// The group's history: every room's Edit History together, newest first.
// One action on several rooms at once (group check-in, a group payment, the
// same change made to several rooms) — same person, same note, within a few
// seconds — shows as ONE entry listing the rooms.
function GroupHistory({ events }) {
  const [showAll, setShowAll] = useState(false);
  const entries = [];
  for (const ev of events) {
    const last = entries[entries.length - 1];
    const t = new Date(ev.created_at).getTime();
    if (last && last.note === ev.note && last.author_name === ev.author_name && Math.abs(last.t - t) < 5000) {
      if (!last.rooms.includes(ev.unit_name)) last.rooms.push(ev.unit_name);
    } else {
      entries.push({ key: ev.id, note: ev.note, author_name: ev.author_name, created_at: ev.created_at, t, rooms: [ev.unit_name] });
    }
  }
  const shown = showAll ? entries : entries.slice(0, 15);
  return (
    <div className="card mt-3">
      <div className="card-title">History</div>
      {entries.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13 }}>No changes logged yet.</div>
      ) : shown.map(e => (
        <div key={e.key} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <b style={{ color: 'var(--text)' }}>{e.rooms.slice().sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).join(', ')}</b>
            {' · '}{e.author_name || 'System'} · {new Date(e.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
          <div style={{ fontSize: 13 }}>{e.note}</div>
        </div>
      ))}
      {!showAll && entries.length > 15 && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>Show all ({entries.length})</button>
      )}
    </div>
  );
}

export default function GroupDetail() {
  const { groupId } = useParams();
  const { user, can } = useAuth();
  // Corrections (owner or the `corrections` permission): put a cancelled room back.
  const canCorrect = user?.role === 'owner' || can('corrections');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('details');
  const [cancellingGroup, setCancellingGroup] = useState(null);   // { reason, sure, busy, error }
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

  async function reinstateRoom(b) {
    const reason = (window.prompt(`Put room ${b.unit_name} back into this group? It must still be free for its dates.

Reason (required — goes into History):`) || '').trim();
    if (!reason) return;
    try {
      await api.put(`/api/bookings/${b.id}/reinstate`, { reason });
      setFolio(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not reinstate the room');
    }
  }

  async function loadFolio() {
    setFolioLoading(true);
    try {
      const r = await api.get(`/api/folio/group/${groupId}`);
      setFolio(r.data);
    } catch {}
    setFolioLoading(false);
  }

  useEffect(() => { if (tab === 'folio' && !folio) loadFolio(); }, [tab]);

  // kind: 'proforma' (whole stay, estimate) | 'invoice' (posted so far — only
  // for a group billed as a whole, migration 097)
  async function downloadGroupPdf(kind = 'proforma') {
    try {
      const r = await api.get(`/api/folio/group/${groupId}/${kind}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      const t = new Date();
      a.href = url;
      a.download = `${kind}-group-${groupId.slice(0, 8)}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert(`Failed to download the ${kind === 'invoice' ? 'invoice' : 'pro forma'}`);
    }
  }
  const downloadGroupProforma = () => downloadGroupPdf('proforma');

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
  const [payAmt, setPayAmt] = useState({}); // line id -> amount typed for a part payment
  const [payTotal, setPayTotal] = useState(''); // "Amount received" typed — spread over the lines
  const [payForm, setPayForm] = useState({ method: '', received_at: todayStr, reference: '', notes: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');
  const [folioPaying, setFolioPaying] = useState(false);   // group billed as a whole: Record Group Payment from the Master Folio

  // Every unpaid room payment line in the group, room by room.
  function pendingLines() {
    if (!data) return [];
    return data.bookings
      .filter(b => !['cancelled', 'no_show'].includes(b.status))
      .flatMap(b => (b.payments || [])
        .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status !== 'received' && parseFloat(p.amount) > 0)
        .map(p => ({ ...p, unit_name: b.unit_name, guest_name: b.guest_name })));
  }

  // The amount paid on a ticked line: what was typed, else the whole line.
  const lineAmount = l => (payAmt[l.id] !== undefined && payAmt[l.id] !== '' ? Math.max(0, parseFloat(payAmt[l.id]) || 0) : parseFloat(l.amount));

  // Spread an amount over the lines room by room — a room's deposit, then its
  // balance — so each room is paid off in full before the next one gets
  // anything; only the last room touched is paid in part.
  function spreadAmount(value) {
    setPayTotal(value);
    let left = Math.max(0, Math.round(parseFloat(value) || 0));
    const lines = pendingLines();
    const rank = l => (l.type === 'deposit' ? 0 : 1);
    const roomOrder = [...new Set(lines.map(l => l.booking_id))];
    const order = [...lines].sort((a, b) => roomOrder.indexOf(a.booking_id) - roomOrder.indexOf(b.booking_id) || rank(a) - rank(b));
    const sel = new Set(), amt = {};
    for (const l of order) {
      if (left <= 0) break;
      const full = parseFloat(l.amount);
      const take = Math.min(full, left);
      sel.add(l.id);
      if (take < full - 0.005) amt[l.id] = String(take);
      left -= take;
    }
    setPaySel(sel);
    setPayAmt(amt);
  }

  function openGroupPayment() {
    const lines = pendingLines();
    // Start with the deposits ticked when any are open (the usual first
    // transfer), otherwise everything that's left.
    const deposits = lines.filter(l => l.type === 'deposit');
    setPaySel(new Set((deposits.length ? deposits : lines).map(l => l.id)));
    setPayAmt({});
    setPayTotal('');
    setPayForm({ method: payMethods.find(m => m.id === 'bank_transfer')?.id || payMethods[0]?.id || '', received_at: todayStr, reference: '', notes: '' });
    setPayError('');
    setPaying(true);
  }

  async function saveGroupPayment() {
    setPaySaving(true);
    setPayError('');
    try {
      const lines = pendingLines().filter(l => paySel.has(l.id));
      await api.post(`/api/bookings/group/${groupId}/payments`, {
        lines: lines.map(l => ({ payment_id: l.id, amount: lineAmount(l) })), method: payForm.method, received_at: payForm.received_at, reference: payForm.reference, notes: payForm.notes,
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

  // The added room's dates: its own (the form), defaulting to the group's —
  // never before today.
  function groupAddDates() {
    if (!data) return null;
    const ci = data.group.check_in_date?.slice(0, 10);
    const co = data.group.check_out_date?.slice(0, 10);
    return { check_in: ci < todayStr ? todayStr : ci, check_out: co };
  }
  function addDates() {
    if (addForm?.check_in && addForm?.check_out && addForm.check_out > addForm.check_in) return { check_in: addForm.check_in, check_out: addForm.check_out };
    return groupAddDates();
  }

  function openAddRoom() {
    const d = groupAddDates();
    setAddForm({
      unit_id: '', num_guests: 2, bed_preference: '', total_amount: '', deposit_pct: '50', reason: '',
      rate_plan_id: (ratePlans.find(p => p.is_default) || ratePlans[0])?.id || '',
      check_in: d.check_in, check_out: d.check_out,
    });
    setAddSuggest(null); setAddError(''); setAdding(true);
  }

  // Free rooms for the added room's dates (re-checked when they change).
  useEffect(() => {
    if (!adding) return;
    const d = addDates();
    if (!d?.check_in || !d?.check_out) return;
    api.get('/api/bookings/transfer-availability', { params: d })
      .then(r => setAddUnits(r.data)).catch(() => setAddUnits([]));
  }, [adding, addForm?.check_in, addForm?.check_out]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adding || !addForm?.unit_id) return;
    const d = addDates();
    api.get('/api/pricing/suggest', { params: { unit_id: addForm.unit_id, ...d, rate_plan_id: addForm.rate_plan_id || '', num_guests: addForm.num_guests || 1 } })
      .then(r => setAddSuggest(r.data)).catch(() => setAddSuggest(null));
  }, [adding, addForm?.unit_id, addForm?.rate_plan_id, addForm?.num_guests, addForm?.check_in, addForm?.check_out]); // eslint-disable-line react-hooks/exhaustive-deps

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
        check_in_date: addDates().check_in, check_out_date: addDates().check_out,
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

  // ── Amend Dates, room by room (components/GroupAmendDatesModal.jsx) ──
  const [amending, setAmending] = useState(false);

  function addDaysYmd(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function openAmendGroup() { setAmending(true); }

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

  // Cancel Group: a window with the group spelled out, a required reason and
  // a tick box — never a one-click confirm.
  function cancelGroup() {
    setCancellingGroup({ reason: '', sure: false, busy: false, error: '' });
  }
  async function doCancelGroup() {
    setCancellingGroup(c => ({ ...c, busy: true, error: '' }));
    try {
      await api.delete(`/api/bookings/group/${groupId}`, { data: { reason: cancellingGroup.reason.trim() } });
      setCancellingGroup(null);
      setFolio(null);
      load();
    } catch (err) {
      setCancellingGroup(c => ({ ...c, busy: false, error: err.response?.data?.error || 'Failed to cancel group' }));
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
  // Rooms with their own dates (not all the same) — shown per room.
  const mixedDates = new Set(bookings.filter(b => !['cancelled', 'no_show'].includes(b.status))
    .map(b => `${String(b.check_in_date).slice(0, 10)}|${String(b.check_out_date).slice(0, 10)}`)).size > 1;
  const activeRoomCount = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status)).length;
  const activeRooms = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status));
  const groupNights = Math.max(0, Math.round((new Date(group.check_out_date?.slice(0, 10)) - new Date(group.check_in_date?.slice(0, 10))) / 86400000));
  const groupPax = activeRooms.reduce((sum, b) => sum + (parseInt(b.num_guests, 10) || 0), 0);
  // The group's agent(s) (migration 084) — one normally; set per room in Edit Details.
  const groupAgents = [...new Set(activeRooms.map(b => b.agent_name).filter(Boolean))];
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
          groupAgents.length > 0 && `Agent: ${groupAgents.join(', ')}`,
        ].filter(Boolean)}
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
              items={[
                data.bill && { label: 'Group Invoice', icon: '🧾', hint: 'The group\'s one bill — charges posted so far, group payments, balance', onClick: () => downloadGroupPdf('invoice') },
                { label: data.bill ? 'Group Pro Forma' : 'Pro Forma', icon: '📋', hint: 'Estimate — projected total across every room in the group', onClick: downloadGroupProforma },
              ].filter(Boolean)}
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
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {mixedDates && <><b style={{ color: 'var(--text)' }}>{fmtDate(b.check_in_date)} → {fmtDate(b.check_out_date, true)}</b> · </>}
                    {b.num_guests} guest{b.num_guests !== 1 ? 's' : ''} · {fmtIDR(b.total_amount)}
                  </div>
                </div>
                <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {(() => {
                    // Billed as a whole (migration 097): the room price is on
                    // the group's bill — only the room's own extras are its own.
                    if (data.bill) {
                      const own = data.bill.rooms.find(r => r.booking_id === b.id)?.own_balance || 0;
                      if (own < 1) return null;
                      return (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--color-danger, #dc2626)', fontWeight: 600 }} title="Extras this room pays itself">{fmtIDR(own)} own extras</span>
                          <Link to={`/reservations/${b.id}#record-payment`} className="btn btn-sm btn-secondary">Pay →</Link>
                        </>
                      );
                    }
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
                  {canCorrect && b.status === 'cancelled' && (
                    <button className="btn btn-sm btn-secondary" title="Cancelled by mistake — put this room back if it is still free"
                      onClick={() => reinstateRoom(b)}>↩ Reinstate</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.bill && (
            <GroupBillingCard groupId={groupId} bill={data.bill} rollup={rollup}
              canPay={group.status !== 'cancelled'}
              onChanged={() => { load(); if (folio) loadFolio(); }} />
          )}

          {!data.bill && <div className="card mb-3">
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
          </div>}

          <GroupHistory events={data.events || []} />
        </>
      )}

      {paying && (() => {
        const lines = pendingLines();
        const picked = lines.filter(l => paySel.has(l.id));
        const total = picked.reduce((sum, l) => sum + lineAmount(l), 0);
        const unpaid = lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
        const badLine = picked.find(l => !(lineAmount(l) > 0) || lineAmount(l) > parseFloat(l.amount) + 0.005);
        const typedTotal = Math.round(parseFloat(payTotal) || 0);
        const pick = ids => { setPaySel(new Set(ids)); setPayAmt({}); setPayTotal(''); };
        const toggle = lineId => {
          setPaySel(sel => { const n = new Set(sel); if (n.has(lineId)) n.delete(lineId); else n.add(lineId); return n; });
          setPayAmt(a => { const n = { ...a }; delete n[lineId]; return n; });
          setPayTotal('');
        };
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Record Group Payment</div>
                <button className="btn btn-icon" onClick={() => setPaying(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Amount received (IDR)</label>
                  <input className="form-input" type="number" min={0} value={payTotal}
                    placeholder={`What the group paid — up to ${fmtIDR(unpaid)}`}
                    onChange={e => spreadAmount(e.target.value)} />
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Pays the rooms one by one in the order below (deposit, then balance) — each room in full before the next. Or tick the lines yourself.
                  </div>
                  {typedTotal > unpaid + 0.5 && (
                    <div className="alert alert-warn" style={{ marginTop: 6, fontSize: 12 }}>
                      <div>More than the rooms still owe ({fmtIDR(unpaid)}). Record {fmtIDR(unpaid)} here; money for extras goes on that room's folio.</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                  <span className="text-muted" style={{ fontSize: 13, alignSelf: 'center' }}>Or pick:</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => pick(lines.filter(l => l.type === 'deposit').map(l => l.id))}>All deposits</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => pick(lines.map(l => l.id))}>Everything unpaid</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => pick([])}>Clear</button>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
                  <div className="flex-between text-muted" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <span>Line · due</span><span>Paying now</span>
                  </div>
                  {lines.map(l => {
                    const on = paySel.has(l.id);
                    const part = on && lineAmount(l) < parseFloat(l.amount) - 0.005;
                    return (
                      <div key={l.id} className="flex-between" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 8 }}>
                        <label className="flex gap-2" style={{ alignItems: 'center', cursor: 'pointer', minWidth: 0, flexWrap: 'wrap' }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(l.id)} />
                          <b>{l.unit_name}</b>
                          <span style={{ textTransform: 'capitalize' }}>{l.type}</span>
                          <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtIDR(l.amount)}</span>
                        </label>
                        {on ? (
                          <span style={{ textAlign: 'right' }}>
                            <input className="form-input" type="number" min={1} max={Math.round(parseFloat(l.amount))}
                              style={{ width: 130, textAlign: 'right', padding: '4px 8px' }}
                              value={payAmt[l.id] !== undefined ? payAmt[l.id] : String(Math.round(parseFloat(l.amount) * 100) / 100)}
                              onChange={e => { const v = e.target.value; setPayAmt(a => ({ ...a, [l.id]: v })); setPayTotal(''); }} />
                            {part && <div className="text-muted" style={{ fontSize: 11 }}>part · {fmtIDR(parseFloat(l.amount) - lineAmount(l))} stays open</div>}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </div>
                    );
                  })}
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
                  <label className="form-label">Reference</label>
                  <input className="form-input" value={payForm.reference || ''} maxLength={120} placeholder="Card trace no. / transfer ref" onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={payForm.notes} placeholder="Optional" onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                  <span>Total received</span><span>{fmtIDR(total)}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  A line paid in part stays open for the rest. A room counts as deposit paid once its whole deposit is in.
                </div>
                {badLine && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}><div>Room {badLine.unit_name} {badLine.type}: the amount must be between Rp 1 and {fmtIDR(badLine.amount)}.</div></div>}
                {payError && <div className="alert alert-error" style={{ marginTop: 10 }}>{payError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setPaying(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveGroupPayment} disabled={paySaving || paySel.size === 0 || !payForm.method || !!badLine}>
                  {paySaving ? 'Saving…' : `Record ${fmtIDR(total)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {folioPaying && data.bill && (
        <GroupPaymentModal groupId={groupId} balance={data.bill.balance_due}
          onClose={() => setFolioPaying(false)}
          onSaved={() => { setFolioPaying(false); load(); loadFolio(); }} />
      )}

      {amending && (
        <GroupAmendDatesModal groupId={groupId} groupName={group.guest_name} rooms={amendableRooms}
          onClose={() => setAmending(false)}
          onDone={async () => { setAmending(false); await load(); if (folio) loadFolio(); }} />
      )}

      {cancellingGroup && (() => {
        const toCancel = bookings.filter(b => ['pending', 'deposit_paid', 'confirmed'].includes(b.status));
        const inHouse = bookings.filter(b => b.status === 'checked_in');
        const received = parseFloat(data.bill ? data.bill.received : rollup.paid_amount) || 0;
        return (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <div className="modal-title">Cancel this whole group?</div>
                <button className="btn btn-icon" onClick={() => setCancellingGroup(null)}>✕</button>
              </div>
              <div className="modal-body">
                {cancellingGroup.error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{cancellingGroup.error}</div></div>}
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={{ fontWeight: 700 }}>{group.guest_name}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    {group.check_in_date?.slice(0, 10)} → {group.check_out_date?.slice(0, 10)} · {toCancel.length} room{toCancel.length === 1 ? '' : 's'} will be cancelled
                    {toCancel.length > 0 && <>: {toCancel.map(b => b.unit_name).join(', ')}</>}
                  </div>
                </div>
                {inHouse.length > 0 ? (
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <div>{inHouse.length} room{inHouse.length === 1 ? ' is' : 's are'} checked in ({inHouse.map(b => b.unit_name).join(', ')}) — a group with guests in house can't be cancelled as a whole. Use <b>Remove</b> on the rooms that aren't coming instead.</div>
                  </div>
                ) : (
                  <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                    <div>
                      Every room of this group that hasn't arrived is cancelled and becomes free for other guests.
                      {received > 0
                        ? <> <b>{fmtIDR(received)} has been received</b> from this group — it stays recorded and has to be given back by hand.</>
                        : <> No payment has been received from it.</>}
                      {' '}If only some rooms aren't coming, use <b>Remove</b> on those rooms instead.
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Reason (required — goes into History)</label>
                  <input className="form-input" autoFocus value={cancellingGroup.reason} placeholder="e.g. the company cancelled the event"
                    onChange={e => setCancellingGroup(c => ({ ...c, reason: e.target.value }))} />
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cancellingGroup.sure} onChange={e => setCancellingGroup(c => ({ ...c, sure: e.target.checked }))} />
                  Yes, cancel the whole group of {group.guest_name}
                </label>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setCancellingGroup(null)}>Keep the group</button>
                <button className="btn btn-danger" onClick={doCancelGroup}
                  disabled={cancellingGroup.busy || !cancellingGroup.sure || !cancellingGroup.reason.trim() || inHouse.length > 0}>
                  {cancellingGroup.busy ? 'Cancelling…' : 'Cancel group'}
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
                <div className="form-row form-row-dates">
                  <div className="form-group">
                    <label className="form-label">Check-in</label>
                    <input className="form-input" type="date" value={addForm.check_in} min={todayStr}
                      onChange={e => { const v = e.target.value; setAddForm(f => ({ ...f, check_in: v, check_out: v ? addDaysYmd(v, nights) : f.check_out, unit_id: '' })); }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nights</label>
                    <input className="form-input" type="number" min={1} max={365} value={nights}
                      onChange={e => { const n = parseInt(e.target.value, 10); if (n >= 1) setAddForm(f => ({ ...f, check_out: addDaysYmd(f.check_in, n), unit_id: '' })); }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Check-out</label>
                    <input className="form-input" type="date" value={addForm.check_out} min={addForm.check_in ? addDaysYmd(addForm.check_in, 1) : undefined}
                      onChange={e => { const v = e.target.value; setAddForm(f => ({ ...f, check_out: v, unit_id: '' })); }} />
                  </div>
                </div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  The group's dates by default — change them if this room stays differently. Booked under {group.guest_name} (use Assign Guests for the real guest). The group discount isn't applied to an added room.
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
            <MasterFolio folio={folio}
              onRecordGroupPayment={data.bill ? (group.status !== 'cancelled' ? () => setFolioPaying(true) : null)
                : pendingLines().length > 0 ? openGroupPayment : null} />
          )}
        </div>
      )}
    </div>
  );
}
