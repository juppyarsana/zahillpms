import { useState, useEffect, useCallback } from 'react';
import api from './api';
import SetupScreen from './screens/SetupScreen';
import IdleScreen from './screens/IdleScreen';
import GuestScreen from './screens/GuestScreen';
import DebugMenu from './components/DebugMenu';
import UpdatePrompt from './components/UpdatePrompt';

const POLL_MS = 10_000;
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
        />
        {showDebugMenu && (
          <DebugMenu
            onLogout={handleLogout}
            onChangeRoom={handleChangeRoom}
            onClose={() => setShowDebugMenu(false)}
          />
        )}
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
      />
      {showDebugMenu && (
        <DebugMenu
          onLogout={handleLogout}
          onChangeRoom={handleChangeRoom}
          onClose={() => setShowDebugMenu(false)}
        />
      )}
      <UpdatePrompt />
    </>
  );
}
