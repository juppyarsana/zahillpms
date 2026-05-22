import { useState, useEffect, useRef, useCallback } from 'react';

const DURATION = 7000;

function pickIcon(icon) {
  return icon || 'partly_cloudy_day';
}

function useSwipeAndHold(onNext, onPrev, onPause, onResume) {
  const ref = useRef(null);
  const touchStartX = useRef(0);
  const mouseStartX = useRef(0);
  const mouseDown = useRef(false);
  const holdTimer = useRef(null);
  const paused = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const SWIPE = 50;

    function startHold() {
      holdTimer.current = setTimeout(() => { paused.current = true; onPause(); }, 400);
    }
    function cancelHold(dx) { if (Math.abs(dx) > 10) clearTimeout(holdTimer.current); }
    function endInteraction(dx) {
      clearTimeout(holdTimer.current);
      if (paused.current) { paused.current = false; onResume(); return; }
      if (Math.abs(dx) > SWIPE) { dx < 0 ? onNext() : onPrev(); }
    }

    const onTouchStart = e => { touchStartX.current = e.touches[0].clientX; startHold(); };
    const onTouchMove  = e => cancelHold(e.touches[0].clientX - touchStartX.current);
    const onTouchEnd   = e => endInteraction(e.changedTouches[0].clientX - touchStartX.current);
    const onMouseDown  = e => { mouseStartX.current = e.clientX; mouseDown.current = true; startHold(); };
    const onMouseMove  = e => { if (mouseDown.current) cancelHold(e.clientX - mouseStartX.current); };
    const onMouseUp    = e => { if (!mouseDown.current) return; mouseDown.current = false; endInteraction(e.clientX - mouseStartX.current); };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: true });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    el.addEventListener('mousedown',  onMouseDown);
    el.addEventListener('mousemove',  onMouseMove);
    el.addEventListener('mouseup',    onMouseUp);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      el.removeEventListener('mousedown',  onMouseDown);
      el.removeEventListener('mousemove',  onMouseMove);
      el.removeEventListener('mouseup',    onMouseUp);
    };
  }, [onNext, onPrev, onPause, onResume]);

  return ref;
}

