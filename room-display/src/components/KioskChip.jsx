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
  const level = s.battery_level != null ? Math.max(0, Math.min(100, Math.round(s.battery_level))) : null;
  const lowBattery = level != null && level <= 20 && !s.battery_charging;
  const midBattery = level != null && level > 20 && level <= 40 && !s.battery_charging;

  // The battery icon drains with the level (0–6 bars); the number sits beside it.
  let icon;
  if (s.battery_charging) icon = 'battery_charging_full';
  else if (level == null) icon = 'battery_full';
  else {
    const bars = Math.round((level / 100) * 6);
    icon = bars >= 6 ? 'battery_full' : `battery_${bars}_bar`;
  }

  const color = lowBattery ? 'var(--danger)' : midBattery ? 'var(--warn)' : 'var(--text-muted)';
  const netIcon = s.network_type === 'none' || s.network_type == null ? 'wifi_off' : 'signal_wifi_bad';

  const title = [
    s.battery_level != null ? `Battery ${s.battery_level}%${s.battery_charging ? ' (charging)' : ''}` : null,
    netProblem
      ? (s.internet_ok === false ? 'Wi-Fi connected, no internet' : 'No network')
      : s.wifi_ssid
        ? `${s.wifi_ssid}${s.wifi_rssi != null ? ` (${s.wifi_rssi} dBm)` : ''}`
        : s.network_type,
  ].filter(Boolean).join(' · ');

  return (
    <span className="flex flex-col items-center gap-1 shrink-0" title={title}>
      {/* a network problem is shown as well as the battery, never instead of it */}
      {netProblem && (
        <span className="material-symbols-outlined text-lg" style={{ color: 'var(--danger)' }}>{netIcon}</span>
      )}
      <span
        className="h-8 rounded-full flex items-center justify-center glass-card"
        style={{ padding: '0 8px 0 5px', gap: 1, color }}
      >
        <span className="material-symbols-outlined text-lg">{icon}</span>
        {level != null && (
          <span className="text-xs font-semibold" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{level}%</span>
        )}
      </span>
    </span>
  );
}
