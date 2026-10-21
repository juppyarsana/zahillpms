import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { OtaRow, useOtaInbox, timeText } from '../components/OtaInbox';

// 🌐 OTA bookings (migration 123) — everything the channel manager did with
// the reservations Channex sent, for front desk: what needs someone first,
// then today's, then the latest. Owner's setup and history stay on
// Settings → Channel Manager.
export default function OtaBookings() {
  const { refresh, markAll, unseen } = useOtaInbox();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => api.get('/api/ota-inbox').then(r => setData(r.data)).catch(e => setMsg(e.response?.data?.error || 'Could not load')), []);
  const sig = unseen.map(r => r.id).join(',');
  useEffect(() => { load(); }, [load, sig]);

  async function handled(r) {
    setBusy(true);
    try { await api.post(`/api/ota-inbox/${r.id}/handled`); await load(); refresh(); }
    catch (e) { setMsg(e.response?.data?.error || 'Not saved'); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setMsg('');
    try {
      const { data: out } = await api.post('/api/ota-inbox/check');
      setMsg(out.busy ? 'Already reading — a moment…' : out.handled ? `${out.handled} new from the channel manager` : 'Nothing new from the channel manager');
      await load(); refresh();
    } catch (e) { setMsg(e.response?.data?.error || 'Could not reach the channel manager'); }
    finally { setBusy(false); }
  }

  const todayIds = new Set((data?.today.items || []).map(r => r.id));
  const earlier = (data?.recent || []).filter(r => !todayIds.has(r.id));
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">OTA bookings</div>
          <div className="page-subtitle">
            Bookings from Agoda, Booking.com and the other OTAs come in by themselves through the channel manager.
            {data?.last_pull_at && <> Last checked {timeText(data.last_pull_at)}.</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {unseen.length > 0 && <button className="btn btn-secondary" onClick={markAll}>All seen ({unseen.length})</button>}
          <button className="btn btn-secondary" disabled={busy} onClick={check}><Icon name="refresh" />{busy ? 'Checking…' : 'Check now'}</button>
          <Link className="btn btn-secondary" to="/guide/ota-bookings"><Icon name="book" />Guide</Link>
        </div>
      </div>
      {msg && <div className="alert alert-info" style={{ marginBottom: 12 }}><div>{msg}</div></div>}
      {!data ? <div style={{ padding: 20, color: '#6B7280' }}>Loading…</div> : (
        <>
          {data.open.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #D97706' }}>
              <h3 style={{ margin: 0 }}>⚠️ Needs you ({data.open.length})</h3>
              <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--text-muted, #6B7280)' }}>
                The PMS did not book or change these by itself. Do what the line says (by hand, or call the OTA), then press <b>Done — handled</b>.
              </p>
              {data.open.map(r => <OtaRow key={r.id} r={r} onHandled={handled} busy={busy} />)}
            </div>
          )}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Today</h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', margin: '4px 0' }}>
              {data.today.new} new · {data.today.changed} changed · {data.today.cancelled} cancelled
            </div>
            {data.today.items.length ? data.today.items.map(r => <OtaRow key={r.id} r={r} />)
              : <div style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', paddingTop: 6 }}>Nothing from the OTAs yet today.</div>}
          </div>
          {earlier.length > 0 && (
            <div className="card">
              <h3 style={{ margin: 0 }}>Earlier</h3>
              {earlier.map(r => <OtaRow key={r.id} r={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