function WeatherStrip({ weather }) {
  if (!weather) return (
    <div style={{ padding: '10px 36px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Weather unavailable</span>
    </div>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
      padding: '10px 36px 9px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0,
    }}>
      {/* Today */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#334155', marginRight: 4 }}>Today</span>
        <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#c5a358' }}>{pickIcon(weather.today.icon)}</span>
        <span style={{ fontSize: 22, fontWeight: 200, lineHeight: 1 }}>{weather.today.temp}°C</span>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{weather.today.desc}</div>
          <div style={{ fontSize: 9, color: '#2a3441', textTransform: 'uppercase', letterSpacing: '0.18em' }}>Kintamani · Bali</div>
        </div>
      </div>
      {/* Separator */}
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)', margin: '0 28px' }} />
      {/* Tomorrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#334155', marginRight: 4 }}>Tomorrow</span>
        <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#64748b' }}>{pickIcon(weather.tomorrow.icon)}</span>
        <span style={{ fontSize: 22, fontWeight: 200, lineHeight: 1, color: '#94a3b8' }}>{weather.tomorrow.temp}°C</span>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{weather.tomorrow.desc}</div>
      </div>
    </div>
  );
}

function CardSlideshow({ cards, category }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fade, setFade] = useState(true);
  const timerRef = useRef(null);
  const barRef = useRef(null);

  const items = cards.filter(c => c.category === category);

  const goTo = useCallback((n) => {
    setFade(false);
    setTimeout(() => { setCurrent(n); setFade(true); }, 250);
  }, []);

  const next = useCallback(() => goTo((current + 1) % Math.max(items.length, 1)), [current, items.length, goTo]);
  const prev = useCallback(() => goTo((current - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1)), [current, items.length, goTo]);

  const resetBar = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    bar.style.transition = 'none'; bar.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${DURATION}ms linear`; bar.style.width = '100%';
    }));
  }, []);

  const stopBar = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    bar.style.transition = 'none';
  }, []);

  useEffect(() => {
    setCurrent(0);
  }, [category]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (!paused && items.length > 1) {
      resetBar();
      timerRef.current = setInterval(next, DURATION);
    } else if (paused) {
      stopBar();
    } else {
      resetBar();
    }
    return () => clearInterval(timerRef.current);
  }, [paused, items.length, next, resetBar, stopBar]);

  const swipeRef = useSwipeAndHold(
    next, prev,
    () => setPaused(true),
    () => setPaused(false),
  );

  if (items.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#2a3441' }}>inbox</span>
        <p style={{ fontSize: 12, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No cards yet</p>
      </div>
    );
  }

  const card = items[Math.min(current, items.length - 1)];
  const TAG_COLORS = { activity: '#4ade80', dining: '#fb923c', property: '#c5a358', notice: '#818cf8' };
  const tagColor = TAG_COLORS[category] || '#c5a358';

  return (
    <div ref={swipeRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', userSelect: 'none' }}>
      {/* Card */}
      <div style={{ position: 'absolute', inset: 0, opacity: fade ? 1 : 0, transition: 'opacity 0.25s ease' }}>
        {/* Background image or gradient */}
        {card.image_url ? (
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${card.image_url})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'brightness(0.5)',
          }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #0a0d12 0%, #111827 100%)' }} />
        )}
        {/* Gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to right, rgba(5,7,10,0.96) 0%, rgba(5,7,10,0.75) 45%, rgba(5,7,10,0.15) 100%)',
        }} />
        {/* Content */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '40px 56px', maxWidth: 600 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em',
              padding: '6px 14px', borderRadius: 20, marginBottom: 20, width: 'fit-content',
              background: `${tagColor}20`, color: tagColor, border: `1px solid ${tagColor}40`,
            }}>
              {category}
            </div>
            <div style={{ fontSize: 50, fontWeight: 200, lineHeight: 1.1, marginBottom: 18, color: '#fff' }}>
              {card.title.split('\n').map((line, i) => <span key={i}>{line}{i < card.title.split('\n').length - 1 && <br />}</span>)}
            </div>
            <div style={{ fontSize: 16, color: '#94a3b8', lineHeight: 1.75, maxWidth: 460 }}>{card.body}</div>
            {card.meta && (
              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.13em' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>info</span>
                {card.meta}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pause indicator */}
      {paused && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(5,7,10,0.7)', border: '1px solid rgba(197,163,88,0.3)',
          borderRadius: '50%', width: 64, height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#c5a358' }}>pause</span>
        </div>
      )}

      {/* Gesture hint */}
      {items.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 20,
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em',
          color: '#64748b', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swipe</span>Swipe to navigate
          </span>
          <span style={{ width: 1, height: 12, background: '#334155' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>touch_app</span>Hold to pause
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.03)' }}>
        <div ref={barRef} style={{ height: '100%', background: '#c5a358', width: '0%' }} />
      </div>
    </div>
  );
}

export default function ExploreTab({ weather, cards = [], activeCategory, onCategoryChange }) {
  const notices = cards.filter(c => c.category === 'notice');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <WeatherStrip weather={weather} />
      <CardSlideshow cards={cards} category={activeCategory} />
      {/* Notice bar — always visible at bottom */}
      {notices.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 36px',
          background: 'rgba(99,102,241,0.07)',
          borderTop: '1px solid rgba(99,102,241,0.15)',
          flexShrink: 0,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#818cf8', flexShrink: 0 }}>campaign</span>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#818cf8', flexShrink: 0, marginRight: 4 }}>Notice</span>
          <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {notices[0].title}{notices.length > 1 ? ` · +${notices.length - 1} more` : ''}
          </span>
        </div>
      )}
      {/* Dots + counter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 36px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {cards.filter(c => c.category === activeCategory).map((_, i) => (
            <div key={i} style={{
              borderRadius: 3, height: 5, background: '#2a3441',
              width: 6, transition: 'all 0.35s ease',
            }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#2a3441', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 700 }}>
          {cards.filter(c => c.category === activeCategory).length} card{cards.filter(c => c.category === activeCategory).length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}
