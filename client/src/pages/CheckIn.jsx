import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const PALETTE = ['#2D5016','#4A7C2A','#B8860B','#1E40AF','#7C3AED','#DB2777','#0891B2','#9A3412'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initials(name = '') {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}
function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

const OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];

const SOURCE_LABEL = {
  direct: 'Direct', airbnb: 'Airbnb', booking_com: 'Booking.com',
  traveloka: 'Traveloka', walkin: 'Walk-in',
};

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
  { key: 'wifi',              label: 'WiFi details provided',           sub: 'Network: BirdnestGuest · Pass: volcano2026' },
  { key: 'checkout_time',     label: 'Guest briefed on check-out time', sub: 'Remind: 11:00 AM on check-out date' },
  { key: 'house_rules',       label: 'House rules explained',           sub: 'No campfire outside zone · Quiet hours 22:00 · No outside guests' },
  { key: 'id_captured',       label: 'ID / Passport captured',          sub: 'Required by Indonesian immigration regulation' },
  { key: 'emergency_contact', label: 'Emergency contact shared',        sub: 'Staff WhatsApp: +62 812 XXXX XXXX' },
];

export default function CheckIn() {
  const [arrivals, setArrivals]     = useState([]);
  const [departures, setDepartures] = useState([]);
  const [selected, setSelected]     = useState(null);
  const [mode, setMode]             = useState(null);
  const [checklist, setChecklist]   = useState({});
  const [idFile, setIdFile]         = useState(null);
  const [conditionNotes, setConditionNotes] = useState('');
  const [step, setStep]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState('');
  const [depositBlockId, setDepositBlockId] = useState(null);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  async function load() {
    const [a, d] = await Promise.all([
      api.get('/api/bookings/today/arrivals'),
      api.get('/api/bookings/today/departures'),
    ]);
    setArrivals(a.data);
    setDepartures(d.data);
  }

  useEffect(() => { load(); }, []);

  function startCheckin(b) {
    const depositOk = b.deposit_paid || OTA_SOURCES.includes(b.source);
    setSelected(b);
    setMode('checkin');
    setStep(1);
    setChecklist({});
    setIdFile(null);
    setDepositBlockId(depositOk ? null : b.id);
    setMsg(depositOk ? '' : 'deposit_unpaid');
  }

  function startCheckout(b) {
    setSelected(b);
    setMode('checkout');
    setConditionNotes('');
    setMsg('');
  }

  async function doCheckin() {
    setLoading(true);
    setDepositBlockId(null);
    try {
      await api.post(`/api/checkin/${selected.id}/start`);
      const fd = new FormData();
      fd.append('checklist_data', JSON.stringify(checklist));
      if (idFile) fd.append('id_document', idFile);
      await api.put(`/api/checkin/${selected.id}/complete`, fd);
      setMsg('success');
      load();
      setTimeout(() => { setSelected(null); setMode(null); setMsg(''); }, 2000);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'DEPOSIT_UNPAID') {
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
      await api.put(`/api/checkin/checkout/${selected.id}/complete`, { condition_notes: conditionNotes });
      setMsg('success');
      load();
      setTimeout(() => { setSelected(null); setMode(null); setMsg(''); }, 2000);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function waWelcome(b) {
    const text = encodeURIComponent(`Welcome to Birdnest Glamping, ${b.guest_name}! 🌿\n\nWe hope you enjoy your stay in ${b.unit_name}. Please don't hesitate to reach out if you need anything.\n\n🌄 Kintamani, Bali`);
    window.open(`https://wa.me/${b.guest_whatsapp?.replace(/\D/g, '')}?text=${text}`, '_blank');
  }

  const isOTA = (b) => OTA_SOURCES.includes(b.source);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Check-in / Check-out</div>
          <div className="page-subtitle">{today}</div>
        </div>
      </div>

      <div className="grid-2 mb-3">
        {/* ── Arrivals ── */}
        <div className="card">
          <div className="card-title">Arriving Today ({arrivals.length})</div>
          {arrivals.length === 0 && <p className="text-muted">No arrivals today</p>}
          {arrivals.map(b => {
            const depositOk = b.deposit_paid || isOTA(b);
            return (
              <div
                key={b.id}
                className="guest-row"
                style={{ marginBottom: 8, cursor: 'default' }}
              >
                <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                  {initials(b.guest_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{b.guest_name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {b.unit_name} · {b.num_guests} pax · {b.nationality}
                  </div>
                  {b.guest_whatsapp && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => waWelcome(b)}
                    >
                      💬 Send Welcome WA
                    </button>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span
                    className={`badge ${depositOk ? 'badge-blue' : 'badge-red'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => startCheckin(b)}
                  >
                    Check In →
                  </span>
                  <div style={{ fontSize: 11, marginTop: 4, color: depositOk ? 'var(--green)' : '#DC2626', fontWeight: 600 }}>
                    {isOTA(b)
                      ? '🏷 OTA managed'
                      : b.deposit_paid
                        ? '✓ Deposit paid'
                        : '⚠ Deposit pending'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Departures ── */}
        <div className="card">
          <div className="card-title">Departing Today ({departures.length})</div>
          {departures.length === 0 && <p className="text-muted">No departures today</p>}
          {departures.map(b => {
            const balanceOk = b.balance_paid || isOTA(b) || parseFloat(b.balance_amount || 0) === 0;
            return (
              <div
                key={b.id}
                className="guest-row"
                style={{ marginBottom: 8, background: '#F0FDF4', borderColor: '#BBF7D0', cursor: 'default' }}
              >
                <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                  {initials(b.guest_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{b.guest_name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{b.unit_name}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span
                    className="badge badge-amber"
                    style={{ cursor: 'pointer' }}
                    onClick={() => startCheckout(b)}
                  >
                    Check Out →
                  </span>
                  <div style={{ fontSize: 11, marginTop: 4, color: balanceOk ? 'var(--green)' : '#DC2626', fontWeight: 600 }}>
                    {isOTA(b)
                      ? '🏷 OTA managed'
                      : b.balance_paid
                        ? '✓ Balance paid'
                        : parseFloat(b.balance_amount || 0) === 0
                          ? '✓ No balance due'
                          : `⚠ Balance pending ${fmtIDR(b.balance_amount)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
                <div className="alert alert-success">Check-in complete! ✓ Unit status updated.</div>
              ) : msg === 'deposit_unpaid' ? (
                <div>
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <strong>Deposit not received.</strong><br />
                    Record the deposit payment in the booking before checking in.
                  </div>
                  <Link to={`/reservations/${depositBlockId}`} className="btn btn-primary" onClick={() => setSelected(null)}>
                    → Go to Booking &amp; Record Payment
                  </Link>
                </div>
              ) : msg ? (
                <div className="alert alert-error">{msg}</div>
              ) : (
                <>
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
                        <Row label="Channel"    value={SOURCE_LABEL[selected.source] || selected.source} />
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

                  {/* Balance status */}
                  {isOTA(selected) ? (
                    <div className="alert alert-success" style={{ marginTop: 0, marginBottom: 12 }}>
                      🏷 OTA managed — payment handled by {selected.source.replace('_', '.')}
                    </div>
                  ) : selected.balance_paid || parseFloat(selected.balance_amount || 0) === 0 ? (
                    <div className="alert alert-success" style={{ marginTop: 0, marginBottom: 12 }}>
                      ✓ Balance {parseFloat(selected.balance_amount || 0) === 0 ? 'not required (fully prepaid)' : `received — ${fmtIDR(selected.balance_amount)}`}
                    </div>
                  ) : (
                    <div className="alert alert-error" style={{ marginTop: 0, marginBottom: 12 }}>
                      ⚠ Balance of <strong>{fmtIDR(selected.balance_amount)}</strong> has not been received.
                      {' '}Please collect payment before or after completing check-out.
                      {' '}<Link to={`/reservations/${selected.id}`} onClick={() => setSelected(null)} style={{ fontWeight: 700 }}>
                        Record payment →
                      </Link>
                    </div>
                  )}

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
                <button className="btn btn-primary" onClick={doCheckout} disabled={loading}>
                  {loading ? 'Processing…' : 'Complete Check-out ✓'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
