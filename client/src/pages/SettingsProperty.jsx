import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function SettingsProperty() {
  const { hasModule } = useAuth();
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
            <div className="form-group">
              <label className="form-label">Registration Card — House Rules Text</label>
              <textarea className="form-textarea" rows={6}
                placeholder="Shown on the printable guest Registration Card. One rule per line."
                value={propertyForm.registration_notice || ''} onChange={e => setProp('registration_notice', e.target.value)} />
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

      {hasModule('insights') && <MarketInsightsCard />}
    </div>
  );
}

// Dashboard → Market Insights, per property (migration 069): where the
// property is, its own Google listing, which Google searches to follow, and a
// short description for the weekly AI briefing.
function MarketInsightsCard() {
  const [form, setForm] = useState(null);
  const [keywordsText, setKeywordsText] = useState('');
  const [selfName, setSelfName] = useState('');
  const [saving, setSaving] = useState(false);
  const [finding, setFinding] = useState(false);
  const [msg, setMsg] = useState(null);   // { ok, text }

  function apply(data) {
    setForm(data);
    setKeywordsText(data.keywords.join(', '));
  }
  useEffect(() => {
    api.get('/api/insights/settings').then(r => apply(r.data)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean);
      const r = await api.put('/api/insights/settings', { area: form.area, description: form.description, keywords });
      apply(r.data);
      setMsg({ ok: true, text: 'Saved. New search terms appear on the Dashboard in a minute or two.' });
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function findSelf() {
    if (!selfName.trim()) return;
    setFinding(true);
    setMsg(null);
    try {
      const r = await api.put('/api/insights/self', { name: selfName.trim() });
      apply(r.data);
      setSelfName('');
      setMsg({ ok: true, text: `Your listing is now "${r.data.self?.name}".` });
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Could not find that listing' });
    } finally {
      setFinding(false);
    }
  }

  if (!form) return null;
  const muted = { fontSize: 12, color: 'var(--text-muted)' };

  return (
    <div className="card mt-3">
      <div className="card-title">Market Insights</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Sets up the Dashboard's Competitor Ratings, Search Interest and AI Weekly Briefing for this property.
      </p>

      <div className="form-group">
        <label className="form-label">Area</label>
        <input className="form-input" placeholder="e.g. Kintamani, Bali" value={form.area}
          onChange={e => setForm(f => ({ ...f, area: e.target.value }))} />
        <div style={muted}>Used to find the right Google listings (yours and your competitors') and in the AI briefing.</div>
      </div>

      <div className="form-group">
        <label className="form-label">Google searches to follow (up to 5, comma-separated)</label>
        <input className="form-input" placeholder="e.g. kintamani glamping, bali glamping" value={keywordsText}
          onChange={e => setKeywordsText(e.target.value)} />
        <div style={muted}>What guests type into Google when looking for a place like yours. Shown on the Search Interest card.</div>
      </div>

      <div className="form-group">
        <label className="form-label">Short description (for the AI briefing)</label>
        <input className="form-input" placeholder="e.g. glamping resort with volcano and lake views" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} maxLength={300} />
      </div>

      <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 14 }}>
        <label className="form-label">Your Google listing</label>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          {form.self
            ? <>✓ <strong>{form.self.name}</strong>{form.self.matched_address ? <span style={muted}> — {form.self.matched_address}</span> : null}</>
            : <span style={muted}>Not set — the Competitor Ratings card has no "You" row to compare with.</span>}
        </div>
        {form.places_configured ? (
          <div className="flex gap-2">
            <input className="form-input" placeholder={form.self ? 'Change: type your property name as on Google' : 'Type your property name as on Google'}
              value={selfName} onChange={e => setSelfName(e.target.value)} />
            <button className="btn btn-secondary btn-sm" onClick={findSelf} disabled={finding || !selfName.trim()}>
              {finding ? 'Finding…' : 'Find'}
            </button>
          </div>
        ) : (
          <div style={muted}>Google Places isn't set up on the server (GOOGLE_PLACES_API_KEY).</div>
        )}
        <div style={{ ...muted, marginTop: 4 }}>Save the Area first so the search looks in the right place.</div>
      </div>

      {msg && (
        <div style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--color-success, #16a34a)' : 'var(--danger, #dc2626)' }}>{msg.text}</div>
      )}
    </div>
  );
}
