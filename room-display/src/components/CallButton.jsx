export default function CallButton({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: 'rgba(220,38,38,0.12)', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: '#f87171', fontFamily: 'inherit', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        padding: '10px 4px', width: '100%', borderRadius: 10,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span className="material-symbols-outlined text-xl">call</span>
      Front Desk
    </button>
  );
}
