import { useState, useRef, useEffect } from 'react';

// Generic "⋮ more actions" dropdown — pass `items` as
// [{ label, icon, onClick, danger }] (falsy entries are filtered out, so
// conditionally-shown actions can just be written as `condition && {...}`).
export default function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-icon" onClick={() => setOpen(o => !o)} aria-label="More actions" style={{ fontSize: 16, lineHeight: 1 }}>
        ⋮
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, minWidth: 200, zIndex: 100,
          background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.16)', padding: 6,
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {visibleItems.map((item, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); item.onClick(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 10px', borderRadius: 6, border: 'none', background: 'none',
                cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 500,
                color: item.danger ? 'var(--danger)' : 'var(--text)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--cream)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              {item.icon && <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
