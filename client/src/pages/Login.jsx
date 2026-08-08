import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, firstAllowedPath } from '../context/AuthContext';
import api from '../services/api';

const LAST_SLUG_KEY = 'lastPropertySlug';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { slug: slugParam } = useParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [slug, setSlug] = useState(slugParam || localStorage.getItem(LAST_SLUG_KEY) || '');
  const [branding, setBranding] = useState(null);

  async function fetchBranding(value) {
    if (!value.trim()) { setBranding(null); return; }
    try {
      const { data } = await api.get(`/api/public/properties/${value.trim()}/branding`);
      setBranding(data);
      localStorage.setItem(LAST_SLUG_KEY, value.trim());
    } catch {
      setBranding(null);
    }
  }

  // Branding lookup is cosmetic only — it never changes how /api/auth/login
  // resolves the user, which still happens by email alone.
  useEffect(() => { if (slug) fetchBranding(slug); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      nav(user.is_superadmin ? '/admin' : firstAllowedPath(user));
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img
            src={branding?.logo_url || '/logo.png'}
            alt={branding?.name || 'ZHP PMS'}
            style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: 12 }}
          />
          <h1>{branding?.name || 'ZHP PMS'}</h1>
          {!branding && <p style={{ fontSize: 11, marginTop: 4, opacity: 0.5, letterSpacing: 0, textTransform: 'none' }}>Property Management System</p>}
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Property</label>
            <input
              className="form-input"
              value={slug}
              placeholder="your-property-slug"
              onChange={e => setSlug(e.target.value)}
              onBlur={e => fetchBranding(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={loading} type="submit">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
