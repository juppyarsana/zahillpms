/**
 * Avatar — matches mockup .avatar sizes exactly.
 *
 * name:  used to derive initials and background color
 * size:  'sm' (28px) | 'md' (36px, default) | 'lg' (48px) | 'xl' (72px)
 * color: explicit CSS color; if omitted, derived from name hash
 */

const PALETTE = [
  '#2D5016', '#4A7C2A', '#B8860B', '#1E40AF',
  '#7C3AED', '#DB2777', '#0891B2', '#9A3412',
];

function colorFrom(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Avatar({ name = '', size = 'md', color, className = '', style, ...props }) {
  return (
    <div
      className={`avatar avatar-${size} ${className}`}
      style={{ background: color ?? colorFrom(name), ...style }}
      {...props}
    >
      {initials(name)}
    </div>
  );
}
