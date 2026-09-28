import { useState, useEffect } from 'react';
import api from '../services/api';
import AgentFormModal from './AgentFormModal';
import { AGENT_TYPE_LABEL, PAYMENT_MODE_SHORT } from '../lib/agents';

// Pick the agent / company of a booking (migration 084): search the list, or
// add a new one on the spot (name is enough — the rest can follow in Agent
// Billing). value = the picked agent row or null; onChange(agent | null).
export default function AgentPicker({ value, onChange, placeholder = 'Search agent or company…' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setSearching(true);
      api.get('/api/agent-directory', { params: { q: query.trim() || undefined, active: 'true' } })
        .then(r => setResults(r.data.slice(0, 10)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  function pick(agent) {
    onChange(agent);
    setOpen(false);
    setQuery('');
  }

  if (value) {
    return (
      <div className="flex-between" style={{ gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
        <span>
          <b>{value.name}</b>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {' · '}{AGENT_TYPE_LABEL[value.agent_type] || 'Agent'}
            {value.payment_status && value.payment_status !== 'normal' ? ` · ${PAYMENT_MODE_SHORT[value.payment_status]}` : ''}
          </span>
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }

  const q = query.trim();
  return (
    <div style={{ position: 'relative' }}>
      <input className="form-input" placeholder={placeholder} value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }} />
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, background: 'var(--white, #fff)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, boxShadow: '0 6px 18px rgba(0,0,0,.08)', maxHeight: 280, overflowY: 'auto' }}>
          {searching && <div className="text-muted" style={{ fontSize: 12, padding: '6px 10px' }}>Searching…</div>}
          {!searching && results.map(a => (
            <div key={a.id} style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseDown={e => { e.preventDefault(); pick(a); }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {[AGENT_TYPE_LABEL[a.agent_type], a.payment_status !== 'normal' && PAYMENT_MODE_SHORT[a.payment_status], a.contact_name, a.contact_phone].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
          {!searching && results.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12, padding: '6px 10px' }}>{q ? 'No agent found.' : 'No agents yet.'}</div>
          )}
          <div style={{ padding: '6px 10px', cursor: 'pointer', color: 'var(--green-dark)', fontWeight: 600, fontSize: 13 }}
            onMouseDown={e => { e.preventDefault(); setOpen(false); setAdding(true); }}>
            + New agent{q ? ` “${q}”` : ''}
          </div>
        </div>
      )}
      {adding && (
        <AgentFormModal initialName={q} onClose={() => setAdding(false)}
          onSaved={a => { setAdding(false); pick(a); }} />
      )}
    </div>
  );
}
