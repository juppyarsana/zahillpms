import { useState } from 'react';

export default function SetupScreen({ onSetup }) {
  const [roomId, setRoomId] = useState('');
  const [token, setToken] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (roomId.trim() && token.trim()) onSetup(roomId.trim(), token.trim());
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-bg-dark relative overflow-hidden">
      <div className="absolute -top-60 -right-60 w-[500px] h-[500px] rounded-full blur-[150px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />
      <div className="absolute -bottom-60 -left-60 w-[500px] h-[500px] rounded-full blur-[150px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />

      <form onSubmit={handleSubmit} className="glass-card rounded-3xl p-12 w-96 flex flex-col gap-6 z-10">
        <div className="text-center mb-2">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Birdnest" style={{ width: 120, height: 120, objectFit: 'contain' }} />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] mb-2" style={{ color: '#c5a358' }}>Room Display</p>
          <h1 className="text-2xl font-extralight text-white">First-Time Setup</h1>
          <p className="text-slate-600 text-xs mt-2">Configure this tablet for a specific room</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Room ID</label>
          <input
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="e.g. 1"
            className="rounded-xl px-4 py-3 text-white text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Display Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste display token from PMS"
            className="rounded-xl px-4 py-3 text-white text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>

        <button
          type="submit"
          className="font-bold text-sm uppercase tracking-widest py-3 rounded-xl mt-2 text-black transition-opacity active:opacity-80"
          style={{ background: '#c5a358' }}
        >
          Activate Display
        </button>
      </form>
    </div>
  );
}
