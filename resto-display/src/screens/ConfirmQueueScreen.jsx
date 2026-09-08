import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { getToken } from '../auth';
import useResilientEventSource from '../useResilientEventSource';
import OrderCard from '../components/OrderCard';

const POLL_MS = 30_000;

export default function ConfirmQueueScreen() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);

  const fetchPending = useCallback(async () => {
    try {
      const { data } = await api.get('/resto/pending');
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Connection error');
    }
  }, []);

  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPending]);

  const token = getToken();
  useResilientEventSource(
    token ? `/api/resto/stream?token=${encodeURIComponent(token)}` : null,
    () => fetchPending()
  );

  async function handleConfirm(id) {
    await api.post(`/resto/orders/${id}/confirm`);
    fetchPending();
  }

  async function handleReject(id, reason) {
    await api.post(`/resto/orders/${id}/reject`, { reason });
    fetchPending();
  }

  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl font-light text-ink">Confirm Queue</h1>
        {orders.length > 0 && (
          <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-warn-soft text-warn">
            {orders.length} waiting
          </span>
        )}
      </div>
      <p className="text-xs text-dim mb-6">Room-service orders waiting to be sent to the kitchen.</p>

      {error && orders.length === 0 && <p className="text-danger text-sm">{error}</p>}
      {!error && orders.length === 0 && <p className="text-dim text-sm">Nothing waiting on confirmation.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {orders.map(o => (
          <OrderCard key={o.id} order={o} onConfirm={handleConfirm} onReject={handleReject} />
        ))}
      </div>
    </div>
  );
}
