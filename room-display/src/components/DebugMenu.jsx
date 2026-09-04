import { useState } from 'react';
import { getThemeOverride, setThemeOverride } from '../theme';

export default function DebugMenu({ onLogout, onChangeRoom, onClose }) {
  const [newRoomId, setNewRoomId] = useState('');
  const [themeOverride, setThemeOverrideState] = useState(getThemeOverride());

  const chooseTheme = (v) => {
    setThemeOverride(v);
    setThemeOverrideState(v);
  };

  const handleChangeRoom = () => {
    if (newRoomId.trim()) {
      onChangeRoom(newRoomId);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-4">Debug Menu</h2>

        {/* Change Room */}
        <div className="mb-4">
          <label className="block text-sm text-slate-300 mb-2">Change Room ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newRoomId}
              onChange={e => setNewRoomId(e.target.value)}
              placeholder="Enter new room ID"
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
              onKeyPress={e => e.key === 'Enter' && handleChangeRoom()}
            />
            <button
              onClick={handleChangeRoom}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-medium transition"
            >
              Change
            </button>
          </div>
        </div>

        {/* Theme override */}
        <div className="mb-4">
          <label className="block text-sm text-slate-300 mb-2">Theme (auto = day/night by clock)</label>
          <div className="flex gap-2">
            {[['', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => (
              <button
                key={v || 'auto'}
                onClick={() => chooseTheme(v)}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium transition ${themeOverride === v ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Logout */}
        <div className="flex gap-2">
          <button
            onClick={onLogout}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition"
          >
            Logout
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition"
          >
            Close
          </button>
        </div>

        <p className="text-[10px] text-slate-500 mt-4 text-center">
          (Click 5 times on logo to access again)
        </p>
        <p className="text-[10px] text-slate-600 mt-1 text-center font-mono">
          build {__APP_COMMIT__}
        </p>
      </div>
    </div>
  );
}
