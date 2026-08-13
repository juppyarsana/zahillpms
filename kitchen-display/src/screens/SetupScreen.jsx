import { useState } from 'react';

export default function SetupScreen({ onSetup }) {
  const [token, setToken] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (token.trim()) onSetup(token.trim());
  }

  return (
    <div style={{
      width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 24, padding: 48, width: 380, display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/logo.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 12 }} />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#c9a227', margin: '0 0 8px' }}>
            Kitchen Display
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 300, margin: 0 }}>First-Time Setup</h1>
          <p style={{ fontSize: 12, color: '#8b8378', marginTop: 8 }}>Activate this station for the kitchen</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#8b8378' }}>
            Display Token
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste display token from PMS Settings"
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none',
            }}
          />
          <p style={{ fontSize: 11, color: '#8b8378', margin: 0 }}>
            Same token used to set up Room Display / TV Display — find it under Property Details in Settings.
          </p>
        </div>

        <button type="submit" style={{
          background: '#c9a227', color: '#000', fontWeight: 700, fontSize: 13, textTransform: 'uppercase',
          letterSpacing: '0.2em', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
        }}>
          Activate Station
        </button>
      </form>
    </div>
  );
}
