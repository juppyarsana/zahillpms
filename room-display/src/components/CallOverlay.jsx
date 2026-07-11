import { useState, useEffect } from 'react';

export default function CallOverlay({ callState, onCancel, onHangup, onMuteToggle, muted }) {
  const { status, error } = callState;
  if (!status || status === 'idle') return null;

  if (status === 'missed' || status === 'ended' || status === 'failed') {
    return (
      <div style={{
        position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
        background: 'rgba(15,18,24,0.95)', border: '1px solid rgba(201,162,39,0.35)',
        borderRadius: 16, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>
        <span className="material-symbols-outlined" style={{ color: '#c9a227', fontSize: 22 }}>call_end</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
          {status === 'missed' ? 'No one answered' : status === 'failed' ? (error || 'Call failed') : 'Call ended'}
        </span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(5,7,10,0.92)', backdropFilter: 'blur(6px)' }}>
      <div className="flex flex-col items-center gap-6 text-center">
        <div style={{
          width: 96, height: 96, borderRadius: '50%', background: 'rgba(201,162,39,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#c9a227' }}>call</span>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] mb-2" style={{ color: '#c9a227' }}>Front Desk</p>
          <h1 className="text-2xl font-extralight text-white">
            {status === 'calling' ? 'Calling…' : 'Connected'}
          </h1>
          {status === 'connected' && <CallTimer />}
        </div>
        <div className="flex gap-4">
          {status === 'connected' && (
            <button onClick={onMuteToggle} style={btnStyle(false)}>
              <span className="material-symbols-outlined">{muted ? 'mic_off' : 'mic'}</span>
            </button>
          )}
          <button onClick={status === 'calling' ? onCancel : onHangup} style={btnStyle(true)}>
            <span className="material-symbols-outlined">call_end</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function btnStyle(danger) {
  return {
    width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: danger ? '#dc2626' : 'rgba(255,255,255,0.08)',
    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

function CallTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return <p className="text-slate-500 text-sm mt-1">{m}:{s}</p>;
}
