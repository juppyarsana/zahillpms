import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import BackLink from '../components/BackLink';
import api from '../services/api';
import StayNightsPicker from '../components/StayNightsPicker';
import { useSettings } from '../context/SettingsContext';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { shownAmount, includesText } from '../lib/priceBasis';
import BookingAgentFields from '../components/BookingAgentFields';
import { CITY_LEDGER, HAS_COMMISSION, commissionText as fmtCommission, EMPTY_AGENT_VALUE, agentBody } from '../lib/agents';

// Staff-facing heads-up when the booking's agent (migration 084) has a
// billing arrangement: billed to the agent at checkout and/or a commission.
function AgentBillingNote({ value }) {
  const agent = value?.agent;
  if (!agent || !agent.payment_status || agent.payment_status === 'normal') return null;
  const cityLedger = CITY_LEDGER.includes(agent.payment_status);
  const commission = HAS_COMMISSION.includes(agent.payment_status)
    && (value.own && value.amount !== '' ? fmtCommission(value.type, value.amount) : fmtCommission(agent.commission_type, agent.commission_value));
  const commissionText = commission ? ` Commission to ${agent.name}: ${commission}.` : '';
  const msg = cityLedger
    ? `Billed to ${agent.name} — settled via the agent statement, not collected from the guest at checkout.${commissionText}`
    : `The guest pays the hotel; ${agent.name} earns a commission on this booking.${commissionText}`;
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 10px' }}>
      {msg}
    </div>
  );
}

// Warn-only heads-up when a booking would push an agent source past its
// credit limit. Never blocks submission (client decision, locked 2026-08-31).
function CreditLimitNote({ check }) {
  if (!check || !check.would_exceed) return null;
  const fmt = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 10px' }}>
      ⚠ {check.label} would be over its credit limit — {fmt(check.projected_outstanding)} projected vs {fmt(check.credit_limit)} limit
      ({fmt(check.over_by)} over). The booking is still allowed; settle the agent statement to bring the balance down.
    </div>
  );
}

function sourceMatchesAllotment(source, allotmentChannel) {
  if (allotmentChannel === 'buffer') return false;
  if (source === 'walkin') return allotmentChannel === 'direct';
  return source === allotmentChannel;
}

