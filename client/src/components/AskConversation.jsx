import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAsk } from '../context/AskContext';
import { canListen, canSpeak, listen, speak, stopSpeaking, primeSpeech, LANGS } from '../lib/speech';

// The Ask conversation: a staff member asks the PMS a question — spoken (the
// browser turns it into text) or typed — in Indonesian or English, and gets a
// short answer plus the table behind it. Read-only: it looks things up, it
// never books or changes anything. Shown in the floating panel (AskFab.jsx)
// and on the /ask page; the conversation itself lives in AskContext.
// Server: POST /api/assistant/ask (services/assistant.js) — every figure comes
// from the same lookups as the Availability and Forecast pages.

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDay(s) { return parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }

// Remembered on this device only: which language the mic listens in.
function pref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* private window */ } }

const STARTERS = [
  'Malam ini masih ada kamar?',
  'Weekend ini ada kamar untuk 4 orang, 2 kamar?',
  'Okupansi minggu depan gimana?',
  'What is the rate for each room type tomorrow?',
];

function AvailabilityCard({ card, onNavigate }) {
  const q = new URLSearchParams({ check_in: card.check_in, check_out: card.check_out, guests: card.guests, rooms: card.rooms_wanted });
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 13 }}>
          <b>{card.rooms_free}</b> of {card.rooms_total} rooms free · {fmtDay(card.check_in)} → {fmtDay(card.check_out)} · {card.nights} night{card.nights === 1 ? '' : 's'}
        </div>
        {card.rooms_wanted > 1 && (
          <span className={`badge badge-${card.enough_rooms ? 'green' : 'red'}`}>
            {card.enough_rooms ? `Enough for ${card.rooms_wanted} rooms` : `Only ${card.rooms_free} free`}
          </span>
        )}
      </div>
      {card.room_types.map(t => (
        <div key={t.name} className="flex-between" style={{ gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{t.name}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              up to {t.max_guests} guest{t.max_guests === 1 ? '' : 's'}
              {!t.fits_party && <span style={{ color: '#B45309', fontWeight: 600 }}> · too small</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ fontWeight: 700, color: t.free ? '#16A34A' : '#9CA3AF' }}>{t.free ? `${t.free} of ${t.total} free` : 'Sold out'}</div>
            {t.stay_price != null && (
              <div className="text-muted" style={{ fontSize: 11 }}>
                {t.price_varies_by_room ? 'from ' : ''}{fmtIDR(t.stay_price)}{card.nights > 1 ? ` · ${fmtIDR(t.per_night)}/night` : ''}
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <span className="text-muted" style={{ fontSize: 11 }}>Room only, incl. service &amp; tax</span>
        <Link to={`/availability?${q}`} className="btn btn-sm btn-primary" onClick={onNavigate}>Open in Availability →</Link>
      </div>
    </div>
  );
}

function ForecastCard({ card, onNavigate }) {
  const types = Object.keys(card.rows[0]?.free_by_type || {});
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        {fmtDay(card.from)} → {fmtDay(card.to)} · average occupancy <b>{card.average_occupancy_pct}%</b>
      </div>
      <div className="table-wrap">
        <table style={{ minWidth: card.with_money ? 520 : 400, fontSize: 12 }}>
          <thead>
            <tr>
              <th>Day</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Free</th>
              <th style={{ textAlign: 'right' }}>Occ.</th><th style={{ textAlign: 'right' }}>Arr.</th><th style={{ textAlign: 'right' }}>Dep.</th>
              {card.with_money && <th style={{ textAlign: 'right' }}>Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {card.rows.map(r => (
              <tr key={r.date} title={types.map(t => `${t}: ${r.free_by_type[t]} free`).join(' · ')}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDay(r.date)}
                  {r.holiday && <div className="text-muted" style={{ fontSize: 10 }}>{r.holiday}</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{r.sold}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: r.free ? '#16A34A' : '#DC2626' }}>{r.free}</td>
                <td style={{ textAlign: 'right' }}>{r.occupancy_pct}%</td>
                <td style={{ textAlign: 'right' }}>{r.arrivals}</td>
                <td style={{ textAlign: 'right' }}>{r.departures}</td>
                {card.with_money && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(r.revenue)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
        On the books today, nothing projected. <Link to="/forecast" onClick={onNavigate}>Forecast →</Link>
      </div>
    </div>
  );
}

function RatesCard({ card }) {
  const dates = card.room_types[0]?.nights.map(n => n.date) || [];
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="table-wrap">
        <table style={{ minWidth: 160 + dates.length * 96, fontSize: 12 }}>
          <thead>
            <tr>
              <th>Room type</th>
              {dates.map(d => <th key={d} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtDay(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {card.room_types.map(t => (
              <tr key={t.name}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                {t.nights.map(n => (
                  <td key={n.date} style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={n.period || 'Normal rate'}>
                    {fmtIDR(n.rate)}
                    {n.period && <div className="text-muted" style={{ fontSize: 10 }}>{n.period}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>Per night, room only, incl. service &amp; tax</div>
    </div>
  );
}

const CARDS = { availability: AvailabilityCard, forecast: ForecastCard, rates: RatesCard };

// The Voice on / off and Clear buttons — in the panel's or the page's header.
export function AskControls() {
  const { turns, voiceOn, toggleVoice, clear } = useAsk();
  return (
    <>
      {canSpeak() && (
        <button className={`btn btn-sm ${voiceOn ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleVoice}
          title={voiceOn ? 'Replies are read aloud — tap to turn off' : 'Read replies aloud'}>
          {voiceOn ? '🔊 Voice on' : '🔈 Voice off'}
        </button>
      )}
      {turns.length > 0 && <button className="btn btn-sm btn-secondary" onClick={clear}>Clear</button>}
    </>
  );
}

// `panel`: laid out to fill the floating panel (the messages scroll, the
// input stays at the bottom); otherwise it flows in the page with the input
// pinned to the bottom of the screen. `onNavigate`: a link in a card was followed.
export default function AskConversation({ panel = false, onNavigate }) {
  const { turns, busy, notice, setNotice, voiceOn, send } = useAsk();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(() => pref('askLang', 'id'));
  const stopRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);
  useEffect(() => () => { stopRef.current?.(); }, []);

  async function submit(question) {
    const q = (question ?? text).trim();
    if (!q || busy) return;
    setText('');
    if (!(await send(q))) setText(q);
  }

  function toggleMic() {
    if (listening) { stopRef.current?.(); return; }
    stopSpeaking();
    if (voiceOn) primeSpeech();
    setNotice('');
    setListening(true);
    stopRef.current = listen({
      lang: LANGS[lang],
      onPartial: setText,
      onFinal: heard => { setListening(false); if (heard) submit(heard); },
      onError: msg => { setListening(false); setNotice(msg); },
    });
  }
  function pickLang(l) { setLang(l); savePref('askLang', l); }

  const mic = canListen();

  const messages = (
    <>
      {turns.length === 0 && (
        <div className={panel ? '' : 'card mb-3'} style={panel ? { marginBottom: 12 } : undefined}>
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Ask about rooms, prices and how busy a date is, in Indonesian or English. Try one of these, or use your own words. It only looks things up — it never makes or changes a booking.
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {STARTERS.map(s => <button key={s} className="btn btn-sm btn-secondary" style={{ textAlign: 'left' }} onClick={() => submit(s)}>{s}</button>)}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        {turns.map((t, i) => t.role === 'user' ? (
          <div key={i} style={{
            alignSelf: 'flex-end', maxWidth: '85%', padding: '9px 13px', borderRadius: '14px 14px 4px 14px',
            background: 'var(--color-primary, #6B1E3A)', color: '#fff', fontSize: 14,
          }}>{t.text}</div>
        ) : (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {t.understood && <div className="text-muted" style={{ fontSize: 11 }}>Looked up: {t.understood}</div>}
            <div className="flex gap-2" style={{ alignItems: 'flex-start' }}>
              <div style={{ fontSize: 15, lineHeight: 1.45, flex: 1 }}>{t.text}</div>
              {canSpeak() && (
                <button className="btn btn-sm btn-secondary" title="Read this aloud" onClick={() => speak(t.text)}>🔈</button>
              )}
            </div>
            {(t.cards || []).map((c, j) => {
              const Card = CARDS[c.type];
              return Card ? <Card key={j} card={c} onNavigate={onNavigate} /> : null;
            })}
          </div>
        ))}
        {busy && <div className="text-muted" style={{ fontSize: 13 }}>Looking it up…</div>}
        <div ref={endRef} />
      </div>

      {notice && <div className="alert alert-error"><div>{notice}</div></div>}
    </>
  );

  const input = (
    <>
      <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex gap-2" style={{ alignItems: 'center' }}>
        {mic && (
          <button type="button" onClick={toggleMic} disabled={busy} aria-label={listening ? 'Stop listening' : 'Speak'}
            style={{
              width: 48, height: 48, borderRadius: '50%', border: 'none', fontSize: 20, flexShrink: 0, cursor: 'pointer',
              background: listening ? '#DC2626' : 'var(--color-primary, #6B1E3A)', color: '#fff',
              boxShadow: listening ? '0 0 0 6px rgba(220,38,38,0.2)' : 'none',
            }}>
            {listening ? '■' : '🎙'}
          </button>
        )}
        <input className="form-input" style={{ flex: 1, minWidth: 0 }} value={text} maxLength={500}
          placeholder={listening ? 'Listening…' : lang === 'id' ? 'Tanya sesuatu…' : 'Ask something…'}
          onChange={e => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      <div style={{ marginTop: 6 }}>
        {mic ? (
          <div className="flex gap-2" style={{ alignItems: 'center', fontSize: 12 }}>
            <span className="text-muted">Mic listens in</span>
            {['id', 'en'].map(l => (
              <button key={l} type="button" className={`btn btn-sm ${lang === l ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pickLang(l)}>
                {l === 'id' ? 'Indonesia' : 'English'}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>This browser has no voice input — tap the mic on your keyboard to speak.</span>
        )}
      </div>
    </>
  );

  if (panel) {
    return (
      <>
        <div className="ask-panel-body">{messages}</div>
        <div className="ask-panel-input">{input}</div>
      </>
    );
  }
  return (
    <>
      {messages}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 20, background: 'var(--surface, #fff)', borderRadius: 12,
        border: '1px solid var(--border)', boxShadow: '0 -4px 16px rgba(0,0,0,0.10)', padding: '10px 84px 10px 12px', // right padding: clear of the floating buttons
      }}>{input}</div>
    </>
  );
}
