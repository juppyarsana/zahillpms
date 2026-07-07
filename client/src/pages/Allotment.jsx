import { useState, useEffect } from 'react';
import api from '../services/api';

const CHANNELS = ['direct', 'airbnb', 'booking_com', 'traveloka', 'buffer'];
const LABELS  = { direct: 'Direct', airbnb: 'Airbnb', booking_com: 'Booking.com', traveloka: 'Traveloka', buffer: 'Buffer' };
const COLORS  = { direct: '#5C1A2E', airbnb: '#FF5A5F', booking_com: '#003580', traveloka: '#038CFC', buffer: '#9CA3AF' };
const CH_CLASS = { direct: 'ch-direct', airbnb: 'ch-airbnb', booking_com: 'ch-booking', traveloka: 'ch-traveloka', buffer: 'ch-buffer' };

function TonightBadge({ status }) {
  if (status === 'occupied')    return <span className="badge badge-amber">Occupied</span>;
  if (status === 'arriving')    return <span className="badge badge-blue">Arriving</span>;
  if (status === 'maintenance') return <span className="badge badge-gray">Maintenance</span>;
  return <span className="badge badge-green">Available</span>;
}

export default function Allotment() {
  const now = new Date();
  const [year, setYear]           = useState(now.getFullYear());
  const [month, setMonth]         = useState(now.getMonth() + 1);
  const [units, setUnits]         = useState([]);
  const [allotments, setAllotments] = useState([]);
  const [unitStatuses, setUnitStatuses] = useState({});
  const [dirty, setDirty]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');

  useEffect(() => {
    api.get('/api/units').then(r => setUnits(r.data));
    api.get('/api/dashboard/summary').then(r => {
      const map = {};
      r.data.occupancy.units.forEach(u => {
        let s = 'available';
        if (u.booking_id)          s = 'occupied';
        else if (u.arriving_booking_id) s = 'arriving';
        else if (u.status === 'maintenance') s = 'maintenance';
        map[u.id] = s;
      });
      setUnitStatuses(map);
    });
  }, []);

  useEffect(() => {
    api.get(`/api/allotments?month=${month}&year=${year}`).then(r => setAllotments(r.data));
    setDirty(false);
  }, [month, year]);

  function getChannel(unitId) {
    return allotments.find(a => a.unit_id === unitId)?.channel || 'direct';
  }

  function setChannel(unitId, channel) {
    setAllotments(prev => {
      const exists = prev.find(a => a.unit_id === unitId);
      if (exists) return prev.map(a => a.unit_id === unitId ? { ...a, channel } : a);
      return [...prev, { unit_id: unitId, channel, month, year }];
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/allotments', {
        allotments: units.map(u => ({ unit_id: u.id, channel: getChannel(u.id), month, year })),
      });
      setMsg('Saved!');
      setDirty(false);
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Error saving');
    } finally {
      setSaving(false);
    }
  }

  const counts = CHANNELS.reduce((acc, ch) => {
    acc[ch] = units.filter(u => getChannel(u.id) === ch).length;
    return acc;
  }, {});
  const total = units.length || 1;
  const monthName = new Date(year, month - 1).toLocaleString('en', { month: 'long' });

  const visibleChannels = CHANNELS.filter(ch => ch !== 'traveloka' || counts.traveloka > 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Room Allotment</div>
          <div className="page-subtitle">Manage channel distribution across your {units.length} units</div>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <button className="btn btn-icon" onClick={() => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); }}>‹</button>
          <span style={{ fontWeight: 700 }}>{monthName} {year}</span>
          <button className="btn btn-icon" onClick={() => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); }}>›</button>
          {dirty && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>}
        </div>
      </div>

      {msg && <div className={`alert ${msg.includes('Error') ? 'alert-error' : 'alert-success'}`}>{msg}</div>}

      <div className="grid-2 mb-3">
        {/* ── Channel Allocation card ── */}
        <div className="card">
          <div className="card-title">Channel Allocation — {monthName} {year}</div>

          {visibleChannels.map(ch => (
            <div key={ch} className="allot-row">
              <div className="allot-label">
                <span className={`ch ${CH_CLASS[ch]}`}>{LABELS[ch]}</span>
              </div>
              <div className="allot-bar-bg">
                <div className="allot-bar" style={{ width: `${(counts[ch] / total) * 100}%`, background: COLORS[ch] }} />
              </div>
              <div className="allot-count">{counts[ch]} unit{counts[ch] !== 1 ? 's' : ''}</div>
            </div>
          ))}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
            💡 Buffer unit is kept unallocated to protect against double-booking during OTA sync. Released to open channels at T–3 days if still empty.
          </p>

          {counts.buffer === 0 && (
            <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
              ⚠️ No buffer unit set. Recommended to keep at least 1 unit as a buffer.
            </div>
          )}
        </div>

        {/* ── Unit Assignments card ── */}
        <div className="card">
          <div className="card-title">Unit Assignments</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={{ padding: '8px 0', textAlign: 'left' }}>Unit</th>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th style={{ textAlign: 'left' }}>Tonight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {units.map(u => {
                const ch = getChannel(u.id);
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 0', fontWeight: 700 }}>{u.name}</td>
                    <td><span className={`ch ${CH_CLASS[ch]}`}>{LABELS[ch]}</span></td>
                    <td><TonightBadge status={unitStatuses[u.id]} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <select
                        className="btn btn-ghost btn-sm"
                        style={{ border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'white', padding: '4px 8px' }}
                        value={ch}
                        onChange={e => setChannel(u.id, e.target.value)}
                      >
                        {CHANNELS.map(c => <option key={c} value={c}>{LABELS[c]}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Channel Strategy ── */}
      <div className="card">
        <div className="card-title">Channel Strategy</div>
        <div className="grid-3" style={{ marginTop: 8 }}>
          <div style={{ background: '#F0FDF4', padding: 16, borderRadius: 10, border: '1px solid #BBF7D0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#15803D' }}>📲 Direct Booking Goal</div>
            <div style={{ fontSize: 11, color: '#166534', lineHeight: 1.6 }}>Grow direct from 40% → 60% over 6 months. Offer 10% discount vs OTA rate for guests booking via WhatsApp or website. No commission = more margin.</div>
          </div>
          <div style={{ background: '#FFF7ED', padding: 16, borderRadius: 10, border: '1px solid #FED7AA' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#C2410C' }}>📢 OTA Exposure Phase</div>
            <div style={{ fontSize: 11, color: '#9A3412', lineHeight: 1.6 }}>Keep 2 units on OTA (Airbnb + Booking.com) for visibility and reviews. Plan: reduce to 1 OTA unit after reaching 50+ reviews and strong direct booking demand.</div>
          </div>
          <div style={{ background: '#EFF6FF', padding: 16, borderRadius: 10, border: '1px solid #BFDBFE' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1E40AF' }}>🛡 Buffer Rule</div>
            <div style={{ fontSize: 11, color: '#1E3A8A', lineHeight: 1.6 }}>Always hold 1 unit as buffer to prevent double-booking during OTA sync lag. Auto-release it to best available channel at T–3 days if still empty.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
