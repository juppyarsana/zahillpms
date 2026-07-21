import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const EDITING_NONE = null;

const AUTO_COLORS = [
  '#7A2540','#1E40AF','#7C3AED','#DB2777','#0891B2',
  '#C9A227','#9A3412','#0D9488','#C2410C','#6D28D9',
];

const EMAIL_TRIGGERS = [
  { id: 'booking_confirmed', label: 'Booking Confirmed' },
  { id: 'pre_arrival', label: 'Pre-Arrival (T-1 day)' },
  { id: 'post_checkout', label: 'Post-Checkout' },
];

export default function Settings() {
  const { user } = useAuth();
  const { sources, paymentMethods, reload } = useSettings();

  const [editingId, setEditingId] = useState(EDITING_NONE); // 'source:direct' | 'method:cash'
  const [editForm, setEditForm] = useState({});
  const [adding, setAdding] = useState(null); // 'source' | 'method'
  const [addForm, setAddForm] = useState({});
  const [error, setError] = useState('');

  const [propertyForm, setPropertyForm] = useState(null);
  const [propertySaving, setPropertySaving] = useState(false);
  const [propertySaved, setPropertySaved] = useState(false);
  const [propertyError, setPropertyError] = useState('');

  const [templates, setTemplates] = useState([]);
  const [activeTrigger, setActiveTrigger] = useState(EMAIL_TRIGGERS[0].id);
  const [templateForm, setTemplateForm] = useState({ subject: '', body_html: '', is_active: true });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateError, setTemplateError] = useState('');

  const [recentBookings, setRecentBookings] = useState([]);
  const [testBookingId, setTestBookingId] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [commLog, setCommLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);

  function reloadTemplates() {
    return api.get('/api/communications/templates').then(r => setTemplates(r.data)).catch(() => {});
  }
  function reloadLog() {
    setLogLoading(true);
    return api.get('/api/communications/log?limit=50')
      .then(r => setCommLog(r.data))
      .catch(() => {})
      .finally(() => setLogLoading(false));
  }

  useEffect(() => {
    if (user?.role !== 'owner') return;
    api.get('/api/settings/property').then(r => setPropertyForm(r.data)).catch(() => {});
    reloadTemplates();
    reloadLog();
    api.get('/api/bookings').then(r => {
      const sorted = [...r.data].sort((a, b) => new Date(b.check_in_date) - new Date(a.check_in_date));
      setRecentBookings(sorted.slice(0, 20));
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    const tmpl = templates.find(t => t.trigger === activeTrigger);
    setTemplateForm(tmpl
      ? { subject: tmpl.subject, body_html: tmpl.body_html, is_active: tmpl.is_active }
      : { subject: '', body_html: '', is_active: true }
    );
    setTemplateSaved(false);
    setTemplateError('');
    setTestResult(null);
  }, [activeTrigger, templates]);

  function setTemplateField(k, v) {
    setTemplateForm(f => ({ ...f, [k]: v }));
    setTemplateSaved(false);
  }

  async function saveTemplate() {
    setTemplateSaving(true);
    setTemplateError('');
    try {
      await api.put(`/api/communications/templates/${activeTrigger}`, templateForm);
      setTemplateSaved(true);
      await reloadTemplates();
    } catch (err) {
      setTemplateError(err.response?.data?.error || 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testBookingId) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const r = await api.post(`/api/communications/test/${activeTrigger}`, { booking_id: testBookingId });
      setTestResult(r.data);
      reloadLog();
    } catch (err) {
      setTestResult({ sent: false, error: err.response?.data?.error || 'Failed to send test email' });
    } finally {
      setTestSending(false);
    }
  }

  if (user?.role !== 'owner') {
    return <div className="alert alert-error">Owner access required to manage settings.</div>;
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

  function startEdit(type, item) {
    setEditingId(`${type}:${item.id}`);
    setEditForm(type === 'source'
      ? { label: item.label, is_ota: item.is_ota, color: item.color, sort_order: item.sort_order }
      : { label: item.label, sort_order: item.sort_order }
    );
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setError('');
  }

  async function saveEdit() {
    const [type, id] = editingId.split(':');
    const url = type === 'source'
      ? `/api/settings/booking-sources/${id}`
      : `/api/settings/payment-methods/${id}`;
    try {
      await api.put(url, editForm);
      cancelEdit();
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  async function toggleActive(type, id, current) {
    const url = type === 'source'
      ? `/api/settings/booking-sources/${id}`
      : `/api/settings/payment-methods/${id}`;
    await api.put(url, { is_active: !current });
    reload();
  }

  function startAdd(type) {
    setAdding(type);
    if (type === 'source') {
      const used = new Set(sources.map(s => s.color?.toLowerCase()));
      const autoColor = AUTO_COLORS.find(c => !used.has(c.toLowerCase())) || AUTO_COLORS[0];
      setAddForm({ color: autoColor, is_ota: false });
    } else {
      setAddForm({});
    }
    setError('');
  }

  function cancelAdd() {
    setAdding(null);
    setAddForm({});
    setError('');
  }

  async function saveAdd() {
    const url = adding === 'source'
      ? '/api/settings/booking-sources'
      : '/api/settings/payment-methods';
    try {
      await api.post(url, addForm);
      cancelAdd();
      reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add');
    }
  }

  function setAdd(k, v) { setAddForm(f => ({ ...f, [k]: v })); }
  function setEdit(k, v) { setEditForm(f => ({ ...f, [k]: v })); }

  const rowStyle = { padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const formBoxStyle = { background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, margin: '6px 0 10px' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Booking Sources & Methods</div>
          <div className="page-subtitle">Configure payment channels and payment methods</div>
        </div>
      </div>

      {/* ── Property Details & Billing ──────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Property Details & Billing</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Used on the folio and invoice PDF.
        </p>
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

      {/* ── Email & Communication ──────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Email & Communication</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          SMTP settings and the automated emails sent on booking confirmation, pre-arrival, and post-checkout.
        </p>

        {propertyForm && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>SMTP Configuration</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Leave blank to use platform default SMTP.
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">SMTP Host</label>
                <input className="form-input" placeholder="smtp.gmail.com" value={propertyForm.smtp_host || ''} onChange={e => setProp('smtp_host', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">SMTP Port</label>
                <input className="form-input" type="number" style={{ maxWidth: 120 }} placeholder="587" value={propertyForm.smtp_port ?? ''} onChange={e => setProp('smtp_port', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">SMTP Username</label>
                <input className="form-input" value={propertyForm.smtp_user || ''} onChange={e => setProp('smtp_user', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">SMTP Password</label>
                <input className="form-input" type="password" value={propertyForm.smtp_password || ''} onChange={e => setProp('smtp_password', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">From Address</label>
                <input className="form-input" placeholder="Zahill <hello@zahill.com>" value={propertyForm.smtp_from || ''} onChange={e => setProp('smtp_from', e.target.value)} />
              </div>
            </div>
            {propertyError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{propertyError}</div>}
            <div className="flex gap-2 items-center mb-3">
              <button className="btn btn-primary btn-sm" onClick={savePropertyDetails} disabled={propertySaving}>
                {propertySaving ? 'Saving…' : 'Save'}
              </button>
              {propertySaved && <span style={{ fontSize: 12, color: 'var(--color-success, #16a34a)' }}>Saved</span>}
            </div>
          </>
        )}

        <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Email Templates</div>
        <div className="flex gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
          {EMAIL_TRIGGERS.map(t => {
            const tmpl = templates.find(x => x.trigger === t.id);
            return (
              <button
                key={t.id}
                className={`btn btn-sm ${activeTrigger === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTrigger(t.id)}
              >
                {t.label}
                {tmpl && !tmpl.is_active && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>(off)</span>}
              </button>
            );
          })}
        </div>

        <div style={formBoxStyle}>
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input className="form-input" value={templateForm.subject} onChange={e => setTemplateField('subject', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Body (HTML)</label>
            <textarea className="form-input" rows={8} style={{ fontFamily: 'monospace', fontSize: 12 }}
              value={templateForm.body_html} onChange={e => setTemplateField('body_html', e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              Placeholders: {'{{guest_name}}'}, {'{{check_in_date}}'}, {'{{check_out_date}}'}, {'{{unit_name}}'}, {'{{nights}}'}, {'{{property_name}}'}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!templateForm.is_active} onChange={e => setTemplateField('is_active', e.target.checked)} />
            Active — send this email automatically
          </label>
          {templateError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{templateError}</div>}
          <div className="flex gap-2 items-center mb-3">
            <button className="btn btn-primary btn-sm" onClick={saveTemplate} disabled={templateSaving}>
              {templateSaving ? 'Saving…' : 'Save Template'}
            </button>
            {templateSaved && <span style={{ fontSize: 12, color: 'var(--color-success, #16a34a)' }}>Saved</span>}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Send Test</div>
          <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
            <select className="form-input" style={{ maxWidth: 320 }} value={testBookingId} onChange={e => setTestBookingId(e.target.value)}>
              <option value="">Select a recent booking…</option>
              {recentBookings.map(b => (
                <option key={b.id} value={b.id}>
                  {b.guest_name} — {b.unit_name} ({String(b.check_in_date).slice(0, 10)})
                </option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={sendTestEmail} disabled={!testBookingId || testSending}>
              {testSending ? 'Sending…' : 'Send Test'}
            </button>
          </div>
          {testResult && (
            <div className={`alert ${testResult.sent ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 10, fontSize: 12 }}>
              {testResult.sent && 'Test email sent.'}
              {testResult.skipped && `Skipped — ${testResult.reason}.`}
              {testResult.sent === false && !testResult.skipped && `Failed — ${testResult.error}`}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />

        <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Communication Log</div>
          <button className="btn btn-secondary btn-sm" onClick={reloadLog} disabled={logLoading}>
            {logLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {commLog.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No emails sent yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Trigger</th>
                  <th>Recipient</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {commLog.map(row => (
                  <tr key={row.id}>
                    <td>{new Date(row.sent_at).toLocaleString()}</td>
                    <td>{EMAIL_TRIGGERS.find(t => t.id === row.trigger)?.label || row.trigger}</td>
                    <td>{row.recipient}</td>
                    <td>
                      <span className={`badge ${row.status === 'sent' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10, padding: '2px 6px' }} title={row.error || ''}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Booking Sources ─────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-title">Booking Sources</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Channels guests book through. Mark OTA sources — their check-in flow will skip the payment gate since payment is handled by the platform.
        </p>

        {sources.map(s => (
          <div key={s.id}>
            {editingId === `source:${s.id}` ? (
              <div style={formBoxStyle}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label</label>
                    <input className="form-input" value={editForm.label || ''} onChange={e => setEdit('label', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={editForm.color || '#6b7280'} onChange={e => setEdit('color', e.target.value)}
                        style={{ width: 40, height: 36, padding: 2, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{editForm.color}</span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order</label>
                    <input className="form-input" type="number" value={editForm.sort_order ?? 0}
                      onChange={e => setEdit('sort_order', parseInt(e.target.value) || 0)} style={{ maxWidth: 80 }} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editForm.is_ota} onChange={e => setEdit('is_ota', e.target.checked)} />
                  OTA channel — payment managed by platform
                </label>
                {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={rowStyle}>
                <div className="flex gap-2 items-center">
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({s.id})</span>
                  {s.is_ota && <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 6px' }}>OTA</span>}
                  {!s.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit('source', s)}>Edit</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => toggleActive('source', s.id, s.is_active)}>
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {adding === 'source' ? (
          <div style={{ ...formBoxStyle, marginTop: 14 }}>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>New Booking Source</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">ID (slug) *</label>
                <input className="form-input" placeholder="e.g. expedia" value={addForm.id || ''}
                  onChange={e => setAdd('id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Lowercase, underscores only. Cannot be changed later.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" placeholder="e.g. Expedia" value={addForm.label || ''} onChange={e => setAdd('label', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={addForm.color || '#6b7280'} onChange={e => setAdd('color', e.target.value)}
                    style={{ width: 40, height: 36, padding: 2, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }} />
                </div>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!addForm.is_ota} onChange={e => setAdd('is_ota', e.target.checked)} />
              OTA channel — payment managed by platform
            </label>
            {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveAdd}>Add Source</button>
              <button className="btn btn-secondary btn-sm" onClick={cancelAdd}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => startAdd('source')}>+ Add Source</button>
        )}
      </div>

      {/* ── Payment Methods ──────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Payment Methods</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Methods available when recording a payment against a booking.
        </p>

        {paymentMethods.map(m => (
          <div key={m.id}>
            {editingId === `method:${m.id}` ? (
              <div style={formBoxStyle}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label</label>
                    <input className="form-input" value={editForm.label || ''} onChange={e => setEdit('label', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order</label>
                    <input className="form-input" type="number" value={editForm.sort_order ?? 0}
                      onChange={e => setEdit('sort_order', parseInt(e.target.value) || 0)} style={{ maxWidth: 80 }} />
                  </div>
                </div>
                {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={rowStyle}>
                <div className="flex gap-2 items-center">
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({m.id})</span>
                  {!m.is_active && <span className="badge badge-gray" style={{ fontSize: 10, padding: '2px 6px' }}>Inactive</span>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit('method', m)}>Edit</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => toggleActive('method', m.id, m.is_active)}>
                    {m.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {adding === 'method' ? (
          <div style={{ ...formBoxStyle, marginTop: 14 }}>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>New Payment Method</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">ID (slug) *</label>
                <input className="form-input" placeholder="e.g. paypal" value={addForm.id || ''}
                  onChange={e => setAdd('id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Lowercase, underscores only. Cannot be changed later.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" placeholder="e.g. PayPal" value={addForm.label || ''} onChange={e => setAdd('label', e.target.value)} />
              </div>
            </div>
            {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveAdd}>Add Method</button>
              <button className="btn btn-secondary btn-sm" onClick={cancelAdd}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => startAdd('method')}>+ Add Method</button>
        )}
      </div>
    </div>
  );
}
