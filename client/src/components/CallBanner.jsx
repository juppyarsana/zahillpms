import { useCall } from '../context/CallContext';

export default function CallBanner() {
  const { incomingCall, activeCall, muted, answerCall, dismissIncoming, endCall, toggleMute } = useCall();

  if (incomingCall) {
    return (
      <div className="modal-backdrop" style={{ zIndex: 1000 }}>
        <div className="modal" style={{ maxWidth: 380, textAlign: 'center', padding: '40px 32px' }}>
          <div
            className="call-ring-icon"
            style={{
              width: 88, height: 88, borderRadius: '50%', background: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 40, margin: '0 auto 24px',
            }}
          >
            📞
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#dc2626', marginBottom: 8 }}>
            Incoming Call
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 32 }}>
            Room {incomingCall.unitName}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="btn btn-lg"
              style={{ background: '#16a34a', color: 'white', border: 'none', flex: 1, justifyContent: 'center' }}
              onClick={() => answerCall(incomingCall.callId)}
            >
              Answer
            </button>
            <button
              className="btn btn-lg btn-secondary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={dismissIncoming}
            >
              Ignore
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeCall) {
    return (
      <div style={bannerStyle('#166534')}>
        <span style={{ fontSize: 18 }}>📞</span>
        <span style={{ fontWeight: 700 }}>
          {activeCall.status === 'connected' ? 'On call' : 'Connecting…'} — Room {activeCall.unitName}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm"
            style={{ background: 'transparent', color: 'white', border: '1.5px solid rgba(255,255,255,0.5)' }}
            onClick={toggleMute}
          >
            {muted ? '🔇' : '🎤'}
          </button>
          <button
            className="btn btn-sm"
            style={{ background: 'white', color: '#166534', border: 'none' }}
            onClick={endCall}
          >
            Hang up
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function bannerStyle(bg) {
  return {
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
    background: bg, color: 'white', padding: '10px 20px',
    display: 'flex', alignItems: 'center', gap: 10, fontSize: 14,
  };
}
