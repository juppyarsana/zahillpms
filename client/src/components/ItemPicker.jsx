import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

// A select you can type into — for long item lists (stock items, restaurant
// items). Shows the chosen item like a select; click or type to search
// (every word must match, names starting with the text first), arrows + Enter
// to pick, Esc to close. The list is drawn on top of the page (portal, fixed
// position) so a modal's or a table's scrolling never cuts it off.
//
// options: [{ value, label, hint?, group?, tone? ('danger') }] — `group` adds a
// heading where it changes (keep options ordered by group).
export default function ItemPicker({ value, options, onChange, placeholder = 'Type to search…', emptyText = 'Nothing matches', style }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const chosen = options.find(o => o.value === value);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return options;
    const words = q.split(/\s+/);
    const hit = options.filter(o => {
      const s = `${o.label} ${o.hint || ''}`.toLowerCase();
      return words.every(w => s.includes(w));
    });
    return hit.sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1));
  }, [text, options]);

  function place() {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setBox({ left: r.left, width: Math.max(r.width, 280), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(320, (up ? r.top : below) - 12) });
  }
  function openList() { place(); setText(''); setHi(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true); }
  function close() { setOpen(false); setText(''); }
  function pick(o) { onChange(o.value); close(); inputRef.current?.blur(); }

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = e => { if (!listRef.current?.contains(e.target)) place(); };
    const onDown = e => { if (!inputRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);

  function onKey(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  }

  return (
    <>
      <div style={{ position: 'relative', ...style }}>
        <input
          ref={inputRef}
          className="form-input"
          style={{ paddingRight: 28, width: '100%' }}
          value={open ? text : chosen ? chosen.label : ''}
          placeholder={open && chosen ? chosen.label : placeholder}
          onFocus={openList}
          onClick={() => { if (!open) openList(); }}
          onChange={e => { setText(e.target.value); setHi(0); if (!open) openList(); }}
          onKeyDown={onKey}
          title={chosen?.label}
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 10, color: 'var(--text-muted)' }}>▼</span>
      </div>
      {open && box && createPortal(
        <div ref={listRef} style={{ position: 'fixed', left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight,
          overflowY: 'auto', background: 'var(--white)', border: '1px solid var(--border-strong)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 2000, fontSize: 13 }}>
          {shown.length === 0 && <div style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{emptyText}</div>}
          {shown.map((o, i) => (
            <div key={o.value}>
              {o.group && !text.trim() && (i === 0 || shown[i - 1].group !== o.group) && (
                <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{o.group}</div>)}
              <div
                data-i={i}
                onMouseDown={e => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHi(i)}
                style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline',
                  background: i === hi ? 'var(--green-light)' : o.value === value ? 'var(--bg-subtle)' : 'transparent' }}>
                <span style={{ flex: 1, fontWeight: o.value === value ? 600 : 400 }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: o.tone === 'danger' ? 'var(--danger-text)' : 'var(--text-muted)' }}>{o.hint}</span>}
              </div>
            </div>
          ))}
        </div>,
        document.body)}
    </>
  );
}
