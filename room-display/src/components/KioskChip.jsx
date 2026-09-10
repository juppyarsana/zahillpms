import { useEffect, useState } from 'react';
import { isKiosk, startKioskStatsWatcher } from '../kiosk';

// Small battery/wifi chip, visible only inside the native kiosk wrapper.
// Display-only — it never POSTs telemetry (the APK does that directly, so
// the Dashboard still gets "battery 12%" even when this web app is broken).
export default function KioskChip() {
  const [s, setS] = useState(null);

  useEffect(() => startKioskStatsWatcher(setS), []);

  if (!isKiosk() || !s) return null;

  const netProblem = s.internet_ok === false || s.network_type === 'none' || s.network_type == null;
  const lowBattery = s.battery_level != null && s.battery_level <= 20 && !s.battery_charging;

  let icon;
  if (netProblem) icon = s.network_type === 'none' || s.network_type == null ? 'wifi_off' : 'signal_wifi_bad';
  else if (s.battery_charging) icon = 'battery_charging_full';
  else if (lowBattery) icon = 'battery_alert';
  else icon = 'battery_full';

  const color = netProblem || lowBattery ? 'var(--danger)' : 'var(--text-muted)';

  const title = [
    s.battery_level != null ? `Battery ${s.battery_level}%${s.battery_charging ? ' (charging)' : ''}` : null,
    netProblem
      ? (s.internet_ok === false ? 'Wi-Fi connected, no internet' : 'No network')
      : s.wifi_ssid
        ? `${s.wifi_ssid}${s.wifi_rssi != null ? ` (${s.wifi_rssi} dBm)` : ''}`
        : s.network_type,
  ].filter(Boolean).join(' · ');

  return (
    <span
      className="w-9 h-9 rounded-full flex items-center justify-center glass-card shrink-0"
      title={title}
    >
      <span className="material-symbols-outlined text-lg" style={{ color }}>{icon}</span>
    </span>
  );
}
