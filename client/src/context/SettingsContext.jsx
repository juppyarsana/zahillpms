import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const SettingsContext = createContext({ sources: [], paymentMethods: [], reload: () => {} });

export function SettingsProvider({ children }) {
  const [sources, setSources] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);

  async function load() {
    try {
      const [s, p] = await Promise.all([
        api.get('/api/settings/booking-sources'),
        api.get('/api/settings/payment-methods'),
      ]);
      setSources(s.data);
      setPaymentMethods(p.data);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  return (
    <SettingsContext.Provider value={{ sources, paymentMethods, reload: load }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

export function SourceBadge({ sourceId }) {
  const { sources } = useSettings();
  const s = sources.find(src => src.id === sourceId);
  return (
    <span className="ch" style={{ background: s?.color || '#6b7280' }}>
      {s?.label || sourceId}
    </span>
  );
}
