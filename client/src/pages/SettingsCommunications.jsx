import { useState, useEffect } from 'react';
import api from '../services/api';

const EMAIL_TRIGGERS = [
  { id: 'booking_confirmed', label: 'Booking Confirmed' },
  { id: 'pre_arrival', label: 'Pre-Arrival (T-1 day)' },
  { id: 'post_checkout', label: 'Post-Checkout' },
];

export default function SettingsCommunications() {
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
    api.get('/api/settings/property').then(r => setPropertyForm(r.data)).catch(() => {});
    reloadTemplates();
    reloadLog();
    api.get('/api/bookings').then(r => {
      const sorted = [...r.data].sort((a, b) => new Date(b.check_in_date) - new Date(a.check_in_date));
      setRecentBookings(sorted.slice(0, 20));
    }).catch(() => {});
  }, []);

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

  const formBoxStyle = { background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, margin: '6px 0 10px' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Email &amp; Communication</div>
          <div className="page-subtitle">SMTP settings and automated guest emails</div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-title">SMTP Configuration</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Leave blank to use platform default SMTP.
        </p>
        {propertyForm && (
          <>
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
            <div className="flex gap-2 items-center">
              <button className="btn btn-primary btn-sm" onClick={savePropertyDetails} disabled={propertySaving}>
                {propertySaving ? 'Saving…' : 'Save'}
              </button>
              {propertySaved && <span style={{ fontSize: 12, color: 'var(--color-success, #16a34a)' }}>Saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="card mb-3">
        <div className="card-title">Email Templates</div>
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
      </div>

      <div className="card">
        <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Communication Log</div>
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
    </div>
  );
}
