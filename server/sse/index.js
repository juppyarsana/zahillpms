// SSE client registry — Map<controllerId, Set<res>>
const clients = new Map();

function addClient(controllerId, res) {
  if (!clients.has(controllerId)) clients.set(controllerId, new Set());
  clients.get(controllerId).add(res);
}

function removeClient(controllerId, res) {
  const set = clients.get(controllerId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(controllerId);
  }
}

// Sends a "refresh now" signal to all clients watching this key.
// Pass `data` to carry an actual payload (e.g. call signaling messages)
// instead of the default "go refetch state" ping.
function notify(controllerId, data) {
  const set = clients.get(controllerId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(data || { type: 'update' })}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch {}
  }
}

module.exports = { addClient, removeClient, notify };
