/**
 * Badge — two variants from the mockup:
 *
 * <Badge color="green|amber|red|blue|purple|orange|pink|gray|yellow">text</Badge>
 *   → pill badge (.badge .badge-{color})
 *
 * <Badge channel="direct|airbnb|booking_com|traveloka|buffer">text</Badge>
 *   → solid channel pill (.ch .ch-{channel})
 *
 * Channel labels are auto-filled when no children are provided.
 */

const CHANNEL_LABELS = {
  direct:      'Direct',
  airbnb:      'Airbnb',
  booking_com: 'Booking.com',
  traveloka:   'Traveloka',
  buffer:      'Buffer',
  walkin:      'Walk-in',
};

export default function Badge({ children, color, channel, className = '', ...props }) {
  if (channel) {
    const key = channel === 'booking_com' ? 'booking' : channel;
    return (
      <span className={`ch ch-${key} ${className}`} {...props}>
        {children ?? CHANNEL_LABELS[channel] ?? channel}
      </span>
    );
  }

  return (
    <span className={`badge badge-${color ?? 'gray'} ${className}`} {...props}>
      {children}
    </span>
  );
}
