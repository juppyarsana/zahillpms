import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const KitchenTicketsContext = createContext(null);

export function KitchenTicketsProvider({ children }) {
  const { user, hasModule } = useAuth();
  const [tickets, setTickets] = useState([]);

  const refetch = useCallback(async () => {
    try {
      const r = await api.get('/api/kitchen/active');
      setTickets(r.data);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user || !hasModule('sales')) return;
    refetch();

    const token = localStorage.getItem('token');
    const evtSource = new EventSource(`/api/kitchen/stream?token=${encodeURIComponent(token)}`);
    evtSource.onmessage = () => refetch();
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, [user, hasModule, refetch]);

  return (
    <KitchenTicketsContext.Provider value={{ tickets, refetch }}>
      {children}
    </KitchenTicketsContext.Provider>
  );
}

export function useKitchenTickets() {
  return useContext(KitchenTicketsContext);
}
