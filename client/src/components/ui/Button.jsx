/**
 * Button — matches mockup .btn variants exactly.
 *
 * variant: 'primary' | 'outline' | 'ghost' | 'danger'
 * size:    'sm' | 'md' (default) | 'lg'
 * as:      element override ('a', 'button', etc.)
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  as: Tag = 'button',
  ...props
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Tag className={classes} disabled={Tag === 'button' ? disabled : undefined} {...props}>
      {children}
    </Tag>
  );
}
