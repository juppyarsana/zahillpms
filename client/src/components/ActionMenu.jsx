import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

// Generic dropdown menu — defaults to a "⋮ more actions" trigger, but pass
// `label` (e.g. "Download") to render a labeled button instead, or `bare` to
// render just the icon with no button chrome of its own (for dropping into a
// parent `.icon-group`, where the group's own CSS styles the button — see
// BookingDetail.jsx's Download trigger sitting alongside Call/Message/WhatsApp).
// `items` is [{ label, icon, onClick, danger }] (falsy entries are filtered
// out, so conditionally-shown actions can just be written as
// `condition && {...}`) — an item can also be `{ divider: true }` to draw a
// separating rule (e.g. before a "danger zone" group of destructive actions).
// `label` + an Icon as `icon` = a labeled outline button with a chevron (detail
// page headers: "Documents", "More").
export default function ActionMenu({ items, icon = '⋮', label, ariaLabel = 'More actions', bare = false, small = false }) {
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
    <div ref={ref} style={{ position: 'relative', ...(bare ? { display: 'flex' } : {}) }}>
      <button
        className={bare ? '' : label ? 'btn btn-secondary btn-sm' : small ? 'btn btn-icon btn-sm' : 'btn btn-icon'}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        style={bare ? { height: '100%' } : label ? { display: 'flex', alignItems: 'center', gap: 6 } : small ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : { fontSize: 16, lineHeight: 1 }}
      >
        {icon}{label && <>{label}<Icon name="chevronDown" size={14} style={{ opacity: 0.7 }} /></>}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, minWidth: 220, width: 'max-content', maxWidth: 280, zIndex: 100,
          background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.16)', padding: 6,
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {visibleItems.map((item, i) =>
            item.divider ? (
              <div key={i} style={{ borderTop: '1px solid var(--border)', margin: '4px 2px' }} />
            ) : (
              <button
                key={i}
                title={item.hint}
                onClick={() => { setOpen(false); item.onClick(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '9px 10px', borderRadius: 6, border: 'none', background: 'none',
                  cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                  color: item.danger ? 'var(--danger)' : 'var(--text)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--cream)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                {item.icon && <span style={{ width: 16, flexShrink: 0, textAlign: 'center' }}>{item.icon}</span>}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
