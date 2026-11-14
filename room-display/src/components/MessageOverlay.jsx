// A message from front desk: full screen to catch the guest's eye.
// A long message is shown smaller and left-aligned in a box that scrolls; the Dismiss button never leaves the screen.
export default function MessageOverlay({ message, dismissing, onDismiss }) {
  if (!message) return null;

  const body = String(message.body || '');
  const long = body.length > 180 || body.split('\n').length > 4;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}>
      <div
        className="flex flex-col items-center text-center"
        style={{
          gap: long ? 16 : 24, width: '100%', maxWidth: long ? 760 : 560,
          maxHeight: '100vh', padding: long ? '20px 32px' : '24px 32px', boxSizing: 'border-box',
        }}
      >
        <div style={{
          flexShrink: 0,
          width: long ? 64 : 96, height: long ? 64 : 96, borderRadius: '50%', background: 'rgb(var(--accent-rgb) / 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined text-accent" style={{ fontSize: long ? 32 : 48 }}>mail</span>
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent" style={{ flexShrink: 0, margin: 0 }}>Message from Front Desk</p>

        {long ? (
          <div style={{
            minHeight: 0, width: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
            textAlign: 'left', padding: '18px 22px', borderRadius: 16,
            background: 'var(--surface)', border: '1px solid rgb(var(--accent-rgb) / 0.25)',
          }}>
            <p className="text-ink" style={{ margin: 0, fontSize: 17, lineHeight: 1.6, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
              {body}
            </p>
          </div>
        ) : (
          <h1 className="text-xl text-ink" style={{ margin: 0, lineHeight: 1.4, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{body}</h1>
        )}

        <button
          onClick={onDismiss}
          disabled={dismissing}
          style={{
            flexShrink: 0,
            padding: '14px 32px', borderRadius: 999, border: 'none', cursor: dismissing ? 'default' : 'pointer',
            background: 'var(--accent)', color: 'var(--accent-contrast)',
            fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
            opacity: dismissing ? 0.6 : 1,
          }}
        >
          {dismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
