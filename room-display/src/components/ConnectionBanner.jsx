// Shown across the top while the tablet can't reach the hotel's system. The
// screen keeps what it last had, but buttons would do nothing — say so
// instead of leaving a guest tapping. Goes away by itself once it is back.
export default function ConnectionBanner({ offline }) {
  if (!offline) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '10px 16px', background: '#B45309', color: '#fff',
      fontSize: 14, fontWeight: 600, boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>cloud_off</span>
      <span>No connection — reconnecting… Orders, calls and room controls will work again in a moment.</span>
    </div>
  );
}
