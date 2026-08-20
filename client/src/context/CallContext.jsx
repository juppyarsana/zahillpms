import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import callClient from '../services/callClient';
import ringtone from '../services/ringtone';
import { useAuth } from './AuthContext';

const CallContext = createContext(null);

const CONNECTING_TIMEOUT_MS = 25_000;
const OFFER_WAIT_MS = 5_000;
const END_TOAST_MS = 2500;
const CONNECT_FAILED_MESSAGE = 'Could not connect — please try again';

export function CallProvider({ children }) {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null); // { callId, unitName, roomId }
  const [activeCall, setActiveCall] = useState(null);     // { callId, roomId, status: 'connecting'|'connected' }
  const [muted, setMuted] = useState(false);

  const pendingOffers = useRef(new Map());   // callId -> offer sdp
  const pendingIce = useRef(new Map());      // callId -> [candidates]
  const activeCallRef = useRef(null);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  const connectingTimeoutRef = useRef(null);

  const clearConnectingTimeout = useCallback(() => {
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
      connectingTimeoutRef.current = null;
    }
  }, []);

  // Mirrors the room-display side (App.jsx): a call stuck in
  // 'calling'/'connecting' past the timeout below, or one whose peer
  // connection reports failed/disconnected, is treated as a lost cause and
  // surfaced as a brief 'failed' banner instead of hanging forever.
  const endCallLocally = useCallback((callId, finalStatus, errorMessage) => {
    clearConnectingTimeout();
    callClient.close();
    setMuted(false);
    pendingOffers.current.delete(callId);
    pendingIce.current.delete(callId);
    setActiveCall(prev => (prev?.callId === callId ? { ...prev, status: finalStatus, error: errorMessage } : prev));
    setTimeout(() => {
      setActiveCall(prev => (prev?.callId === callId ? null : prev));
    }, END_TOAST_MS);
  }, [clearConnectingTimeout]);

  const startConnectingTimeout = useCallback((callId) => {
    clearConnectingTimeout();
    connectingTimeoutRef.current = setTimeout(() => {
      if (activeCallRef.current?.callId === callId) {
        endCallLocally(callId, 'failed', CONNECT_FAILED_MESSAGE);
      }
    }, CONNECTING_TIMEOUT_MS);
  }, [clearConnectingTimeout, endCallLocally]);

  useEffect(() => {
    if (incomingCall) ringtone.start();
    else ringtone.stop();
    return () => ringtone.stop();
  }, [incomingCall]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    const evtSource = new EventSource(`/api/calls/staff/stream?token=${encodeURIComponent(token)}`);

    evtSource.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'incoming_call') {
        setIncomingCall({ callId: msg.callId, unitName: msg.unitName, roomId: msg.roomId, guestName: msg.guestName });
      } else if (msg.type === 'signal' && msg.payload?.kind === 'offer') {
        pendingOffers.current.set(msg.callId, msg.payload.sdp);
      } else if (msg.type === 'signal' && msg.payload?.kind === 'answer') {
        if (activeCallRef.current?.callId === msg.callId) callClient.handleAnswer(msg.payload.sdp);
      } else if (msg.type === 'signal' && msg.payload?.kind === 'ice') {
        if (activeCallRef.current?.callId === msg.callId) {
          callClient.addIceCandidate(msg.payload.candidate);
        } else {
          const list = pendingIce.current.get(msg.callId) || [];
          list.push(msg.payload.candidate);
          pendingIce.current.set(msg.callId, list);
        }
      } else if (msg.type === 'answered_from_room') {
        setActiveCall(prev => (prev?.callId === msg.callId && prev.status === 'calling' ? { ...prev, status: 'connecting' } : prev));
      } else if (msg.type === 'call_taken') {
        setIncomingCall(prev => (prev?.callId === msg.callId ? null : prev));
      } else if (msg.type === 'ended' || msg.type === 'missed') {
        setIncomingCall(prev => (prev?.callId === msg.callId ? null : prev));
        setActiveCall(prev => {
          if (prev?.callId !== msg.callId) return prev;
          clearConnectingTimeout();
          callClient.close();
          setMuted(false);
          return null;
        });
      }
    };
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, [user, clearConnectingTimeout]);

  const answerCall = useCallback(async (callId) => {
    const call = incomingCall;
    if (!call || call.callId !== callId) return;
    try {
      await api.post(`/api/calls/${callId}/answer`);
    } catch {
      setIncomingCall(prev => (prev?.callId === callId ? null : prev));
      return;
    }

    setIncomingCall(null);
    setActiveCall({ callId, roomId: call.roomId, unitName: call.unitName, guestName: call.guestName, status: 'connecting' });

    // Offer is sent async right after the ring notification — poll briefly
    // rather than silently no-op, so a slow signal doesn't leave the call
    // stuck (mirrors room-display App.jsx's handleAnswerIncoming).
    let offerSdp = pendingOffers.current.get(callId);
    const pollStart = Date.now();
    while (!offerSdp && Date.now() - pollStart < OFFER_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (activeCallRef.current?.callId !== callId) return; // call ended/cancelled while waiting
      offerSdp = pendingOffers.current.get(callId);
    }
    if (!offerSdp) {
      endCallLocally(callId, 'failed', CONNECT_FAILED_MESSAGE);
      return;
    }
    pendingOffers.current.delete(callId);

    const answerSdp = await callClient.createAnswer(offerSdp, {
      onIceCandidate: (candidate) => {
        api.post(`/api/calls/${callId}/signal`, { roomId: call.roomId, payload: { kind: 'ice', candidate } }).catch(() => {});
      },
      onConnectionStateChange: (connState) => {
        if (connState === 'connected') {
          clearConnectingTimeout();
          setActiveCall(prev => (prev?.callId === callId ? { ...prev, status: 'connected' } : prev));
        } else if (['failed', 'disconnected', 'closed'].includes(connState)) {
          endCallLocally(callId, 'failed', CONNECT_FAILED_MESSAGE);
        }
      },
    });
    startConnectingTimeout(callId);

    for (const candidate of pendingIce.current.get(callId) || []) {
      callClient.addIceCandidate(candidate);
    }
    pendingIce.current.delete(callId);

    await api.post(`/api/calls/${callId}/signal`, { roomId: call.roomId, payload: { kind: 'answer', sdp: answerSdp } });
  }, [incomingCall, endCallLocally, startConnectingTimeout, clearConnectingTimeout]);

  const dismissIncoming = useCallback(() => setIncomingCall(null), []);

  // Staff places a call to a specific room. Mirrors the room's own outgoing
  // call flow (App.jsx's handlePlaceCall) — offer created immediately, mic
  // requested up front, connectionstatechange drives 'calling' -> 'connected'.
  const callRoom = useCallback(async (unit) => {
    if (activeCallRef.current || incomingCall) throw new Error('Already on a call');
    const { data } = await api.post('/api/calls/to-room', { unitId: unit.id });
    setActiveCall({ callId: data.callId, roomId: data.roomId, unitName: data.unitName, status: 'calling' });

    try {
      const offer = await callClient.createOffer({
        onIceCandidate: (candidate) => {
          api.post(`/api/calls/${data.callId}/signal`, { roomId: data.roomId, payload: { kind: 'ice', candidate } }).catch(() => {});
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'connected') {
            clearConnectingTimeout();
            setActiveCall(prev => (prev?.callId === data.callId ? { ...prev, status: 'connected' } : prev));
          } else if (['failed', 'disconnected', 'closed'].includes(connState)) {
            endCallLocally(data.callId, 'failed', CONNECT_FAILED_MESSAGE);
          }
        },
      });
      startConnectingTimeout(data.callId);
      await api.post(`/api/calls/${data.callId}/signal`, { roomId: data.roomId, payload: { kind: 'offer', sdp: offer } });
    } catch (err) {
      clearConnectingTimeout();
      callClient.close();
      setActiveCall(null);
      try { await api.post(`/api/calls/${data.callId}/end`); } catch {}
      throw err;
    }
  }, [incomingCall, endCallLocally, startConnectingTimeout, clearConnectingTimeout]);

  const endCall = useCallback(async () => {
    const call = activeCallRef.current;
    clearConnectingTimeout();
    callClient.close();
    setMuted(false);
    setActiveCall(null);
    if (call) { try { await api.post(`/api/calls/${call.callId}/end`); } catch {} }
  }, [clearConnectingTimeout]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      callClient.setMuted(next);
      return next;
    });
  }, []);

  return (
    <CallContext.Provider value={{ incomingCall, activeCall, muted, answerCall, dismissIncoming, endCall, toggleMute, callRoom }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
