import { useState } from 'react';
import { getThemeOverride, setThemeOverride } from '../theme';
import { isKiosk, getKioskStats, getKioskConfig, openKioskSettings } from '../kiosk';

const DEVICE_ROWS = [
  ['Battery', s => (s.battery_level != null ? `${s.battery_level}%${s.battery_charging ? ' (charging)' : ''}` : '—')],
  ['Power', s => s.power_source || '—'],
  ['Network', s => s.network_type || '—'],
  ['Internet', s => (s.internet_ok == null ? '—' : s.internet_ok ? 'ok' : 'no internet')],
  ['Wi-Fi', s => (s.wifi_ssid ? `${s.wifi_ssid}${s.wifi_rssi != null ? ` · ${s.wifi_rssi} dBm` : ''}${s.wifi_link_speed_mbps != null ? ` · ${s.wifi_link_speed_mbps} Mbps` : ''}` : '—')],
  ['Storage', s => (s.storage_free_mb != null ? `${(s.storage_free_mb / 1024).toFixed(1)} / ${((s.storage_total_mb || 0) / 1024).toFixed(1)} GB free` : '—')],
  ['Uptime', s => (s.uptime_seconds != null ? `${Math.floor(s.uptime_seconds / 3600)}h ${Math.floor((s.uptime_seconds % 3600) / 60)}m` : '—')],
  ['App', s => s.app_version || '—'],
  ['WebView', s => s.webview_version || '—'],
  ['Android', s => s.android_version || '—'],
  ['Device', s => s.device_model || '—'],
];

export default function DebugMenu({ onLogout, onChangeRoom, onClose }) {
  const [newRoomId, setNewRoomId] = useState('');
  const [themeOverride, setThemeOverrideState] = useState(getThemeOverride());
  const [stats, setStats] = useState(() => (isKiosk() ? getKioskStats() : null));

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

        {/* Change Room — in the kiosk wrapper the APK owns the room ID, so
            editing it here would just drift from what telemetry posts for. */}
        {isKiosk() ? (
          <div className="mb-4">
            <label className="block text-sm text-slate-300 mb-2">Room ID</label>
            <div className="flex gap-2 items-center">
              <span className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm font-mono">
                {getKioskConfig()?.roomId || '—'}
              </span>
              <button
                onClick={() => openKioskSettings()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-medium transition whitespace-nowrap"
              >
                Kiosk Settings
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Change it in the kiosk app's Settings (5 taps, bottom-right corner).</p>
          </div>
        ) : (
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
        )}

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

        {/* Device (kiosk wrapper only) */}
        {isKiosk() && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-slate-300">Device</label>
              <button
                onClick={() => setStats(getKioskStats())}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition"
              >
                Refresh
              </button>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded p-3 text-xs font-mono text-slate-300 space-y-1">
              {stats
                ? DEVICE_ROWS.map(([label, fn]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <span className="text-slate-500">{label}</span>
                      <span className="text-right">{fn(stats)}</span>
                    </div>
                  ))
                : <div className="text-slate-500">No data from the wrapper.</div>}
            </div>
          </div>
        )}

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
