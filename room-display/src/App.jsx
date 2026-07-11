import { useState, useEffect, useCallback, useRef } from 'react';
import api from './api';
import callClient from './callClient';
import SetupScreen from './screens/SetupScreen';
import IdleScreen from './screens/IdleScreen';
import GuestScreen from './screens/GuestScreen';
import DebugMenu from './components/DebugMenu';
import UpdatePrompt from './components/UpdatePrompt';
import CallOverlay from './components/CallOverlay';

const POLL_MS = 10_000;
const END_TOAST_MS = 2500;
const DEBUG_CLICK_THRESHOLD = 5;
const DEBUG_CLICK_TIMEOUT = 3000;

export default function App() {
  const [roomId, setRoomId] = useState(() => localStorage.getItem('roomId'));
  const [displayToken, setDisplayToken] = useState(() => localStorage.getItem('displayToken'));
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [debugClicks, setDebugClicks] = useState(0);
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const debugTimeoutRef = useCallback(() => setDebugClicks(0), []);

  const [callState, setCallState] = useState({ status: 'idle', callId: null });
  const [muted, setMuted] = useState(false);
  const callIdRef = useRef(null);

  const handleDebugClick = useCallback(() => {
    setDebugClicks(prev => {
      const newCount = prev + 1;
      if (newCount >= DEBUG_CLICK_THRESHOLD) {
        setShowDebugMenu(true);
        return 0;
      }
      // Auto-reset after timeout
      setTimeout(() => setDebugClicks(0), DEBUG_CLICK_TIMEOUT);
      return newCount;
    });
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('roomId');
    localStorage.removeItem('displayToken');
    setRoomId(null);
    setDisplayToken(null);
    setShowDebugMenu(false);
  }, []);

  const handleChangeRoom = useCallback((newRoomId) => {
    localStorage.setItem('roomId', newRoomId);
    setRoomId(newRoomId);
    setShowDebugMenu(false);
  }, []);

  const handleSetup = useCallback((id, token) => {
    localStorage.setItem('roomId', id);
    localStorage.setItem('displayToken', token);
    setRoomId(id);
    setDisplayToken(token);
  }, []);

  const fetchState = useCallback(async () => {
    if (!roomId || !displayToken) return;
    try {
      const { data } = await api.get(`/display/room/${roomId}/state`);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Connection error');
    }
  }, [roomId, displayToken]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_MS);

    // SSE for instant updates — falls back to polling silently on error
    const evtSource = new EventSource(
      `/api/display/room/${roomId}/stream?token=${encodeURIComponent(displayToken)}`
    );
    evtSource.onmessage = () => fetchState();
    evtSource.onerror = () => {};

    return () => {
      clearInterval(id);
      evtSource.close();
    };
  }, [fetchState]);

  const endCallLocally = useCallback((finalStatus) => {
    callClient.close();
    callIdRef.current = null;
    setMuted(false);
    setCallState({ status: finalStatus, callId: null });
    setTimeout(() => setCallState({ status: 'idle', callId: null }), END_TOAST_MS);
  }, []);

  // Call signaling — separate SSE channel from the room-state one above,
  // since call payloads carry real data rather than a "go refetch" ping.
  useEffect(() => {
    if (!roomId || !displayToken) return;
    const evtSource = new EventSource(
      `/api/calls/room/${roomId}/stream?token=${encodeURIComponent(displayToken)}`
    );
    evtSource.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg.callId || msg.callId !== callIdRef.current) return;

      if (msg.type === 'signal' && msg.payload?.kind === 'answer') {
        callClient.handleAnswer(msg.payload.sdp);
      } else if (msg.type === 'signal' && msg.payload?.kind === 'ice') {
        callClient.addIceCandidate(msg.payload.candidate);
      } else if (msg.type === 'ended' || msg.type === 'missed') {
        endCallLocally(msg.type);
      }
    };
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, [roomId, displayToken, endCallLocally]);

  const handlePlaceCall = useCallback(async () => {
    if (callState.status !== 'idle') return;
    try {
      const { data } = await api.post('/calls', { roomId });
      callIdRef.current = data.callId;
      setCallState({ status: 'calling', callId: data.callId });

      const offer = await callClient.createOffer({
        onIceCandidate: (candidate) => {
          api.post(`/calls/${data.callId}/signal-from-room`, { payload: { kind: 'ice', candidate } }).catch(() => {});
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'connected' && callIdRef.current === data.callId) {
            setCallState({ status: 'connected', callId: data.callId });
          }
        },
      });
      await api.post(`/calls/${data.callId}/signal-from-room`, { payload: { kind: 'offer', sdp: offer } });
    } catch (err) {
      console.error('[Call] place call failed:', err);
      callClient.close();
      callIdRef.current = null;
      setCallState({ status: 'failed', callId: null, error: err.response?.data?.error || err.message || 'Call failed' });
      setTimeout(() => setCallState({ status: 'idle', callId: null }), END_TOAST_MS);
    }
  }, [roomId, callState.status]);

  const handleCancelCall = useCallback(async () => {
    const id = callIdRef.current;
    callClient.close();
    callIdRef.current = null;
    setCallState({ status: 'idle', callId: null });
    if (id) { try { await api.post(`/calls/${id}/end-from-room`); } catch {} }
  }, []);

  const handleHangup = useCallback(async () => {
    const id = callIdRef.current;
    endCallLocally('ended');
    if (id) { try { await api.post(`/calls/${id}/end-from-room`); } catch {} }
  }, [endCallLocally]);

  const handleMuteToggle = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      callClient.setMuted(next);
      return next;
    });
  }, []);

  if (!roomId || !displayToken) {
    return <SetupScreen onSetup={handleSetup} />;
  }

  if (error && !state) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-bg-dark gap-4">
        <img src="/logo.png" alt="Zahill" style={{ width: 64, height: 64, objectFit: 'contain', opacity: 0.3 }} />
        <p className="text-xs uppercase tracking-[0.3em] text-slate-600">{error}</p>
        <p className="text-[10px] text-slate-700 uppercase tracking-widest">Room {roomId}</p>
      </div>
    );
  }

  if (!state) return null;

  if (!state.booking) {
    return (
      <>
        <IdleScreen
          unit={state.unit}
          controller={state.controller}
          relays={state.relays}
          roomId={roomId}
          onRefresh={fetchState}
          onDebugClick={handleDebugClick}
          onCallFrontDesk={handlePlaceCall}
          callActive={callState.status !== 'idle'}
        />
        {showDebugMenu && (
          <DebugMenu
            onLogout={handleLogout}
            onChangeRoom={handleChangeRoom}
            onClose={() => setShowDebugMenu(false)}
          />
        )}
        <CallOverlay
          callState={callState}
          onCancel={handleCancelCall}
          onHangup={handleHangup}
          onMuteToggle={handleMuteToggle}
          muted={muted}
        />
        <UpdatePrompt />
      </>
    );
  }

  return (
    <>
      <GuestScreen
        unit={state.unit}
        booking={state.booking}
        relays={state.relays}
        controller={state.controller}
        roomId={roomId}
        weather={state.weather}
        cards={state.cards || []}
        onRefresh={fetchState}
        onDebugClick={handleDebugClick}
        onCallFrontDesk={handlePlaceCall}
        callActive={callState.status !== 'idle'}
      />
      {showDebugMenu && (
        <DebugMenu
          onLogout={handleLogout}
          onChangeRoom={handleChangeRoom}
          onClose={() => setShowDebugMenu(false)}
        />
      )}
      <CallOverlay
        callState={callState}
        onCancel={handleCancelCall}
        onHangup={handleHangup}
        onMuteToggle={handleMuteToggle}
        muted={muted}
      />
      <UpdatePrompt />
    </>
  );
}
