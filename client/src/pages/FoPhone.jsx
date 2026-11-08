// The front desk phone (migration 162): the screen inside the Android app
// (fo-phone/), also usable in a phone browser for testing.
//
// Auth is the phone's own key, not a staff login: from the Android app
// (window.FoPhoneApp.getKey()) or, in a browser, paired here with the code
// from Settings → Front desk phones (kept in localStorage).
//
// What it does: rings for a room calling the front desk (the Android app also
// rings natively, full screen, even when locked), answers, calls a room, the
// missed calls list. Calls use the same callClient.js as the PMS screens.
// In the app, the native side keeps the event stream while the screen is
// closed; when Answer is pressed there it opens this page with
// ?answer=<callId>, and the signals it already received (the room's offer)
// come from FoPhoneApp.takeSignals(callId).
import { useCallback, useEffect, useRef, useState } from 'react';
import callClient from '../services/callClient';
import ringtone from '../services/ringtone';

const APP = typeof window !== 'undefined' ? window.FoPhoneApp : null;   // the Android bridge, when inside the app
const KEY_STORE = 'foPhoneKey';
const CONNECT_TIMEOUT_MS = 45000;
const OFFER_WAIT_MS = 8000;
const MIC_BLOCKED = 'Microphone blocked — allow the microphone for the app and try again';
const CONNECT_FAILED = 'Could not connect — please try again';

