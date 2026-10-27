// The check-in steps and the check-out window, shared by Check-in / out and
// Today: useCheckInOut({ onChanged }) → { startCheckin(b), startCheckout(b),
// waWelcome(b), otaPays(b), windows } — render `windows` once on the page.
// `b` is a row of /api/bookings/today/arrivals, /today/departures or /in-house.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckoutBalanceBlock, checkoutBlocked } from './CheckoutBalance';
import { NotesPreview } from './StaffNotes';
import RoomCheckPanel from './RoomCheck';
import api from '../services/api';
import PayLaterOption from './PayLaterOption';
import EarlyDepartureOption from './EarlyDepartureOption';
import { useSettings } from '../context/SettingsContext';
import RegistrationCardModal from './RegistrationCardModal';
import OtherGuests from './OtherGuests';

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

const CHECKLIST = [
  { key: 'unit_clean',        label: 'Unit clean & ready',              sub: 'Housekeeping confirmed' },
  { key: 'amenities',         label: 'Welcome amenities in place',      sub: 'Water, local snacks, welcome card, fresh flowers' },
  { key: 'wifi',              label: 'WiFi details provided',           sub: 'Network name and password given to the guest' },
  { key: 'checkout_time',     label: 'Guest briefed on check-out time', sub: 'Remind: 11:00 AM on check-out date' },
  { key: 'house_rules',       label: 'House rules explained',           sub: 'No campfire outside zone · Quiet hours 22:00 · No outside guests' },
  { key: 'id_captured',       label: 'ID / Passport captured',          sub: 'Required by Indonesian immigration regulation' },
  { key: 'emergency_contact', label: 'Emergency contact shared',        sub: 'Staff WhatsApp: +62 812 XXXX XXXX' },
];

