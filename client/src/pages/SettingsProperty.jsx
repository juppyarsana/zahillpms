import { useState, useEffect } from 'react';
import api from '../services/api';

export default function SettingsProperty() {
  const [propertyForm, setPropertyForm] = useState(null);
  const [propertySaving, setPropertySaving] = useState(false);
  const [propertySaved, setPropertySaved] = useState(false);
  const [propertyError, setPropertyError] = useState('');

  const [displayToken, setDisplayToken] = useState('');
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    api.get('/api/settings/property').then(r => setPropertyForm(r.data)).catch(() => {});
    api.get('/api/settings/display-token').then(r => setDisplayToken(r.data.display_token)).catch(() => {});
  }, []);

  function copyToken() {
    navigator.clipboard.writeText(displayToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  function setProp(k, v) {
    setPropertyForm(f => ({ ...f, [k]: v }));
    setPropertySaved(false);
  }

  async function savePropertyDetails() {
    setPropertySaving(true);
    setPropertyError('');
    try {
      const r = await api.patch('/api/settings/property', propertyForm);
      setPropertyForm(r.data);
      setPropertySaved(true);
    } catch (err) {
      setPropertyError(err.response?.data?.error || 'Failed to save');
    } finally {
      setPropertySaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Property Details</div>
          <div className="page-subtitle">Used on the folio and invoice PDF</div>
        </div>
      </div>

      <div className="card">
        {propertyForm && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Property Name</label>
                <input className="form-input" value={propertyForm.property_name || ''} onChange={e => setProp('property_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={propertyForm.property_phone || ''} onChange={e => setProp('property_phone', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Address</label>
                <input className="form-input" value={propertyForm.property_address || ''} onChange={e => setProp('property_address', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={propertyForm.property_email || ''} onChange={e => setProp('property_email', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Tax Rate (%)</label>
                <input className="form-input" type="number" step="0.01" style={{ maxWidth: 120 }}
                  value={propertyForm.tax_rate ?? ''} onChange={e => setProp('tax_rate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Service Charge (%)</label>
                <input className="form-input" type="number" step="0.01" style={{ maxWidth: 120 }}
                  value={propertyForm.service_charge_rate ?? ''} onChange={e => setProp('service_charge_rate', e.target.value)} />
              </div>
            </div>
            {propertyError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{propertyError}</div>}
            <div className="flex gap-2 items-center">
              <button className="btn btn-primary btn-sm" onClick={savePropertyDetails} disabled={propertySaving}>
                {propertySaving ? 'Saving…' : 'Save'}
              </button>
              {propertySaved && <span style={{ fontSize: 12, color: 'var(--color-success, #16a34a)' }}>Saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="card mt-3">
        <div className="card-title">Device Setup</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Room Display, TV Display, and Kitchen Display units all activate with this same token — paste it into a
          device's setup screen once when you first set it up.
        </p>
        {displayToken && (
          <div className="flex gap-2 items-center">
            <input className="form-input" readOnly value={displayToken} style={{ maxWidth: 320, fontFamily: 'monospace' }} />
            <button className="btn btn-secondary btn-sm" onClick={copyToken}>{tokenCopied ? 'Copied!' : 'Copy'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