function getKey() {
  try { if (APP?.getKey) return APP.getKey() || ''; } catch { /* old app */ }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
const appCall = (fn, ...a) => { try { if (APP && typeof APP[fn] === 'function') return APP[fn](...a); } catch { /* ignore */ } return undefined; };

async function api(method, path, body) {
  const r = await fetch('/api/phone' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getKey()}`, 'X-App-Version': appCall('version') || 'web' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; e.code = data.code; throw e; }
  return data;
}

const hm = iso => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const HOW = { called_back: 'Called back', rang_again: 'Room called again', done: 'Marked done' };

export default function FoPhone() {
  const [hasKey, setHasKey] = useState(() => !!getKey());
  if (!hasKey) return <Pair onPaired={() => setHasKey(true)} />;
  return <Phone onUnpaired={() => setHasKey(false)} />;
}

function Pair({ onPaired }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/public/fo-phone/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, app_version: appCall('version') || 'web' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Pairing failed');
      if (APP?.saveKey) appCall('saveKey', d.key); else localStorage.setItem(KEY_STORE, d.key);
      onPaired();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div style={S.page}>
      <div style={{ ...S.card, marginTop: 40 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Front desk phone</div>
        <p style={S.muted}>On the PMS: <b>Settings → Front desk phones → Add phone</b>. Type the code it shows.</p>
        <form onSubmit={submit}>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" autoFocus
            style={{ ...S.input, fontSize: 24, letterSpacing: 4, textAlign: 'center' }} />
          <button type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length !== 8} style={{ ...S.btn, ...S.primary, width: '100%', marginTop: 12 }}>
            {busy ? 'Pairing…' : 'Pair this phone'}
          </button>
        </form>
        {error && <div style={S.error}>{error}</div>}
      </div>
    </div>
  );
}

function Phone({ onUnpaired }) {
  const [me, setMe] = useState(null);
  const [online, setOnline] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [active, setActive] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [missed, setMissed] = useState({ open: 0, calls: [] });
  const [rooms, setRooms] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const activeRef = useRef(null); useEffect(() => { activeRef.current = active; }, [active]);
  const incomingRef = useRef(null); useEffect(() => { incomingRef.current = incoming; }, [incoming]);
  const offers = useRef(new Map());
  const ice = useRef(new Map());
  const timer = useRef(null);

  const fail = useCallback((err) => {
    if (err?.code === 'DEVICE_UNKNOWN') { appCall('clearKey'); try { localStorage.removeItem(KEY_STORE); } catch {} onUnpaired(); return; }
    setError(err?.message || String(err));
  }, [onUnpaired]);

  const loadMissed = useCallback(() => api('GET', '/missed').then(setMissed).catch(() => {}), []);
  const loadRooms = useCallback(() => api('GET', '/rooms').then(setRooms).catch(() => {}), []);

  useEffect(() => {
    api('GET', '/me').then(setMe).catch(fail);
    loadMissed(); loadRooms();
    const id = setInterval(() => { loadMissed(); }, 60000);
    const id2 = setInterval(loadRooms, 5 * 60000);
    return () => { clearInterval(id); clearInterval(id2); };
  }, [fail, loadMissed, loadRooms]);

  useEffect(() => { callClient.configure({ fetchTurnServers: async () => (await api('GET', '/turn-credentials')).iceServers }); }, []);

  // In a browser this page rings itself; inside the app the native side rings.
  useEffect(() => {
    if (incoming && !APP) ringtone.start(); else ringtone.stop();
    return () => ringtone.stop();
  }, [incoming]);
  useEffect(() => {
    if (active?.status === 'calling') ringtone.startDial(); else ringtone.stopDial();
    appCall('callState', active ? active.status : 'idle');
    return () => ringtone.stopDial();
  }, [active?.status]);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const finish = useCallback((callId, status, err) => {
    if (status === 'failed') api('POST', `/${callId}/end`).catch(() => {});
    clearTimer(); callClient.close(); setMuted(false);
    offers.current.delete(callId); ice.current.delete(callId);
    setActive(prev => (prev?.callId === callId ? { ...prev, status, error: err } : prev));
    setTimeout(() => setActive(prev => (prev?.callId === callId ? null : prev)), err ? 5000 : 2500);
  }, []);
  const startTimer = useCallback((callId) => {
    clearTimer();
    timer.current = setTimeout(() => { if (activeRef.current?.callId === callId) finish(callId, 'failed', CONNECT_FAILED); }, CONNECT_TIMEOUT_MS);
  }, [finish]);
  const onConn = useCallback(callId => state => {
    if (state === 'connected') { clearTimer(); setActive(p => (p?.callId === callId ? { ...p, status: 'connected' } : p)); }
    else if (['failed', 'disconnected', 'closed'].includes(state)) finish(callId, 'failed', CONNECT_FAILED);
  }, [finish]);

  const handle = useCallback((e) => {
    if (['missed', 'missed_changed', 'call_taken', 'answered_from_room', 'ended'].includes(e.type)) setTimeout(loadMissed, 300);
    if (e.type === 'incoming_call') {
      // Inside the app the phone's own full-screen ringing handles it.
      if (activeRef.current || APP) return;
      setIncoming(prev => prev || { callId: e.callId, unitName: e.unitName, roomId: e.roomId, guestName: e.guestName });
    } else if (e.type === 'signal' && e.payload?.kind === 'offer') {
      offers.current.set(e.callId, e.payload.sdp);
    } else if (e.type === 'signal' && e.payload?.kind === 'answer') {
      if (activeRef.current?.callId === e.callId) callClient.handleAnswer(e.payload.sdp);
    } else if (e.type === 'signal' && e.payload?.kind === 'ice') {
      if (activeRef.current?.callId === e.callId) callClient.addIceCandidate(e.payload.candidate);
      else { const l = ice.current.get(e.callId) || []; l.push(e.payload.candidate); ice.current.set(e.callId, l); }
    } else if (e.type === 'answered_from_room') {
      setActive(p => (p?.callId === e.callId && p.status === 'calling' ? { ...p, status: 'connecting' } : p));
    } else if (e.type === 'call_taken') {
      setIncoming(p => (p?.callId === e.callId ? null : p));
    } else if (e.type === 'ended' || e.type === 'missed') {
      setIncoming(p => (p?.callId === e.callId ? null : p));
      if (activeRef.current?.callId === e.callId) finish(e.callId, 'ended');
    }
  }, [finish, loadMissed]);

  // Inside the app, the native service passes on what it receives as well
  // (covers the moment between the ringing screen and this page's own stream).
  useEffect(() => { window.foPhoneEvent = handle; return () => { delete window.foPhoneEvent; }; }, [handle]);

  // The event stream (reconnects; 40 s without a heartbeat = dead).
  useEffect(() => {
    let es = null, last = Date.now(), stopped = false, retry = 1000, t = null;
    const connect = () => {
      es?.close();
      es = new EventSource(`/api/phone/stream?key=${encodeURIComponent(getKey())}`);
      last = Date.now();
      es.onopen = () => { setOnline(true); retry = 1000; };
      es.onmessage = (m) => { last = Date.now(); setOnline(true); let d; try { d = JSON.parse(m.data); } catch { return; } if (d.type !== 'heartbeat') handle(d); };
      es.onerror = () => { setOnline(false); es.close(); if (!stopped) { clearTimeout(t); t = setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); } };
    };
    connect();
    const watch = setInterval(() => { if (Date.now() - last > 40000) { setOnline(false); connect(); } }, 5000);
    const vis = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30000) connect(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stopped = true; clearInterval(watch); clearTimeout(t); document.removeEventListener('visibilitychange', vis); es?.close(); };
  }, [handle]);

  // Polling fallback for a call that came while the stream was down.
  useEffect(() => {
    if (APP) return undefined;   // the app's service polls
    const id = setInterval(async () => {
      if (activeRef.current || incomingRef.current) return;
      try { const p = await api('GET', '/pending'); if (p?.callId) setIncoming({ callId: p.callId, unitName: p.unitName, roomId: p.roomId, guestName: p.guestName }); } catch { /* next tick */ }
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const answer = useCallback(async (call) => {
    if (!call || activeRef.current) return;
    // Signals the native side received while the page was closed (the room's offer, ICE).
    try {
      const pre = JSON.parse(appCall('takeSignals', call.callId) || '[]');
      for (const s of pre) handle({ type: 'signal', callId: call.callId, payload: s });
    } catch { /* none */ }
    try { await callClient.acquireMic(); } catch { callClient.close(); setIncoming(null); setActive({ ...call, status: 'failed', error: MIC_BLOCKED }); setTimeout(() => setActive(null), 6000); return; }
    try { await api('POST', `/${call.callId}/answer`); } catch (err) { callClient.close(); setIncoming(null); setError(err.message === 'Call already answered' ? 'Someone else answered' : err.message); return; }
    setIncoming(null);
    setActive({ ...call, status: 'connecting' });
    startTimer(call.callId);
    try {
      let sdp = offers.current.get(call.callId);
      const t0 = Date.now();
      while (!sdp && Date.now() - t0 < OFFER_WAIT_MS) {
        await new Promise(r => setTimeout(r, 200));
        if (activeRef.current?.callId !== call.callId) return;
        sdp = offers.current.get(call.callId);
      }
      if (!sdp) { finish(call.callId, 'failed', CONNECT_FAILED); return; }
      const ans = await callClient.createAnswer(sdp, {
        onIceCandidate: c => api('POST', `/${call.callId}/signal`, { roomId: call.roomId, payload: { kind: 'ice', candidate: c } }).catch(() => {}),
        onConnectionStateChange: onConn(call.callId),
      });
      for (const c of ice.current.get(call.callId) || []) callClient.addIceCandidate(c);
      ice.current.delete(call.callId);
      await api('POST', `/${call.callId}/signal`, { roomId: call.roomId, payload: { kind: 'answer', sdp: ans } });
    } catch (err) { finish(call.callId, 'failed', err.micError ? MIC_BLOCKED : CONNECT_FAILED); }
  }, [handle, finish, startTimer, onConn]);

  // Opened by the app's ringing screen: ?answer=<callId>&room=…&unit=…&guest=…
  const answeredFromUrl = useRef(false);
  useEffect(() => {
    if (answeredFromUrl.current) return;
    const p = new URLSearchParams(window.location.search);
    const id = p.get('answer');
    if (!id) return;
    answeredFromUrl.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    answer({ callId: id, roomId: p.get('room'), unitName: p.get('unit') || '', guestName: p.get('guest') || null });
  }, [answer]);
  // The app can also hand over an answer while the page is open.
  useEffect(() => { window.foPhoneAnswer = (id, roomId, unitName, guestName) => answer({ callId: id, roomId, unitName, guestName }); return () => { delete window.foPhoneAnswer; }; }, [answer]);

  const callRoom = async (room) => {
    if (activeRef.current || incomingRef.current) return;
    setError('');
    try { await callClient.acquireMic(); } catch { callClient.close(); setError(MIC_BLOCKED); return; }
    let d;
    try { d = await api('POST', '/to-room', { unit_id: room.id }); } catch (err) { callClient.close(); fail(err); return; }
    setActive({ callId: d.callId, roomId: d.roomId, unitName: d.unitName, guestName: room.guest_name, status: 'calling' });
    try {
      const offer = await callClient.createOffer({
        onIceCandidate: c => api('POST', `/${d.callId}/signal`, { roomId: d.roomId, payload: { kind: 'ice', candidate: c } }).catch(() => {}),
        onConnectionStateChange: onConn(d.callId),
      });
      startTimer(d.callId);
      await api('POST', `/${d.callId}/signal`, { roomId: d.roomId, payload: { kind: 'offer', sdp: offer } });
    } catch (err) { clearTimer(); callClient.close(); setActive(null); api('POST', `/${d.callId}/end`).catch(() => {}); setError(err.message || CONNECT_FAILED); }
  };

  const hangUp = () => {
    const c = activeRef.current;
    clearTimer(); callClient.close(); setMuted(false); setActive(null);
    if (c) api('POST', `/${c.callId}/end`).catch(() => {});
  };
  const decline = () => { setIncoming(null); appCall('stopRinging'); };
  const toggleMute = () => setMuted(m => { callClient.setMuted(!m); return !m; });
  const toggleSpeaker = () => setSpeaker(s => { appCall('setSpeaker', !s); return !s; });
  const done = async (c) => { try { await api('POST', `/${c.callId}/missed-done`); loadMissed(); } catch (err) { setError(err.message); } };

  const open = missed.calls.filter(c => !c.handled);
  const handled = missed.calls.filter(c => c.handled);
  const list = (rooms || []).filter(r => !q || `${r.name} ${r.guest_name || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{me?.property?.name || 'Front desk phone'}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{me?.device?.name || ''}</div>
        </div>
        <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: online ? '#22C55E' : '#EF4444' }} />
          {online ? 'Ready for calls' : 'Not connected'}
        </div>
      </div>
      {me && !me.calling && <div style={S.error}>Calling is switched off for this hotel.</div>}
      {APP && <AppChecks />}
      {error && <div style={S.error} onClick={() => setError('')}>{error}</div>}

      {incoming && !active && (
        <div style={S.overlay}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: '#FCA5A5', fontWeight: 700 }}>ROOM CALLING</div>
          <div style={{ fontSize: 46, fontWeight: 800, marginTop: 6 }}>Room {incoming.unitName}</div>
          {incoming.guestName && <div style={{ fontSize: 18, opacity: 0.85 }}>{incoming.guestName}</div>}
          <div style={{ display: 'flex', gap: 40, marginTop: 50 }}>
            <button onClick={decline} style={{ ...S.round, background: '#DC2626' }} aria-label="Not now">✕</button>
            <button onClick={() => answer(incoming)} style={{ ...S.round, background: '#16A34A' }} aria-label="Answer">📞</button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 18 }}>✕ silences this phone only — the front desk PC keeps ringing.</div>
        </div>
      )}

      {active && (
        <div style={S.overlay}>
          <div style={{ fontSize: 13, letterSpacing: 2, fontWeight: 700, color: active.status === 'connected' ? '#86EFAC' : active.status === 'failed' ? '#FCA5A5' : '#FDE68A' }}>
            {active.status === 'calling' ? 'CALLING…' : active.status === 'connecting' ? 'CONNECTING…' : active.status === 'connected' ? <>ON A CALL · <Timer /></> : active.status === 'failed' ? 'CALL FAILED' : 'CALL ENDED'}
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, marginTop: 6 }}>Room {active.unitName}</div>
          {active.guestName && <div style={{ fontSize: 18, opacity: 0.85 }}>{active.guestName}</div>}
          {active.error && <div style={{ color: '#FCA5A5', marginTop: 12 }}>{active.error}</div>}
          {['calling', 'connecting', 'connected'].includes(active.status) && (
            <div style={{ display: 'flex', gap: 28, marginTop: 50, alignItems: 'center' }}>
              <button onClick={toggleMute} style={{ ...S.roundSm, background: muted ? '#F59E0B' : 'rgba(255,255,255,0.15)' }}>{muted ? '🔇' : '🎙'}<div style={S.roundLabel}>{muted ? 'Muted' : 'Mute'}</div></button>
              <button onClick={hangUp} style={{ ...S.round, background: '#DC2626' }} aria-label="Hang up">✕</button>
              {APP && <button onClick={toggleSpeaker} style={{ ...S.roundSm, background: speaker ? '#2563EB' : 'rgba(255,255,255,0.15)' }}>🔊<div style={S.roundLabel}>Speaker</div></button>}
            </div>
          )}
        </div>
      )}

      {missed.calls.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.title, color: open.length ? '#DC2626' : '#6B7280' }}>Missed calls{open.length ? ` · ${open.length} to call back` : ' · all called back'}</div>
          {open.map(c => (
            <div key={c.callId} style={S.missedRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>Room {c.unitName}{c.guestName ? <span style={{ fontWeight: 400, color: '#6B7280' }}> · {c.guestName}</span> : null}</div>
                <div style={{ fontSize: 13, color: '#6B7280' }}>{hm(c.at)} · {ago(c.at)}</div>
              </div>
              <button style={{ ...S.btn, ...S.primary }} onClick={() => { const r = (rooms || []).find(x => x.id === c.unitId); if (r) callRoom(r); }}>📞 Call back</button>
              <button style={S.btn} onClick={() => done(c)}>Done</button>
            </div>
          ))}
          {handled.map(c => (
            <div key={c.callId} style={{ fontSize: 13, color: '#9CA3AF', padding: '4px 0' }}>Room {c.unitName} · missed {hm(c.at)} — {HOW[c.handled.how]} {hm(c.handled.at)}{c.handled.by ? ` · ${c.handled.by}` : ''}</div>
          ))}
        </div>
      )}

      <div style={S.card}>
        <div style={S.title}>Call a room</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Room or guest name" style={S.input} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, marginTop: 10 }}>
          {!rooms && <div style={{ color: '#6B7280' }}>Loading…</div>}
          {list.map(r => (
            <button key={r.id} onClick={() => callRoom(r)} disabled={!!active}
              style={{ textAlign: 'left', padding: '10px 10px', borderRadius: 12, border: `1px solid ${r.guest_name ? '#B45309' : '#E5E7EB'}`,
                background: r.guest_name ? '#FEF3C7' : '#fff', fontFamily: 'inherit' }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.guest_name || 'No guest'}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Inside the app: what still needs setting on this phone (permissions, battery).
function AppChecks() {
  const [checks, setChecks] = useState([]);
  const load = () => { try { setChecks(JSON.parse(appCall('checks') || '[]')); } catch { setChecks([]); } };
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  const todo = checks.filter(c => !c.ok);
  if (!todo.length) return null;
  return (
    <div style={{ ...S.card, borderColor: '#F59E0B', background: '#FFFBEB' }}>
      <div style={{ ...S.title, color: '#B45309' }}>Finish setting up this phone</div>
      {todo.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <div style={{ flex: 1, fontSize: 14 }}>{c.label}</div>
          <button style={{ ...S.btn, ...S.primary }} onClick={() => { appCall('fix', c.id); }}>Fix</button>
        </div>
      ))}
    </div>
  );
}

function Timer() {
  const [s, setS] = useState(0);
  useEffect(() => { const id = setInterval(() => setS(x => x + 1), 1000); return () => clearInterval(id); }, []);
  return <>{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</>;
}

const S = {
  page: { minHeight: '100vh', background: '#F3F4F6', fontFamily: 'Inter, system-ui, sans-serif', color: '#111827', paddingBottom: 30 },
  header: { background: '#5B1A2E', color: '#fff', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 5 },
  card: { background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', margin: '12px 12px 0', padding: 14 },
  title: { fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  muted: { color: '#6B7280', fontSize: 14 },
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 12px', borderRadius: 10, border: '1px solid #D1D5DB', fontSize: 16, fontFamily: 'inherit' },
  btn: { padding: '10px 14px', borderRadius: 10, border: '1px solid #D1D5DB', background: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' },
  primary: { background: '#5B1A2E', color: '#fff', border: 'none' },
  error: { background: '#FEE2E2', color: '#991B1B', margin: '12px 12px 0', padding: '10px 12px', borderRadius: 10, fontSize: 14 },
  missedRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10, background: '#FEF2F2', marginBottom: 8 },
  overlay: { position: 'fixed', inset: 0, zIndex: 20, background: '#1F2937', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20 },
  round: { width: 78, height: 78, borderRadius: '50%', border: 'none', color: '#fff', fontSize: 30 },
  roundSm: { width: 62, height: 62, borderRadius: '50%', border: 'none', color: '#fff', fontSize: 22, position: 'relative' },
  roundLabel: { position: 'absolute', top: 68, left: -10, right: -10, fontSize: 11, color: '#D1D5DB' },
};
