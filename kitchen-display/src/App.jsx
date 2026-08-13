import { useState, useEffect, useCallback } from 'react';
import api from './api';
import SetupScreen from './screens/SetupScreen';
import TicketBoard from './screens/TicketBoard';

const POLL_MS = 30_000;
const DEBUG_CLICK_THRESHOLD = 5;
const DEBUG_CLICK_TIMEOUT = 3000;

export default function App() {
  const [displayToken, setDisplayToken] = useState(() => localStorage.getItem('displayToken'));
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState(null);
  const [debugClicks, setDebugClicks] = useState(0);

  const handleSetup = useCallback((token) => {
    localStorage.setItem('displayToken', token);
    setDisplayToken(token);
  }, []);

  const handleDebugClick = useCallback(() => {
    setDebugClicks(prev => {
      const next = prev + 1;
      if (next >= DEBUG_CLICK_THRESHOLD) {
        if (window.confirm('Reset this station? You will need to re-enter the display token.')) {
          localStorage.removeItem('displayToken');
          setDisplayToken(null);
        }
        return 0;
      }
      setTimeout(() => setDebugClicks(c => Math.max(0, c - 1)), DEBUG_CLICK_TIMEOUT);
      return next;
    });
  }, []);

  const fetchTickets = useCallback(async () => {
    if (!displayToken) return;
    try {
      const { data } = await api.get('/kitchen/active');
      setTickets(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Connection error');
    }
  }, [displayToken]);

  useEffect(() => {
    if (!displayToken) return;
    fetchTickets();
    const id = setInterval(fetchTickets, POLL_MS);

    const evtSource = new EventSource(`/api/kitchen/stream?token=${encodeURIComponent(displayToken)}`);
    evtSource.onmessage = () => fetchTickets();
    evtSource.onerror = () => {};

    return () => {
      clearInterval(id);
      evtSource.close();
    };
  }, [displayToken, fetchTickets]);

  async function advance(id, status) {
    await api.patch(`/kitchen/${id}/status`, { status });
    fetchTickets();
  }

  if (!displayToken) return <SetupScreen onSetup={handleSetup} />;

  if (error && tickets.length === 0) {
    return (
      <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <img src="/logo.png" alt="" style={{ width: 64, height: 64, objectFit: 'contain', opacity: 0.3 }} />
        <p style={{ fontSize: 12, color: '#8b8378', textTransform: 'uppercase', letterSpacing: '0.2em' }}>{error}</p>
      </div>
    );
  }

  return <TicketBoard tickets={tickets} onAdvance={advance} onDebugClick={handleDebugClick} />;
}
