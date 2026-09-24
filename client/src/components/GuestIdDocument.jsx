import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

// The guest's ID (passport / KTP photo, or a PDF from the scanner): a
// thumbnail to open full size, plus Upload / Replace. Loaded through
// GET /api/guests/:id/id-document with the login token — the file is never a
// public link (it's personal data). Used on BookingDetail's Guest card and
// the Guest Profile page.
export default function GuestIdDocument({ guestId, hasDocument, onChanged, compact = false }) {
  const [doc, setDoc] = useState(null); // { url, isPdf }
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    setDoc(null);
    if (!guestId || !hasDocument) return;
    setLoading(true);
    api.get(`/api/guests/${guestId}/id-document`, { responseType: 'blob' })
      .then(r => {
        if (cancelled) return;
        url = URL.createObjectURL(r.data);
        setDoc({ url, isPdf: (r.data.type || '').includes('pdf') });
      })
      .catch(() => { if (!cancelled) setError('Could not load the ID'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [guestId, hasDocument]);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('id_document', file);
      await api.post(`/api/guests/${guestId}/id-document`, fd);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const size = compact ? 56 : 88;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>ID document</div>
      <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {loading && <span className="text-muted" style={{ fontSize: 12 }}>Loading…</span>}
        {doc && !doc.isPdf && (
          <a href={doc.url} target="_blank" rel="noreferrer" title="Open full size">
            <img src={doc.url} alt="Guest ID" style={{ width: size * 1.5, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
          </a>
        )}
        {doc && doc.isPdf && (
          <a href={doc.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">📄 Open ID (PDF)</a>
        )}
        {!hasDocument && !loading && <span className="text-muted" style={{ fontSize: 12 }}>No ID on file yet</span>}
        <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
          onChange={e => upload(e.target.files?.[0])} />
        <button type="button" className="btn btn-sm btn-secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? 'Uploading…' : hasDocument ? '↻ Replace ID' : '⬆ Upload ID'}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
