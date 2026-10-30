import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// The red count on the menu's OTA dashboard item: nights below their occupancy
// target in the next 30. Only asked by those who may open the page.
export default function useOtaSlowCount() {
  const { can, hasModule } = useAuth();
  const allowed = can('ota_dashboard') && hasModule('channel_manager');
  const [slow, setSlow] = useState(0);
  useEffect(() => {
    if (!allowed) { setSlow(0); return undefined; }
    let live = true;
    const load = () => api.get('/api/ota-dashboard/count').then(r => { if (live) setSlow(r.data.slow || 0); }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { live = false; clearInterval(t); };
  }, [allowed]);
  return slow;
}
