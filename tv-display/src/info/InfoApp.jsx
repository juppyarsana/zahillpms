import { useEffect, useMemo, useState } from 'react';
import api from '../api.js';
import { HOTEL_TZ } from '../hotelTime';
import { closePage, useDpad } from './dpad.js';

// Hotel info pages for the room TV (TV_LAUNCHER_PLAN.md, Phase 2): /info/dining,
// /info/activities, /info/guide, /info/today. Opened full screen from the "At <hotel>" tiles
// of the TV launcher's Home, driven by the remote (dpad.js). Read-only for now — ordering and
// booking stay on the room tablet. Sizes follow the 1920×1080 design (tv-launcher/design).

const u = (n) => `calc(${n} * 100vw / 1920)`;
const TEXT = '#f4f1ea', TEXT_2 = '#d9d4c7', LABEL = '#b7b1a3', CARD = '#15181d', CARD_2 = '#1a1d22';

const PAGES = ['dining', 'activities', 'guide', 'today'];

function query(key) { return new URLSearchParams(window.location.search).get(key)?.trim() || ''; }

// brand_color as the accent; a very dark one is lightened so the focus ring stays visible.
function readableAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  let [r, g, b] = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [0xc9, 0xa2, 0x27];
  const lum = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  for (let i = 0; i < 10 && lum() < 0.42; i++) { r += (255 - r) / 5; g += (255 - g) / 5; b += (255 - b) / 5; }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

const rp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

function duration(min) {
  const m = Number(min) || 0;
  if (!m) return '';
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

export default function InfoApp() {
  const page = window.location.pathname.replace(/^\/info\/?/, '').split('/')[0];
  const lang = query('lang') === 'id' ? 'id' : 'en';
  const t = (en, id) => (lang === 'id' ? id : en);
  const roomId = query('room') || localStorage.getItem('roomId') || '';
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query('room')) localStorage.setItem('roomId', query('room'));
    if (query('token')) localStorage.setItem('displayToken', query('token'));
    api.get(`/room/${encodeURIComponent(roomId)}/state`)
      .then(({ data }) => setState(data))
      .catch(err => setError(err.response?.data?.error || t('Unable to reach the hotel server', 'Tidak dapat terhubung ke server hotel')));
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const accent = readableAccent(state?.tv?.accent || state?.property?.brand_color);
  const ctx = { state, roomId, t, lang, accent };
  const Page = { dining: Dining, activities: Activities, guide: Guide, today: Today }[page];

  return (
    <div style={{ '--accent': accent, position: 'fixed', inset: 0, background: '#0a0c10', color: TEXT, fontFamily: 'Manrope, sans-serif', overflow: 'hidden' }}>
      {!PAGES.includes(page) ? <Message ctx={ctx} text={t('This page does not exist.', 'Halaman ini tidak ada.')} />
        : error ? <Message ctx={ctx} text={error} />
        : !state ? null
        : <Page ctx={ctx} />}
    </div>
  );
}

// ─── Frame ─────────────────────────────────────────────────────────────────────

function Header({ eyebrow, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: u(28), padding: `${u(60)} ${u(88)} 0` }}>
      <button data-focus tabIndex={0} className="tvf" onClick={closePage} aria-label="Back"
        style={{ width: u(66), height: u(66), borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.25)', background: 'transparent',
          color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span className="material-symbols-outlined" style={{ fontSize: u(36) }}>chevron_left</span>
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: 'var(--accent)', fontSize: u(21), fontWeight: 700, letterSpacing: '0.35em' }}>{eyebrow}</div>
        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, fontSize: u(72), lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      </div>
      {right && <div style={{ display: 'flex', gap: u(16) }}>{right}</div>}
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div style={{ background: CARD, border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: u(14), padding: `${u(20)} ${u(26)}` }}>
      <div style={{ color: LABEL, fontSize: u(15), fontWeight: 700, letterSpacing: '0.2em' }}>{label}</div>
      <div style={{ fontSize: u(25), fontWeight: 500, marginTop: u(6), whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function Message({ ctx, text }) {
  useDpad(true);
  return (
    <>
      <Header eyebrow="" title="" />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: u(200), textAlign: 'center',
        fontSize: u(34), color: TEXT_2, pointerEvents: 'none' }}>{text}</div>
      <Footer>{ctx.t('Press Back to return.', 'Tekan Back untuk kembali.')}</Footer>
    </>
  );
}

