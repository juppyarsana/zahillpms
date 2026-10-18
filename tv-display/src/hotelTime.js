// The hotel's clock. A tablet or TV keeps the timezone it was set up with
// (often Jakarta / WIB), so clocks, dates and anything timed (alarm, day/night
// theme, nightly reload) read the hotel's own time instead. Every property is
// in Bali (WITA) for now, same as the PMS (client/src/lib/propertyTime.js).
export const HOTEL_TZ = 'Asia/Makassar';

const hm = new Intl.DateTimeFormat('en-GB', { timeZone: HOTEL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// { hours: 0–23, minutes: 0–59 } at the hotel.
export function hotelHM(date = new Date()) {
  const parts = Object.fromEntries(hm.formatToParts(date).map((p) => [p.type, p.value]));
  return { hours: Number(parts.hour) % 24, minutes: Number(parts.minute) };
}

// toLocaleDateString in the hotel's timezone.
export const hotelDate = (date, opts) => date.toLocaleDateString('en-GB', { timeZone: HOTEL_TZ, ...opts });
