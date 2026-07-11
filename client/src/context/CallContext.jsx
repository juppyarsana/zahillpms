import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import callClient from '../services/callClient';
import ringtone from '../services/ringtone';
import { useAuth } from './AuthContext';

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null); // { callId, unitName, roomId }
  const [activeCall, setActiveCall] = useState(null);     // { callId, roomId, status: 'connecting'|'connected' }
  const [muted, setMuted] = useState(false);

  const pendingOffers = useRef(new Map());   // callId -> offer sdp
  const pendingIce = useRef(new Map());      // callId -> [candidates]
  const activeCallRef = useRef(null);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

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
        setIncomingCall({ callId: msg.callId, unitName: msg.unitName, roomId: msg.roomId });
      } else if (msg.type === 'signal' && msg.payload?.kind === 'offer') {
        pendingOffers.current.set(msg.callId, msg.payload.sdp);
      } else if (msg.type === 'signal' && msg.payload?.kind === 'ice') {
        if (activeCallRef.current?.callId === msg.callId) {
          callClient.addIceCandidate(msg.payload.candidate);
        } else {
          const list = pendingIce.current.get(msg.callId) || [];
          list.push(msg.payload.candidate);
          pendingIce.current.set(msg.callId, list);
        }
      } else if (msg.type === 'call_taken' || msg.type === 'missed') {
        setIncomingCall(prev => (prev?.callId === msg.callId ? null : prev));
      } else if (msg.type === 'ended') {
        setIncomingCall(prev => (prev?.callId === msg.callId ? null : prev));
        setActiveCall(prev => {
          if (prev?.callId !== msg.callId) return prev;
          callClient.close();
          setMuted(false);
          return null;
        });
      }
    };
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, [user]);

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
    setActiveCall({ callId, roomId: call.roomId, unitName: call.unitName, status: 'connecting' });

    const offerSdp = pendingOffers.current.get(callId);
    pendingOffers.current.delete(callId);
    if (!offerSdp) return;

    const answerSdp = await callClient.createAnswer(offerSdp, {
      onIceCandidate: (candidate) => {
        api.post(`/api/calls/${callId}/signal`, { roomId: call.roomId, payload: { kind: 'ice', candidate } }).catch(() => {});
      },
      onConnectionStateChange: (connState) => {
        if (connState === 'connected') {
          setActiveCall(prev => (prev?.callId === callId ? { ...prev, status: 'connected' } : prev));
        }
      },
    });

    for (const candidate of pendingIce.current.get(callId) || []) {
      callClient.addIceCandidate(candidate);
    }
    pendingIce.current.delete(callId);

    await api.post(`/api/calls/${callId}/signal`, { roomId: call.roomId, payload: { kind: 'answer', sdp: answerSdp } });
  }, [incomingCall]);

  const dismissIncoming = useCallback(() => setIncomingCall(null), []);

  const endCall = useCallback(async () => {
    const call = activeCallRef.current;
    callClient.close();
    setMuted(false);
    setActiveCall(null);
    if (call) { try { await api.post(`/api/calls/${call.callId}/end`); } catch {} }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      callClient.setMuted(next);
      return next;
    });
  }, []);

  return (
    <CallContext.Provider value={{ incomingCall, activeCall, muted, answerCall, dismissIncoming, endCall, toggleMute }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
