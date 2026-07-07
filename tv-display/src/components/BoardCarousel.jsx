import { useEffect, useState } from 'react';

const TAG_COLORS = { notice: '#818cf8', activity: '#4ade80', dining: '#fb923c', property: '#c9a227' };

// `index` is owned by the parent (shared with the background image rotation) so
// both change in lockstep. This component fades its own text out/in around that
// change rather than the background's crossfade, since overlapping two different
// blocks of text (of differing length) reads as messy where overlapping images don't.
export default function BoardCarousel({ card, cards = [], index = 0 }) {
  const [displayed, setDisplayed] = useState(card);
  const [displayedIndex, setDisplayedIndex] = useState(index);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (index === displayedIndex) return;
    setVisible(false);
    const id = setTimeout(() => {
      setDisplayed(card);
      setDisplayedIndex(index);
      setVisible(true);
    }, 300);
    return () => clearTimeout(id);
  }, [index, card, displayedIndex]);

  if (!displayed) return null;
  const tagColor = TAG_COLORS[displayed.category] || '#c9a227';

  return (
    <div className="glass-card rounded-2xl relative overflow-hidden"
      style={{
        flex: '0 0 58%',
        padding: 'clamp(1.5rem, 3.2vh, 2.75rem) clamp(1.75rem, 3.2vw, 3rem)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
      <div style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 'clamp(0.55rem, 0.9vw, 0.7rem)', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.14em', padding: '0.3em 0.85em', borderRadius: 20,
          marginBottom: 'clamp(0.6rem, 1.4vh, 1rem)', width: 'fit-content',
          background: `${tagColor}20`, color: tagColor, border: `1px solid ${tagColor}40`,
        }}>
          {displayed.category}
        </div>
        <h2 className="text-white" style={{
          fontFamily: 'var(--font-brand)', fontWeight: 700,
          fontSize: 'clamp(1.5rem, 3.2vw, 2.5rem)', lineHeight: 1.15,
          marginBottom: 'clamp(0.6rem, 1.4vh, 1rem)',
        }}>
          {displayed.title}
        </h2>
        <p className="text-slate-300" style={{
          fontSize: 'clamp(0.85rem, 1.4vw, 1.1rem)', lineHeight: 1.6, maxWidth: '85%',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {displayed.body}
        </p>
        {displayed.meta && (
          <p className="text-slate-500" style={{
            marginTop: 'clamp(0.6rem, 1.4vh, 1rem)', fontSize: 'clamp(0.65rem, 1.05vw, 0.85rem)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            {displayed.meta}
          </p>
        )}
      </div>

      {cards.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 'clamp(0.85rem, 2vh, 1.5rem)', left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 6,
        }}>
          {cards.map((_, i) => (
            <div key={i} style={{
              width: i === displayedIndex ? 14 : 6, height: 6, borderRadius: 3,
              background: i === displayedIndex ? tagColor : 'rgba(255,255,255,0.15)',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
