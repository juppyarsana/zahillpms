import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const SettingsContext = createContext({ sources: [], paymentMethods: [], branding: null, ratePlans: [], reload: () => {} });

export function SettingsProvider({ children }) {
  const [sources, setSources] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [branding, setBranding] = useState(null);
  const [ratePlans, setRatePlans] = useState([]);

  async function load() {
    try {
      const [s, p, b] = await Promise.all([
        api.get('/api/settings/booking-sources'),
        api.get('/api/settings/payment-methods'),
        api.get('/api/settings/branding'),
      ]);
      setSources(s.data);
      setPaymentMethods(p.data);
      setBranding(b.data);
    } catch {}
    // rate-plans is behind the reservations module — keep it off the critical path
    try {
      const rp = await api.get('/api/rate-plans?active=1');
      setRatePlans(rp.data);
    } catch { setRatePlans([]); }
  }

  useEffect(() => { load(); }, []);

  return (
    <SettingsContext.Provider value={{ sources, paymentMethods, branding, ratePlans, reload: load }}>
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
