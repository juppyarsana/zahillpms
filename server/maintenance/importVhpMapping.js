// How the old PMS's (VHP) reservation export maps onto this PMS — used by
// importVhpReservations.js. No guest data here; edit freely when the owner
// decides how an agent or source should come in.

// RmCat (first 3 letters; the 4th, D / T, is the bed: double / twin) →
// room type name in the PMS (must exist, case-insensitive).
const ROOM_TYPES = {
  DLP: 'Deluxe Pool View',
  DLG: 'Deluxe Garden View',
  TNT: 'Deluxe Glamping',
  SUT: 'Suite',
  VLA: 'Villa 3 Bedroom',   // room 801
  '1VL': 'Villa',           // rooms 802–804
};
const BEDS = { D: 'double', T: 'twin' };

// Arrangement → rate plan code (the property's default plan when missing).
const RATE_PLANS = { RB: 'BB', RO: 'RO' };

// Company/TA (VHP cuts it at 14 characters; the part before the first comma
// is used) → an OTA source. `label` = the source is created when the property
// doesn't have it yet (as an OTA, Publish Rate off).
const OTA_SOURCES = {
  'AGODA': { id: 'agoda' },
  'TIKET.COM': { id: 'tiket_com' },
  'BOOKING.COM': { id: 'booking_com' },
  'EXPEDIA': { id: 'expedia' },
  'TRAVELOKA': { id: 'traveloka' },
  'AIRBNB': { id: 'airbnb' },
  'CTRIP': { id: 'ctrip', label: 'Ctrip / Trip.com' },
  'KLIKNBOOK': { id: 'kliknbook', label: 'KlikNBook' },
};

// Company/TA values that mean "no company" → the Direct source.
const DIRECT_COMPANIES = ['[INDIVIDUAL RE', '[HOTEL WEBSITE', '[INDIVIDUAL', '[HOTEL'];

// Segment → source for a booking made through an agent / company
// (a travel agent unless listed here).
const AGENT_SEGMENT_SOURCE = { CORPORATE: 'corporate', GOVM: 'corporate' };
const AGENT_TYPE_FOR_SOURCE = { corporate: 'company', travel_agent: 'travel_agent', wholesaler: 'wholesaler' };

// VHP company → the agent's name in the PMS, when the cut name doesn't find it
// by itself (matching is otherwise: one name starts with the other, ignoring
// case, punctuation and a leading "PT"). Also the name used to create it.
const AGENT_NAMES = {
  'MG JARVIS': 'MG Jarvis',
  'TRAVASS LIFE': 'Travass Life',
  'GRINNING MONKE': 'Grinning Monkey',
  'BALI TOP HOLID': 'Bali Top Holiday',
  'BALI PROFOND': 'Bali Profond',
  'MANUMADI TOURS': 'Manumadi Tours',
  'HAPPY TRAILS': 'Happy Trails',
  'KBA TUR': 'KBA Tur',
  'PALAPA WISATA': 'Palapa Wisata',
  'PHENOM EVENT I': 'Phenom Event',
  'KHIRI TRAVEL I': 'Khiri Travel',
  'BALI DORADA TO': 'PT BALI DORADA TOURS & TRAVEL',
  'WICKED ADVENTU': 'Wicked Adventures',
  'BB TRAVEL': 'BB Travel',
  'GOLDEN KRIS TO': 'Golden Kris Tours',
  'JANS TOUR': 'Jans Tour',
  'EAGLE VOYAGES': 'Eagle Voyages',
  'ASIA EVOLUTION': 'Asia Evolution',
  'PACTO': 'Pacto',
};

// Nat → nationality as the PMS stores it (country names, client/src/lib/countries.js).
const NATIONALITIES = {
  IDN: 'Indonesia', ID: 'Indonesia', US: 'United States', USA: 'United States',
  CHE: 'Switzerland', CH: 'Switzerland', DE: 'Germany', DEU: 'Germany',
  SGP: 'Singapore', SG: 'Singapore', BHR: 'Bahrain', GB: 'United Kingdom', GBR: 'United Kingdom',
  AUT: 'Austria', AT: 'Austria', SAU: 'Saudi Arabia', SA: 'Saudi Arabia', IND: 'India', IN: 'India',
  AUS: 'Australia', AU: 'Australia', MYS: 'Malaysia', MY: 'Malaysia', RE: 'France',
  NLD: 'Netherlands', NL: 'Netherlands', FRA: 'France', FR: 'France', JPN: 'Japan', JP: 'Japan',
  CHN: 'China', CN: 'China', KOR: 'South Korea', KR: 'South Korea', NZL: 'New Zealand', NZ: 'New Zealand',
  ITA: 'Italy', IT: 'Italy', ESP: 'Spain', ES: 'Spain', BEL: 'Belgium', BE: 'Belgium',
  CAN: 'Canada', CA: 'Canada', RUS: 'Russia', RU: 'Russia', THA: 'Thailand', TH: 'Thailand',
};

// Guest names that are not a real person yet.
const PLACEHOLDER_NAME = /^(TBA|TBC|TBD|GUEST|N\/?A)$|^(GROUP|SERIES)\b|\b\d{1,3}$/i;
const TITLES = /^(MR|MRS|MS|MISS|MSTR|DR|PROF|IBU|BAPAK|BPK|BU|PAK|SIR|MADAM|MDM|MX)\.?$/i;

module.exports = {
  ROOM_TYPES, BEDS, RATE_PLANS, OTA_SOURCES, DIRECT_COMPANIES, AGENT_SEGMENT_SOURCE,
  AGENT_TYPE_FOR_SOURCE, AGENT_NAMES, NATIONALITIES, PLACEHOLDER_NAME, TITLES,
};
