export default function CallButton({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'var(--danger)', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: '#fff', fontFamily: 'inherit', fontSize: 8.5, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        padding: '12px 4px 10px', width: '100%', borderRadius: 16,
        boxShadow: disabled ? 'none' : '0 6px 18px rgba(179,38,30,0.35)',
        opacity: disabled ? 0.45 : 1,
        transition: 'opacity 0.2s, box-shadow 0.2s',
      }}
    >
      <span className="material-symbols-outlined filled" style={{ fontSize: 22 }}>call</span>
      Front Desk
    </button>
  );
}
