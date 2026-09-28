import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

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
      // Service charge / tax are saved by their own card (PUT /tax).
      const fields = Object.fromEntries(Object.entries(propertyForm)
        .filter(([k]) => !['tax_rate', 'service_charge_rate', 'prices_include_tax'].includes(k)));
      const r = await api.patch('/api/settings/property', fields);
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

      <TaxCard />

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

      {hasModule('pos_integration') && <PosIntegrationCard />}
      {hasModule('insights') && <MarketInsightsCard />}
    </div>
  );
}

// Service charge & tax (migration 079): the rates, and whether prices are
// entered including them. Saving new rates re-splits open bookings on the
// server so each guest's agreed price stays the same — shown before saving.
function TaxCard() {
  const { reload } = useSettings();
  const [cur, setCur] = useState(null);
  const [form, setForm] = useState(null);
  const [check, setCheck] = useState(null);   // preview before saving
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.get('/api/settings/property').then(r => {
      const v = { tax_rate: parseFloat(r.data.tax_rate) || 0, service_charge_rate: parseFloat(r.data.service_charge_rate) || 0,
        prices_include_tax: !!r.data.prices_include_tax, show_tax_breakdown: !!r.data.show_tax_breakdown };
      setCur(v); setForm({ ...v, tax_rate: String(v.tax_rate), service_charge_rate: String(v.service_charge_rate) });
    }).catch(() => {});
  }
  useEffect(load, []);
  if (!form) return null;

  const sc = parseFloat(form.service_charge_rate) || 0, tx = parseFloat(form.tax_rate) || 0;
  const changed = sc !== cur.service_charge_rate || tx !== cur.tax_rate || form.prices_include_tax !== cur.prices_include_tax
    || form.show_tax_breakdown !== cur.show_tax_breakdown;
  const F = (1 + sc / 100) * (1 + tx / 100);
  const example = 1000000;
  const fmt = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');

  async function review() {
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await api.get('/api/settings/tax/preview', { params: { tax_rate: tx, service_charge_rate: sc } });
      setCheck(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not check the change');
    } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const r = await api.put('/api/settings/tax', { tax_rate: tx, service_charge_rate: sc, prices_include_tax: form.prices_include_tax, show_tax_breakdown: form.show_tax_breakdown });
      setCheck(null);
      setMsg(r.data.bookings ? `Saved — ${r.data.bookings} open booking${r.data.bookings === 1 ? '' : 's'} re-split, guest prices unchanged.` : 'Saved');
      load(); reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setBusy(false); }
  }

  return (
    <div className="card mt-3">
      <div className="card-title">Service charge &amp; tax</div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Service Charge (%)</label>
          <input className="form-input" type="number" step="0.01" min="0" max="100" style={{ maxWidth: 120 }}
            value={form.service_charge_rate} onChange={e => { setForm(f => ({ ...f, service_charge_rate: e.target.value })); setMsg(''); }} />
        </div>
        <div className="form-group">
          <label className="form-label">Tax Rate (%)</label>
          <input className="form-input" type="number" step="0.01" min="0" max="100" style={{ maxWidth: 120 }}
            value={form.tax_rate} onChange={e => { setForm(f => ({ ...f, tax_rate: e.target.value })); setMsg(''); }} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Prices are entered</label>
        {[[true, 'Including service & tax (nett)', 'The price you set is what the guest pays — the service charge and tax are inside it.'],
          [false, 'Before service & tax (++)', 'Service charge and tax are added on top of the price you set.']].map(([v, l, d]) => (
          <label key={l} className="flex gap-2" style={{ alignItems: 'flex-start', cursor: 'pointer', marginBottom: 6 }}>
            <input type="radio" checked={form.prices_include_tax === v} onChange={() => { setForm(f => ({ ...f, prices_include_tax: v })); setMsg(''); }} style={{ marginTop: 3 }} />
            <span><b style={{ fontSize: 13 }}>{l}</b><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d}</div></span>
          </label>
        ))}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Applies to room rates, pricing periods, rate-plan meal prices and Sales items. Activities have their own setting.
          {(sc > 0 || tx > 0) && <> Example: a price of {fmt(example)} → {form.prices_include_tax
            ? <>the guest pays {fmt(example)} (incl. service {fmt(example / F * sc / 100)} and tax {fmt(example / (1 + tx / 100) * tx / 100)}).</>
            : <>the guest pays {fmt(example * F)}.</>}</>}
        </div>
      </div>
      {form.prices_include_tax && (
        <div className="form-group">
          <label className="flex gap-2" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.show_tax_breakdown} style={{ marginTop: 3 }}
              onChange={e => { setForm(f => ({ ...f, show_tax_breakdown: e.target.checked })); setMsg(''); }} />
            <span><b style={{ fontSize: 13 }}>Show the service charge &amp; tax inside the total</b>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Adds "Includes service charge Rp … and tax Rp …" under the total on invoices, receipts and the booking screens.
                Off: just the total. Reports always count the service charge and tax.
              </div></span>
          </label>
        </div>
      )}
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="flex gap-2 items-center">
        <button className="btn btn-primary btn-sm" onClick={review} disabled={!changed || busy}>{busy && !check ? 'Checking…' : 'Save'}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--color-success, #16a34a)' }}>{msg}</span>}
      </div>

      {check && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header"><div className="modal-title">Change service charge &amp; tax?</div></div>
            <div className="modal-body">
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <div>Service charge {check.current.service_charge_rate}% → <b>{sc}%</b>, tax {check.current.tax_rate}% → <b>{tx}%</b></div>
              <div>Prices entered: <b>{form.prices_include_tax ? 'including service & tax' : 'before service & tax'}</b>
                {form.prices_include_tax && <> · service &amp; tax {form.show_tax_breakdown ? 'shown' : 'not shown'} under the total</>}</div>
              {check.rates_change && check.bookings > 0 ? (
                <div className="alert" style={{ marginTop: 12 }}><div>
                  <b>{check.bookings} open booking{check.bookings === 1 ? '' : 's'}</b> (upcoming and in house){check.extras + check.activities > 0 && <> with {check.extras} extra{check.extras === 1 ? '' : 's'} and {check.activities} activit{check.activities === 1 ? 'y' : 'ies'}</>} will
                  be re-split at the new rates. <b>Each guest&apos;s price stays exactly the same</b> — only the service charge and tax inside it change. Each booking gets a note in its Edit History.
                </div></div>
              ) : check.rates_change ? (
                <div style={{ marginTop: 12, color: 'var(--text-muted)' }}>No open bookings to re-split.</div>
              ) : null}
              {check.rates_change && check.agent_invoiced > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{check.agent_invoiced} stay{check.agent_invoiced === 1 ? ' is' : 's are'} already on an agent invoice — left as invoiced.</div>
              )}
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                {check.rates_change && check.checked_out_kept > 0 ? `${check.checked_out_kept} checked-out stay${check.checked_out_kept === 1 ? '' : 's'} keep` : 'Checked-out stays keep'} their bill at the old rates. New bookings use the new setting.
              </div>
            </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCheck(null)} disabled={busy}>Back</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Confirm & save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// External POS (migration 070): the key the POS sends to look up in-house
// guests and charge bills to their room. Regenerating breaks the POS until
// the new key is pasted into it.
function PosIntegrationCard() {
  const [key, setKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/settings/pos-api-key').then(r => setKey(r.data.pos_api_key || '')).catch(() => setKey(''));
  }, []);

  async function regenerate() {
    if (key && !window.confirm('Make a new key? The POS stops charging rooms until you paste the new key into it.')) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/api/settings/pos-api-key/regenerate');
      setKey(r.data.pos_api_key);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to make a key');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (key === null) return null;
  return (
    <div className="card mt-3">
      <div className="card-title">POS Integration</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Paste this key and the PMS address into your POS settings. The POS can then see who is checked in and
        charge a bill to their room — it appears on the guest's folio under Food &amp; Beverage, with service
        charge and tax added by the PMS.
      </p>
      {key ? (
        <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
          <input className="form-input" readOnly value={key} style={{ maxWidth: 320, fontFamily: 'monospace' }} />
          <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
          <button className="btn btn-secondary btn-sm" onClick={regenerate} disabled={busy}>
            {busy ? 'Working…' : 'Make a new key'}
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={regenerate} disabled={busy}>
          {busy ? 'Working…' : 'Create key'}
        </button>
      )}
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
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
