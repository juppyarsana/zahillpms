import { useState, useEffect, useCallback } from 'react';
import api from './api';
import SetupScreen from './screens/SetupScreen';
import IdleScreen from './screens/IdleScreen';
import GuestScreen from './screens/GuestScreen';

const POLL_MS = 10_000;

export default function App() {
  const [roomId, setRoomId] = useState(() => localStorage.getItem('roomId'));
  const [displayToken, setDisplayToken] = useState(() => localStorage.getItem('displayToken'));
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const handleSetup = useCallback((id, token) => {
    localStorage.setItem('roomId', id);
    localStorage.setItem('displayToken', token);
    setRoomId(id);
    setDisplayToken(token);
  }, []);

  const fetchState = useCallback(async () => {
    if (!roomId || !displayToken) return;
    try {
      const { data } = await api.get(`/room/${roomId}/state`);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Connection error');
    }
  }, [roomId, displayToken]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  if (!roomId || !displayToken) {
    return <SetupScreen onSetup={handleSetup} />;
  }

  if (error && !state) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-bg-dark gap-4">
        <span className="material-symbols-outlined text-6xl" style={{ color: 'rgba(197,163,88,0.3)' }}>wifi_off</span>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-600">{error}</p>
        <p className="text-[10px] text-slate-700 uppercase tracking-widest">Room {roomId}</p>
      </div>
    );
  }

  if (!state) return null;

  if (!state.booking) {
    return (
      <IdleScreen
        unit={state.unit}
        controller={state.controller}
        relays={state.relays}
        roomId={roomId}
        onRefresh={fetchState}
      />
    );
  }

  return (
    <GuestScreen
      unit={state.unit}
      booking={state.booking}
      relays={state.relays}
      controller={state.controller}
      roomId={roomId}
      onRefresh={fetchState}
    />
  );
}