export function useCheckInOut({ onChanged } = {}) {
  const { sources, branding } = useSettings();
  const otaSources = sources.filter(s => s.is_ota).map(s => s.id);
  // Who collects (channel manager, migration 121) wins over the source.
  const otaPays = (b) => (b.payment_collect ? ['ota', 'vcc'].includes(b.payment_collect) : otaSources.includes(b.source));
  function srcLabel(id) { return sources.find(s => s.id === id)?.label || id; }

  const [selected, setSelected]     = useState(null);
  const [mode, setMode]             = useState(null);
  const [checklist, setChecklist]   = useState({});
  const [idFile, setIdFile]         = useState(null);
  const [conditionNotes, setConditionNotes] = useState('');
  const [unpaidReason, setUnpaidReason] = useState('');
  const [earlyCo, setEarlyCo] = useState({ early: false, valid: true, early_departure: null }); // leaving before the booked date
  const [step, setStep]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState('');
  const [showRegCard, setShowRegCard] = useState(false);
  const [depositBlockId, setDepositBlockId] = useState(null);
  // Set when front desk chose "Check in anyway — pay later" (with a reason).
  const [payLaterReason, setPayLaterReason] = useState(null);

  function startCheckin(b) {
    setSelected(b);
    setMode('checkin');
    setStep(1);
    setChecklist({});
    setIdFile(null);
    setPayLaterReason(null);

    if (!otaPays(b) && !b.agent_billed) {
      if (b.status === 'deposit_paid') {
        setDepositBlockId(b.id);
        setMsg('balance_unpaid');
        return;
      }
      if (!b.deposit_paid) {
        setDepositBlockId(b.id);
        setMsg('deposit_unpaid');
        return;
      }
    }
    setDepositBlockId(null);
    setMsg('');
  }

  function startCheckout(b) {
    setSelected(b);
    setMode('checkout');
    setConditionNotes('');
    setUnpaidReason('');
    setEarlyCo({ early: false, valid: true, early_departure: null });
    setMsg('');
  }

  async function doCheckin() {
    setLoading(true);
    setDepositBlockId(null);
    try {
      await api.post(`/api/checkin/${selected.id}/start`, payLaterReason ? { pay_later_reason: payLaterReason } : {});
      const fd = new FormData();
      fd.append('checklist_data', JSON.stringify(checklist));
      if (idFile) fd.append('id_document', idFile);
      await api.put(`/api/checkin/${selected.id}/complete`, fd);
      setMsg('success');
      onChanged?.();
      // No auto-dismiss here (unlike checkout below) — front desk gets a
      // moment to open the Registration Card before moving on, instead of
      // racing a timer.
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'BALANCE_UNPAID') {
        setDepositBlockId(selected.id);
        setMsg('balance_unpaid');
      } else if (data?.code === 'DEPOSIT_UNPAID') {
        setDepositBlockId(selected.id);
        setMsg('deposit_unpaid');
      } else {
        setMsg(data?.error || 'Error');
      }
    } finally {
      setLoading(false);
    }
  }

  async function doCheckout() {
    setLoading(true);
    try {
      await api.put(`/api/checkin/checkout/${selected.id}/complete`, {
        condition_notes: conditionNotes,
        ...(earlyCo.early ? { early_departure: earlyCo.early_departure } : {}),
        ...(unpaidReason.trim() ? { unpaid_reason: unpaidReason.trim() } : {}),
      });
      setMsg('success');
      onChanged?.();
      setTimeout(() => { setSelected(null); setMode(null); setMsg(''); }, 2000);
    } catch (err) {
      const data = err.response?.data;
      // The list was out of date (e.g. an extra was just charged): show what's owed now.
      if (data?.code === 'BALANCE_DUE') setSelected(s => ({ ...s, guest_balance_due: data.amount }));
      else setMsg(data?.error || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function waWelcome(b) {
    const text = encodeURIComponent(`Welcome to ${branding?.name || 'our hotel'}, ${b.guest_name}! 🌿\n\nWe hope you enjoy your stay in ${b.unit_name}. Please don't hesitate to reach out if you need anything.${branding?.area ? `\n\n🌄 ${branding.area}` : ''}`);
    const rawWa = (b.guest_whatsapp || '').trim();
    let waNum = rawWa.replace(/\D/g, '');
    if (!rawWa.startsWith('+')) {
      if (waNum.startsWith('0')) waNum = '62' + waNum.slice(1);
      else if (!waNum.startsWith('62')) waNum = '62' + waNum;
    }
    window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
  }

  const windows = (
    <>
        {/* ── Check-in modal ── */}
        {selected && mode === 'checkin' && (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 540 }}>
              <div className="modal-header">
                <div>
                  <div className="modal-title">Check-in · {selected.guest_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {selected.unit_name} · {selected.check_in_date?.slice(0, 10)} → {selected.check_out_date?.slice(0, 10)} · {selected.num_guests} guest{selected.num_guests > 1 ? 's' : ''}
                  </div>
                </div>
                <button className="btn btn-icon" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="modal-body">
                {/* ── result states ── */}
                {msg === 'success' ? (
                  <div>
                    <div className="alert alert-success" style={{ marginBottom: 12 }}>Check-in complete! ✓ Unit status updated.</div>
                    <div className="flex gap-2">
                      <button className="btn btn-primary" onClick={() => setShowRegCard(true)}>🖨 Print Registration Card</button>
                      <button className="btn btn-secondary" onClick={() => { setSelected(null); setMode(null); setMsg(''); }}>Done</button>
                    </div>
                  </div>
                ) : msg === 'balance_unpaid' ? (
                  <div>
                    <div className="alert alert-error" style={{ marginBottom: 12 }}>
                      <strong>Balance payment not received.</strong><br />
                      Full payment is required before check-in. Please collect the outstanding balance first.
                    </div>
                    <Link to={`/reservations/${depositBlockId}`} className="btn btn-primary" onClick={() => setSelected(null)}>
                      → Go to Booking &amp; Record Payment
                    </Link>
                    <PayLaterOption lang="en" onConfirm={r => { setPayLaterReason(r); setDepositBlockId(null); setMsg(''); }} />
                  </div>
                ) : msg === 'deposit_unpaid' ? (
                  <div>
                    <div className="alert alert-error" style={{ marginBottom: 12 }}>
                      <strong>Payment not received.</strong><br />
                      Full payment is required before check-in. Please record the payment first.
                    </div>
                    <Link to={`/reservations/${depositBlockId}`} className="btn btn-primary" onClick={() => setSelected(null)}>
                      → Go to Booking &amp; Record Payment
                    </Link>
                    <PayLaterOption lang="en" onConfirm={r => { setPayLaterReason(r); setDepositBlockId(null); setMsg(''); }} />
                  </div>
                ) : msg ? (
                  <div className="alert alert-error">{msg}</div>
                ) : (
                  <>
                    {payLaterReason && (
                      <div className="alert alert-warn" style={{ marginBottom: 12, fontSize: 13 }}>
                        ⚠ Checking in <b>without full payment</b> — the unpaid amount stays as balance due. Reason: {payLaterReason}
                      </div>
                    )}
                    {/* Step indicator */}
                    <div className="steps" style={{ marginBottom: 20 }}>
                      <div className={`step ${step > 1 ? 'done' : step === 1 ? 'active' : ''}`}>
                        {step > 1 ? '1. Guest Info ✓' : '1. Guest Info'}
                      </div>
                      <div className={`step ${step > 2 ? 'done' : step === 2 ? 'active' : ''}`}>
                        {step > 2 ? '2. ID Verify ✓' : '2. ID Verify'}
                      </div>
                      <div className={`step ${step === 3 ? 'active' : ''}`}>3. Handover</div>
                      <div className="step">4. Complete</div>
                    </div>

                    {/* ── Step 1: Guest Info Review ── */}
                    {step === 1 && (
                      <>
                        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 10 }} onClick={() => setShowRegCard(true)}>
                          🖨 Print Registration Card
                        </button>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <Row label="Guest"      value={selected.guest_name} bold />
                          <Row label="Nationality" value={selected.nationality || '—'} />
                          <Row label="WhatsApp"   value={selected.guest_whatsapp || '—'} />
                          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                          <Row label="Unit"       value={selected.unit_name} bold />
                          <Row label="Check-in"   value={selected.check_in_date?.slice(0, 10)} />
                          <Row label="Check-out"  value={selected.check_out_date?.slice(0, 10)} />
                          <Row label="Nights"     value={selected.nights} />
                          <Row label="Guests"     value={`${selected.num_guests} pax`} />
                          <Row label="Channel"    value={srcLabel(selected.source) || selected.source} />
                          {selected.special_requests && (
                            <>
                              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                              <div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Special Requests</div>
                                <div style={{ fontSize: 13, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px' }}>
                                  {selected.special_requests}
                                </div>
                              </div>
                            </>
                          )}
                          {selected.staff_notes?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Staff notes</div>
                              <NotesPreview notes={selected.staff_notes} max={5} />
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* ── Step 2: ID Verify ── */}
                    {step === 2 && (
                      <>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                          Verify the guest's identity and capture their ID or passport photo for records.
                        </p>
                        <div className="form-group">
                          <label className="form-label">ID / Passport Photo</label>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="form-input"
                            onChange={e => setIdFile(e.target.files[0])}
                          />
                          {idFile && (
                            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>
                              ✓ {idFile.name} selected
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            Required by Indonesian immigration regulation. Photo is stored securely.
                          </div>
                        </div>
                        {!idFile && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
                            You can skip the photo and add it later from the guest profile if needed.
                          </div>
                        )}
                        <OtherGuests bookingId={selected.id} compact />
                      </>
                    )}

                    {/* ── Step 3: Unit Handover ── */}
                    {step === 3 && (
                      <>
                        <div className="card-title" style={{ fontSize: 13, marginBottom: 12 }}>
                          {selected.unit_name} Handover Checklist
                        </div>
                        {CHECKLIST.map(item => (
                          <div
                            key={item.key}
                            className={`check-item${checklist[item.key] ? ' checked' : ''}`}
                            onClick={() => setChecklist(c => ({ ...c, [item.key]: !c[item.key] }))}
                          >
                            <div className="check-box">{checklist[item.key] ? '✓' : ''}</div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Footer buttons per step */}
              {!msg && (
                <div className="modal-footer">
                  {step === 1 && (
                    <>
                      <button className="btn btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
                      {selected.guest_whatsapp && (
                        <button className="btn btn-ghost" onClick={() => waWelcome(selected)}>📲 Welcome WA</button>
                      )}
                      <button className="btn btn-primary" onClick={() => setStep(2)}>
                        Next: ID Verify →
                      </button>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
                      <button className="btn btn-primary" onClick={() => setStep(3)}>
                        Next: Unit Handover →
                      </button>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
                      <button className="btn btn-primary" onClick={doCheckin} disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                        {loading ? 'Processing…' : '✅ Complete Check-in'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Check-out modal ── */}
        {selected && mode === 'checkout' && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <div className="modal-title">Check-out: {selected.guest_name}</div>
                <button className="btn btn-icon" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className="modal-body">
                {msg === 'success' ? (
                  <div className="alert alert-success">Check-out complete! ✓ Unit freed for housekeeping.</div>
                ) : msg ? (
                  <div className="alert alert-error">{msg}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>
                      <strong>{selected.unit_name}</strong> · Check-out {selected.check_out_date?.slice(0, 10)}
                    </div>

                    {/* What the guest still owes (whole stay) — checkout is refused
                        until it's paid, unless a reason is given. */}
                    {selected.staff_notes?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Staff notes — anything to settle before the guest leaves?</div>
                        <NotesPreview notes={selected.staff_notes} max={5} />
                      </div>
                    )}
                    {/* Minibar check by housekeeping — only a warning, never blocks */}
                    <RoomCheckPanel bookingId={selected.id} onCharged={() => {
                      api.get(`/api/checkin/checkout/${selected.id}/balance`).then(r => setSelected(s => (s ? { ...s, guest_balance_due: r.data.owed } : s))).catch(() => {});
                    }} />
                    <CheckoutBalanceBlock booking={selected} reason={unpaidReason} setReason={setUnpaidReason}
                      onRecordPayment={() => setSelected(null)} />

                    <EarlyDepartureOption booking={selected} onChange={setEarlyCo} />
                    <div className="form-group">
                      <label className="form-label">Unit Condition Notes</label>
                      <textarea
                        className="form-textarea"
                        placeholder="Any damage, issues, or items left behind…"
                        value={conditionNotes}
                        onChange={e => setConditionNotes(e.target.value)}
                      />
                    </div>
                    <div className="alert alert-success" style={{ marginTop: 0 }}>
                      Completing check-out will free the unit and auto-generate a housekeeping task.
                    </div>
                  </>
                )}
              </div>
              {!msg && (
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={doCheckout} disabled={loading || !earlyCo.valid || checkoutBlocked(selected, unpaidReason)}>
                    {loading ? 'Processing…' : checkoutBlocked(selected, unpaidReason) ? 'Take the payment first' : unpaidReason.trim() && selected.guest_balance_due > 0 ? 'Check out with balance due' : 'Complete Check-out ✓'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {showRegCard && selected && (
          <RegistrationCardModal bookingId={selected.id} onClose={() => setShowRegCard(false)} />
        )}
    </>
  );

  return { startCheckin, startCheckout, waWelcome, otaPays, windows };
}
