export default function MessageOverlay({ message, dismissing, onDismiss }) {
  if (!message) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}>
      <div className="flex flex-col items-center gap-6 text-center" style={{ maxWidth: 420, padding: '0 32px' }}>
        <div style={{
          width: 96, height: 96, borderRadius: '50%', background: 'rgb(var(--accent-rgb) / 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined text-accent" style={{ fontSize: 48 }}>mail</span>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] mb-2 text-accent">Message from Front Desk</p>
          <h1 className="text-xl text-ink" style={{ lineHeight: 1.4 }}>{message.body}</h1>
        </div>
        <button
          onClick={onDismiss}
          disabled={dismissing}
          style={{
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
