import { useEffect } from 'react';

// Remote control on the hotel info pages (TV launcher → HotelInfoActivity's WebView).
// The arrows move to the nearest [data-focus] element in that direction, OK clicks it,
// Back (Escape / Backspace / GoBack) closes the page. Every focusable thing on these pages
// carries data-focus and tabIndex 0; data-autofocus marks where focus starts.

export function closePage() {
  // The launcher puts a small bridge on the page; in a browser, go back instead.
  if (window.ZahillTV?.close) window.ZahillTV.close();
  else window.history.back();
}

const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function focusables() {
  return [...document.querySelectorAll('[data-focus]')].filter(el => el.offsetParent !== null);
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

// The nearest element whose centre lies in the direction pressed, preferring ones
// straight ahead (distance across the direction counts three times as much).
function next(from, [dx, dy]) {
  const a = center(from.getBoundingClientRect());
  let best = null, bestScore = Infinity;
  for (const el of focusables()) {
    if (el === from) continue;
    const b = center(el.getBoundingClientRect());
    const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
    if (along <= 4) continue;
    const across = Math.abs((b.x - a.x) * dy) + Math.abs((b.y - a.y) * dx);
    // Only things roughly in that direction: Down from the last row of a grid stays put
    // instead of jumping into the list beside it.
    if (across > along * 1.2) continue;
    const score = along + across * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function focusFirst() {
  const el = document.querySelector('[data-autofocus]') || focusables()[0];
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function useDpad(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(focusFirst, 30);
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.preventDefault();
        closePage();
        return;
      }
      const dir = DIRS[e.key];
      const cur = document.activeElement?.closest?.('[data-focus]');
      if (dir) {
        e.preventDefault();
        if (!cur) { focusFirst(); return; }
        const to = next(cur, dir);
        if (to) {
          to.focus({ preventScroll: true });
          to.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
      } else if ((e.key === 'Enter' || e.key === ' ') && cur) {
        e.preventDefault();
        cur.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [ready]);
}
