export default function NoticeTicker({ cards = [] }) {
  const notices = cards.filter(c => c.category === 'notice');
  if (notices.length === 0) return null;

  const text = notices.map(n => n.title).join('     •     ');
  // +14s accounts for the extra 100vw gap scrolled between repeats (see padding note below)
  const duration = Math.max(18, text.length * 0.16) + 14;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 15,
      display: 'flex', alignItems: 'stretch',
      height: 'clamp(2.25rem, 4.2vh, 3.25rem)',
      background: 'rgba(5,7,10,0.85)', borderTop: '1px solid rgba(129,140,248,0.25)',
      backdropFilter: 'blur(6px)', overflow: 'hidden',
    }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 clamp(1rem, 2vw, 1.75rem)',
        background: 'rgba(129,140,248,0.12)', borderRight: '1px solid rgba(129,140,248,0.25)',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)', color: '#818cf8' }}>campaign</span>
        <span style={{
          fontWeight: 700, fontSize: 'clamp(0.6rem, 0.95vw, 0.75rem)', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: '#818cf8', whiteSpace: 'nowrap',
        }}>
          Notice
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center',
          whiteSpace: 'nowrap', animation: `zahill-ticker ${duration}s linear infinite`,
        }}>
          {/* paddingRight: 100vw resolves against the viewport, not this auto-width flex row,
              guaranteeing a gap at least as wide as the ticker so repeats can't overlap on screen */}
          <span style={{ paddingRight: '100vw', fontSize: 'clamp(0.7rem, 1.1vw, 0.95rem)', color: '#cbd5e1' }}>{text}</span>
          <span style={{ paddingRight: '100vw', fontSize: 'clamp(0.7rem, 1.1vw, 0.95rem)', color: '#cbd5e1' }}>{text}</span>
        </div>
      </div>
    </div>
  );
}
