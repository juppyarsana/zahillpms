import { useState, useEffect } from 'react';
import api from '../services/api';

function fmtIDR(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000)     return `Rp ${(num / 1_000_000).toFixed(1)}M`;
  return 'Rp ' + num.toLocaleString('id-ID');
}

function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ExpandedRow({ run }) {
  const noShows = run.no_shows || [];
  const pendingBalances = run.pending_balances || [];

  return (
    <tr>
      <td colSpan={7} style={{ padding: '0 16px 16px', background: '#F9FAFB' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 12 }}>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              No-shows ({noShows.length})
            </div>
            {noShows.length === 0
              ? <p style={{ fontSize: 13, color: '#9CA3AF' }}>None</p>
              : noShows.map((ns, i) => (
                <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #E5E7EB' }}>
                  <strong>{ns.guest_name}</strong>
                  <span style={{ color: '#6B7280' }}> — {ns.unit_name}</span>
                </div>
              ))
            }
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Pending balances due ({pendingBalances.length})
            </div>
            {pendingBalances.length === 0
              ? <p style={{ fontSize: 13, color: '#9CA3AF' }}>None</p>
              : pendingBalances.map((pb, i) => (
                <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>{pb.guest_name}</strong><span style={{ color: '#6B7280' }}> — {pb.unit_name}</span></span>
                  <span style={{ fontWeight: 700, color: '#D97706' }}>{fmtIDR(pb.amount)}</span>
                </div>
              ))
            }
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function NightAudit() {
  const [history, setHistory]   = useState([]);
  const [latest, setLatest]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast]       = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function load() {
    try {
      const [histRes, latestRes] = await Promise.all([
        api.get('/api/night-audit/history'),
        api.get('/api/night-audit/latest'),
      ]);
      setHistory(histRes.data);
      setLatest(latestRes.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleRunNow() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const auditDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (!confirm(`Run night audit for ${auditDate} (yesterday)?\n\nThis will flag no-shows, generate housekeeping tasks, and record the day's revenue.`)) return;
    setRunning(true);
    try {
      const { data } = await api.post('/api/night-audit/run');
      if (data.skipped) {
        showToast(`Already run for ${data.business_date}`, 'warning');
      } else {
        showToast(`Audit complete: ${data.summary}`);
        load();
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Audit failed', 'error');
    }
    setRunning(false);
  }

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  return (
    <div>
      {toast && (
        <div className={`alert ${toast.type === 'error' ? 'alert-error' : toast.type === 'warning' ? 'alert-warning' : 'alert-success'}`}
          style={{ marginBottom: 16 }}>
          {toast.msg}
        </div>
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Night Audit</div>
          <div className="page-subtitle">End-of-day audit history · Owner only</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleRunNow}
          disabled={running}
        >
          {running ? 'Running…' : '▶ Run Audit Now'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading…</div>
      ) : history.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
          No audit runs yet. Click "Run Audit Now" to run the first one.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                {['Date', 'Triggered by', 'Occupied', 'Room Revenue', 'Other Revenue', 'No-shows', 'Pmt Due'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                    color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((run, i) => {
                const isExp = expanded === run.id;
                const noShowCount = (run.no_shows || []).length;
                const pendingCount = (run.pending_balances || []).length;
                return [
                  <tr
                    key={run.id}
                    onClick={() => toggleExpand(run.id)}
                    style={{
                      borderBottom: isExp ? 'none' : '1px solid #E5E7EB',
                      cursor: 'pointer',
                      background: isExp ? '#F9FAFB' : i % 2 === 0 ? 'white' : '#FAFAFA',
                    }}
                    onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isExp ? '#F9FAFB' : i % 2 === 0 ? 'white' : '#FAFAFA'; }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>
                      {fmtDate(run.business_date)}
                      <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}>{fmtDateTime(run.run_at)}</div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>
                      {run.triggered_by.startsWith('manual') ? '👤 Manual' : '🤖 Auto'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700 }}>
                      {run.units_occupied ?? '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>{fmtIDR(run.room_revenue)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>{fmtIDR(run.ancillary_revenue)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {noShowCount > 0
                        ? <span className="badge badge-red">{noShowCount}</span>
                        : <span style={{ color: '#9CA3AF', fontSize: 13 }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {pendingCount > 0
                        ? <span className="badge badge-amber">{pendingCount}</span>
                        : <span style={{ color: '#9CA3AF', fontSize: 13 }}>—</span>
                      }
                    </td>
                  </tr>,
                  isExp && <ExpandedRow key={`${run.id}-exp`} run={run} />,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
