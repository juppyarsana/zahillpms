// Live unit status — every room as a coloured tile by room type, the status
// counts, and the room window (stay, check in / out, payment, housekeeping,
// tablet health). Shared by the Dashboard and Today.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useCall } from '../context/CallContext';
import { checkinTemplate, checkoutTemplate } from '../lib/messageTemplates';
import RegistrationCardModal from './RegistrationCardModal';
import api from '../services/api';
import { groupUnitsByType } from '../lib/roomTypeOrder';
import { NotesPreview } from './StaffNotes';
import { propertyToday, PROPERTY_TZ } from '../lib/propertyTime';

function fmtIDR(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000)     return `Rp ${(num / 1_000_000).toFixed(1)}M`;
  return 'Rp ' + num.toLocaleString('id-ID');
}



/* ─── channel badge ────────────────────────────────────── */
function ChBadge({ source }) {
  const { sources } = useSettings();
  if (!source) return null;
  if (source === 'buffer') {
    return <span style={{ background: '#6B7280', color: 'white', padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>Buffer</span>;
  }
  const s = sources.find(src => src.id === source);
  return (
    <span style={{ background: s?.color || '#6B7280', color: 'white', padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>
      {s?.label || source}
    </span>
  );
}

/* ─── unit status card ─────────────────────────────────── */
function fmtDay(ymd) {
  return ymd ? new Date(String(ymd).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
}
// The property's today (Bali), not the viewer's.
function todayYmd() { return propertyToday(); }
const BED_LABEL = { double: 'Double bed', twin: 'Twin beds', twin_or_double: 'Twin or double', other: 'Other bed setup' };

// The stay behind a room tile (in house, or arriving today): loaded when the
// room popup opens, so the Dashboard can be FO's main screen — dates, plan,
// balance, requests, and the next step (open booking, check in/out, payment).
function RoomStay({ bookingId, kind }) {
  const { hasModule, can } = useAuth();
  const [b, setB] = useState(null);
  const [est, setEst] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setB(null); setEst(null); setErr('');
    api.get(`/api/bookings/${bookingId}`)
      .then(r => { if (live) setB(r.data); })
      .catch(e => { if (live) setErr(e.response?.data?.error || 'Could not load the booking'); });
    if (hasModule('financial')) {
      api.get(`/api/folio/${bookingId}/estimate`).then(r => { if (live) setEst(r.data); }).catch(() => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (err) return <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 8 }}>{err}</div>;
  if (!b) return <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Loading stay…</div>;

  const nights = Math.round((new Date(String(b.check_out_date).slice(0, 10)) - new Date(String(b.check_in_date).slice(0, 10))) / 86400000);
  const pendingLines = (b.payments || []).filter(p => p.status === 'pending' && ['deposit', 'balance'].includes(p.type))
    .reduce((s, p) => s + parseFloat(p.amount), 0);
  const balance = est ? parseFloat(est.balance_due) : pendingLines;
  const agentBilled = !!b.folio_status;
  const canOpen = can('reservations');
  const canCheckin = can('checkin_full') || can('quick_checkin');
  const row = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' };

  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'white', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>
        {b.guest_name}{b.nationality ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {b.nationality}</span> : null}
      </div>
      {b.group && (
        <Link to={`/reservations/group/${b.group.id}`} style={{ fontSize: 11, fontWeight: 600 }}>👥 Group booking · {b.group.room_count} rooms →</Link>
      )}
      <div style={{ marginTop: 6 }}>
        <div style={row}><span className="text-muted">Stay</span><span>{fmtDay(b.check_in_date)} → {fmtDay(b.check_out_date)} · {nights} night{nights !== 1 ? 's' : ''}</span></div>
        <div style={row}><span className="text-muted">Guests</span><span>{b.num_guests} pax{b.bed_preference ? ` · ${BED_LABEL[b.bed_preference] || b.bed_preference}` : ''}</span></div>
        {b.rate_plan_code && <div style={row}><span className="text-muted">Rate plan</span><span>{b.rate_plan_code} — {b.rate_plan_name}</span></div>}
        {b.complimentary_scope ? (
          <div style={row}><span className="text-muted">Price</span><span>🎁 Complimentary</span></div>
        ) : (
          <div style={row}>
            <span className="text-muted">{est ? 'Balance (whole stay)' : 'Unpaid'}</span>
            {agentBilled
              ? <span>Billed to agent</span>
              : balance >= 1
                ? <strong style={{ color: '#B91C1C' }}>{fmtIDR(balance)}</strong>
                : <span style={{ color: '#15803D', fontWeight: 600 }}>✓ Paid</span>}
          </div>
        )}
      </div>
      {b.special_requests && (
        <div style={{ marginTop: 6, fontSize: 12, padding: '6px 8px', borderRadius: 6, background: '#FEF3C7', color: '#92400E' }}>
          📝 {b.special_requests}
        </div>
      )}
      {b.internal_notes && (
        <div style={{ marginTop: 6, fontSize: 12, padding: '6px 8px', borderRadius: 6, background: '#F3F4F6', color: '#374151' }}>
          🔒 {b.internal_notes}
        </div>
      )}
      <NotesPreview notes={b.notes} max={3} />
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {canOpen && (
          <Link to={`/reservations/${b.id}`} className="btn btn-primary btn-sm" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>
            Open reservation →
          </Link>
        )}
        {canCheckin && kind === 'arriving' && (
          <Link to="/checkin" className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>✅ Check in</Link>
        )}
        {canCheckin && kind === 'in_house' && (
          <Link to="/checkin" className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>🧳 Check out</Link>
        )}
        {canOpen && (
          <Link to={`/reservations/${b.id}#add-item`} className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}
            title="Extra bed or any Sales item, charged to this room">
            🛏 + Extra bed / item
          </Link>
        )}
        {canOpen && !agentBilled && balance >= 1 && hasModule('financial') && (
          <Link to={`/reservations/${b.id}#record-payment`} className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>
            💳 Record payment
          </Link>
        )}
      </div>
    </div>
  );
}

function UnitCard({ unit, flags, health, onChanged }) {
  const { hasModule, can } = useAuth();
  const { callRoom } = useCall();
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState('');
  const [messaging, setMessaging] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [showRegCard, setShowRegCard] = useState(false);
  const [hkConfirm, setHkConfirm] = useState(false);
  const [hkBusy, setHkBusy] = useState(false);
  const [tabletConfirm, setTabletConfirm] = useState(false);
  const [tabletBusy, setTabletBusy] = useState(false);
  const [oooForm, setOooForm] = useState(false);
  const [oooReason, setOooReason] = useState('');
  const [oooExpectedBack, setOooExpectedBack] = useState('');
  const [oooBusy, setOooBusy] = useState(false);
  const [oooError, setOooError] = useState('');
  const [oooReturnConfirm, setOooReturnConfirm] = useState(false);
  const [dndBusy, setDndBusy] = useState(false);

  // DND left on (e.g. the guest checked out without switching it off) — the
  // tablet follows the server, so closing the task turns it off there too.
  const turnOffDnd = async () => {
    setDndBusy(true);
    try {
      await Promise.all((flags?.dndIds || []).map(id => api.put(`/api/tasks/${id}`, { status: 'done' })));
      onChanged?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not switch Do Not Disturb off');
    }
    setDndBusy(false);
  };

  async function markOutOfOrder() {
    if (!oooReason.trim()) { setOooError('A reason is required'); return; }
    setOooBusy(true);
    setOooError('');
    try {
      await api.patch(`/api/units/${unit.id}/status`, {
        status: 'out_of_order',
        reason: oooReason.trim(),
        expected_back: oooExpectedBack || undefined,
      });
      setOooForm(false);
      setOooReason('');
      setOooExpectedBack('');
      onChanged?.();
    } catch (err) {
      setOooError(err.response?.data?.error || 'Failed to mark Out of Order');
    }
    setOooBusy(false);
  }

  async function returnToService() {
    setOooBusy(true);
    try {
      await api.patch(`/api/units/${unit.id}/status`, { status: 'available' });
      setOooReturnConfirm(false);
      onChanged?.();
    } catch { /* leave confirm open to retry */ }
    setOooBusy(false);
  }

  async function removeTablet() {
    setTabletBusy(true);
    try {
      await api.delete(`/api/units/${unit.id}/tablet`);
      setTabletConfirm(false);
      onChanged?.();
    } catch { /* leave confirm open to retry */ }
    setTabletBusy(false);
  }

  // Clean on request — front desk asks housekeeping to clean a room with a
  // guest in it; housekeeping gets a Telegram message (migration 132).
  async function askClean() {
    setHkBusy(true);
    try { await api.post(`/api/housekeeping/rooms/${unit.id}/request`); onChanged?.(); }
    catch (err) { alert(err.response?.data?.error || 'Could not ask for a clean'); }
    setHkBusy(false);
  }
  async function cancelCleanRequest() {
    setHkBusy(true);
    try { await api.delete(`/api/housekeeping/rooms/${unit.id}/request`); onChanged?.(); }
    catch (err) { alert(err.response?.data?.error || 'Could not cancel the request'); }
    setHkBusy(false);
  }

  async function setHousekeeping(status) {
    setHkBusy(true);
    try {
      await api.patch(`/api/units/${unit.id}/housekeeping`, { status });
      setHkConfirm(false);
      onChanged?.();
    } catch { /* leave the confirm open so staff can retry */ }
    setHkBusy(false);
  }

  async function handleCallRoom(e) {
    e.stopPropagation();
    setCallError('');
    setCalling(true);
    try {
      await callRoom({ id: unit.id, name: unit.name });
    } catch (err) {
      setCallError(err.response?.data?.error || err.message || 'Could not place call');
    }
    setCalling(false);
  }

  function openMessage(e) {
    e.stopPropagation();
    setMessageError('');
    setMessageBody('');
    setMessaging(true);
  }

  async function handleSendMessage() {
    if (!messageBody.trim()) return;
    setSendingMessage(true);
    setMessageError('');
    try {
      await api.post(`/api/bookings/${unit.booking_id}/message`, { body: messageBody.trim() });
      setMessaging(false);
    } catch (err) {
      setMessageError(err.response?.data?.error || 'Failed to send message');
    }
    setSendingMessage(false);
  }

  const isOccupied  = unit.status === 'occupied' && unit.guest_name;
  const isDeparting = isOccupied && unit.nights_left != null && unit.nights_left <= 0;
  const isArriving  = !!unit.arriving_guest_name;
  const isOutOfOrder = unit.status === 'out_of_order';
  const isDirty     = unit.status === 'available' && unit.housekeeping_status === 'dirty';

  let cls = 'available';
  if (isDeparting)    cls = 'departing';
  else if (isOccupied) cls = 'occupied';
  else if (isDirty)   cls = 'dirty';
  else if (isArriving) cls = 'arriving';
  else if (isOutOfOrder) cls = 'out_of_order';

  const unitBg    = { occupied: '#FEF2F2', departing: '#FAF5FF', arriving: '#EFF6FF', available: '#F0FDF4', dirty: '#FEFCE8', out_of_order: '#F9FAFB' };
  const unitBorder= { occupied: '#DC2626', departing: '#9333EA', arriving: '#3B82F6', available: '#22C55E', dirty: '#EAB308', out_of_order: '#9CA3AF' };

  const bg     = unitBg[cls]     || '#F9FAFB';
  const border = unitBorder[cls] || '#D1D5DB';

  return (
    <div style={{ borderRadius: 10, padding: 14, border: `1.5px solid ${border}`, background: bg }}>

      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".04em" }}>Status</span>
        {isOccupied && <ChBadge source={unit.source} />}
        {!isOccupied && isArriving && <ChBadge source={unit.arriving_source} />}
        {!isOccupied && !isArriving && isDirty && (
          <span style={{ background: '#FEF9C3', color: '#854D0E', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>🧹 To clean</span>
        )}
        {!isOccupied && !isArriving && !isDirty && unit.status === 'available' && (
          <span style={{ background: '#D1FAE5', color: '#065F46', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Available</span>
        )}
        {isOutOfOrder && <span style={{ background: '#F3F4F6', color: '#374151', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>🔧 Out of Order</span>}
      </div>

      {/* guest request flags — set from Room Display's DND / Clean Room widget */}
      {(flags?.dnd || flags?.clean) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {flags.dnd && (
            <span style={{ background: '#EDE9FE', color: '#5B21B6', padding: '3px 4px 3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              🔕 Do Not Disturb
              <button
                type="button"
                disabled={dndBusy}
                title="Switch Do Not Disturb off — also on the room tablet"
                onClick={turnOffDnd}
                style={{ border: 'none', background: '#fff', color: '#5B21B6', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 700, cursor: dndBusy ? 'default' : 'pointer' }}
              >
                {dndBusy ? '…' : 'Turn off'}
              </button>
            </span>
          )}
          {flags.clean && (
            <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 4px 3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title={cleanAskedText(unit)}>
              🧹 Clean requested
              <button type="button" disabled={hkBusy} title="Cancel the clean request"
                onClick={cancelCleanRequest}
                style={{ border: 'none', background: '#fff', color: '#92400E', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 700, cursor: hkBusy ? 'default' : 'pointer' }}>
                {hkBusy ? '…' : 'Cancel'}
              </button>
            </span>
          )}
        </div>
      )}

      {/* Room tablet — telemetry from the room-display-kiosk Android APK. */}
      {health && (
        <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: health.offline ? '#B91C1C' : '#475569' }}>
            📱 Room tablet
            {health.offline && <span style={{ color: '#B91C1C' }}>· 📵 offline, last seen {relTime(health.lastSeen)}</span>}
          </div>
          {!health.offline && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
              {health.battery != null && (
                <span style={{ color: health.lowBattery ? '#B91C1C' : undefined, fontWeight: health.lowBattery ? 700 : undefined }}>
                  {health.charging ? '⚡' : '🔋'} {health.battery}%{health.charging ? ' charging' : ''}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {health.noInternet
                  ? '⚠️ wifi, no internet'
                  : health.networkType === 'wifi'
                    ? <>📶 {health.ssid || 'wifi'} {health.bars != null && <WifiBars bars={health.bars} />}</>
                    : health.networkType && health.networkType !== 'none'
                      ? `📶 ${health.networkType}`
                      : '📵 no network'}
              </span>
              <span>seen {relTime(health.lastSeen)}</span>
              {health.appVersion && <span style={{ color: '#94A3B8' }}>v{health.appVersion}{health.webviewVersion ? ` · WebView ${health.webviewVersion}` : ''}</span>}
            </div>
          )}
          {onChanged && (tabletConfirm ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#6B7280' }}>Remove this tablet record?</span>
              <button onClick={(e) => { e.stopPropagation(); removeTablet(); }} disabled={tabletBusy}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: '#B91C1C', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                {tabletBusy ? '…' : 'Yes, remove'}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setTabletConfirm(false); }}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: '#6B7280', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setTabletConfirm(true); }}
              style={{ background: 'none', border: 'none', padding: 0, marginTop: 5, fontSize: 10, color: '#9CA3AF', cursor: 'pointer', textDecoration: 'underline' }}>
              {health.offline ? 'Remove tablet (moved / retired)' : 'Remove tablet record'}
            </button>
          ))}
        </div>
      )}

      {/* status line */}
      {isOccupied && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: isDeparting ? '#7E22CE' : '#B91C1C' }}>
            {unit.nights_left < 0
              ? `⏰ Overdue — was due out ${fmtDay(unit.check_out_date)}`
              : isDeparting
              ? '🧳 Departing today'
              : `● Occupied${unit.nights_left > 0 ? ` · ${unit.nights_left} night${unit.nights_left !== 1 ? 's' : ''} left` : ' · last night'}`}
          </div>
          <RoomStay bookingId={unit.booking_id} kind="in_house" />
          {hasModule('operations') && !unit.clean_request_at && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8, fontSize: 12, width: '100%', justifyContent: 'center' }}
              disabled={hkBusy} onClick={(e) => { e.stopPropagation(); askClean(); }}
              title="The guest asked for their room to be cleaned — housekeeping gets a Telegram message">
              {hkBusy ? '…' : '🧹 Clean on request'}
            </button>
          )}
          {unit.clean_request_at && (
            <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>🧹 Clean {cleanAskedText(unit)}</div>
          )}
          {isArriving && (
            <div style={{ fontSize: 11, color: '#1D4ED8', marginTop: 8 }}>
              🔄 Then arriving today: <strong>{unit.arriving_guest_name}</strong>
              {can('reservations') && <> · <Link to={`/reservations/${unit.arriving_booking_id}`}>open →</Link></>}
            </div>
          )}
        </>
      )}

      {!isOccupied && isArriving && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8' }}>🔄 Arriving today</div>
          <RoomStay bookingId={unit.arriving_booking_id} kind="arriving" />
        </>
      )}

      {!isOccupied && !isArriving && !isDirty && unit.status === 'available' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#15803D' }}>
            ✓ Empty &amp; ready{unit.next_booking_date && !unit.next_booking_id
              ? ` · Next booking ${new Date(unit.next_booking_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : ''}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            {unit.gap_nights ? `${unit.gap_nights}-night gap · Open for last-minute booking` : 'No upcoming bookings'}
          </div>
          {unit.next_booking_id && (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Next: <strong>{unit.next_guest_name}</strong> · {fmtDay(unit.next_booking_date)}
              {can('reservations') && <> · <Link to={`/reservations/${unit.next_booking_id}`}>open →</Link></>}
            </div>
          )}
          {can('reservations') && hasModule('reservations') && (
            <Link to={`/reservations/new?unit=${unit.id}&date=${todayYmd()}`} className="btn btn-primary btn-sm"
              style={{ marginTop: 8, fontSize: 12, width: '100%', justifyContent: 'center' }}>
              + New booking from today
            </Link>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setHousekeeping('dirty'); }}
              disabled={hkBusy}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: '#9CA3AF', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Flag for cleaning
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOooForm(true); }}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: '#9CA3AF', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Mark Out of Order
            </button>
          </div>
        </>
      )}

      {isDirty && (
        <div style={{ marginTop: isArriving ? 8 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#854D0E' }}>🧹 Vacant — needs cleaning</div>
          {!hkConfirm ? (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 8, fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); setHkConfirm(true); }}
            >
              Mark clean
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#6B7280' }}>Room cleaned?</span>
              <button className="btn btn-primary btn-sm" style={{ fontSize: 12 }} disabled={hkBusy}
                onClick={(e) => { e.stopPropagation(); setHousekeeping('clean'); }}>
                {hkBusy ? '…' : 'Yes'}
              </button>
              <button className="btn btn-secondary btn-sm" style={{ fontSize: 12 }} disabled={hkBusy}
                onClick={(e) => { e.stopPropagation(); setHkConfirm(false); }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {isOutOfOrder && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: '#F3F4F6', border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>🔧 {unit.status_reason || 'Out of Order'}</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>
            {unit.status_expected_back && `Expected back ${new Date(unit.status_expected_back).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · `}
            Since {relTime(unit.status_updated_at)}{unit.status_updated_by_name ? ` · ${unit.status_updated_by_name}` : ''}
          </div>
          {!oooReturnConfirm ? (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 8, fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); setOooReturnConfirm(true); }}
            >
              Return to Service
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#6B7280' }}>Fixed and ready to sell?</span>
              <button className="btn btn-primary btn-sm" style={{ fontSize: 12 }} disabled={oooBusy}
                onClick={(e) => { e.stopPropagation(); returnToService(); }}>
                {oooBusy ? '…' : 'Yes'}
              </button>
              <button className="btn btn-secondary btn-sm" style={{ fontSize: 12 }} disabled={oooBusy}
                onClick={(e) => { e.stopPropagation(); setOooReturnConfirm(false); }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {oooForm && (
        <div className="modal-backdrop" onClick={e => e.stopPropagation()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Mark Out of Order — {unit.name}</div>
              <button className="btn btn-icon" onClick={() => setOooForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Reason</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. AC not cooling, plumbing leak"
                  value={oooReason}
                  onChange={e => setOooReason(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Expected back in service (optional)</label>
                <input
                  type="date"
                  className="form-input"
                  value={oooExpectedBack}
                  onChange={e => setOooExpectedBack(e.target.value)}
                />
              </div>
              {oooError && <div className="alert alert-error">{oooError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setOooForm(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={markOutOfOrder}
                disabled={oooBusy || !oooReason.trim()}
              >
                {oooBusy ? 'Saving…' : 'Mark Out of Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Room — same eligibility as Sidebar's "Call a Room" / CallRoomModal:
          the calling module on, and a Room Display tablet actually assigned.
          Send Message — needs an actual checked-in booking to attach to (no
          point messaging an empty room's tablet).
          Registration Card — either the current in-house stay (reprint) or
          today's not-yet-arrived booking (front desk prepares it ahead of
          arrival), so it also keys off arriving_booking_id. */}
      {(hasModule('calling') && unit.controller_id) || unit.booking_id || unit.arriving_booking_id ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {hasModule('calling') && unit.controller_id && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: 12 }}
              disabled={calling}
              onClick={handleCallRoom}
            >
              📞 {calling ? 'Calling…' : 'Call Room'}
            </button>
          )}
          {unit.booking_id && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: 12 }}
              onClick={openMessage}
            >
              ✉️ Message
            </button>
          )}
          {(unit.booking_id || unit.arriving_booking_id) && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: 12 }}
              onClick={() => setShowRegCard(true)}
            >
              📝 Reg. Card
            </button>
          )}
        </div>
      ) : null}
      {showRegCard && (
        <RegistrationCardModal
          bookingId={unit.booking_id || unit.arriving_booking_id}
          onClose={() => setShowRegCard(false)}
        />
      )}
      {callError && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{callError}</div>}

      {messaging && (
        <div className="modal-backdrop" onClick={e => e.stopPropagation()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Send Message — {unit.name}</div>
              <button className="btn btn-icon" onClick={() => setMessaging(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Shown full-screen on the room's tablet until the guest dismisses it.
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkinTemplate(unit.guest_name))}>
                    🔑 Check-in Welcome
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMessageBody(checkoutTemplate(unit.guest_name))}>
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
              {messageError && <div className="alert alert-error">{messageError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMessaging(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSendMessage}
                disabled={sendingMessage || !messageBody.trim()}
              >
                {sendingMessage ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── compact unit status board ────────────────────────── */

// Housekeeping-board convention: green = vacant ready, red = occupied,
// yellow = vacant dirty. Departing gets its own purple; out_of_order drops
// to grey (occupied took the red).
const TILE_BG = {
  available:    '#22C55E',
  occupied:     '#DC2626',
  dirty:        '#FACC15',
  arriving:     '#3B82F6',
  departing:    '#9333EA',
  out_of_order: '#9CA3AF',
};

// Tiles are white-on-color by default; yellow needs dark text to stay legible.
const TILE_FG = {
  dirty: '#1F2937',
};

// Icons so status doesn't rely on color alone — small but legible at tile size.
const TILE_ICON = {
  available:    '✓',
  occupied:     '🛏',
  dirty:        '🧹',
  arriving:     '🔑',
  departing:    '🧳',
  out_of_order: '🔧',
};

// DND / Clean Room requests come from Room Display as `guest_request` tasks
// (server/routes/display.js's /housekeeping endpoint) with fixed title
// prefixes — matching on those avoids a schema change just to tag intent.
// DND is a room *state* the guest controls (cleared automatically when they
// turn it off), not a task for staff to complete — so it's surfaced only as
// passive status on the room tile, never in the actionable requests banner.
function isDndTask(t) {
  return t.title.startsWith('Do Not Disturb');
}

// Do Not Disturb is still a task; a clean asked for while the guest is in the
// room is on the room itself (units.clean_request_*, migration 132).
function unitRequestFlags(guestRequests, units = []) {
  const map = new Map();
  const get = id => map.get(id) || { dnd: false, clean: false, dndIds: [] };
  for (const t of guestRequests) {
    if (!t.unit_id || !isDndTask(t)) continue;
    const flags = get(t.unit_id);
    flags.dnd = true; flags.dndIds.push(t.id);
    map.set(t.unit_id, flags);
  }
  for (const u of units) {
    if (!u.clean_request_at) continue;
    const flags = get(u.id);
    flags.clean = true;
    map.set(u.id, flags);
  }
  return map;
}

// "asked by the guest · 10:15" / "asked by front desk (Ayu) · 10:15"
export function cleanAskedText(u) {
  const by = u.clean_request_via === 'guest' ? 'the guest' : `front desk${u.clean_request_by_name ? ` (${u.clean_request_by_name})` : ''}`;
  const at = u.clean_request_at ? new Date(u.clean_request_at).toLocaleTimeString('en-GB', { timeZone: PROPERTY_TZ, hour: '2-digit', minute: '2-digit' }) : '';
  return `asked by ${by}${at ? ` · ${at}` : ''}`;
}

/* ─── Room Display tablet telemetry ────────────────────────
   Fed by room-display-kiosk/ (the Android kiosk APK) via
   POST /api/display/room/:roomId/telemetry -> room_display_devices,
   LEFT JOINed onto the occupancy query as tablet_* columns. */

// 3 missed ~2-min telemetry ticks = "we've lost this tablet".
const TABLET_STALE_MS = 6 * 60 * 1000;

function wifiBars(rssi) {
  if (rssi == null) return null;
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

// 4 CSS-drawn signal bars (unicode block chars render as tofu in some fonts).
function WifiBars({ bars }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1.5, height: 10 }}>
      {[3, 6, 8, 10].map((h, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            height: h,
            borderRadius: 1,
            background: i < bars ? (bars <= 1 ? '#DC2626' : '#64748B') : '#CBD5E1',
          }}
        />
      ))}
    </span>
  );
}

function relTime(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// null when no tablet is assigned or none has ever reported in.
function tabletHealth(u) {
  if (!u.controller_id || !u.tablet_last_seen_at) return null;
  const ageMs = Date.now() - new Date(u.tablet_last_seen_at).getTime();
  const offline = ageMs > TABLET_STALE_MS;
  const battery = u.tablet_battery_level;
  return {
    offline,
    battery,
    charging: u.tablet_battery_charging === true,
    powerSource: u.tablet_power_source,
    noInternet: !offline && u.tablet_internet_ok === false,
    lowBattery: !offline && battery != null && battery <= 20 && u.tablet_battery_charging !== true,
    networkType: u.tablet_network_type,
    ssid: u.tablet_wifi_ssid,
    rssi: u.tablet_wifi_rssi,
    bars: wifiBars(u.tablet_wifi_rssi),
    lastSeen: u.tablet_last_seen_at,
    appVersion: u.tablet_app_version,
    webviewVersion: u.tablet_webview_version,
  };
}

// mirrors UnitCard's branch order
function tileState(u) {
  if (u.status === 'out_of_order') return 'out_of_order';
  if (u.status === 'occupied' && u.guest_name) {
    return (u.nights_left != null && u.nights_left <= 0) ? 'departing' : 'occupied';
  }
  // A vacant-but-dirty room is an action (clean it) — surface it over both
  // "available" and "arriving today"; the popover still shows arrival detail.
  if (u.status === 'available' && u.housekeeping_status === 'dirty') return 'dirty';
  if (u.arriving_guest_name)      return 'arriving';
  return 'available';
}

// Order = how segments/chips read left-to-right.
const STATUS_META = [
  { key: 'available',    color: '#22C55E', label: 'Available' },
  { key: 'occupied',     color: '#DC2626', label: 'Occupied' },
  { key: 'departing',    color: '#9333EA', label: 'Departing' },
  { key: 'arriving',     color: '#3B82F6', label: 'Arriving' },
  { key: 'dirty',        color: '#FACC15', label: 'To clean' },
  { key: 'out_of_order', color: '#9CA3AF', label: 'Out of Order' },
];

function bucketOf(u) {
  return tileState(u);
}

function countByState(list) {
  const c = { available: 0, occupied: 0, departing: 0, arriving: 0, dirty: 0, out_of_order: 0 };
  for (const u of list) c[bucketOf(u)]++;
  return c;
}

// strip the leading type word so a "Deluxe 101" tile just reads "101"
function shortRoomName(name, type) {
  const w = (type || '').split(/\s+/)[0];
  return w && name.startsWith(w) ? (name.slice(w.length).trim() || name) : name;
}

// Room window: a centred modal at every width (it holds the stay details and
// actions, too much for a small anchored popover).
function UnitPopover({ unit, flags, health, onClose, onChanged }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Room {unit.name}{unit.type ? <span className="text-muted" style={{ fontWeight: 400 }}> · {unit.type}</span> : null}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body"><UnitCard unit={unit} flags={flags} health={health} onChanged={onChanged} /></div>
      </div>
    </div>
  );
}

function TypeCounts({ counts, filter }) {
  const shown = STATUS_META.filter(m => counts[m.key] > 0);
  if (!shown.length) return null;
  return (
    <div className="unit-type-counts">
      {shown.map(m => (
        <span key={m.key} className={`unit-type-chip${filter && filter !== m.key ? ' dim' : ''}`} title={`${counts[m.key]} ${m.label}`}>
          <span className="unit-type-chip-dot" style={{ background: m.color }} />
          <b>{counts[m.key]}</b>
          <span className="unit-type-chip-lbl">{m.label}</span>
        </span>
      ))}
    </div>
  );
}

function UnitTile({ unit, flags, health, selected, onClick }) {
  const state = tileState(unit);
  // Only the single most severe tablet issue gets a badge — offline wins.
  const tabletBadge = health?.offline
    ? { icon: '📵', title: 'Tablet offline' }
    : health?.noInternet
      ? { icon: '⚠️', title: 'Tablet: wifi but no internet' }
      : health?.lowBattery
        ? { icon: '🔋', title: `Tablet battery ${health.battery}%` }
        // a tablet that is online and fine: green, so rooms WITH a tablet
        // stand out from rooms without one (no badge at all)
        : health ? { icon: '📱', title: 'Tablet online', ok: true }
        : null;
  // Still checked in past check-out (nights_left < 0) — see the Dashboard banner.
  const overdue = unit.status === 'occupied' && unit.guest_name && unit.nights_left != null && unit.nights_left < 0;
  const title = `${unit.name}`
    + (overdue ? ' · Overdue — still checked in past check-out' : '')
    + (flags?.dnd ? ' · Do Not Disturb' : '')
    + (flags?.clean ? ' · Clean requested' : '')
    + (tabletBadge ? ` · ${tabletBadge.title}` : '');
  return (
    <button
      className={`unit-tile${selected ? ' selected' : ''}`}
      style={{ background: TILE_BG[state], color: TILE_FG[state] }}
      title={title}
      onClick={onClick}
    >
      <span className="unit-tile-icon">{TILE_ICON[state]}</span>
      <span className="unit-tile-num">{shortRoomName(unit.name, unit.type)}</span>
      {(flags || tabletBadge || overdue) && (
        <span className="unit-tile-badges">
          {overdue && <span className="unit-tile-badge warn" title="Overdue — still checked in past check-out">⏰</span>}
          {flags?.dnd && <span className="unit-tile-badge" title="Do Not Disturb">🔕</span>}
          {flags?.clean && <span className="unit-tile-badge" title="Clean requested">🧹</span>}
          {tabletBadge && <span className={`unit-tile-badge ${tabletBadge.ok ? 'ok' : 'warn'}`} title={tabletBadge.title}>{tabletBadge.icon}</span>}
        </span>
      )}
    </button>
  );
}

export default function UnitStatusBoard({ units, guestRequests = [], onChanged }) {
  const [selected, setSelected] = useState(null); // { unit }
  const [filter, setFilter] = useState(null);     // a STATUS_META key, or null

  useEffect(() => {
    if (selected && !units.some(u => u.id === selected.unit.id)) setSelected(null);
  }, [units, selected]);

  const groups = groupUnitsByType(units);
  const requestFlags = unitRequestFlags(guestRequests, units);
  const overall = countByState(units);
  const total = units.length;

  return (
    <div>
      {/* Whole-property status at a glance — one proportional bar. */}
      <div className="unit-overview-bar" title={`${total} rooms`}>
        {STATUS_META.filter(m => overall[m.key] > 0).map(m => (
          <div
            key={m.key}
            className="unit-overview-seg"
            style={{ flexGrow: overall[m.key], background: m.color }}
            title={`${overall[m.key]} ${m.label}`}
          />
        ))}
      </div>

      {/* Legend + click-to-filter. Filtering narrows the tile grids below. */}
      <div className="unit-summary-strip">
        {STATUS_META.map(m => (
          <button
            key={m.key}
            className={`unit-summary-item${filter === m.key ? ' active' : ''}${overall[m.key] === 0 ? ' zero' : ''}`}
            onClick={() => setFilter(f => (f === m.key ? null : m.key))}
          >
            <span className="unit-summary-dot" style={{ background: m.color }} />
            <b>{overall[m.key]}</b> {m.label}
          </button>
        ))}
        {filter && (
          <button className="unit-summary-clear" onClick={() => setFilter(null)}>
            Show all ✕
          </button>
        )}
      </div>

      {groups.map(g => {
        const list = filter ? g.list.filter(u => bucketOf(u) === filter) : g.list;
        if (!list.length) return null;
        return (
          <div key={g.type} className="unit-tile-group">
            <div className="unit-type-head">
              <span className="unit-type-name">{g.type}</span>
              <span className="unit-type-total">{g.list.length} room{g.list.length !== 1 ? 's' : ''}</span>
            </div>
            <TypeCounts counts={countByState(g.list)} filter={filter} />
            <div className="unit-tile-grid">
              {list.map(u => (
                <UnitTile
                  key={u.id}
                  unit={u}
                  flags={requestFlags.get(u.id)}
                  health={tabletHealth(u)}
                  selected={selected?.unit.id === u.id}
                  onClick={() => setSelected({ unit: u })}
                />
              ))}
            </div>
          </div>
        );
      })}

      {selected && (
        <UnitPopover
          unit={units.find(u => u.id === selected.unit.id) || selected.unit}
          flags={requestFlags.get(selected.unit.id)}
          health={tabletHealth(units.find(u => u.id === selected.unit.id) || selected.unit)}
          onClose={() => setSelected(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
