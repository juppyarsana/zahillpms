import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const CATEGORIES = [
  { value: 'activity', label: 'Activity',  color: '#4ade80' },
  { value: 'dining',   label: 'Dining',    color: '#fb923c' },
  { value: 'property', label: 'Property',  color: '#c5a358' },
  { value: 'notice',   label: 'Notice',    color: '#818cf8' },
];

const EMPTY_FORM = { title: '', body: '', category: 'activity', meta: '', active: true };

function catMeta(cat) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];
}

export default function SettingsBoardCards() {
  const { user } = useAuth();
  const [cards, setCards]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // card id or null
  const [form, setForm]         = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function load() {
    try {
      const { data } = await api.get('/api/board');
      setCards(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setError('');
    setShowForm(true);
  }

  function openEdit(card) {
    setEditing(card.id);
    setForm({ title: card.title, body: card.body, category: card.category, meta: card.meta || '', active: card.active });
    setImageFile(null);
    setImagePreview(card.image_url || null);
    setError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setImageFile(null);
    setImagePreview(null);
    setError('');
  }

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (imageFile) fd.append('image', imageFile);

      if (editing) {
        await api.put(`/api/board/${editing}`, fd);
      } else {
        await api.post('/api/board', fd);
      }
      await load();
      closeForm();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(card) {
    try {
      const { data } = await api.patch(`/api/board/${card.id}/toggle`);
      setCards(prev => prev.map(c => c.id === card.id ? data : c));
    } catch {}
  }

  async function deleteCard(card) {
    if (!confirm(`Delete "${card.title}"?`)) return;
    try {
      await api.delete(`/api/board/${card.id}`);
      setCards(prev => prev.filter(c => c.id !== card.id));
    } catch {}
  }

  if (user?.role !== 'owner') {
    return <div className="alert alert-error">Owner access required.</div>;
  }

  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    items: cards.filter(c => c.category === cat.value),
  }));

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Guest Board</div>
          <div className="page-subtitle">Manage content shown on the Room Display Explore tab</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Card</button>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {grouped.map(group => (
            <div key={group.value} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: group.color }} />
                <div className="card-title" style={{ margin: 0 }}>{group.label}</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{group.items.length} card{group.items.length !== 1 ? 's' : ''}</span>
              </div>

              {group.items.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No cards yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {group.items.map(card => (
                    <div key={card.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14,
                      padding: '12px 14px', borderRadius: 10,
                      background: 'var(--cream)', border: '1px solid var(--border)',
                      opacity: card.active ? 1 : 0.5,
                    }}>
                      {card.image_url && (
                        <img src={card.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{card.title}</div>
                        {card.meta && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{card.meta}</div>}
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {card.body}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                        <button
                          className={`btn btn-sm ${card.active ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => toggleActive(card)}
                          style={{ fontSize: 11 }}
                        >
                          {card.active ? 'Hide' : 'Show'}
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(card)}>Edit</button>
                        <button className="btn btn-sm btn-secondary" style={{ color: '#DC2626' }} onClick={() => deleteCard(card)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">{editing ? 'Edit Card' : 'New Card'}</div>
              <button className="btn btn-icon" onClick={closeForm}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              <div className="form-group">
                <label className="form-label">Category</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, category: cat.value }))}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1px solid',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        borderColor: form.category === cat.value ? cat.color : 'var(--border)',
                        background: form.category === cat.value ? `${cat.color}20` : 'transparent',
                        color: form.category === cat.value ? cat.color : 'var(--text-muted)',
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Mt Batur Sunrise Trek" />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" rows={3} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="2–3 sentences shown on the display…" />
              </div>

              <div className="form-group">
                <label className="form-label">Meta <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — shown as small detail line)</span></label>
                <input className="form-input" value={form.meta} onChange={e => setForm(f => ({ ...f, meta: e.target.value }))} placeholder="e.g. 20 min drive · open 8am–6pm" />
              </div>

              <div className="form-group">
                <label className="form-label">Image <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                {imagePreview && (
                  <img src={imagePreview} alt="Preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                )}
                <input type="file" accept="image/*" onChange={handleImageChange} className="form-input" style={{ padding: '6px 10px' }} />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                Show on Room Display
              </label>

              {error && <div className="alert alert-error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Card'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
