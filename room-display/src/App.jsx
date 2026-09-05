import { useState, useEffect, useCallback, useRef } from 'react';
import api from './api';
import callClient from './callClient';
import ringtone from './ringtone';
import alarmSound from './alarm';
import notification from './notification';
import { applyAccent } from './theme';
import SetupScreen from './screens/SetupScreen';
import IdleScreen from './screens/IdleScreen';
import GuestScreen from './screens/GuestScreen';
import DebugMenu from './components/DebugMenu';
import UpdatePrompt from './components/UpdatePrompt';
import InstallPrompt from './components/InstallPrompt';
import CallOverlay from './components/CallOverlay';
import AlarmOverlay from './components/AlarmOverlay';
import MessageOverlay from './components/MessageOverlay';
import useResilientEventSource from './useResilientEventSource';

const POLL_MS = 10_000;
const END_TOAST_MS = 2500;
const DEBUG_CLICK_THRESHOLD = 5;
const DEBUG_CLICK_TIMEOUT = 3000;
const CONNECTING_TIMEOUT_MS = 25_000;
const OFFER_WAIT_MS = 5_000;
const CONNECT_FAILED_MESSAGE = 'Could not connect — please try again';

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
  const pendingOfferRef = useRef(null);
  const connectingTimeoutRef = useRef(null);

  // Alarm — a local, on-device wake-up (no staff/front-desk call involved).
  // Device-local, same convention as roomId/displayToken. One-shot: rings
  // once at the set time, then auto-disables.
  const [alarmTime, setAlarmTime] = useState(() => localStorage.getItem('alarmTime') || '');
  const [alarmEnabled, setAlarmEnabled] = useState(() => localStorage.getItem('alarmEnabled') === 'true');
  const [alarmRinging, setAlarmRinging] = useState(false);
  const alarmFiredKeyRef = useRef(null);

  useEffect(() => {
    if (callState.status === 'incoming') ringtone.start();
    else ringtone.stop();
    return () => ringtone.stop();
  }, [callState.status]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      const key = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      if (alarmEnabled && key === alarmTime) {
        if (alarmFiredKeyRef.current !== key) {
          alarmFiredKeyRef.current = key;
          setAlarmRinging(true);
          alarmSound.start();
        }
      } else {
        alarmFiredKeyRef.current = null;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [alarmEnabled, alarmTime]);

  const handleSetAlarm = useCallback((time, enabled) => {
    setAlarmTime(time);
    setAlarmEnabled(enabled);
    localStorage.setItem('alarmTime', time);
    localStorage.setItem('alarmEnabled', String(enabled));
  }, []);

  const handleDismissAlarm = useCallback(() => {
    setAlarmRinging(false);
    alarmSound.stop();
    handleSetAlarm(alarmTime, false);
  }, [alarmTime, handleSetAlarm]);

  // Per-property accent — reapplied whenever branding changes
  useEffect(() => {
    if (state?.property?.brand_color) applyAccent(state.property.brand_color);
  }, [state?.property?.brand_color]);

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

      // Polling fallback for the calls SSE stream — adopts an incoming call
      // the poll found that we don't already know about, in case the calls
      // stream died silently and never delivered its own push. Guarded by
      // callIdRef (not callState.status) so this stays correct without
      // needing callState as a fetchState dependency.
      if (data.incomingCall && callIdRef.current !== data.incomingCall.callId) {
        callIdRef.current = data.incomingCall.callId;
        setCallState({ status: 'incoming', callId: data.incomingCall.callId, staffName: data.incomingCall.staffName });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Connection error');
    }
  }, [roomId, displayToken]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  const stateStreamUrl = (roomId && displayToken)
    ? `/api/display/room/${roomId}/stream?token=${encodeURIComponent(displayToken)}`
    : null;
  useResilientEventSource(stateStreamUrl, () => fetchState());

  // Front-desk message — full-screen until dismissed, oldest-unread served
  // first by the backend so a burst of sends doesn't skip any of them.
  const [dismissingMessage, setDismissingMessage] = useState(false);
  const lastMessageIdRef = useRef(null);
  useEffect(() => {
    const id = state?.message?.id || null;
    if (id && id !== lastMessageIdRef.current) notification.play();
    lastMessageIdRef.current = id;
  }, [state?.message?.id]);
  const handleDismissMessage = useCallback(async () => {
    if (!state?.message) return;
    setDismissingMessage(true);
    try {
      await api.post(`/display/room/${roomId}/message/${state.message.id}/dismiss`);
    } catch { /* best-effort — stays unread server-side, next poll retries naturally */ }
    setDismissingMessage(false);
    fetchState();
  }, [state?.message, roomId, fetchState]);

  const clearConnectingTimeout = useCallback(() => {
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
      connectingTimeoutRef.current = null;
    }
  }, []);

  const endCallLocally = useCallback((finalStatus, errorMessage) => {
    clearConnectingTimeout();
    callClient.close();
    callIdRef.current = null;
    pendingOfferRef.current = null;
    setMuted(false);
    setCallState({ status: finalStatus, callId: null, error: errorMessage });
    setTimeout(() => setCallState({ status: 'idle', callId: null }), END_TOAST_MS);
  }, [clearConnectingTimeout]);

  // Bounds how long a call may sit in 'calling'/'connecting' before ICE
  // negotiation is considered a lost cause — otherwise a failed negotiation
  // that never fires 'failed'/'disconnected' (seen in practice on some
  // networks) leaves the overlay stuck on "Connecting…" forever.
  const startConnectingTimeout = useCallback((id) => {
    clearConnectingTimeout();
    connectingTimeoutRef.current = setTimeout(() => {
      if (callIdRef.current === id) {
        endCallLocally('failed', CONNECT_FAILED_MESSAGE);
      }
    }, CONNECTING_TIMEOUT_MS);
  }, [clearConnectingTimeout, endCallLocally]);

  // Call signaling — separate SSE channel from the room-state one above,
  // since call payloads carry real data rather than a "go refetch" ping.
  const callsStreamUrl = (roomId && displayToken)
    ? `/api/calls/room/${roomId}/stream?token=${encodeURIComponent(displayToken)}`
    : null;
  useResilientEventSource(callsStreamUrl, (msg) => {
    if (msg.type === 'incoming_call_from_staff') {
      if (callIdRef.current) return; // already on/ringing a call — ignore
      callIdRef.current = msg.callId;
      setCallState({ status: 'incoming', callId: msg.callId, staffName: msg.staffName });
      return;
    }

    if (!msg.callId || msg.callId !== callIdRef.current) return;

    if (msg.type === 'signal' && msg.payload?.kind === 'offer') {
      pendingOfferRef.current = msg.payload.sdp;
    } else if (msg.type === 'signal' && msg.payload?.kind === 'answer') {
      callClient.handleAnswer(msg.payload.sdp);
    } else if (msg.type === 'signal' && msg.payload?.kind === 'ice') {
      callClient.addIceCandidate(msg.payload.candidate);
    } else if (msg.type === 'ended' || msg.type === 'missed') {
      endCallLocally(msg.type);
    }
  });

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
            clearConnectingTimeout();
            setCallState({ status: 'connected', callId: data.callId });
          } else if (['failed', 'disconnected', 'closed'].includes(connState) && callIdRef.current === data.callId) {
            endCallLocally('failed', CONNECT_FAILED_MESSAGE);
          }
        },
      });
      startConnectingTimeout(data.callId);
      await api.post(`/calls/${data.callId}/signal-from-room`, { payload: { kind: 'offer', sdp: offer } });
    } catch (err) {
      console.error('[Call] place call failed:', err);
      clearConnectingTimeout();
      callClient.close();
      callIdRef.current = null;
      setCallState({ status: 'failed', callId: null, error: err.response?.data?.error || err.message || 'Call failed' });
      setTimeout(() => setCallState({ status: 'idle', callId: null }), END_TOAST_MS);
    }
  }, [roomId, callState.status, endCallLocally, startConnectingTimeout, clearConnectingTimeout]);

  const handleCancelCall = useCallback(async () => {
    const id = callIdRef.current;
    clearConnectingTimeout();
    callClient.close();
    callIdRef.current = null;
    pendingOfferRef.current = null;
    setCallState({ status: 'idle', callId: null });
    if (id) { try { await api.post(`/calls/${id}/end-from-room`); } catch {} }
  }, [clearConnectingTimeout]);

  const handleHangup = useCallback(async () => {
    const id = callIdRef.current;
    endCallLocally('ended');
    if (id) { try { await api.post(`/calls/${id}/end-from-room`); } catch {} }
  }, [endCallLocally]);

  // Guest answers a call placed by staff — mirrors CallContext.jsx's
  // answerCall on the staff side. The offer may not have arrived yet (it's
  // sent async, right after the ring notification), so poll briefly rather
  // than silently no-op — a human tapping Answer is almost always faster
  // than the offer, but a slow signal shouldn't leave the call stuck.
  const handleAnswerIncoming = useCallback(async () => {
    const id = callIdRef.current;
    if (!id || callState.status !== 'incoming') return;
    try {
      await api.post(`/calls/${id}/answer-from-room`);
      setCallState(prev => (prev.callId === id ? { ...prev, status: 'connecting' } : prev));

      let offerSdp = pendingOfferRef.current;
      const pollStart = Date.now();
      while (!offerSdp && Date.now() - pollStart < OFFER_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (callIdRef.current !== id) return; // call ended/cancelled while waiting
        offerSdp = pendingOfferRef.current;
      }
      if (!offerSdp) {
        endCallLocally('failed', CONNECT_FAILED_MESSAGE);
        return;
      }

      const answer = await callClient.createAnswer(offerSdp, {
        onIceCandidate: (candidate) => {
          api.post(`/calls/${id}/signal-from-room`, { payload: { kind: 'ice', candidate } }).catch(() => {});
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'connected' && callIdRef.current === id) {
            clearConnectingTimeout();
            setCallState(prev => (prev.callId === id ? { ...prev, status: 'connected' } : prev));
          } else if (['failed', 'disconnected', 'closed'].includes(connState) && callIdRef.current === id) {
            endCallLocally('failed', CONNECT_FAILED_MESSAGE);
          }
        },
      });
      startConnectingTimeout(id);
      await api.post(`/calls/${id}/signal-from-room`, { payload: { kind: 'answer', sdp: answer } });
    } catch (err) {
      console.error('[Call] answer failed:', err);
      endCallLocally('failed', CONNECT_FAILED_MESSAGE);
    }
  }, [callState.status, endCallLocally, startConnectingTimeout, clearConnectingTimeout]);

  const handleMuteToggle = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      callClient.setMuted(next);
      return next;
    });
  }, []);

  if (!roomId || !displayToken) {
    return (
      <>
        <SetupScreen onSetup={handleSetup} />
        <InstallPrompt />
      </>
    );
  }

  if (error && !state) {
    return (
      <>
        <div className="w-screen h-dvh flex flex-col items-center justify-center bg-app-deep gap-4">
          <img
            src="/logo.png" alt=""
            style={{ width: 64, height: 64, objectFit: 'contain', opacity: 0.3, cursor: 'pointer' }}
            onClick={handleDebugClick}
          />
          <p className="text-xs uppercase tracking-[0.3em] text-faint">{error}</p>
          <p className="text-[10px] text-ghost uppercase tracking-widest">Room {roomId}</p>
        </div>
        {showDebugMenu && (
          <DebugMenu
            onLogout={handleLogout}
            onChangeRoom={handleChangeRoom}
            onClose={() => setShowDebugMenu(false)}
          />
        )}
      </>
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
          property={state.property}
          roomId={roomId}
          online={!error}
          roomControllerEnabled={state.roomControllerEnabled}
          callingEnabled={state.callingEnabled}
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
          onAnswer={handleAnswerIncoming}
          onHangup={handleHangup}
          onMuteToggle={handleMuteToggle}
          muted={muted}
        />
        <MessageOverlay message={state.message} dismissing={dismissingMessage} onDismiss={handleDismissMessage} />
        <UpdatePrompt />
        <InstallPrompt />
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
        property={state.property}
        roomId={roomId}
        online={!error}
        weather={state.weather}
        cards={state.cards || []}
        orderingEnabled={state.orderingEnabled}
        activitiesEnabled={state.activitiesEnabled}
        roomControllerEnabled={state.roomControllerEnabled}
        callingEnabled={state.callingEnabled}
        operationsEnabled={state.operationsEnabled}
        onRefresh={fetchState}
        onDebugClick={handleDebugClick}
        onCallFrontDesk={handlePlaceCall}
        callActive={callState.status !== 'idle'}
        alarmTime={alarmTime}
        alarmEnabled={alarmEnabled}
        onSetAlarm={handleSetAlarm}
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
        onAnswer={handleAnswerIncoming}
        onHangup={handleHangup}
        onMuteToggle={handleMuteToggle}
        muted={muted}
      />
      <AlarmOverlay ringing={alarmRinging} time={alarmTime} onDismiss={handleDismissAlarm} />
      <MessageOverlay message={state.message} dismissing={dismissingMessage} onDismiss={handleDismissMessage} />
      <UpdatePrompt />
      <InstallPrompt />
    </>
  );
}
