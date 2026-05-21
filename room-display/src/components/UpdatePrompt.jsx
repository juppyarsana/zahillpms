import { useRegisterSW } from 'virtual:pwa-register/react';

export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'rgba(15,18,24,0.95)',
      border: '1px solid rgba(197,163,88,0.35)',
      borderRadius: 16,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      whiteSpace: 'nowrap',
    }}>
      <span className="material-symbols-outlined" style={{ color: '#c5a358', fontSize: 22 }}>system_update</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>Update available</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: '#c5a358',
          color: '#05070a',
          border: 'none',
          borderRadius: 10,
          padding: '7px 18px',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Refresh
      </button>
    </div>
  );
}
