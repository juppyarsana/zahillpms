import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

// Settings → Reports & Alerts (migration 068): free instant Telegram alerts
// for every property, plus the paid Smart Reports scheduled reports.
// A property's own recipient list — anyone, with or without a PMS login —
// each getting the reports ticked for them by Telegram or email.

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', front_desk: 'Front desk', kitchen: 'Kitchen', other: 'Other' };
const EMPTY = { name: '', channel: 'telegram', address: '', role: 'manager' };

const linkBtn = { background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12 };

// A Telegram recipient who hasn't connected yet: a Connect link (QR, copy,
// share on WhatsApp). Pressing Start on it connects their chat — no Chat ID.
function ConnectPanel({ r, propertyName, onNewLink }) {
  const [qr, setQr] = useState(null);
  const [group, setGroup] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = group ? r.connect_urls.group : r.connect_urls.person;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 180, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [url]);

  const message = group
    ? `Tap this link, pick the group and add the bot, so the group receives ${propertyName}'s reports: ${url}`
    : `Hi ${r.name}, tap this link and press Start in Telegram to receive ${propertyName}'s reports: ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      prompt('Copy this link:', url);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      {qr && <img src={qr} alt="Telegram connect QR code" style={{ width: 120, height: 120, borderRadius: 6, background: '#fff' }} />}
      <div style={{ flex: 1, minWidth: 220, fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>⏳ Waiting for {group ? 'the group' : r.name} to connect</div>
        <div style={{ color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          {group
            ? 'Open the link, choose the group and add the bot. The group is connected straight away.'
            : 'Send them this link, or let them scan the QR. They tap it and press Start in Telegram — that’s all.'}
          {' '}The link works for 7 days.
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <a className="btn btn-primary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
          <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noreferrer">Open in Telegram</a>
        </div>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <button style={{ ...linkBtn, color: 'var(--green-dark)' }} onClick={() => setGroup(g => !g)}>
            {group ? '← Connect a person instead' : 'Connect a Telegram group instead →'}
          </button>
          <span style={{ color: 'var(--text-muted)' }}> · </span>
          <button style={{ ...linkBtn, color: 'var(--text-muted)' }} onClick={onNewLink}>New link</button>
        </div>
      </div>
    </div>
  );
}

// The hotel's own Telegram bot (so alerts come from e.g. @ZahillResortBot),
// or the platform bot when it has none. The token never comes back from the
// server — only the bot's @username and the token's last 4 characters.
function BotCard({ telegramCount, onChanged }) {
  const [bot, setBot] = useState(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => api.get('/api/smart-reports/bot').then(r => setBot(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function done(data) {
    setBot(data);
    setEditing(false);
    setToken('');
    setNotice(data.reconnect ? `${data.reconnect} Telegram recipient${data.reconnect === 1 ? '' : 's'} got a new Connect link — send it to them again.` : '');
    onChanged();
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      done((await api.put('/api/smart-reports/bot', { token: token.trim() })).data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function removeOwn() {
    const warn = telegramCount > 0 ? ` Everyone on Telegram (${telegramCount}) will need to reconnect.` : '';
    if (!confirm(`Stop using @${bot.own_username || 'this bot'}?${bot.platform_username ? ` Messages will come from @${bot.platform_username} instead.` : ''}${warn}`)) return;
    try {
      done((await api.delete('/api/smart-reports/bot')).data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove');
    }
  }

  if (!bot) return null;
  const muted = { fontSize: 13, color: 'var(--text-muted)' };

  return (
    <div className="card mb-3">
      <div className="flex-between" style={{ gap: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Telegram bot</div>
          <div style={{ fontSize: 14 }}>
            {bot.own
              ? <>Messages come from <strong>@{bot.own_username || '(bot not reachable)'}</strong> — your hotel's own bot <span style={muted}>(token {bot.own_hint})</span></>
              : bot.platform_username
                ? <>Messages come from the platform bot <strong>@{bot.platform_username}</strong>.</>
                : <span style={{ color: 'var(--danger, #dc2626)' }}>No Telegram bot yet — add your hotel's bot to use Telegram.</span>}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2" style={{ flexShrink: 0 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setError(''); }}>{bot.own ? 'Change bot' : 'Use our own bot'}</button>
            {bot.own && <button className="btn btn-secondary btn-sm" onClick={removeOwn}>Remove</button>}
          </div>
        )}
      </div>
      {notice && <div className="alert" style={{ fontSize: 13, marginTop: 10, background: 'var(--cream)', border: '1px solid var(--border)' }}>{notice}</div>}

      {editing && (
        <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginTop: 12 }}>
          <div style={{ ...muted, lineHeight: 1.7, marginBottom: 10 }}>
            1. In Telegram, open <strong>@BotFather</strong> and send <code>/newbot</code>.<br />
            2. Name it after the hotel (e.g. <em>Zahill Resort</em>) and pick a username ending in <em>bot</em>.<br />
            3. Copy the token BotFather sends (looks like <code>1234567890:AAH…</code>) and paste it below.<br />
            Tip: <code>/setuserpic</code> in BotFather gives the bot your logo.
          </div>
          <div className="form-group">
            <label className="form-label">Bot token</label>
            <input className="form-input" placeholder="1234567890:AAH…" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" />
          </div>
          {telegramCount > 0 && (
            <div style={{ ...muted, fontSize: 12, marginBottom: 8 }}>
              ⚠️ A new bot can't message people who connected to the old one — everyone on Telegram ({telegramCount}) will get a new Connect link to send them.
            </div>
          )}
          {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !token.trim()}>{saving ? 'Checking…' : 'Save'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setToken(''); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtWhen(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SettingsReports() {
  const { branding } = useSettings();
  const [catalog, setCatalog] = useState(null);
  const [manualId, setManualId] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rowMsg, setRowMsg] = useState({});        // recipient id → { ok, text }
  const [testing, setTesting] = useState(null);
  const [preview, setPreview] = useState(null);    // { report, telegram, email }
  const [previewTab, setPreviewTab] = useState('telegram');
  const [previewLoading, setPreviewLoading] = useState(null);

  function reload() {
    return api.get('/api/smart-reports/recipients').then(r => setRecipients(r.data)).catch(() => {});
  }
  useEffect(() => {
    loadCatalog();
    reload();
  }, []);

  function loadCatalog() {
    return api.get('/api/smart-reports/catalog').then(r => setCatalog(r.data)).catch(() => {});
  }

  // While someone still has to press Start, refresh so "connected" appears by itself.
  const waiting = recipients.some(r => r.link_pending);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [waiting]);

  const reports = catalog?.reports || [];
  const reportLabel = key => reports.find(r => r.key === key)?.label || key;
  // Why a report can't be ticked for a recipient (null = it can).
  function blockedReason(rep, channel) {
    if (!rep.channels.includes(channel)) return `${rep.label}: ${rep.channels.join(' or ')} only`;
    if (rep.paid && !catalog?.module_enabled) return 'Needs the Smart Reports add-on';
    return null;
  }

  async function add() {
    setSaving(true);
    setError('');
    try {
      await api.post('/api/smart-reports/recipients', {
        ...form,
        // Telegram without a typed Chat ID → the server makes a Connect link.
        address: form.channel === 'telegram' && !manualId ? '' : form.address,
      });
      setForm(EMPTY);
      setManualId(false);
      setAdding(false);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add recipient');
    } finally {
      setSaving(false);
    }
  }

  async function update(r, patch) {
    setRecipients(list => list.map(x => (x.id === r.id ? { ...x, ...patch } : x)));
    try {
      await api.put(`/api/smart-reports/recipients/${r.id}`, patch);
    } catch (err) {
      setRowMsg(m => ({ ...m, [r.id]: { ok: false, text: err.response?.data?.error || 'Failed to save' } }));
      reload();
    }
  }

  function toggleReport(r, key) {
    const next = r.reports.includes(key) ? r.reports.filter(k => k !== key) : [...r.reports, key];
    update(r, { reports: next });
  }

  async function newLink(r) {
    try {
      await api.post(`/api/smart-reports/recipients/${r.id}/link`);
      setRowMsg(m => ({ ...m, [r.id]: null }));
      reload();
    } catch (err) {
      setRowMsg(m => ({ ...m, [r.id]: { ok: false, text: err.response?.data?.error || 'Failed to create a link' } }));
    }
  }

  async function remove(r) {
    if (!confirm(`Remove ${r.name}? They will stop receiving reports.`)) return;
    await api.delete(`/api/smart-reports/recipients/${r.id}`);
    reload();
  }

  async function sendTest(r, report) {
    setTesting(r.id);
    setRowMsg(m => ({ ...m, [r.id]: null }));
    try {
      const { data } = await api.post(`/api/smart-reports/recipients/${r.id}/test`, { report });
      setRowMsg(m => ({ ...m, [r.id]: data.ok ? { ok: true, text: `${reportLabel(report)} sent — check ${r.channel === 'telegram' ? 'Telegram' : 'the inbox'}` } : { ok: false, text: data.error } }));
    } catch (err) {
      setRowMsg(m => ({ ...m, [r.id]: { ok: false, text: err.response?.data?.error || 'Failed to send' } }));
    } finally {
      setTesting(null);
      reload();
    }
  }

  async function openPreview(report) {
    setPreviewLoading(report);
    try {
      const { data } = await api.get(`/api/smart-reports/preview/${report}`);
      setPreview({ report, ...data });
      setPreviewTab('telegram');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to load preview');
    } finally {
      setPreviewLoading(null);
    }
  }

  const muted = { fontSize: 13, color: 'var(--text-muted)' };
  const bot = catalog?.telegram_bot;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Reports &amp; Alerts</div>
          <div className="page-subtitle">Telegram alerts and routine reports for your owner, manager and team</div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-title">Instant alerts <span style={{ ...muted, fontWeight: 400 }}>· Telegram</span></div>
        {reports.filter(r => r.type === 'alert').map(r => (
          <div key={r.key} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600 }}>
              {r.label}
              {r.paid && !catalog?.module_enabled && <span className="badge badge-amber" style={{ marginLeft: 8 }}>🔒 Smart Reports add-on</span>}
            </div>
            <div style={{ ...muted, marginTop: 2 }}>{r.description}</div>
          </div>
        ))}
      </div>

      <div className="card mb-3">
        <div className="flex-between" style={{ gap: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Scheduled reports <span style={{ ...muted, fontWeight: 400 }}>· Telegram or email</span></div>
          {catalog && !catalog.module_enabled && <span className="badge badge-amber">🔒 Smart Reports add-on</span>}
        </div>
        {catalog && !catalog.module_enabled && (
          <p style={{ ...muted, margin: '8px 0 0' }}>
            Part of the Smart Reports add-on — preview what your team would get below, and ask your platform provider to switch it on.
          </p>
        )}
        {reports.filter(r => r.type === 'scheduled').map(r => (
          <div key={r.key} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="flex-between" style={{ gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.label} <span style={{ ...muted, fontWeight: 400 }}>· {r.when}</span></div>
                <div style={{ ...muted, marginTop: 2 }}>{r.description}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => openPreview(r.key)} disabled={previewLoading === r.key}>
                {previewLoading === r.key ? 'Loading…' : 'Preview'}
              </button>
            </div>
          </div>
        ))}
        <p style={{ ...muted, marginTop: 10, marginBottom: 0 }}>
          All reports are sent in English, on Bali time (WITA).
        </p>
      </div>

      <BotCard
        telegramCount={recipients.filter(r => r.channel === 'telegram').length}
        onChanged={() => { loadCatalog(); reload(); }}
      />

      <div className="card mb-3">
        <div className="flex-between" style={{ marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Recipients</div>
          {!adding && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Add recipient</button>}
        </div>

        {catalog && !catalog.telegram_bot && recipients.some(r => r.channel === 'telegram') && (
          <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 13 }}>
            No Telegram bot yet — add your hotel's bot in the Telegram bot card above. Telegram recipients get nothing until then.
          </div>
        )}

        {adding && (
          <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" placeholder="e.g. Made (Manager)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {(catalog?.roles || Object.keys(ROLE_LABEL)).map(r => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ maxWidth: 160 }}>
                <label className="form-label">Send by</label>
                <select className="form-input" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value, address: '' }))}>
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                </select>
              </div>
              {(form.channel === 'email' || manualId) && (
                <div className="form-group">
                  <label className="form-label">{form.channel === 'telegram' ? 'Telegram Chat ID' : 'Email address'}</label>
                  <input className="form-input" placeholder={form.channel === 'telegram' ? '123456789' : 'manager@hotel.com'}
                    value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
              )}
            </div>
            {form.channel === 'telegram' && (
              <div style={{ ...muted, fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
                {manualId ? (
                  <>
                    They must first open {bot ? <strong>@{bot}</strong> : 'the bot'} and press <strong>Start</strong>; <strong>@userinfobot</strong> tells them their Chat ID.{' '}
                    <button style={{ ...linkBtn, color: 'var(--green-dark)' }} onClick={() => { setManualId(false); setForm(f => ({ ...f, address: '' })); }}>Use a Connect link instead</button>
                  </>
                ) : (
                  <>
                    After adding, you get a <strong>Connect link</strong> to send them (WhatsApp or QR code). They tap it and press Start — no Chat ID needed.{' '}
                    <button style={{ ...linkBtn, color: 'var(--text-muted)', textDecoration: 'underline' }} onClick={() => setManualId(true)}>Enter a Chat ID instead</button>
                  </>
                )}
              </div>
            )}
            <div style={{ ...muted, fontSize: 12, marginBottom: 10 }}>
              Ticked by default for this role: {reports.filter(r => r.default_roles.includes(form.role) && !blockedReason(r, form.channel)).map(r => r.label).join(', ') || 'none — tick them after adding'}.
            </div>
            {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={add} disabled={saving || !form.name.trim() || ((form.channel === 'email' || manualId) && !form.address.trim())}>{saving ? 'Adding…' : 'Add'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setForm(EMPTY); setError(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {recipients.length === 0 && !adding && (
          <p style={muted}>No one yet. Add yourself, your manager or a front desk group to start getting alerts and reports.</p>
        )}

        {recipients.map(r => (
          <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', opacity: r.is_active ? 1 : 0.55 }}>
            <div className="flex-between" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.channel === 'telegram' ? '✈️' : '✉️'} {r.name}
                  <span className="badge badge-gray" style={{ marginLeft: 8 }}>{ROLE_LABEL[r.role] || r.role}</span>
                  {!r.is_active && <span className="badge badge-amber" style={{ marginLeft: 6 }}>Paused</span>}
                </div>
                <div style={{ ...muted, fontSize: 12 }}>
                  {r.channel === 'email' ? r.address
                    : r.address ? <>Telegram · {r.telegram_name || `chat ${r.address}`} <span style={{ color: 'var(--color-success, #16a34a)' }}>● connected</span></>
                    : r.link_pending ? 'Telegram · not connected yet'
                    : 'Telegram · Connect link expired'}
                </div>
              </div>
              <div className="flex gap-2" style={{ flexShrink: 0 }}>
                {r.channel === 'telegram' && !r.link_pending && (
                  <button className="btn btn-secondary btn-sm" onClick={() => newLink(r)}
                    title={r.address ? 'Move reports to another phone or group' : 'Create a new Connect link'}>
                    {r.address ? 'Reconnect' : 'New link'}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => update(r, { is_active: !r.is_active })}>{r.is_active ? 'Pause' : 'Resume'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => remove(r)}>Remove</button>
              </div>
            </div>
            {r.link_pending && r.connect_urls && (
              <ConnectPanel r={r} propertyName={branding?.name || 'the hotel'} onNewLink={() => newLink(r)} />
            )}
            {r.link_pending && !r.connect_urls && (
              <div className="alert alert-error" style={{ fontSize: 12, marginTop: 8 }}>
                Can't show a Connect link yet — add your hotel's Telegram bot first (Telegram bot card above).
              </div>
            )}
            <div className="flex" style={{ flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
              {/* Alerts are Telegram only, so an email recipient doesn't see them. */}
              {reports.filter(rep => rep.channels.includes(r.channel)).map(rep => {
                const ticked = r.reports.includes(rep.key);
                const blocked = blockedReason(rep, r.channel);
                return (
                  <span key={rep.key} className="flex items-center" style={{ gap: 8, fontSize: 13, opacity: blocked && !ticked ? 0.55 : 1 }} title={blocked || ''}>
                    <label className="flex items-center" style={{ gap: 6, cursor: blocked && !ticked ? 'not-allowed' : 'pointer' }}>
                      {/* A report ticked before the add-on was switched off can still be unticked. */}
                      <input type="checkbox" checked={ticked} disabled={!!blocked && !ticked} onChange={() => toggleReport(r, rep.key)} />
                      {rep.label}{rep.paid && !catalog?.module_enabled ? ' 🔒' : ''}
                    </label>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => sendTest(r, rep.key)} disabled={testing === r.id || !r.address || !!blocked}
                      title={!r.address ? 'Connect first' : blocked || ''}>
                      {testing === r.id ? 'Sending…' : 'Send test'}
                    </button>
                  </span>
                );
              })}
            </div>
            {rowMsg[r.id] && (
              <div style={{ fontSize: 12, marginTop: 6, color: rowMsg[r.id].ok ? 'var(--color-success, #16a34a)' : 'var(--danger, #dc2626)' }}>
                {rowMsg[r.id].text}
              </div>
            )}
            {!rowMsg[r.id] && (r.last_error || r.last_sent_at) && (
              <div style={{ fontSize: 12, marginTop: 6, color: r.last_error ? 'var(--danger, #dc2626)' : 'var(--text-muted)' }}>
                {r.last_error ? `Last send failed: ${r.last_error}` : `Last sent ${fmtWhen(r.last_sent_at)}`}
              </div>
            )}
          </div>
        ))}
      </div>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{reportLabel(preview.report)} — preview with today's figures</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>Close</button>
            </div>
            <div className="modal-body">
            <div className="tab-bar" style={{ marginBottom: 12 }}>
              <button className={`tab-bar-item${previewTab === 'telegram' ? ' active' : ''}`} onClick={() => setPreviewTab('telegram')}>Telegram</button>
              <button className={`tab-bar-item${previewTab === 'email' ? ' active' : ''}`} onClick={() => setPreviewTab('email')}>Email</button>
            </div>
            {previewTab === 'telegram' ? (
              // The server escapes every value it inserts; only its own <b>/<i>/<a> tags remain.
              <div style={{ background: '#e7f3e2', borderRadius: 12, padding: 14, maxWidth: 420, fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5, color: '#111' }}
                dangerouslySetInnerHTML={{ __html: preview.telegram }} />
            ) : (
              <>
                <div style={{ ...muted, fontSize: 12, marginBottom: 6 }}>Subject: {preview.email.subject}</div>
                {preview.email.attachments?.length > 0 && (
                  <div style={{ ...muted, fontSize: 12, marginBottom: 6 }}>📎 Attached: {preview.email.attachments.join(', ')}</div>
                )}
                <iframe title="Email preview" sandbox="" srcDoc={preview.email.html}
                  style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
              </>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
