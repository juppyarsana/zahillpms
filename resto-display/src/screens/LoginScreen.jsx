import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, firstAllowedPath } from '../auth';

// Mirrors client/src/pages/Login.jsx's look (maroon/accent full-bleed
// background, white centered card, Playfair Display wordmark) — this is a
// staff-only screen, so it should read as the same product as the PMS login,
// not the guest-facing kiosk aesthetic.
export default function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(firstAllowedPath(), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-accent">
      <div className="bg-white rounded-2xl p-10 w-[360px] shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
        <div className="text-center mb-7">
          <img src="/logo.png" alt="" className="w-20 h-20 object-contain mx-auto mb-3" />
          <h1 className="font-serif text-3xl font-bold text-accent tracking-wide" style={{ fontFamily: "'Playfair Display', serif" }}>Resto</h1>
          <p className="text-xs text-gray-500 tracking-widest uppercase mt-1">Staff Login</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoCapitalize="none" required autoFocus
              className="w-full border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-accent text-[color:var(--accent-contrast)] font-bold text-sm py-3 mt-2 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
