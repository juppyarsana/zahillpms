import { useRegisterSW } from 'virtual:pwa-register/react';

export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 12px)',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      background: '#2D5016',
      color: 'white',
      borderRadius: 12,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      maxWidth: 'calc(100vw - 32px)',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Update available</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: 'white',
          color: '#2D5016',
          border: 'none',
          borderRadius: 8,
          padding: '6px 14px',
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
