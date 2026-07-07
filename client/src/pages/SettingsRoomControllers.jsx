import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const RELAY_ICON_OPTIONS = [
  'electrical_services', 'lightbulb', 'bed', 'shower', 'park',
  'ac_unit', 'power_settings_new', 'toggle_on', 'water_drop', 'thermostat',
  'hotel', 'cleaning_services', 'bolt', 'bedroom_parent', 'nightlight',
  'harddrive', 'settings_power', 'light_mode', 'wash', 'water_damage',
];

export default function SettingsRoomControllers() {
  const { user } = useAuth();

  const [iotUnits, setIotUnits] = useState([]);
  const [iotEditing, setIotEditing] = useState(null);
  const [iotValue, setIotValue] = useState('');
  const [iotError, setIotError] = useState('');
  const [iotRelayDrafts, setIotRelayDrafts] = useState({});

  useEffect(() => {
    api.get('/api/iot/units').then(r => {
      setIotUnits(r.data);
      const drafts = {};
      for (const unit of r.data) {
        drafts[unit.id] = {};
        for (let num = 1; num <= 5; num += 1) {
          const relay = (unit.relays || []).find(r => r.relay_num === num) || {};
          drafts[unit.id][num] = {
            label: relay.label || `Relay ${num}`,
            icon: relay.icon || 'electrical_services',
            enabled: relay.enabled !== false,
          };
        }
      }
      setIotRelayDrafts(drafts);
    }).catch(() => {});
  }, []);

  function startIotEdit(unit) {
    setIotEditing(unit.id);
    setIotValue(unit.controller_id || '');
    setIotError('');
  }

  function cancelIotEdit() {
    setIotEditing(null);
    setIotValue('');
    setIotError('');
  }

  async function saveIotEdit(unitId) {
    try {
      const { data } = await api.put(`/api/iot/units/${unitId}/controller`, { controller_id: iotValue });
      setIotUnits(prev => prev.map(u => u.id === unitId ? { ...u, controller_id: data.controller_id } : u));
      cancelIotEdit();
    } catch (err) {
      setIotError(err.response?.data?.error || 'Save failed');
    }
  }

  function getRelayDraft(unitId, relayNum) {
    return iotRelayDrafts[unitId]?.[relayNum] || { label: `Relay ${relayNum}`, icon: 'electrical_services', enabled: true };
  }

  function setRelayDraft(unitId, relayNum, key, value) {
    setIotRelayDrafts(prev => ({
      ...prev,
      [unitId]: {
        ...prev[unitId],
        [relayNum]: {
          ...prev[unitId]?.[relayNum],
          [key]: value,
        },
      },
    }));
  }

  async function saveRelayConfigs(unitId) {
    const unit = iotUnits.find(u => u.id === unitId);
    if (!unit) return;

    const original = {};
    for (const relay of unit.relays || []) {
      original[relay.relay_num] = relay;
    }

    const drafts = iotRelayDrafts[unitId] || {};
    const updates = [];
    for (let num = 1; num <= 5; num += 1) {
      const draft = drafts[num];
      if (!draft) continue;
      const existing = original[num] || {};
      const changed = (
        draft.label !== (existing.label || `Relay ${num}`) ||
        draft.icon !== (existing.icon || 'electrical_services') ||
        draft.enabled !== (existing.enabled !== false)
      );
      if (changed) {
        updates.push(api.patch(`/api/iot/units/${unitId}/relays/${num}`, draft));
      }
    }

    if (updates.length === 0) return;

    try {
      const results = await Promise.all(updates);
      const updatedRelays = (unit.relays || []).slice();
      for (const res of results) {
        const relay = res.data;
        const idx = updatedRelays.findIndex(r => r.relay_num === relay.relay_num);
        if (idx >= 0) updatedRelays[idx] = relay;
        else updatedRelays.push(relay);
      }
      updatedRelays.sort((a, b) => a.relay_num - b.relay_num);
      setIotUnits(prev => prev.map(u => u.id === unitId ? { ...u, relays: updatedRelays } : u));
      setIotError('');
    } catch (err) {
      setIotError(err.response?.data?.error || 'Failed to save relay config');
    }
  }

  function getRelayRows(unit) {
    return Array.from({ length: 5 }, (_, index) => {
      const relayNum = index + 1;
      const relay = (unit.relays || []).find(r => r.relay_num === relayNum) || {};
      const draft = getRelayDraft(unit.id, relayNum);
      return { relayNum, relay, draft };
    });
  }

  function resetRelayDrafts(unitId) {
    const unit = iotUnits.find(u => u.id === unitId);
    if (!unit) return;

    setIotRelayDrafts(prev => ({
      ...prev,
      [unitId]: Array.from({ length: 5 }, (_, index) => {
        const relayNum = index + 1;
        const relay = (unit.relays || []).find(r => r.relay_num === relayNum) || {};
        return {
          relayNum,
          label: relay.label || `Relay ${relayNum}`,
          icon: relay.icon || 'electrical_services',
          enabled: relay.enabled !== false,
        };
      }).reduce((acc, row) => ({
        ...acc,
        [row.relayNum]: {
          label: row.label,
          icon: row.icon,
          enabled: row.enabled,
        },
      }), {}),
    }));
  }

  if (user?.role !== 'owner') {
    return <div className="alert alert-error">Owner access required to manage settings.</div>;
  }

  const rowStyle = { padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const formBoxStyle = { background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, margin: '6px 0 10px' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Room Controllers</div>
          <div className="page-subtitle">Manage ESP32 controllers and relay configuration</div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-title">Controllers & Relays</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Assign each nest to its ESP32 controller ID and configure relay labels, icons, and visibility. This ID must match what the device uses in its MQTT topics (e.g. <code>zahill/room/<strong>1</strong>/connected</code>).
        </p>

        {iotUnits.map(unit => (
          <div key={unit.id}>
            {iotEditing === unit.id ? (
              <div style={formBoxStyle}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{unit.name} — Controller ID</label>
                    <input
                      className="form-input"
                      placeholder="e.g. 1, NEST2 (max 10 chars)"
                      value={iotValue}
                      maxLength={10}
                      onChange={e => setIotValue(e.target.value)}
                      style={{ maxWidth: 200 }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Leave blank to unassign.
                    </div>
                  </div>
                </div>
                {iotError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{iotError}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => saveIotEdit(unit.id)}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={cancelIotEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={rowStyle}>
                <div className="flex gap-2 items-center">
                  <span style={{ fontWeight: 600 }}>{unit.name}</span>
                  {unit.controller_id ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ID: <strong>{unit.controller_id}</strong></span>
                      {unit.connected === true && <span className="badge badge-green" style={{ fontSize: 10, padding: '2px 6px' }}>Online</span>}
                      {unit.connected === false && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Offline</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No controller assigned</span>
                  )}
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => startIotEdit(unit)}>
                  {unit.controller_id ? 'Edit' : 'Assign'}
                </button>
              </div>
            )}

            <div style={{ ...formBoxStyle, margin: '12px 0', padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px 180px 100px', gap: 12, alignItems: 'center', marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
                <div>Relay</div>
                <div>Label</div>
                <div>Icon</div>
                <div>Enabled</div>
              </div>
              {getRelayRows(unit).map(row => (
                <div key={row.relayNum} style={{ display: 'grid', gridTemplateColumns: '1fr 220px 180px 100px', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Relay {row.relayNum}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>State: {row.relay.state === true ? 'On' : 'Off'}</div>
                  </div>
                  <input
                    className="form-input"
                    value={row.draft.label}
                    onChange={e => setRelayDraft(unit.id, row.relayNum, 'label', e.target.value)}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#c5a358' }}>
                      {row.draft.icon}
                    </span>
                    <select
                      className="form-input"
                      value={row.draft.icon}
                      onChange={e => setRelayDraft(unit.id, row.relayNum, 'icon', e.target.value)}
                      style={{ flex: 1 }}
                    >
                      {RELAY_ICON_OPTIONS.map(iconName => (
                        <option key={iconName} value={iconName}>{iconName}</option>
                      ))}
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={row.draft.enabled}
                      onChange={e => setRelayDraft(unit.id, row.relayNum, 'enabled', e.target.checked)}
                    />
                    <span>{row.draft.enabled ? 'Yes' : 'No'}</span>
                  </label>
                </div>
              ))}
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => saveRelayConfigs(unit.id)}>Save relay config</button>
                <button className="btn btn-secondary btn-sm" onClick={() => resetRelayDrafts(unit.id)}>Reset</button>
              </div>
              {iotError && <div className="alert alert-error" style={{ marginTop: 10 }}>{iotError}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
