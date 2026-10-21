import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import api from '../services/api';
import LobbyMusicCard from '../components/LobbyMusicCard';

const CATEGORIES = [
  { value: 'activity', label: 'Activity',  color: '#4ade80' },
  { value: 'dining',   label: 'Dining',    color: '#fb923c' },
  { value: 'property', label: 'Property',  color: '#c5a358' },
  { value: 'notice',   label: 'Notice',    color: '#818cf8' },
];

const EMPTY_FORM = { title: '', body: '', category: 'activity', meta: '', active: true, paid: false, price: '', linkMode: 'new', link_activity_id: '', show_on: 'both', video_sound: true };

// Where a card shows (migration 116). Rooms = the room TVs and the room tablets.
const SHOW_ON = [
  { value: 'both',  label: 'Rooms & lobby' },
  { value: 'rooms', label: 'Rooms only' },
  { value: 'lobby', label: 'Lobby only' },
];
const VIDEO_MAX_MB = 100;

function catMeta(cat) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];
}

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function SettingsBoardCards() {
  const { user, hasModule } = useAuth();
  const [cards, setCards]       = useState([]);
  const [catalog, setCatalog]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // card id or null
  const [form, setForm]         = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [progress, setProgress] = useState(null); // upload %, while a video goes up
  const [videoFile, setVideoFile] = useState(null);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [error, setError]       = useState('');

  async function load() {
    try {
      const { data } = await api.get('/api/board');
      setCards(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (hasModule('activities')) {
      api.get('/api/activities', { params: { available: true } }).then(({ data }) => setCatalog(data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setVideoFile(null);
    setRemoveVideo(false);
    setError('');
    setShowForm(true);
  }

  function openEdit(card) {
    setEditing(card.id);
    setForm({
      title: card.title, body: card.body, category: card.category, meta: card.meta || '', active: card.active,
      paid: !!card.activity_id, price: card.activity_price ?? '', linkMode: 'new', link_activity_id: '',
      show_on: card.show_on || 'both', video_sound: card.video_sound !== false,
    });
    setVideoFile(null);
    setRemoveVideo(false);
    setImageFile(null);
    setImagePreview(card.image_url || null);
    setError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setVideoFile(null);
    setRemoveVideo(false);
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

  function handleVideoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > VIDEO_MAX_MB * 1024 * 1024) {
      setError(`This video is ${Math.round(file.size / 1048576)} MB — at most ${VIDEO_MAX_MB} MB. Export it shorter or at a lower quality.`);
      e.target.value = '';
      return;
    }
    setError('');
    setVideoFile(file);
    setRemoveVideo(false);
    // A new video card is meant for the lobby — rooms only ever show the picture.
    if (!editing) setForm(f => ({ ...f, show_on: 'lobby' }));
  }

  const editingCard = editing ? cards.find(c => c.id === editing) : null;
  const currentVideo = removeVideo ? null : editingCard?.video_url || null;
  const hasVideo = !!videoFile || !!currentVideo;
  const alreadyLinked = !!editingCard?.activity_id;
  const linkedActivityIds = new Set(cards.map(c => c.activity_id).filter(Boolean));
  const availableToLink = catalog.filter(a => !linkedActivityIds.has(a.id));

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and description are required.');
      return;
    }
    if (form.paid && !alreadyLinked) {
      if (form.linkMode === 'existing' && !form.link_activity_id) {
        setError('Choose an activity to link.');
        return;
      }
      if (form.linkMode === 'new' && form.price === '') {
        setError('Price is required for a paid card.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (imageFile) fd.append('image', imageFile);
      if (videoFile) fd.append('video', videoFile);
      if (removeVideo && !videoFile) fd.append('remove_video', 'true');

      const opts = videoFile ? {
        timeout: 0,
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      } : {};
      if (editing) {
        await api.put(`/api/board/${editing}`, fd, opts);
      } else {
        await api.post('/api/board', fd, opts);
      }
      await load();
      closeForm();
    } catch (err) {
      setError(err.response?.status === 413
        ? 'The server refused a file this big — its upload limit needs raising (see the deploy notes).'
        : err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
      setProgress(null);
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
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Guest Board</div>
          <div className="page-subtitle">Pictures, notices and lobby videos — shown on the room TVs and tablets, and on the lobby TV</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Icon name="plus" />New card</button>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <LobbyMusicCard />
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
                      display: 'flex', alignItems: 'flex-start', gap: '10px 14px', flexWrap: 'wrap',
                      padding: '12px 14px', borderRadius: 10,
                      background: 'var(--cream)', border: '1px solid var(--border)',
                      opacity: card.active ? 1 : 0.5,
                    }}>
                      {card.image_url && (
                        <img src={card.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {card.title}
                          {card.show_on && card.show_on !== 'both' && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 8px' }}>
                              {card.show_on === 'lobby' ? 'Lobby only' : 'Rooms only'}
                            </span>
                          )}
                          {card.video_url && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', border: '1px solid #C4B5FD', borderRadius: 10, padding: '1px 8px' }}>
                              🎬 Video{card.video_sound === false ? ' · muted' : ''}
                            </span>
                          )}
                          {card.activity_id && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: 10, padding: '1px 8px' }}>
                              {fmtIDR(card.activity_price)}{card.activity_available === false ? ' · inactive' : ''}
                            </span>
                          )}
                        </div>
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

              {/* Paid/bookable creates or unlinks a priced activity — an owner
                  decision, matching the owner-only Activities catalog. Staff
                  manage free content cards; a card already linked to an activity
                  keeps that link untouched when a non-owner edits it. */}
              {hasModule('activities') && user?.role === 'owner' && (
                <div className="form-group">
                  <label className="form-label">Bookable</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: alreadyLinked || form.paid ? 10 : 0 }}>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, paid: false }))}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1px solid',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        borderColor: !form.paid ? 'var(--gold)' : 'var(--border)',
                        background: !form.paid ? 'rgba(197,163,88,0.12)' : 'transparent',
                        color: !form.paid ? 'var(--gold)' : 'var(--text-muted)',
                      }}
                    >
                      Free (info only)
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, paid: true }))}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1px solid',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        borderColor: form.paid ? 'var(--gold)' : 'var(--border)',
                        background: form.paid ? 'rgba(197,163,88,0.12)' : 'transparent',
                        color: form.paid ? 'var(--gold)' : 'var(--text-muted)',
                      }}
                    >
                      Paid (bookable)
                    </button>
                  </div>

                  {form.paid && alreadyLinked && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>Price: <strong>{fmtIDR(form.price)}</strong></span>
                      <Link to="/activities" className="btn btn-sm btn-secondary" style={{ fontSize: 11 }}>Manage full details →</Link>
                    </div>
                  )}
                  {form.paid && !alreadyLinked && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {availableToLink.length > 0 && (
                        <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                            <input type="radio" checked={form.linkMode === 'new'} onChange={() => setForm(f => ({ ...f, linkMode: 'new' }))} />
                            Create new activity
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                            <input type="radio" checked={form.linkMode === 'existing'} onChange={() => setForm(f => ({ ...f, linkMode: 'existing' }))} />
                            Link an existing activity
                          </label>
                        </div>
                      )}
                      {form.linkMode === 'existing' && availableToLink.length > 0 ? (
                        <select
                          className="form-input"
                          value={form.link_activity_id}
                          onChange={e => setForm(f => ({ ...f, link_activity_id: e.target.value }))}
                        >
                          <option value="">Select an activity…</option>
                          {availableToLink.map(a => (
                            <option key={a.id} value={a.id}>{a.name} — {fmtIDR(a.price)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number" min="0" className="form-input"
                          value={form.price}
                          onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                          placeholder="Price per person (Rp)"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Image <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                {imagePreview && (
                  <img src={imagePreview} alt="Preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                )}
                <input type="file" accept="image/*" onChange={handleImageChange} className="form-input" style={{ padding: '6px 10px' }} />
              </div>

              <div className="form-group">
                <label className="form-label">Video <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — plays on the lobby TV)</span></label>
                {(videoFile || currentVideo) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {videoFile
                      ? <div style={{ fontSize: 13 }}>🎬 {videoFile.name} · {Math.round(videoFile.size / 1048576)} MB <span className="text-muted">(uploads when you save)</span></div>
                      : <video src={currentVideo} controls muted style={{ width: '100%', maxHeight: 180, borderRadius: 8, background: '#000' }} />}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.video_sound} onChange={e => setForm(f => ({ ...f, video_sound: e.target.checked }))} />
                        Play with sound
                      </label>
                      <button type="button" className="btn btn-sm btn-secondary" style={{ color: '#DC2626' }}
                        onClick={() => { setVideoFile(null); if (currentVideo) setRemoveVideo(true); }}>Remove video</button>
                    </div>
                  </div>
                ) : (
                  <input type="file" accept="video/mp4,.mp4,.m4v" onChange={handleVideoChange} className="form-input" style={{ padding: '6px 10px' }} />
                )}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  MP4 (H.264), up to 2 minutes and {VIDEO_MAX_MB} MB. An iPhone video must be exported as MP4 ("Most compatible") first. The picture above stays the cover — room TVs and tablets only show the picture.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Show on</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SHOW_ON.map(o => (
                    <button key={o.value} type="button" onClick={() => setForm(f => ({ ...f, show_on: o.value }))}
                      style={{
                        padding: '6px 14px', borderRadius: 20, border: '1px solid', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        borderColor: form.show_on === o.value ? 'var(--gold)' : 'var(--border)',
                        background: form.show_on === o.value ? 'rgba(197,163,88,0.12)' : 'transparent',
                        color: form.show_on === o.value ? 'var(--gold)' : 'var(--text-muted)',
                      }}>{o.label}</button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Rooms = the room TVs and the room tablets. Lobby = the lobby TV.
                  {hasVideo && form.show_on !== 'lobby' && ' In rooms this card shows its picture, not the video.'}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                Active (shown on the screens)
              </label>

              {error && <div className="alert alert-error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? (progress != null ? `Uploading video… ${progress}%` : 'Saving…') : editing ? 'Save Changes' : 'Create Card'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
