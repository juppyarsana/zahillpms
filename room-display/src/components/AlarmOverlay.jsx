export default function AlarmOverlay({ ringing, time, onDismiss }) {
  if (!ringing) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}>
      <div className="flex flex-col items-center gap-6 text-center">
        <div style={{
          width: 96, height: 96, borderRadius: '50%', background: 'rgb(var(--accent-rgb) / 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined text-accent" style={{ fontSize: 48 }}>alarm</span>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] mb-2 text-accent">Alarm</p>
          <h1 className="text-2xl font-extralight text-ink">Good morning!</h1>
          {time && <p className="text-dim text-sm mt-1">Set for {time}</p>}
        </div>
        <button
          onClick={onDismiss}
          style={{
            padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--accent-contrast)',
            fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
