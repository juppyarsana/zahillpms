// Ask — the read-only lookups the language model may run for a staff member.
// Each one calls the same service its own page uses (Availability, Forecast,
// pricing), so an answer always equals that page. A lookup returns
//   forModel — a small summary the model words its reply from (no guest names)
//   card     — what the Ask page shows under the reply
//   understood — one line echoing what was looked up, built here, not by the model
// Adding a lookup = one more entry in TOOLS.
const db = require('../db');
const { searchAvailability } = require('./availabilityService');
const { buildForecast } = require('./forecast');
const { nightlyRoomRates } = require('./pricingService');
const { computeFolioTotals } = require('./folioService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NIGHTS = 31;

const isOwner = user => user?.role === 'owner';
const can = (user, key) => isOwner(user) || (Array.isArray(user?.allowed_menus) && user.allowed_menus.includes(key));
// Same people who see revenue on the Forecast page and the Dashboard's month.
const seesMoney = user => can(user, 'month_summary');

function validDate(s) { return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s)); }
function nightsBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtShort(ymd) {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function weekday(ymd) {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}
// A problem with what was asked — goes back to the model so it can ask again.
class LookupError extends Error {}

function stayRange(input, fromKey, toKey) {
  const from = input[fromKey], to = input[toKey];
  if (!validDate(from) || !validDate(to)) throw new LookupError(`${fromKey} and ${toKey} must be dates as YYYY-MM-DD`);
  if (to <= from) throw new LookupError(`${toKey} must be after ${fromKey}`);
  const nights = nightsBetween(from, to);
  if (nights > MAX_NIGHTS) throw new LookupError(`At most ${MAX_NIGHTS} nights at a time`);
  return { from, to, nights };
}

const TOOLS = [
  {
    name: 'check_availability',
    description: 'Free rooms per room type for a stay, with the normal price of the stay (room only, service & tax included). '
      + 'Use for any question about whether rooms are available or what a stay costs for given dates.',
    input_schema: {
      type: 'object',
      properties: {
        check_in: { type: 'string', description: 'Arrival date, YYYY-MM-DD' },
        check_out: { type: 'string', description: 'Departure date, YYYY-MM-DD (the day after the last night)' },
        guests: { type: 'integer', description: 'Whole party size. Use 2 when not said.' },
        rooms: { type: 'integer', description: 'Rooms wanted. Use 1 when not said.' },
      },
      required: ['check_in', 'check_out', 'guests', 'rooms'],
      additionalProperties: false,
    },
    allowed: user => can(user, 'reservations'),
    async run(propertyId, user, input) {
      const { from, to, nights } = stayRange(input, 'check_in', 'check_out');
      const guests = Math.max(1, parseInt(input.guests, 10) || 2);
      const rooms = Math.max(1, parseInt(input.rooms, 10) || 1);
      const data = await searchAvailability(propertyId, {
        checkIn: from, checkOut: to, guestsPerRoom: Math.ceil(guests / rooms), includeGuests: false,
      });
      const types = data.room_types.map(t => ({
        name: t.name, free: t.available_count, total: t.total_count,
        max_guests: t.max_guests, fits_party: t.fits,
        stay_price: t.price?.total ?? null, per_night: t.price?.per_night ?? null,
        price_varies_by_room: !!t.price?.varies, rate_changes_during_stay: !!t.price?.varies_by_night,
      }));
      const summary = {
        check_in: from, check_out: to, nights, guests, rooms_wanted: rooms,
        rooms_free: data.available_rooms, rooms_total: data.total_rooms,
        enough_rooms: data.available_rooms >= rooms,
        price_note: 'room only, service & tax included, IDR',
        room_types: types,
      };
      return {
        forModel: summary,
        card: { type: 'availability', ...summary },
        understood: `${fmtShort(from)} – ${fmtShort(to)} · ${nights} night${nights === 1 ? '' : 's'} · ${rooms} room${rooms === 1 ? '' : 's'} · ${guests} guest${guests === 1 ? '' : 's'}`,
      };
    },
  },
  {
    name: 'occupancy_forecast',
    description: 'What is on the books day by day: rooms sold and free (also per room type), occupancy %, arrivals, departures, guests in house, holidays. '
      + 'Use for questions about how busy a period is, which days are quiet or full, or how many rooms of a type are left on several dates.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD' },
        days: { type: 'integer', description: `How many days from that day, 1 to ${MAX_NIGHTS}` },
      },
      required: ['from', 'days'],
      additionalProperties: false,
    },
    allowed: user => can(user, 'forecast'),
    async run(propertyId, user, input) {
      if (!validDate(input.from)) throw new LookupError('from must be a date as YYYY-MM-DD');
      const days = Math.min(MAX_NIGHTS, Math.max(1, parseInt(input.days, 10) || 7));
      const money = seesMoney(user);
      const [data, { rows: typeRows }] = await Promise.all([
        buildForecast(propertyId, { from: input.from, days, withMoney: money }),
        db.query('SELECT type, COUNT(*)::int AS total FROM units WHERE property_id = $1 AND type IS NOT NULL GROUP BY type', [propertyId]),
      ]);
      const typeTotal = Object.fromEntries(typeRows.map(r => [r.type, r.total]));
      const rows = data.rows.map(r => {
        const row = {
          date: r.date, weekday: weekday(r.date), holiday: r.holiday,
          sold: r.sold, free: r.free, occupancy_pct: r.occupancy,
          arrivals: r.arrivals, departures: r.departures, guests: r.guests,
          free_by_type: Object.fromEntries(Object.entries(r.by_type).map(([t, sold]) => [t, Math.max(0, (typeTotal[t] || 0) - sold)])),
        };
        if (money) { row.revenue = Math.round(r.revenue); row.adr = Math.round(r.adr); }
        return row;
      });
      const summary = {
        from: data.from, to: data.to, days: data.days, rooms_total: data.total_rooms,
        average_occupancy_pct: data.totals.occupancy,
        busiest: data.busiest, quietest: data.quietest,
        note: 'on the books today, nothing projected' + (money ? '; revenue is net room + meal plan, IDR' : ''),
        rows,
      };
      if (money) summary.revenue_total = Math.round(data.totals.revenue);
      return {
        forModel: summary,
        card: { type: 'forecast', with_money: money, ...summary },
        understood: `${fmtShort(data.from)} – ${fmtShort(data.to)} · ${data.days} day${data.days === 1 ? '' : 's'} · occupancy`,
      };
    },
  },
  {
    name: 'room_rates',
    description: 'The normal rate per night for each room type on given nights (room only, service & tax included), with the pricing period that applies. '
      + 'Use for questions about the price or rate of a room type on a date, without checking whether it is free.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First night, YYYY-MM-DD' },
        to: { type: 'string', description: 'The day after the last night, YYYY-MM-DD' },
        room_type: { type: 'string', description: 'A room type name exactly as listed in the system prompt, or an empty string for every type' },
      },
      required: ['from', 'to', 'room_type'],
      additionalProperties: false,
    },
    allowed: user => can(user, 'reservations'),
    async run(propertyId, user, input) {
      const { from, to, nights } = stayRange(input, 'from', 'to');
      const want = String(input.room_type || '').trim().toLowerCase();
      const [{ rows: units }, { rows: [settings] }] = await Promise.all([
        // One room per type: rooms of a type share their rate (migration 062).
        db.query(`
          SELECT DISTINCT ON (COALESCE(rt.name, u.type, 'Other'))
                 u.id, COALESCE(rt.name, u.type, 'Other') AS type_name, rt.sort_order
          FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
          WHERE u.property_id = $1
          ORDER BY COALESCE(rt.name, u.type, 'Other'), u.name`, [propertyId]),
        db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]),
      ]);
      const picked = want ? units.filter(u => u.type_name.toLowerCase() === want) : units;
      if (!picked.length) throw new LookupError(`No room type called "${input.room_type}". Types: ${units.map(u => u.type_name).join(', ')}`);
      picked.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.type_name.localeCompare(b.type_name));
      const types = [];
      for (const u of picked) {
        const rates = await nightlyRoomRates(propertyId, u.id, from, to);
        const perNight = rates.night_breakdown.map(n => ({
          date: n.date, weekday: weekday(n.date),
          rate: Math.round(computeFolioTotals(n.room_rate, settings?.tax_rate, settings?.service_charge_rate).total),
          period: n.period?.name || null,
        }));
        types.push({ name: u.type_name, total: perNight.reduce((s, n) => s + n.rate, 0), nights: perNight });
      }
      const summary = { from, to, nights, price_note: 'per night, room only, service & tax included, IDR', room_types: types };
      return {
        forModel: summary,
        card: { type: 'rates', ...summary },
        understood: `${fmtShort(from)} – ${fmtShort(addDays(to, -1))} · ${nights} night${nights === 1 ? '' : 's'} · rates${want ? ` · ${picked[0].type_name}` : ''}`,
      };
    },
  },
];

// The lookups this user may use (each page's own permission).
function toolsFor(user) { return TOOLS.filter(t => t.allowed(user)); }

// What the API is told about a lookup.
function definition(t) {
  return { name: t.name, description: t.description, input_schema: t.input_schema, strict: true };
}

module.exports = { TOOLS, toolsFor, definition, LookupError };
