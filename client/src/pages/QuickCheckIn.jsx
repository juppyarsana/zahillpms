import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

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


function GuestCard({ booking, borderColor, rightLabel, rightColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: 'white',
        border: `2px solid ${borderColor}`,
        borderRadius: 14, padding: '18px 20px',
        cursor: 'pointer', textAlign: 'left', width: '100%',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
        background: avatarColor(booking.guest_name),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', fontWeight: 700, fontSize: 20,
      }}>
        {initials(booking.guest_name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {booking.guest_name}
        </div>
        <div style={{ fontSize: 14, color: '#374151', marginTop: 2 }}>{booking.unit_name}</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
          {booking.check_in_date?.slice(0, 10)} → {booking.check_out_date?.slice(0, 10)} · {booking.num_guests} tamu
        </div>
      </div>
      <div style={{ flexShrink: 0, fontWeight: 700, fontSize: 13, color: rightColor }}>
        {rightLabel}
      </div>
    </button>
  );
}

export default function QuickCheckIn() {
  const { sources } = useSettings();
  const otaSources = sources.filter(s => s.is_ota).map(s => s.id);

  const [tab, setTab] = useState('checkin');

  // Check-in state
  const [arrivals, setArrivals]       = useState([]);
  const [ciSelected, setCiSelected]   = useState(null);
  const [idFile, setIdFile]           = useState(null);
  const [ciLoading, setCiLoading]     = useState(false);
  const [ciMsg, setCiMsg]             = useState('');
  const [depositBlockId, setDepositBlockId] = useState(null);

  // Check-out state
  const [departures, setDepartures]   = useState([]);
  const [inHouse, setInHouse]         = useState([]);
  const [coSelected, setCoSelected]   = useState(null);
  const [conditionNotes, setConditionNotes] = useState('');
  const [coLoading, setCoLoading]     = useState(false);
  const [coMsg, setCoMsg]             = useState('');

  async function load() {
    try {
      const [a, d, h] = await Promise.all([
        api.get('/api/bookings/today/arrivals'),
        api.get('/api/bookings/today/departures'),
        api.get('/api/bookings/in-house'),
      ]);
      setArrivals(a.data);
      setDepartures(d.data);
      setInHouse(h.data);
    } catch (_) {}
  }

  useEffect(() => { load(); }, []);

  // ── Check-in helpers ──
  function openCheckin(b) {
    const isOTA = otaSources.includes(b.source);
    setCiSelected(b);
    setIdFile(null);
    setCiMsg('');
    setDepositBlockId(null);
    if (!isOTA) {
      if (b.status === 'deposit_paid')  { setDepositBlockId(b.id); setCiMsg('balance_unpaid'); }
      else if (!b.deposit_paid)         { setDepositBlockId(b.id); setCiMsg('deposit_unpaid'); }
    }
  }

  function closeCiModal() { setCiSelected(null); setCiMsg(''); setDepositBlockId(null); }

  async function doCheckin() {
    setCiLoading(true);
    // /start commits the check-in; treat errors here as the real failure
    try {
      await api.post(`/api/checkin/${ciSelected.id}/start`);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'BALANCE_UNPAID')      { setDepositBlockId(ciSelected.id); setCiMsg('balance_unpaid'); }
      else if (data?.code === 'DEPOSIT_UNPAID') { setDepositBlockId(ciSelected.id); setCiMsg('deposit_unpaid'); }
      else setCiMsg(data?.error || 'Something went wrong');
      setCiLoading(false);
      return;
    }
    // Booking is now checked_in — /complete only saves the ID photo and checklist
    const fd = new FormData();
    fd.append('checklist_data', JSON.stringify({ id_captured: !!idFile }));
    if (idFile) fd.append('id_document', idFile);
    try { await api.put(`/api/checkin/${ciSelected.id}/complete`, fd); } catch (_) {}
    setCiMsg('success');
    load();
    setTimeout(closeCiModal, 2500);
    setCiLoading(false);
  }

  // ── Check-out helpers ──
  function openCheckout(b) {
    setCoSelected(b);
    setConditionNotes('');
    setCoMsg('');
  }

  function closeCoModal() { setCoSelected(null); setCoMsg(''); }

  async function doCheckout() {
    setCoLoading(true);
    try {
      await api.put(`/api/checkin/checkout/${coSelected.id}/complete`, { condition_notes: conditionNotes });
      setCoMsg('success');
      load();
      setTimeout(closeCoModal, 2500);
    } catch (err) {
      setCoMsg(err.response?.data?.error || 'Something went wrong');
    } finally {
      setCoLoading(false);
    }
  }

  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayStr = new Date().toISOString().slice(0, 10);

  // Overdue in-house guests (checkout date has passed)
  const overdueInHouse = inHouse.filter(b => b.check_out_date < todayStr);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Quick {tab === 'checkin' ? 'Check-in' : 'Check-out'}</div>
          <div className="page-subtitle">{today}</div>
        </div>
        <Link to="/checkin" className="btn btn-secondary" style={{ fontSize: 13 }}>Full View →</Link>
      </div>

      {/* ── Tab toggle ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, background: '#F3F4F6', borderRadius: 12, padding: 4 }}>
        {[
          { key: 'checkin',  label: `⬇ Check-in (${arrivals.length})` },
          { key: 'checkout', label: `⬆ Check-out (${departures.length + overdueInHouse.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 9, border: 'none',
              fontWeight: 700, fontSize: 14, cursor: 'pointer',
              background: tab === t.key ? 'white' : 'transparent',
              color: tab === t.key ? '#2D5016' : '#6B7280',
              boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ CHECK-IN TAB ══ */}
      {tab === 'checkin' && (
        arrivals.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Tidak ada tamu tiba hari ini</div>
            <div className="text-muted" style={{ marginTop: 6 }}>Semua tamu sudah check-in atau tidak ada booking hari ini.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {arrivals.map(b => {
              const isOTA = otaSources.includes(b.source);
              const ready = b.deposit_paid || isOTA;
              return (
                <GuestCard
                  key={b.id}
                  booking={b}
                  borderColor={ready ? '#BBF7D0' : '#FED7AA'}
                  rightLabel={ready ? 'Siap ✓' : '⚠ Bayar'}
                  rightColor={ready ? '#16A34A' : '#D97706'}
                  onClick={() => openCheckin(b)}
                />
              );
            })}
          </div>
        )
      )}

      {/* ══ CHECK-OUT TAB ══ */}
      {tab === 'checkout' && (
        departures.length === 0 && overdueInHouse.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏁</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Tidak ada tamu keluar hari ini</div>
            <div className="text-muted" style={{ marginTop: 6 }}>Tidak ada jadwal check-out hari ini.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {overdueInHouse.length > 0 && (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', marginBottom: 2, paddingLeft: 4 }}>
                TERLAMBAT CHECK-OUT
              </div>
            )}
            {overdueInHouse.map(b => {
              const isOTA = otaSources.includes(b.source);
              const balanceOk = b.balance_paid || isOTA || parseFloat(b.balance_amount || 0) === 0;
              return (
                <GuestCard
                  key={b.id}
                  booking={b}
                  borderColor='#FECACA'
                  rightLabel={balanceOk ? 'Lunas ✓' : `⚠ ${fmtIDR(b.balance_amount)}`}
                  rightColor={balanceOk ? '#16A34A' : '#DC2626'}
                  onClick={() => openCheckout(b)}
                />
              );
            })}

            {departures.length > 0 && overdueInHouse.length > 0 && (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginTop: 4, marginBottom: 2, paddingLeft: 4 }}>
                CHECKOUT HARI INI
              </div>
            )}
            {departures.map(b => {
              const isOTA = otaSources.includes(b.source);
              const balanceOk = b.balance_paid || isOTA || parseFloat(b.balance_amount || 0) === 0;
              return (
                <GuestCard
                  key={b.id}
                  booking={b}
                  borderColor={balanceOk ? '#BBF7D0' : '#FED7AA'}
                  rightLabel={balanceOk ? 'Lunas ✓' : `⚠ ${fmtIDR(b.balance_amount)}`}
                  rightColor={balanceOk ? '#16A34A' : '#D97706'}
                  onClick={() => openCheckout(b)}
                />
              );
            })}
          </div>
        )
      )}

      {/* ══ CHECK-IN MODAL ══ */}
      {ciSelected && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">{ciSelected.guest_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {ciSelected.unit_name} · {ciSelected.check_in_date?.slice(0, 10)} → {ciSelected.check_out_date?.slice(0, 10)} · {ciSelected.num_guests} tamu
                </div>
              </div>
              <button className="btn btn-icon" onClick={closeCiModal}>✕</button>
            </div>

            <div className="modal-body">
              {ciMsg === 'success' ? (
                <div style={{ textAlign: 'center', padding: '28px 0' }}>
                  <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>Check-in selesai!</div>
                  <div className="text-muted" style={{ marginTop: 6 }}>{ciSelected.guest_name} sudah check in.</div>
                </div>
              ) : ciMsg === 'balance_unpaid' ? (
                <div>
                  <div className="alert alert-error" style={{ marginBottom: 16 }}>
                    <strong>Pembayaran belum lunas.</strong><br />Lunasi pembayaran sebelum check-in.
                  </div>
                  <Link to={`/reservations/${depositBlockId}`} className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }} onClick={closeCiModal}>
                    → Catat Pembayaran
                  </Link>
                </div>
              ) : ciMsg === 'deposit_unpaid' ? (
                <div>
                  <div className="alert alert-error" style={{ marginBottom: 16 }}>
                    <strong>Belum ada pembayaran.</strong><br />Pembayaran penuh wajib sebelum check-in.
                  </div>
                  <Link to={`/reservations/${depositBlockId}`} className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }} onClick={closeCiModal}>
                    → Catat Pembayaran
                  </Link>
                </div>
              ) : ciMsg ? (
                <div className="alert alert-error">{ciMsg}</div>
              ) : (
                <>
                  <div
                    onClick={() => document.getElementById('qci-file').click()}
                    style={{
                      border: `2px dashed ${idFile ? '#16A34A' : '#D1D5DB'}`,
                      borderRadius: 14, padding: '28px 24px', textAlign: 'center',
                      background: idFile ? '#F0FDF4' : '#F9FAFB', cursor: 'pointer',
                      marginBottom: 16,
                    }}
                  >
                    <input id="qci-file" type="file" accept="image/*" capture="environment"
                      style={{ display: 'none' }} onChange={e => setIdFile(e.target.files[0])} />
                    {idFile ? (
                      <>
                        <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#16A34A' }}>Foto ID berhasil diambil</div>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{idFile.name}</div>
                        <div style={{ fontSize: 12, color: '#2D5016', marginTop: 8 }}>Ketuk untuk foto ulang</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 44, marginBottom: 8 }}>📷</div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>Foto KTP / Paspor</div>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>Ketuk untuk buka kamera</div>
                      </>
                    )}
                  </div>
                  {!idFile && (
                    <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 4 }}>
                      Foto ID bisa ditambahkan nanti dari profil tamu jika perlu.
                    </div>
                  )}
                </>
              )}
            </div>

            {!ciMsg && (
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={closeCiModal}>Batal</button>
                <button className="btn btn-primary" onClick={doCheckin} disabled={ciLoading}
                  style={{ flex: 1, justifyContent: 'center', fontSize: 15, padding: '12px 20px' }}>
                  {ciLoading ? 'Memproses…' : '✅ Check In'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ CHECK-OUT MODAL ══ */}
      {coSelected && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">{coSelected.guest_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {coSelected.unit_name} · checkout {coSelected.check_out_date?.slice(0, 10)} · {coSelected.num_guests} tamu
                </div>
              </div>
              <button className="btn btn-icon" onClick={closeCoModal}>✕</button>
            </div>

            <div className="modal-body">
              {coMsg === 'success' ? (
                <div style={{ textAlign: 'center', padding: '28px 0' }}>
                  <div style={{ fontSize: 60, marginBottom: 12 }}>🏁</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>Check-out selesai!</div>
                  <div className="text-muted" style={{ marginTop: 6 }}>
                    {coSelected.guest_name} sudah check out. Housekeeping otomatis dibuat.
                  </div>
                </div>
              ) : coMsg ? (
                <div className="alert alert-error">{coMsg}</div>
              ) : (
                <>
                  {/* Balance warning */}
                  {(() => {
                    const isOTA = otaSources.includes(coSelected.source);
                    const balanceOk = coSelected.balance_paid || isOTA || parseFloat(coSelected.balance_amount || 0) === 0;
                    if (!balanceOk) return (
                      <div className="alert alert-error" style={{ marginBottom: 16 }}>
                        <strong>⚠ Sisa pembayaran belum diterima: {fmtIDR(coSelected.balance_amount)}</strong><br />
                        Tagih pembayaran sebelum atau sesudah checkout.
                      </div>
                    );
                    return (
                      <div className="alert alert-success" style={{ marginBottom: 16 }}>
                        ✓ {isOTA ? `OTA managed — ${coSelected.source.replace('_', '.')}` : 'Pembayaran lunas'}
                      </div>
                    );
                  })()}

                  {/* Condition notes */}
                  <div className="form-group">
                    <label className="form-label">Catatan kondisi unit (opsional)</label>
                    <textarea
                      className="form-textarea"
                      placeholder="Ada kerusakan, barang tertinggal, atau hal lain…"
                      value={conditionNotes}
                      onChange={e => setConditionNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                    Housekeeping task akan otomatis dibuat setelah checkout selesai.
                  </div>
                </>
              )}
            </div>

            {!coMsg && (
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={closeCoModal}>Batal</button>
                <button className="btn btn-primary" onClick={doCheckout} disabled={coLoading}
                  style={{ flex: 1, justifyContent: 'center', fontSize: 15, padding: '12px 20px', background: '#D97706', borderColor: '#D97706' }}>
                  {coLoading ? 'Memproses…' : '🏁 Check Out'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