function AllotmentNote({ allotment, source, checkIn, sources }) {
  const monthLabel = new Date(checkIn + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' });
  const ch = allotment.channel;
  const matches = sourceMatchesAllotment(source, ch);
  function chLabel(id) {
    if (id === 'buffer') return 'Buffer';
    return sources.find(s => s.id === id)?.label || id;
  }

  if (ch === 'buffer') {
    return (
      <div className="alert alert-error" style={{ marginTop: 0 }}>
        ⚠ This unit is set as <strong>Buffer</strong> for {monthLabel} — it's reserved to prevent double-booking.
        Override only if intentional.
      </div>
    );
  }

  if (!matches) {
    return (
      <div style={{ marginTop: 0, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '10px 12px', color: '#92400e' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          ⚠ Channel mismatch: {chLabel(ch)} allotment · {chLabel(source) || source} booking
        </div>
        <div style={{ fontSize: 12, marginTop: 3 }}>
          This unit is allocated to {chLabel(ch)} for {monthLabel}. Close it on {chLabel(ch)} first to avoid double-booking.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
      ✓ Allotment for {monthLabel}: <strong>{chLabel(ch)}</strong>
      {allotment.notes && <span> · {allotment.notes}</span>}
    </div>
  );
}

// YYYY-MM-DD date math on local calendar dates (toISOString is UTC).
function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

const idr = n => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

// A typed room total far from the normal price for the stay is usually a
// nightly price typed into the whole-stay field (or an extra zero).
function priceWarning(total, normal, nights) {
  const t = parseFloat(total);
  if (!t || !normal) return null;
  const ratio = t / normal;
  if (ratio < 0.6) {
    return nights > 1 && Math.abs(t * nights - normal) / normal < 0.4
      ? `Much lower than the normal price for ${nights} nights (${idr(normal)}). Did you type one night's price? This field is the whole stay.`
      : `Much lower than the normal price for ${nights} night${nights > 1 ? 's' : ''} (${idr(normal)}).`;
  }
  if (ratio > 1.5) return `Much higher than the normal price for ${nights} night${nights > 1 ? 's' : ''} (${idr(normal)}). Check for an extra zero.`;
  return null;
}

// extra: an extra bed (any per-night Sales item) booked with the room —
// { product_id, quantity, nights: ['YYYY-MM-DD', …] | null } or null —
// nights null = every night of the stay (follows the dates).
// own_dates (group rooms): this room has its own check-in / check-out
// (check_in_date / check_out_date) instead of the booking's dates.
// per_night (migration 090): a price for each night (night_amounts, by date);
// total_amount is then their sum.
const EMPTY_ROOM = { unit_id: '', num_guests: 1, total_amount: '', rate_plan_id: '', bed_preference: '', extra: null,
  own_dates: false, check_in_date: '', check_out_date: '', per_night: false, night_amounts: {} };
// Sources whose guests pay extras at the hotel, outside the OTA / agent's
// money: the extra bed isn't part of the deposit asked.
const AGENT_SOURCE_TYPES = ['ota', 'travel_agent', 'wholesaler', 'company'];

const BED_PREFS = [
  ['', 'No preference'],
  ['double', 'Double bed'],
  ['twin', 'Twin beds'],
];

export default function NewBooking() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { sources, ratePlans, branding } = useSettings();
  const [units, setUnits] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestSearch, setGuestSearch] = useState('');
  const [pickedGuest, setPickedGuest] = useState(null);   // the guest chosen from the search list
  // Pre-fill: from a calendar cell (?unit=&date=, 1 night) or from Check
  // Availability (?check_in=&check_out=&units=a,b&guests=2,2 — 2+ units open
  // as a group booking).
  const preIn = sp.get('check_in') || sp.get('date') || '';
  const preOut = sp.get('check_out') || (sp.get('date') ? addDaysYmd(sp.get('date'), 1) : '');
  const preUnits = (sp.get('units') || sp.get('unit') || '').split(',').filter(Boolean);
  const preGuests = (sp.get('guests') || '').split(',').map(g => parseInt(g, 10) || 1);
  const { can } = useAuth();
  // Complimentary stay (single room): the booking is created at its normal
  // price, then made free on the booking page (ComplimentaryModal) — directly
  // with the permission, otherwise via a manager's Telegram approval code.
  const [comp, setComp] = useState({ on: false, scope: 'room', reason: '' });
  // A group is billed as a whole (migration 097): what the group pays.
  const [groupPays, setGroupPays] = useState('room_meals');
  const [form, setForm] = useState({
    guest_id: '',
    check_in_date: preIn, check_out_date: preOut,
    source: 'direct', deposit_mode: 'amount', deposit_value: '', deposit_pct: 50, special_requests: '', status: 'pending',
    discount_type: '', discount_value: '',
  });
  const [rooms, setRooms] = useState(preUnits.length
    ? preUnits.map((id, i) => ({ ...EMPTY_ROOM, unit_id: id, num_guests: preGuests[i] || 1 }))
    : [{ ...EMPTY_ROOM }]);
  const [newGuest, setNewGuest] = useState({ name: '', whatsapp: '', nationality: '', email: '' });
  const [mode, setMode] = useState('search');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceSuggestions, setPriceSuggestions] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [creditCheck, setCreditCheck] = useState(null);
  const [agentVal, setAgentVal] = useState(EMPTY_AGENT_VALUE);   // the booking's agent + commission (084)
  const [showAgent, setShowAgent] = useState(false);
  // Nights ↔ check-out stay in sync: type nights and check-out follows, pick
  // check-out and nights follows; moving check-in keeps the number of nights.
  const [nights, setNights] = useState(preIn && preOut && preOut > preIn ? String(nightsBetween(preIn, preOut)) : '');
  // Every unit's availability for the chosen dates (booked / free), so the
  // Unit dropdown can grey out rooms that are taken.
  const [availByRange, setAvailByRange] = useState({});   // 'in|out' → { unitId: availability }
  const [nightItems, setNightItems] = useState([]);   // per-night Sales items (extra bed)

  const isGroup = rooms.length > 1;
  // Review step: "Create Booking" first shows a summary to confirm.
  const [review, setReview] = useState(false);
  const stayNights = form.check_in_date && form.check_out_date && form.check_out_date > form.check_in_date
    ? nightsBetween(form.check_in_date, form.check_out_date) : 0;
  // A room's own dates (group rooms with "Different dates"), else the booking's.
  const roomIn = r => (isGroup && r.own_dates && r.check_in_date) || form.check_in_date;
  const roomOut = r => (isGroup && r.own_dates && r.check_out_date) || form.check_out_date;
  const roomNights = r => (roomIn(r) && roomOut(r) && roomOut(r) > roomIn(r) ? nightsBetween(roomIn(r), roomOut(r)) : 0);
  const roomDates = r => {
    const out = [];
    for (let d = roomIn(r); d && roomOut(r) && d < roomOut(r); d = addDaysYmd(d, 1)) out.push(d);
    return out;
  };
  const anyOwnDates = isGroup && rooms.some(r => r.own_dates);

  function onCheckIn(v) {
    const n = parseInt(nights, 10) || 1;
    setNights(String(n));
    setForm(f => ({ ...f, check_in_date: v, check_out_date: v ? addDaysYmd(v, n) : f.check_out_date }));
  }
  function onNights(v) {
    setNights(v);
    const n = parseInt(v, 10);
    if (n >= 1 && form.check_in_date) setForm(f => ({ ...f, check_out_date: addDaysYmd(f.check_in_date, n) }));
  }
  function onCheckOut(v) {
    setForm(f => ({ ...f, check_out_date: v }));
    if (v && form.check_in_date && v > form.check_in_date) setNights(String(nightsBetween(form.check_in_date, v)));
  }
  // The same for a group room with its own dates: moving check-in keeps its
  // nights, nights moves check-out, check-out sets the nights.
  function roomCheckIn(i, v) {
    setRooms(rs => rs.map((r, idx) => {
      if (idx !== i) return r;
      const n = r.check_in_date && r.check_out_date > r.check_in_date ? nightsBetween(r.check_in_date, r.check_out_date) : 1;
      return { ...r, check_in_date: v, check_out_date: v ? addDaysYmd(v, n) : r.check_out_date };
    }));
  }
  function roomNightsInput(i, v) {
    const n = parseInt(v, 10);
    if (!(n >= 1)) return;
    setRooms(rs => rs.map((r, idx) => (idx === i && r.check_in_date ? { ...r, check_out_date: addDaysYmd(r.check_in_date, n) } : r)));
  }

  // Every unit's availability for each set of dates in use (a room with its
  // own dates gets its own), so the Unit dropdown greys out rooms that are
  // taken for THAT room's dates.
  const rangeKey = r => (roomNights(r) ? `${roomIn(r)}|${roomOut(r)}` : '');
  const rangesKey = [...new Set(rooms.map(rangeKey).filter(Boolean))].sort().join(',');
  useEffect(() => {
    for (const key of rangesKey ? rangesKey.split(',') : []) {
      if (availByRange[key]) continue;
      const [ci, co] = key.split('|');
      api.get('/api/bookings/transfer-availability', { params: { check_in: ci, check_out: co } })
        .then(r => setAvailByRange(m => ({ ...m, [key]: Object.fromEntries(r.data.map(u => [u.id, u])) })))
        .catch(() => {});
    }
  }, [rangesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dropdown label + whether it can be picked for room row `i`.
  function unitOption(u, i) {
    const otherRow = rooms.findIndex((r, j) => j !== i && r.unit_id === u.id);
    const a = (availByRange[rangeKey(rooms[i])] || {})[u.id];
    let note = '';
    let blocked = false;
    if (otherRow !== -1) { note = ` — already in this group (Room ${otherRow + 1})`; blocked = true; }
    else if (a && !a.available) {
      note = a.conflict?.overdue
        ? ` — ${a.conflict.guest_name} still checked in (overdue)`
        : ` — booked${a.conflict?.guest_name ? ` (${a.conflict.guest_name})` : ''}`;
      blocked = true;
    }
    // Out of order is a current status, not date-based — the room may be back
    // by these dates, so it's flagged but still selectable.
    else if (u.status === 'out_of_order') note = ' — out of order now';
    return { label: `${u.name}${u.type ? ` · ${u.type}` : ''}${note}`, disabled: blocked && rooms[i].unit_id !== u.id };
  }

  useEffect(() => {
    api.get('/api/units').then(r => setUnits(r.data));
    // Per-night Sales items (extra bed…) that can be booked with a room.
    api.get('/api/products').then(r => setNightItems(r.data.filter(p => p.per_night && p.is_available !== false
      && !['food', 'drinks'].includes(p.category)))).catch(() => {});
  }, []);

  // Default every room's rate plan to the property default once plans load.
  const defaultRatePlanId = (ratePlans.find(p => p.is_default) || ratePlans[0])?.id || '';
  useEffect(() => {
    if (!defaultRatePlanId) return;
    setRooms(rs => rs.map(r => r.rate_plan_id ? r : { ...r, rate_plan_id: defaultRatePlanId }));
  }, [defaultRatePlanId]);

  useEffect(() => {
    // A guest was just picked: their name is in the box — don't search it again.
    if (pickedGuest && guestSearch === pickedGuest.name) return;
    if (guestSearch.length >= 2) {
      api.get(`/api/guests?search=${encodeURIComponent(guestSearch)}`).then(r => setGuests(r.data));
    } else {
      setGuests([]);
    }
  }, [guestSearch]); // eslint-disable-line react-hooks/exhaustive-deps -- search only when the text changes

  const unitIdsKey = rooms.map(r => `${r.unit_id}:${roomIn(r)}:${roomOut(r)}`).join(',');
  const suggestKey = rooms.map(r => `${r.unit_id}:${r.rate_plan_id}:${r.num_guests}:${roomIn(r)}:${roomOut(r)}`).join(',');

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date) { setPriceSuggestions([]); return; }
    Promise.all(rooms.map(r => r.unit_id && roomNights(r)
      ? api.get(`/api/pricing/suggest?unit_id=${r.unit_id}&check_in=${roomIn(r)}&check_out=${roomOut(r)}&rate_plan_id=${r.rate_plan_id || ''}&num_guests=${r.num_guests || 1}`).then(res => res.data).catch(() => null)
      : Promise.resolve(null)
    )).then(setPriceSuggestions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey, form.check_in_date, form.check_out_date]);

  useEffect(() => {
    if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) { setAvailabilities([]); return; }
    setAvailabilityLoading(true);
    Promise.all(rooms.map(r => r.unit_id && roomNights(r)
      ? api.get(`/api/bookings/availability?unit_id=${r.unit_id}&check_in=${roomIn(r)}&check_out=${roomOut(r)}`).then(res => res.data).catch(() => null)
      : Promise.resolve(null)
    )).then(setAvailabilities).finally(() => setAvailabilityLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIdsKey, form.check_in_date, form.check_out_date]);

  // Extra bed per room: every night of the stay by default (kept in step
  // with the dates), priced from the Sales item — incl. service & tax like
  // the room total (prices before tax get them added).
  const extraNights = r => {
    if (!r.extra) return [];
    const dates = roomDates(r);
    return (r.extra.nights ?? dates).filter(d => dates.includes(d));
  };
  const taxF = branding?.prices_include_tax ? 1
    : (1 + (parseFloat(branding?.service_charge_rate) || 0) / 100) * (1 + (parseFloat(branding?.tax_rate) || 0) / 100);
  function extraTotal(r) {
    if (!r.extra?.product_id) return 0;
    const item = nightItems.find(p => p.id === r.extra.product_id);
    if (!item) return 0;
    return Math.round(parseFloat(item.price) * (parseInt(r.extra.quantity, 10) || 1) * extraNights(r).length * taxF);
  }
  const extrasTotal = rooms.reduce((s, r) => s + extraTotal(r), 0);
  const srcObj = sources.find(s => s.id === form.source);
  const extrasInDeposit = !(srcObj?.is_ota || AGENT_SOURCE_TYPES.includes(srcObj?.source_type) || CITY_LEDGER.includes(agentVal.agent?.payment_status));
  // The agent field shows by itself for Travel Agent / Corporate / Wholesaler sources.
  const agentFieldShown = showAgent || !!agentVal.agent || ['travel_agent', 'company', 'wholesaler'].includes(srcObj?.source_type);

  const groupTotal = rooms.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const dValue     = parseFloat(form.discount_value || 0);
  const discountAmt = !form.discount_type || !dValue ? 0
    : form.discount_type === 'fixed' ? Math.min(dValue, groupTotal)
    : Math.round(groupTotal * dValue / 100);
  const netAmt = groupTotal - discountAmt;
  // The deposit asked covers room + extra bed (direct guests); it's held on
  // the room's deposit line, never more than the room itself.
  const depositFor = pct => Math.min(netAmt, Math.round((netAmt + (extrasInDeposit ? extrasTotal : 0)) * pct / 100));
  // Typed as an amount (the default) or as a percentage.
  const depositAmt = form.deposit_mode === 'pct'
    ? depositFor(form.deposit_pct)
    : Math.min(netAmt, Math.max(0, Math.round(parseFloat(form.deposit_value) || 0)));
  const depositOver = form.deposit_mode !== 'pct' && (parseFloat(form.deposit_value) || 0) > netAmt && netAmt > 0;

  const agentId = agentVal.agent?.id;
  const agentHasLimit = agentVal.agent?.credit_limit != null;
  useEffect(() => {
    if (!agentId || !agentHasLimit) { setCreditCheck(null); return; }
    const t = setTimeout(() => {
      api.get(`/api/agent-directory/${agentId}/credit-check?amount=${netAmt}`)
        .then(r => setCreditCheck({ ...r.data, label: r.data.name }))
        .catch(() => setCreditCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [agentId, agentHasLimit, netAmt]);

  // Form submit only checks the form and opens the review; createBooking()
  // (the review's Confirm) actually saves.
  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'new' ? !newGuest.name.trim() : !form.guest_id) { setError('Select or create a guest'); return; }
    if (rooms.some(r => !r.unit_id)) { setError('Select a unit for every room'); return; }
    if (rooms.some(r => !parseFloat(r.total_amount || 0))) { setError('Please enter the total amount for every room'); return; }
    if (isGroup && rooms.some(r => r.own_dates && !roomNights(r))) { setError('A room with its own dates needs a check-out after its check-in'); return; }
    if (comp.on && !isGroup && !comp.reason.trim()) { setError('Give a reason for the complimentary stay'); return; }
    setReview(true);
  }

  async function createBooking() {
    setError('');
    setLoading(true);
    try {
      let guestId = form.guest_id;
      if (mode === 'new') {
        const r = await api.post('/api/guests', newGuest);
        guestId = r.data.id;
        // If the booking itself fails, a retry reuses this guest (no duplicate).
        setForm(f => ({ ...f, guest_id: guestId }));
        setPickedGuest({ id: guestId, name: newGuest.name, whatsapp: newGuest.whatsapp, nationality: newGuest.nationality });
        setGuestSearch(newGuest.name);
        setMode('search');
      }
      const compOn = comp.on && !isGroup;
      const deposit_amount = compOn ? 0 : depositAmt;

      if (!isGroup) {
        // Single-room booking — same endpoint and payload shape as before
        // this feature existed. No proration, no group ever created.
        const room = rooms[0];
        const res = await api.post('/api/bookings', {
          guest_id: guestId,
          unit_id: room.unit_id,
          num_guests: room.num_guests,
          total_amount: room.total_amount,
          ...(room.per_night ? { night_prices: roomDates(room).map(d => ({ date: d, amount: parseFloat(room.night_amounts[d]) || 0 })) } : {}),
          check_in_date: form.check_in_date,
          check_out_date: form.check_out_date,
          source: form.source,
          ...agentBody(agentVal),
          status: form.status,
          special_requests: form.special_requests,
          deposit_amount,
          discount_type: form.discount_type || null,
          discount_value: dValue,
          rate_plan_id: room.rate_plan_id || null,
          bed_preference: room.bed_preference || null,
        });
        await addExtras([{ booking_id: res.data.id, room }]);
        nav(`/reservations/${res.data.id}`, compOn ? { state: { complimentary: { scope: comp.scope, reason: comp.reason.trim() } } } : undefined);
      } else {
        const res = await api.post('/api/bookings/group', {
          guest_id: guestId,
          check_in_date: form.check_in_date,
          check_out_date: form.check_out_date,
          source: form.source,
          ...agentBody(agentVal),
          status: form.status,
          special_requests: form.special_requests,
          group_discount_type: form.discount_type || null,
          group_discount_value: dValue,
          group_deposit_amount: deposit_amount,
          billing_mode: groupPays,
          rooms: rooms.map(r => ({ unit_id: r.unit_id, num_guests: r.num_guests, total_amount: r.total_amount, rate_plan_id: r.rate_plan_id || null, bed_preference: r.bed_preference || null,
            check_in_date: roomIn(r), check_out_date: roomOut(r), ...(r.per_night ? { night_prices: roomDates(r).map(d => ({ date: d, amount: parseFloat(r.night_amounts[d]) || 0 })) } : {}) })),
        });
        const byUnit = Object.fromEntries((res.data.bookings || []).map(b => [b.unit_id, b.id]));
        await addExtras(rooms.map(room => ({ booking_id: byUnit[room.unit_id], room })));
        nav(`/reservations/group/${res.data.group.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create booking');
      setReview(false);
    } finally {
      setLoading(false);
    }
  }

  // Each room's extra bed goes on its booking exactly as "Extras for this
  // stay" would add it (a room-charge Sales sale for those nights). The
  // booking already exists if this fails — say so, it can be added there.
  async function addExtras(list) {
    const failed = [];
    for (const { booking_id, room } of list) {
      const nightsFor = extraNights(room);
      if (!booking_id || !room.extra?.product_id || !nightsFor.length) continue;
      try {
        await api.post('/api/sales', { booking_id, payment_method: 'room_charge',
          items: [{ product_id: room.extra.product_id, quantity: parseInt(room.extra.quantity, 10) || 1, nights: nightsFor }] });
      } catch (err) {
        failed.push(err.response?.data?.error || 'error');
      }
    }
    if (failed.length) alert(`The booking was created, but the extra bed could not be added (${failed.join('; ')}). Add it from "Extras for this stay" on the booking.`);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setRoom(i, k, v) { setRooms(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r)); }
  // A price per night: the room's total is the sum of its nights.
  const nightSum = (r, amounts) => roomDates(r).reduce((t, d) => t + (parseFloat(amounts[d]) || 0), 0);
  function setNightAmount(i, date, v) {
    setRooms(rs => rs.map((r, idx) => {
      if (idx !== i) return r;
      const night_amounts = { ...r.night_amounts, [date]: v };
      return { ...r, night_amounts, total_amount: String(nightSum(r, night_amounts)) };
    }));
  }
  // Start the nights from the suggested rate when it differs by night and no
  // other price was typed; otherwise from the typed total, spread evenly.
  function setPerNight(i, on, suggestion) {
    setRooms(rs => rs.map((r, idx) => {
      if (idx !== i) return r;
      if (!on) return { ...r, per_night: false };
      const dates = roomDates(r);
      const typed = parseFloat(r.total_amount) || 0;
      const bd = suggestion?.night_breakdown || [];
      const fromSuggestion = bd.length === dates.length && bd.every(n => n.night_total != null)
        && (!typed || Math.abs(typed - suggestion.grand_total) < 1);
      const each = dates.length ? Math.round(typed / dates.length) : 0;
      const night_amounts = Object.fromEntries(dates.map((d, k) => [d, String(
        fromSuggestion ? bd[k].night_total : (k === dates.length - 1 ? Math.round(typed - each * (dates.length - 1)) : each))]));
      return { ...r, per_night: true, night_amounts, total_amount: String(nightSum(r, night_amounts)) };
    }));
  }
  function addRoom() { setRooms(rs => [...rs, { ...EMPTY_ROOM }]); }
  function removeRoom(i) { setRooms(rs => rs.filter((_, idx) => idx !== i)); }

  const perNightKey = rooms.map(r => (r.per_night ? `${roomIn(r)}|${roomOut(r)}` : '')).join(',');
  useEffect(() => {
    setRooms(rs => rs.map(r => {
      if (!r.per_night) return r;
      if (roomNights(r) < 2) return { ...r, per_night: false };
      const t = String(nightSum(r, r.night_amounts));
      return t === String(r.total_amount) ? r : { ...r, total_amount: t };
    }));
  }, [perNightKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyUnavailable = availabilities.some(a => a && a.available === false);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">New Booking</div>
          <div className="page-subtitle"><BackLink to="/reservations" label="Reservations" /></div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card mb-3">
          <div className="card-title">Guest</div>
          <div className="flex gap-2 mb-3">
            <button type="button" className={`btn btn-sm ${mode==='search'?'btn-primary':'btn-secondary'}`} onClick={() => setMode('search')}>Search Existing</button>
            <button type="button" className={`btn btn-sm ${mode==='new'?'btn-primary':'btn-secondary'}`} onClick={() => setMode('new')}>New Guest</button>
          </div>

          {mode === 'search' ? (
            <div>
              <div className="form-group">
                <label className="form-label">Search Guest</label>
                <input className="form-input" placeholder="Name, phone, or email…" value={guestSearch}
                  onChange={e => {
                    setGuestSearch(e.target.value);
                    // Typing something else un-picks the guest.
                    if (pickedGuest && e.target.value !== pickedGuest.name) { setPickedGuest(null); set('guest_id', ''); }
                  }} />
              </div>
              {pickedGuest && form.guest_id === pickedGuest.id && (
                <div className="flex-between" style={{ marginTop: -4, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--green-pale)' }}>
                  <span style={{ fontSize: 13 }}>
                    ✓ <b>{pickedGuest.name}</b>
                    {[pickedGuest.whatsapp, pickedGuest.nationality].filter(Boolean).length > 0 && (
                      <span className="text-muted"> · {[pickedGuest.whatsapp, pickedGuest.nationality].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost"
                    onClick={() => { setPickedGuest(null); set('guest_id', ''); setGuestSearch(''); setGuests([]); }}>Change</button>
                </div>
              )}
              {guests.length > 0 && !(pickedGuest && form.guest_id === pickedGuest.id) && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: -4 }}>
                  {guests.map(g => (
                    <div key={g.id} onClick={() => { set('guest_id', g.id); setPickedGuest(g); setGuestSearch(g.name); setGuests([]); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: form.guest_id === g.id ? 'var(--green-pale)' : 'white' }}>
                      <div style={{ fontWeight: 600 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.whatsapp} · {g.nationality}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input className="form-input" value={newGuest.name} onChange={e => setNewGuest(g=>({...g,name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">WhatsApp</label>
                <input className="form-input" placeholder="+62…" value={newGuest.whatsapp} onChange={e => setNewGuest(g=>({...g,whatsapp:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Nationality</label>
                <CountrySelect value={newGuest.nationality} onChange={v => setNewGuest(g=>({...g,nationality:v}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={newGuest.email} onChange={e => setNewGuest(g=>({...g,email:e.target.value}))} />
              </div>
            </div>
          )}
        </div>

        <div className="card mb-3">
          <div className="card-title">Dates</div>
          <div className="form-row form-row-dates">
            <div className="form-group">
              <label className="form-label">Check-in *</label>
              <input className="form-input" type="date" value={form.check_in_date} onChange={e => onCheckIn(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Nights</label>
              <input className="form-input" type="number" min={1} max={365} inputMode="numeric" value={nights}
                onChange={e => onNights(e.target.value)} placeholder="1" />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out *</label>
              <input className="form-input" type="date" value={form.check_out_date} min={form.check_in_date ? addDaysYmd(form.check_in_date, 1) : undefined}
                onChange={e => onCheckOut(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Source</label>
            <select className="form-select" value={form.source} onChange={e => set('source', e.target.value)}>
              {sources.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {!agentFieldShown && (
              <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 6 }} onClick={() => setShowAgent(true)}>+ Agent / company (optional)</button>
            )}
          </div>
          {agentFieldShown && (
            <div>
              <BookingAgentFields value={agentVal} onChange={setAgentVal} sourceType={srcObj?.source_type}
                hint={agentVal.agent ? null
                  : srcObj?.source_type === 'company' ? 'The company this stay is for. How it pays (e.g. invoiced later) is set in Agent Billing.'
                  : 'Travel agent, company, wholesaler — or a guide / driver who sent the guest. Their billing and commission come from Agent Billing.'} />
              <AgentBillingNote value={agentVal} />
              <CreditLimitNote check={creditCheck} />
            </div>
          )}
        </div>

        {rooms.map((room, i) => {
          const priceSuggestion = priceSuggestions[i];
          const availability = availabilities[i];
          const suggestedTotal = priceSuggestion?.grand_total || 0;
          const unit = units.find(u => u.id === room.unit_id);
          return (
            <div className="card mb-3" key={i}>
              <div className="card-title flex" style={{ justifyContent: 'space-between' }}>
                <span>{isGroup ? `Room ${i + 1}` : 'Booking Details'}</span>
                {rooms.length > 1 && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => removeRoom(i)}>Remove</button>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Unit *</label>
                  <select className="form-select" value={room.unit_id} onChange={e => setRoom(i, 'unit_id', e.target.value)} required>
                    <option value="">{availByRange[rangeKey(room)] ? 'Select unit…' : 'Select unit… (pick dates first to see what\'s free)'}</option>
                    {units.map(u => { const o = unitOption(u, i); return <option key={u.id} value={u.id} disabled={o.disabled}>{o.label}</option>; })}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Number of Guests</label>
                  <input className="form-input" type="number" min={1} max={10} value={room.num_guests} onChange={e => setRoom(i, 'num_guests', parseInt(e.target.value) || 1)} />
                </div>
              </div>

              {isGroup && (
                <div className="form-group">
                  <label className="flex gap-2" style={{ alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={room.own_dates}
                      onChange={e => setRooms(rs => rs.map((r, idx) => idx !== i ? r : {
                        ...r, own_dates: e.target.checked,
                        check_in_date: r.check_in_date || form.check_in_date, check_out_date: r.check_out_date || form.check_out_date,
                      }))} />
                    Different dates for this room
                  </label>
                  {room.own_dates && (
                    <div className="form-row form-row-dates" style={{ marginTop: 6 }}>
                      <div className="form-group">
                        <label className="form-label">Check-in</label>
                        <input className="form-input" type="date" value={room.check_in_date} onChange={e => roomCheckIn(i, e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Nights</label>
                        <input className="form-input" type="number" min={1} max={365} inputMode="numeric"
                          value={roomNights(room) || ''} onChange={e => roomNightsInput(i, e.target.value)} placeholder="1" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Check-out</label>
                        <input className="form-input" type="date" value={room.check_out_date}
                          min={room.check_in_date ? addDaysYmd(room.check_in_date, 1) : undefined}
                          onChange={e => setRoom(i, 'check_out_date', e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Rate Plan</label>
                  <select className="form-select" value={room.rate_plan_id} onChange={e => setRoom(i, 'rate_plan_id', e.target.value)}>
                    {ratePlans.length === 0 && <option value="">Room Only</option>}
                    {ratePlans.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Bed Preference</label>
                  <select className="form-select" value={room.bed_preference} onChange={e => setRoom(i, 'bed_preference', e.target.value)}>
                    {BED_PREFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {unit?.bed_config && unit.bed_config !== 'twin_or_double' && room.bed_preference && room.bed_preference !== unit.bed_config && (
                    <div style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>
                      This room is set up as {unit.bed_config === 'twin' ? 'twin' : 'double'} — staff may need to reconfigure it.
                    </div>
                  )}
                </div>
              </div>

              {(
                <div className="form-group">
                  {!room.extra ? (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={!nightItems.length}
                        onClick={() => setRoom(i, 'extra', { product_id: nightItems[0].id, quantity: 1, nights: null })}>
                        + Extra bed
                      </button>
                      {!nightItems.length && (
                        <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>
                          No per-night item yet — in Sales → Items, edit the Extra Bed and tick "Per night — part of the stay".
                        </span>
                      )}
                    </>
                  ) : (
                    <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--cream)' }}>
                      <div className="flex-between" style={{ marginBottom: 8 }}>
                        <label className="form-label" style={{ margin: 0 }}>Extra bed</label>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRoom(i, 'extra', null)}>Remove</button>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <select className="form-select" value={room.extra.product_id} onChange={e => setRoom(i, 'extra', { ...room.extra, product_id: e.target.value })}>
                            {nightItems.map(p => <option key={p.id} value={p.id}>{p.name} — {idr(p.price)} / night</option>)}
                          </select>
                        </div>
                        <div className="form-group" style={{ maxWidth: 110 }}>
                          <input className="form-input" type="number" min={1} max={10} value={room.extra.quantity} title="How many"
                            onChange={e => setRoom(i, 'extra', { ...room.extra, quantity: e.target.value })} />
                        </div>
                      </div>
                      {roomDates(room).length > 0 ? (
                        <StayNightsPicker booking={{ check_in_date: roomIn(room), check_out_date: roomOut(room) }}
                          value={extraNights(room)} onChange={v => setRoom(i, 'extra', { ...room.extra, nights: v })} />
                      ) : <div className="text-muted" style={{ fontSize: 12 }}>Pick the dates first.</div>}
                      {extraTotal(room) > 0 && (
                        <div style={{ fontSize: 12, marginTop: 6 }}>
                          = <b>{idr(extraTotal(room))}</b> for {extraNights(room).length} night{extraNights(room).length === 1 ? '' : 's'}{taxF !== 1 ? ' incl. service & tax' : ''} — charged to the room with each night, on top of the room price.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {availabilityLoading && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Checking availability…</div>
              )}
              {availability && (
                <div style={{ marginBottom: 12 }}>
                  {availability.available ? (
                    <div className="alert alert-success" style={{ marginBottom: availability.allotment ? 6 : 0 }}>
                      Unit is available for the selected dates
                    </div>
                  ) : (
                    <div className="alert alert-error" style={{ marginBottom: availability.allotment ? 6 : 0 }}>
                      <strong>Not available</strong> — conflicting booking{availability.conflicts.length > 1 ? 's' : ''}:
                      {availability.conflicts.map(c => (
                        <div key={c.id} style={{ marginTop: 4, fontSize: 12 }}>
                          {c.guest_name} · {c.check_in_date?.slice(0,10)} → {c.check_out_date?.slice(0,10)}{' '}
                          {c.overdue
                            ? <b>— still checked in past check-out (overdue). Check them out or extend their stay first.</b>
                            : `(${c.status})`}
                        </div>
                      ))}
                    </div>
                  )}
                  {availability.allotment ? (
                    <AllotmentNote allotment={availability.allotment} source={form.source} checkIn={form.check_in_date} sources={sources} />
                  ) : room.unit_id && form.check_in_date ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 6 }}>
                      No allotment set for {new Date(form.check_in_date + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">
                  Total for the whole stay{roomNights(room) ? ` (${roomNights(room)} night${roomNights(room) > 1 ? 's' : ''})` : ''} — IDR, incl. tax &amp; service
                </label>
                <input className="form-input" type="number" value={room.total_amount} placeholder={suggestedTotal ? `Suggested: ${suggestedTotal}` : ''}
                  disabled={room.per_night} title={room.per_night ? 'The total of the nights below' : undefined}
                  onChange={e => setRoom(i, 'total_amount', e.target.value)} />
                {roomNights(room) > 1 && (
                  <label className="flex gap-2" style={{ fontSize: 13, cursor: 'pointer', marginTop: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={!!room.per_night} onChange={e => setPerNight(i, e.target.checked, priceSuggestion)} />
                    <span>Different price each night</span>
                  </label>
                )}
                {room.per_night && (
                  <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                    {roomDates(room).map((d, k) => (
                      <div key={d} className="flex-between" style={{ gap: 12, padding: '4px 0' }}>
                        <span style={{ fontSize: 13 }}>
                          Night {k + 1} · {new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <input className="form-input" type="number" min="0" value={room.night_amounts[d] ?? ''} style={{ maxWidth: 170, textAlign: 'right' }}
                          onChange={e => setNightAmount(i, d, e.target.value)} />
                      </div>
                    ))}
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Each night's price as the guest or agent pays it — tax and the meal plan included. The total above is their sum.
                    </div>
                  </div>
                )}
                {!room.per_night && parseFloat(room.total_amount) > 0 && roomNights(room) > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>
                    = <strong style={{ color: 'var(--text)' }}>{idr(room.total_amount / roomNights(room))} per night</strong> × {roomNights(room)} night{roomNights(room) > 1 ? 's' : ''}
                  </div>
                )}
                {(() => {
                  const w = priceWarning(room.total_amount, suggestedTotal, roomNights(room));
                  return w && <div className="alert alert-warn" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}><div>⚠️ {w}</div></div>;
                })()}
                {priceSuggestion && suggestedTotal > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div className="flex-between" style={{ marginBottom: 4 }}>
                      <span className="text-muted">
                        Room ({priceSuggestion.nights} night{priceSuggestion.nights > 1 ? 's' : ''}
                        {!priceSuggestion.varies_by_night && ` × Rp ${Number(priceSuggestion.night_breakdown?.[0]?.entered_rate ?? priceSuggestion.room_rate_per_night).toLocaleString('id-ID')}`})
                        {!priceSuggestion.varies_by_night && priceSuggestion.period && (
                          <span style={{ background: priceSuggestion.period.color, color: 'white', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, marginLeft: 6 }}>
                            {priceSuggestion.period.name}
                          </span>
                        )}
                        {priceSuggestion.varies_by_night && <span style={{ fontStyle: 'italic' }}> · rates vary by night, see below</span>}
                      </span>
                      <span>Rp {Math.round(shownAmount(priceSuggestion.room_total, priceSuggestion)).toLocaleString('id-ID')}</span>
                    </div>

                    {priceSuggestion.meal_total > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">
                          {priceSuggestion.rate_plan?.name || 'Breakfast'} ({room.num_guests} guest{room.num_guests > 1 ? 's' : ''} × {priceSuggestion.nights} night{priceSuggestion.nights > 1 ? 's' : ''} × Rp {Number(priceSuggestion.rate_plan?.meal_price || 0).toLocaleString('id-ID')})
                        </span>
                        <span>Rp {Math.round(shownAmount(priceSuggestion.meal_total, priceSuggestion)).toLocaleString('id-ID')}</span>
                      </div>
                    )}

                    {/* Prices incl. service & tax (migration 079): lines are all-in, no tax rows. */}
                    {!priceSuggestion.prices_include_tax && (
                    <div className="flex-between" style={{ marginBottom: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                      <span className="text-muted">Subtotal</span>
                      <span>Rp {Number(priceSuggestion.subtotal).toLocaleString('id-ID')}</span>
                    </div>
                    )}
                    {!priceSuggestion.prices_include_tax && priceSuggestion.service_charge_amount > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">Service Charge ({priceSuggestion.service_charge_rate}%)</span>
                        <span>Rp {Number(priceSuggestion.service_charge_amount).toLocaleString('id-ID')}</span>
                      </div>
                    )}
                    {!priceSuggestion.prices_include_tax && priceSuggestion.tax_amount > 0 && (
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="text-muted">Tax ({priceSuggestion.tax_rate}%)</span>
                        <span>Rp {Number(priceSuggestion.tax_amount).toLocaleString('id-ID')}</span>
                      </div>
                    )}

                    <div className="flex-between" style={{ fontWeight: 700, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                      <span>Grand Total</span>
                      <span>Rp {Number(suggestedTotal).toLocaleString('id-ID')}</span>
                    </div>
                    {priceSuggestion.prices_include_tax && includesText(priceSuggestion, n => 'Rp ' + Math.round(n).toLocaleString('id-ID')) && (
                      <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>
                        {includesText(priceSuggestion, n => 'Rp ' + Math.round(n).toLocaleString('id-ID'))}
                      </div>
                    )}

                    {!room.total_amount && (
                      <button type="button" className="btn btn-sm btn-secondary mt-2"
                        onClick={() => (priceSuggestion.varies_by_night ? setPerNight(i, true, priceSuggestion) : setRoom(i, 'total_amount', suggestedTotal))}>
                        Use this
                      </button>
                    )}

                    {priceSuggestion.night_breakdown?.length > 1 && (
                      <details open={priceSuggestion.varies_by_night} style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text)' }}>
                          Nightly room rate breakdown ({priceSuggestion.night_breakdown.length} nights)
                        </summary>
                        <div style={{ marginTop: 6 }}>
                          {priceSuggestion.night_breakdown.map(n => (
                            <div key={n.date} className="flex-between" style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                              <span>
                                {n.date}
                                {n.period && (
                                  <span style={{ background: n.period.color, color: 'white', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 600, marginLeft: 6 }}>
                                    {n.period.name}
                                  </span>
                                )}
                              </span>
                              <span>Rp {Number(n.entered_rate ?? n.room_rate).toLocaleString('id-ID')}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div className="mb-3">
          <button type="button" className="btn btn-secondary" onClick={addRoom}>+ Add Another Room</button>
        </div>

        <div className="card mb-3">
          <div className="card-title">{isGroup ? 'Group Discount & Deposit' : 'Discount & Deposit'}</div>
          {isGroup && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Group total: Rp {groupTotal.toLocaleString('id-ID')} across {rooms.length} rooms
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Discount</label>
            <div className="flex gap-2 flex-center" style={{ marginBottom: 6 }}>
              {[{ v: '', label: 'None' }, { v: 'fixed', label: 'Fixed (IDR)' }, { v: 'percentage', label: 'Percentage (%)' }].map(opt => (
                <button key={opt.v} type="button"
                  className={`btn btn-sm ${form.discount_type === opt.v ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { set('discount_type', opt.v); set('discount_value', ''); }}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.discount_type && (
              <div className="flex gap-2 flex-center">
                <input className="form-input" type="number" min={0}
                  placeholder={form.discount_type === 'fixed' ? 'Amount in IDR' : '0 – 100'}
                  value={form.discount_value}
                  onChange={e => set('discount_value', e.target.value)}
                  style={{ maxWidth: 200 }} />
                <span style={{ color: 'var(--text-muted)' }}>{form.discount_type === 'percentage' ? '%' : 'IDR'}</span>
              </div>
            )}
            {discountAmt > 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-success, green)', marginTop: 4 }}>
                Discount: − Rp {discountAmt.toLocaleString('id-ID')} · Net: Rp {netAmt.toLocaleString('id-ID')}
              </div>
            )}
          </div>

          {isGroup && (
            <div className="form-group">
              <label className="form-label">Group pays</label>
              {CITY_LEDGER.includes(agentVal.agent?.payment_status) ? (
                <div className="text-muted" style={{ fontSize: 12 }}>Billed to {agentVal.agent?.name} — each room goes on the agent's bill.</div>
              ) : (<>
                <div className="flex gap-2 flex-center" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                  {[{ v: 'room_meals', label: 'Room & meal plan' }, { v: 'everything', label: 'Everything' }].map(opt => (
                    <button key={opt.v} type="button"
                      className={`btn btn-sm ${groupPays === opt.v ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setGroupPays(opt.v)}>{opt.label}</button>
                  ))}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  One bill and one payment record for the group.{' '}
                  {groupPays === 'everything'
                    ? 'Extras charged to a room go on the group bill too.'
                    : 'Extras charged to a room are paid by that room’s guest at check-out.'}
                  {' '}Can be changed later on the group page.
                </div>
              </>)}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{isGroup ? 'Deposit Required (for the whole group)' : 'Deposit Required'}</label>
            <div className="flex gap-2 flex-center" style={{ marginBottom: 6 }}>
              {[{ v: 'amount', label: 'Amount (IDR)' }, { v: 'pct', label: 'Percentage (%)' }].map(opt => (
                <button key={opt.v} type="button"
                  className={`btn btn-sm ${form.deposit_mode === opt.v ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => set('deposit_mode', opt.v)}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.deposit_mode === 'pct' ? (
              <div className="flex gap-2 flex-center" style={{ flexWrap: 'wrap' }}>
                <input className="form-input" type="number" min={0} max={100} value={form.deposit_pct}
                  onChange={e => set('deposit_pct', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  style={{ maxWidth: 80 }} />
                <span>%</span>
                <div className="flex gap-2" style={{ marginLeft: 8 }}>
                  {[0, 30, 50, 100].map(pct => (
                    <button key={pct} type="button"
                      className={`btn btn-sm ${form.deposit_pct === pct ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => set('deposit_pct', pct)}>
                      {pct === 0 ? 'None' : pct === 100 ? 'Full' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex gap-2 flex-center" style={{ flexWrap: 'wrap' }}>
                <input className="form-input" type="number" min={0} placeholder="Amount in IDR — empty = no deposit"
                  value={form.deposit_value}
                  onChange={e => set('deposit_value', e.target.value)}
                  style={{ maxWidth: 260 }} />
                <span style={{ color: 'var(--text-muted)' }}>IDR</span>
                {netAmt > 0 && (
                  <div className="flex gap-2" style={{ marginLeft: 8 }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('deposit_value', '')}>None</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('deposit_value', String(depositFor(50)))}>50%</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('deposit_value', String(netAmt))}>Full</button>
                  </div>
                )}
              </div>
            )}
            {depositOver && (
              <div style={{ fontSize: 12, color: 'var(--danger, #B91C1C)', marginTop: 4 }}>
                More than the room price — the deposit will be Rp {netAmt.toLocaleString('id-ID')}.
              </div>
            )}
            {netAmt > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {depositAmt > 0 ? <>Deposit: Rp {depositAmt.toLocaleString('id-ID')}</> : 'No deposit'}
                {form.deposit_mode === 'pct' && extrasTotal > 0 && (extrasInDeposit ? ' (on room + extra bed)' : ' (room only — the guest pays the extra bed at the hotel)')}
                {' · '}Balance: Rp {(netAmt - depositAmt).toLocaleString('id-ID')}
                {extrasTotal > 0 && <> · Extra bed: Rp {extrasTotal.toLocaleString('id-ID')}</>}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Special Requests</label>
            <textarea className="form-textarea" value={form.special_requests} onChange={e => set('special_requests', e.target.value)} placeholder="Any notes or requests from the guest…" />
          </div>
        </div>

        {!isGroup && (
          <div className="card mb-3">
            <label className="flex gap-2" style={{ alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={comp.on} onChange={e => setComp(c => ({ ...c, on: e.target.checked }))} />
              🎁 Complimentary stay (free)
            </label>
            {comp.on && (
              <div style={{ marginTop: 10 }}>
                <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  {[['room', 'Room only'], ['room_meals', 'Room + meals'], ['all', 'Everything (incl. extras)']].map(([v, label]) => (
                    <button key={v} type="button" className={`btn btn-sm ${comp.scope === v ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setComp(c => ({ ...c, scope: v }))}>{label}</button>
                  ))}
                </div>
                <textarea className="form-textarea" placeholder="Reason * — e.g. Travel agent site inspection"
                  value={comp.reason} onChange={e => setComp(c => ({ ...c, reason: e.target.value }))} />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Keep the normal price above — it's recorded as the value given away. The booking is created, then made free
                  {can('grant_complimentary') ? '.' : ' once a manager approves: a one-time code is sent to them on Telegram, and you type it in on the next screen.'}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
          <Link to="/reservations" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={loading || anyUnavailable}>
            {isGroup ? 'Review Group Booking' : 'Review Booking'}
          </button>
        </div>
      </form>

      {review && (() => {
        const guestName = mode === 'new' ? newGuest.name : guestSearch;
        const sourceLabel = sources.find(s => s.id === form.source)?.label || form.source;
        const compOn = comp.on && !isGroup;
        const deposit = compOn ? 0 : depositAmt;
        const lines = rooms.map((r, i) => {
          const normal = priceSuggestions[i]?.grand_total || 0;
          return {
            r, normal,
            unit: units.find(u => u.id === r.unit_id),
            plan: ratePlans.find(p => p.id === r.rate_plan_id),
            total: parseFloat(r.total_amount) || 0,
            warning: priceWarning(r.total_amount, normal, roomNights(r)),
          };
        });
        const warned = lines.filter(l => l.warning).length;
        const td = { padding: '6px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 640 }}>
              <div className="modal-header">
                <div className="modal-title">Check before creating</div>
                <button type="button" className="btn btn-icon" onClick={() => setReview(false)}>✕</button>
              </div>
              <div className="modal-body">
                {warned > 0 && (
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <div>⚠️ <strong>{warned === 1 ? '1 room price looks' : `${warned} room prices look`} wrong</strong> — see the red line{warned > 1 ? 's' : ''} below. Each price is the total for the whole stay, not per night.</div>
                  </div>
                )}
                <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>
                  <div><span className="text-muted">Guest:</span> <strong>{guestName || '—'}</strong>{mode === 'new' && <span className="text-muted"> (new guest)</span>}</div>
                  <div><span className="text-muted">Stay:</span> <strong>{form.check_in_date} → {form.check_out_date}</strong> · {stayNights} night{stayNights > 1 ? 's' : ''}
                    {anyOwnDates && <span className="text-muted"> — some rooms have their own dates (below)</span>}</div>
                  <div><span className="text-muted">Source:</span> {sourceLabel}</div>
                  {agentVal.agent && (
                    <div><span className="text-muted">Agent:</span> {agentVal.agent.name}
                      {HAS_COMMISSION.includes(agentVal.agent.payment_status) && (agentVal.own && agentVal.amount !== ''
                        ? ` · commission ${fmtCommission(agentVal.type, agentVal.amount)} (this booking)`
                        : fmtCommission(agentVal.agent.commission_type, agentVal.agent.commission_value) ? ` · commission ${fmtCommission(agentVal.agent.commission_type, agentVal.agent.commission_value)}` : '')}
                    </div>
                  )}
                </div>
                <div className="table-wrap">
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={td}>Room</th>
                        <th style={{ ...td, textAlign: 'right' }}>Per night</th>
                        <th style={{ ...td, textAlign: 'right' }}>{anyOwnDates ? 'Total for its stay' : `Total (${stayNights} night${stayNights > 1 ? 's' : ''})`}</th>
                        <th style={{ ...td, textAlign: 'right' }}>Normal price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} style={l.warning ? { background: 'var(--danger-bg, #FEF2F2)' } : undefined}>
                          <td style={td}>
                            <strong>{l.unit?.name || '—'}</strong>{l.unit?.type ? ` · ${l.unit.type}` : ''}
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {l.r.num_guests} guest{l.r.num_guests > 1 ? 's' : ''}{l.plan ? ` · ${l.plan.code}` : ''}
                              {anyOwnDates && <> · {roomIn(l.r)} → {roomOut(l.r)} ({roomNights(l.r)} night{roomNights(l.r) > 1 ? 's' : ''})</>}
                            </div>
                            {l.r.per_night && (
                              <div className="text-muted" style={{ fontSize: 11 }}>
                                Per night: {roomDates(l.r).map(d => `${d.slice(8, 10)}/${d.slice(5, 7)} ${idr(parseFloat(l.r.night_amounts[d]) || 0)}`).join(' · ')}
                              </div>
                            )}
                            {l.warning && <div style={{ fontSize: 11, color: 'var(--danger, #B91C1C)', marginTop: 2 }}>⚠️ {l.warning}</div>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{roomNights(l.r) ? idr(l.total / roomNights(l.r)) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{idr(l.total)}</td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="text-muted">{l.normal ? idr(l.normal) : '—'}</td>
                        </tr>
                      )).flatMap((row, i) => {
                        const r = lines[i].r;
                        const ex = extraTotal(r);
                        if (!ex) return [row];
                        const item = nightItems.find(p => p.id === r.extra.product_id);
                        return [row, (
                          <tr key={`x${i}`}>
                            <td style={td}>+ {item?.name}{parseInt(r.extra.quantity, 10) > 1 ? ` × ${r.extra.quantity}` : ''}
                              <div className="text-muted" style={{ fontSize: 11 }}>{extraNights(r).length} night{extraNights(r).length === 1 ? '' : 's'} · charged to the room</div>
                            </td>
                            <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{idr(ex / extraNights(r).length)}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{idr(ex)}</td>
                            <td style={td} />
                          </tr>
                        )];
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 14, marginTop: 12, lineHeight: 1.7 }}>
                  {discountAmt > 0 && (
                    <div className="flex-between"><span className="text-muted">Discount{form.discount_type === 'percentage' ? ` (${dValue}%)` : ''}</span><span>− {idr(discountAmt)}</span></div>
                  )}
                  {extrasTotal > 0 ? (<>
                    <div className="flex-between"><span className="text-muted">{isGroup ? `Rooms (${rooms.length})` : 'Room'}</span><span>{idr(netAmt)}</span></div>
                    <div className="flex-between"><span className="text-muted">Extra bed</span><span>{idr(extrasTotal)}</span></div>
                    <div className="flex-between" style={{ fontWeight: 700 }}><span>Total</span><span>{idr(netAmt + extrasTotal)}</span></div>
                  </>) : (
                    <div className="flex-between" style={{ fontWeight: 700 }}><span>{isGroup ? `Total for ${rooms.length} rooms` : 'Total'}</span><span>{idr(netAmt)}</span></div>
                  )}
                  {compOn ? (
                    <div className="text-muted" style={{ fontSize: 12 }}>🎁 Will be made complimentary ({comp.scope === 'room' ? 'room only' : comp.scope === 'room_meals' ? 'room + meals' : 'everything'}) — the price above is recorded as the value given.</div>
                  ) : (
                    <div className="flex-between text-muted" style={{ fontSize: 13 }}>
                      <span>Deposit{form.deposit_mode === 'pct' ? ` ${form.deposit_pct}%` : ''}{form.deposit_mode === 'pct' && extrasTotal > 0 ? (extrasInDeposit ? ' (room + extra bed)' : ' (room only — extra bed paid at the hotel)') : ''}</span>
                      <span>{idr(deposit)} · then {idr(netAmt + extrasTotal - deposit)}</span>
                    </div>
                  )}
                  {isGroup && !CITY_LEDGER.includes(agentVal.agent?.payment_status) && (
                    <div className="flex-between text-muted" style={{ fontSize: 13 }}>
                      <span>Group pays</span>
                      <span>{groupPays === 'everything' ? 'Everything (rooms, meals, extras)' : 'Room & meal plan · rooms pay their extras'}</span>
                    </div>
                  )}
                </div>
                {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReview(false)} disabled={loading}>← Back to edit</button>
                <button type="button" className="btn btn-primary" onClick={createBooking} disabled={loading}>
                  {loading ? 'Creating…' : warned ? 'Create anyway' : isGroup ? 'Confirm & create group' : 'Confirm & create'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