function Footer({ children }) {
  return <div style={{ position: 'absolute', left: u(88), right: u(88), bottom: u(56), fontSize: u(20), color: LABEL }}>{children}</div>;
}

function Photo({ url, emoji, label, style }) {
  return (
    <div style={{ background: url ? `#111 center / cover no-repeat url("${url}")` : 'linear-gradient(135deg, #2a2418, #1a1d22)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', ...style }}>
      {!url && (emoji
        ? <span style={{ fontSize: u(84), color: '#fff' }}>{emoji}</span>
        : <span style={{ fontSize: u(18), letterSpacing: '0.2em' }}>{label}</span>)}
    </div>
  );
}

// ─── Dining & Menu ─────────────────────────────────────────────────────────────

function Dining({ ctx }) {
  const { roomId, t, state } = ctx;
  const [menu, setMenu] = useState(null);
  const [note, setNote] = useState('');
  const [cat, setCat] = useState(null);

  useEffect(() => {
    api.get(`/room/${encodeURIComponent(roomId)}/menu`)
      .then(({ data }) => setMenu(Array.isArray(data) ? { source: 'pms', items: data.map(p => ({ ...p, category: p.category === 'drinks' ? t('Drinks', 'Minuman') : t('Food', 'Makanan') })) } : data))
      .catch(err => {
        setMenu({ items: [] });
        setNote(err.response?.status === 404 ? t('The menu shows here once you have checked in.', 'Menu tampil di sini setelah Anda check-in.')
          : err.response?.status === 403 ? t('In-room dining is not available.', 'Layanan makan di kamar tidak tersedia.')
          : t('The menu could not be loaded. Please try again later.', 'Menu tidak dapat dimuat. Silakan coba lagi nanti.'));
      });
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => menu?.items || [], [menu]);
  const cats = useMemo(() => [...new Set(items.map(i => i.category || 'Menu'))], [items]);
  const active = cat && cats.includes(cat) ? cat : cats[0];
  const shown = items.filter(i => (i.category || 'Menu') === active);
  useDpad(!!menu);

  // What the guest pays: a "++" POS menu adds service + tax to every item that isn't nett.
  const prices = menu?.prices;
  const allIn = (i) => {
    if (!prices || prices.include !== false || i.nett) return i.price;
    const service = i.price * (prices.service || 0) / 100;
    return i.price + service + (i.price + service) * (prices.tax || 0) / 100;
  };

  const tv = state.tv || {};
  const title = tv.breakfast?.outlet || t('Dining', 'Restoran');
  const right = [];
  if (menu?.hours?.from) right.push(<InfoChip key="h" label={t('OPEN TODAY', 'BUKA HARI INI')} value={`${menu.hours.from} – ${menu.hours.to}`} />);
  if (tv.breakfast?.hours) right.push(<InfoChip key="b" label={t('BREAKFAST', 'SARAPAN')} value={tv.breakfast.hours} />);
  if (state.orderingEnabled) right.push(<InfoChip key="r" label={t('ROOM SERVICE', 'LAYANAN KAMAR')} value={t('Order from your room tablet', 'Pesan dari tablet kamar')} />);

  return (
    <>
      <Header eyebrow={t('DINING', 'MAKAN')} title={title} right={right} />
      {note || (menu && !items.length) ? (
        <div style={{ position: 'absolute', inset: `${u(220)} ${u(88)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: u(32), color: TEXT_2, textAlign: 'center' }}>
          {note || t('There is nothing on the menu right now.', 'Belum ada menu saat ini.')}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: u(48), padding: `${u(50)} ${u(88)} 0`, height: `calc(100vh - ${u(330)})` }}>
          <div style={{ width: u(300), flexShrink: 0, display: 'flex', flexDirection: 'column', gap: u(12), overflowY: 'auto', padding: u(6), margin: `-${u(6)}` }}>
            {cats.map((c, i) => (
              <button key={c} data-focus data-autofocus={i === 0 ? true : undefined} tabIndex={0} className="tvf"
                onFocus={() => setCat(c)} onClick={() => setCat(c)}
                style={{ textAlign: 'left', fontSize: u(25), fontWeight: c === active ? 600 : 500, padding: `${u(18)} ${u(26)}`, borderRadius: u(12),
                  border: '1.5px solid rgba(255,255,255,0.1)', background: c === active ? 'var(--accent)' : CARD, color: c === active ? '#111' : TEXT }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: u(8), margin: `-${u(8)}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: u(28) }}>
              {shown.map(i => (
                <div key={i.id ?? i.name} data-focus tabIndex={0} className="tvf"
                  style={{ background: CARD_2, border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: u(16), overflow: 'hidden' }}>
                  <Photo url={i.image_url} emoji={i.emoji} label={t('DISH', 'HIDANGAN')} style={{ height: u(170) }} />
                  <div style={{ padding: `${u(20)} ${u(24)} ${u(22)}` }}>
                    <div style={{ display: 'flex', gap: u(12), alignItems: 'baseline' }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: u(27), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</div>
                      <div style={{ color: 'var(--accent)', fontSize: u(23), fontWeight: 600, whiteSpace: 'nowrap' }}>{rp(allIn(i))}</div>
                    </div>
                    {i.description && (
                      <div style={{ fontSize: u(19), color: TEXT_2, marginTop: u(8), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {menu?.message && <Footer>{menu.message}</Footer>}
      {!menu?.message && menu?.source === 'pos' && items.length > 0 && (
        <Footer>{t('Prices include service & tax.', 'Harga sudah termasuk layanan & pajak.')}{state.orderingEnabled ? ' ' + t('To order, use your room tablet.', 'Untuk memesan, gunakan tablet kamar.') : ''}</Footer>
      )}
    </>
  );
}

// ─── Activities ────────────────────────────────────────────────────────────────

const ACTIVITY_KIND = { tour: ['TOUR', 'TUR'], transport: ['TRANSPORT', 'TRANSPORTASI'], wellness: ['WELLNESS', 'KEBUGARAN'], other: ['EXPERIENCE', 'PENGALAMAN'] };

function Activities({ ctx }) {
  const { roomId, t, state } = ctx;
  const [list, setList] = useState(null);
  const [note, setNote] = useState('');
  const [featuredId, setFeaturedId] = useState(null);

  useEffect(() => {
    api.get(`/room/${encodeURIComponent(roomId)}/activities`)
      .then(({ data }) => setList(data))
      .catch(err => {
        setList([]);
        setNote(err.response?.status === 403 ? t('Activities are not available.', 'Aktivitas tidak tersedia.') : t('Activities could not be loaded.', 'Aktivitas tidak dapat dimuat.'));
      });
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  useDpad(!!list);

  // A Guest Board card linked to an activity gives it a photo and a longer text.
  const cards = state.cards || [];
  const withPhoto = (list || []).map(a => {
    const card = cards.find(c => c.activity_id === a.id);
    return { ...a, image_url: card?.image_url || null, body: card?.body || a.description || '', meta: card?.meta || '' };
  });
  const sorted = [...withPhoto].sort((a, b) => (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0));
  const featured = sorted.find(a => a.id === featuredId) || sorted[0];
  const area = (state.property?.location || '').split(',')[0].trim();
  const kind = (a) => (ACTIVITY_KIND[a.category] || ACTIVITY_KIND.other)[ctx.lang === 'id' ? 1 : 0];

  return (
    <>
      <Header eyebrow={t('ACTIVITIES', 'AKTIVITAS')} title={area ? t(`Discover ${area}`, `Jelajahi ${area}`) : t('Things to do', 'Kegiatan')} />
      {note || (list && !list.length) ? (
        <div style={{ position: 'absolute', inset: `${u(220)} ${u(88)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: u(32), color: TEXT_2 }}>
          {note || t('No activities right now — ask reception.', 'Belum ada aktivitas — tanyakan resepsionis.')}
        </div>
      ) : featured && (
        <div style={{ display: 'flex', gap: u(40), padding: `${u(52)} ${u(88)} 0`, height: `calc(100vh - ${u(250)})` }}>
          <div data-focus data-autofocus tabIndex={0} className="tvf" onFocus={() => setFeaturedId(featured.id)}
            style={{ width: u(950), flexShrink: 0, borderRadius: u(22), overflow: 'hidden', position: 'relative', border: '1.5px solid rgba(255,255,255,0.08)' }}>
            <Photo url={featured.image_url} label={t('PHOTO', 'FOTO')} style={{ position: 'absolute', inset: 0 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(5,7,10,0.95) 0%, rgba(5,7,10,0.55) 40%, rgba(5,7,10,0) 70%)' }} />
            <div style={{ position: 'absolute', left: u(48), right: u(48), bottom: u(44) }}>
              <span style={{ background: 'var(--accent)', color: '#111', fontSize: u(17), fontWeight: 800, letterSpacing: '0.2em', padding: `${u(8)} ${u(16)}`, borderRadius: u(8) }}>{kind(featured)}</span>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, fontSize: u(76), lineHeight: 1.05, marginTop: u(22) }}>{featured.name}</div>
              {featured.body && <div style={{ fontSize: u(24), color: TEXT_2, marginTop: u(14), maxWidth: u(780), display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{featured.body}</div>}
              <div style={{ display: 'flex', gap: u(36), fontSize: u(23), marginTop: u(24), color: TEXT_2 }}>
                {duration(featured.duration_minutes) && <span>{t('Duration', 'Durasi')} <b style={{ color: TEXT }}>{duration(featured.duration_minutes)}</b></span>}
                {Number(featured.price) > 0 && <span>{t('From', 'Mulai')} <b style={{ color: TEXT }}>{rp(featured.price)}</b></span>}
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(18), overflowY: 'auto', padding: u(8), margin: `-${u(8)}` }}>
            {sorted.map(a => (
              <div key={a.id} data-focus tabIndex={0} className="tvf" onFocus={() => setFeaturedId(a.id)}
                style={{ display: 'flex', gap: u(24), alignItems: 'center', padding: u(18), borderRadius: u(18), flexShrink: 0,
                  background: a.id === featured.id ? '#1d2127' : CARD, border: '1.5px solid rgba(255,255,255,0.08)' }}>
                <Photo url={a.image_url} label={t('PHOTO', 'FOTO')} style={{ width: u(180), height: u(120), borderRadius: u(12), flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#9fd3a8', fontSize: u(16), fontWeight: 700, letterSpacing: '0.2em' }}>{kind(a)}</div>
                  <div style={{ fontSize: u(29), fontWeight: 600, marginTop: u(6), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                  <div style={{ fontSize: u(20), color: TEXT_2, marginTop: u(6) }}>
                    {[duration(a.duration_minutes), Number(a.price) > 0 ? rp(a.price) : ''].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 'auto', border: '1.5px dashed rgba(255,255,255,0.2)', borderRadius: u(16), padding: `${u(24)} ${u(26)}`, fontSize: u(23), color: TEXT_2, flexShrink: 0 }}>
              {t('To book, use your ', 'Untuk memesan, gunakan ')}<b style={{ color: TEXT }}>{t('room tablet', 'tablet kamar')}</b>{t(' or call ', ' atau hubungi ')}<b style={{ color: TEXT }}>{t('reception', 'resepsionis')}</b>.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Hotel Guide / Today: Guest Board cards ────────────────────────────────────

function CardGrid({ cards, t }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: u(28), alignItems: 'start' }}>
      {cards.map((c, i) => (
        <div key={c.id} data-focus data-autofocus={i === 0 ? true : undefined} tabIndex={0} className="tvf"
          style={{ background: CARD_2, border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: u(16), overflow: 'hidden' }}>
          {c.image_url && <Photo url={c.image_url} style={{ height: u(200) }} />}
          <div style={{ padding: `${u(22)} ${u(26)} ${u(26)}` }}>
            {c.meta && <div style={{ color: 'var(--accent)', fontSize: u(16), fontWeight: 700, letterSpacing: '0.18em' }}>{String(c.meta).toUpperCase()}</div>}
            <div style={{ fontSize: u(29), fontWeight: 600, marginTop: c.meta ? u(8) : 0 }}>{c.title}</div>
            {c.body && <div style={{ fontSize: u(21), color: TEXT_2, marginTop: u(10), lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: c.image_url ? 3 : 7, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.body}</div>}
            {c.activity_price != null && Number(c.activity_price) > 0 && <div style={{ fontSize: u(21), marginTop: u(12), color: TEXT }}>{rp(c.activity_price)}</div>}
          </div>
        </div>
      ))}
      {!cards.length && <div style={{ gridColumn: '1 / -1', fontSize: u(30), color: TEXT_2, padding: `${u(80)} 0`, textAlign: 'center' }}>
        {t('Nothing here yet — ask reception.', 'Belum ada informasi — tanyakan resepsionis.')}
      </div>}
    </div>
  );
}

function Guide({ ctx }) {
  const { t, state } = ctx;
  const tv = state.tv || {};
  useDpad(true);
  const facts = [];
  if (tv.wifi?.ssid) facts.push(<InfoChip key="w" label="WI-FI" value={tv.wifi.password ? `${tv.wifi.ssid} · ${tv.wifi.password}` : tv.wifi.ssid} />);
  if (tv.breakfast?.hours) facts.push(<InfoChip key="b" label={t('BREAKFAST', 'SARAPAN')} value={tv.breakfast.outlet ? `${tv.breakfast.hours} · ${tv.breakfast.outlet}` : tv.breakfast.hours} />);
  if (tv.checkout_time) facts.push(<InfoChip key="c" label="CHECK-OUT" value={tv.checkout_time} />);
  const cards = (state.cards || []).filter(c => c.category === 'property' || c.category === 'dining');
  return (
    <>
      <Header eyebrow={t('HOTEL GUIDE', 'PANDUAN HOTEL')} title={state.property?.name || t('Hotel Guide', 'Panduan Hotel')} />
      <div style={{ padding: `${u(44)} ${u(88)} ${u(80)}`, height: `calc(100vh - ${u(190)})`, overflowY: 'auto' }}>
        {facts.length > 0 && <div style={{ display: 'flex', gap: u(16), flexWrap: 'wrap', marginBottom: u(36) }}>{facts}</div>}
        <CardGrid cards={cards} t={t} />
      </div>
    </>
  );
}

function Today({ ctx }) {
  const { t, state, lang } = ctx;
  useDpad(true);
  const cards = (state.cards || []).filter(c => c.category === 'notice' || c.category === 'activity');
  const day = new Date().toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { timeZone: HOTEL_TZ, weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <Header eyebrow={t('TODAY', 'HARI INI')} title={day} />
      <div style={{ padding: `${u(44)} ${u(88)} ${u(80)}`, height: `calc(100vh - ${u(190)})`, overflowY: 'auto' }}>
        <CardGrid cards={cards} t={t} />
      </div>
    </>
  );
}
