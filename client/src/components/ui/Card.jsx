/**
 * Card — matches mockup .card and .card-title exactly.
 *
 * title:     optional section heading (uppercase, muted, letter-spaced)
 * className: extra classes to merge onto the root element
 */
export default function Card({ title, children, className = '', style, ...props }) {
  return (
    <div className={`card ${className}`} style={style} {...props}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  );
}
