// Reports (Insights → Reports): every printable report in one place. Each
// report follows the permission of the page it comes from — someone sees only
// what they could already download there, and the server checks again on
// download. The download buttons on the source pages stay. Reports tied to
// one record (an invoice, a stock count) link to their page instead.
// The list itself is lib/reportLibrary.js.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { reportsFor, thisMonth } from '../lib/reportLibrary';

// An error from a blob request comes back as a blob — read its JSON.
async function errorText(err) {
  try {
    const data = err.response?.data;
    if (data instanceof Blob) return JSON.parse(await data.text()).error || 'Download failed';
    return data?.error || 'Download failed';
  } catch { return 'Download failed'; }
}

function ReportPanel({ r }) {
  const [vals, setVals] = useState(() => Object.fromEntries((r.fields || []).map(f => [f.key, f.init()])));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { user } = useAuth();

  async function download(f) {
    setBusy(f.label); setError('');
    try {
      const res = await api.get(f.url(vals), { params: f.params(vals), responseType: 'blob' });
      const disp = res.headers?.['content-disposition'] || '';
      const name = /filename="?([^";]+)"?/.exec(disp)?.[1] || f.name(vals);
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(await errorText(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="lib-panel">
      {r.link ? (
        <Link to={r.link.to} className="btn btn-secondary btn-sm">{r.link.label} →</Link>
      ) : (<>
        {r.fields.length > 0 && (
          <div className="lib-fields">
            {r.fields.map(f => (
              <label key={f.key} className="lib-field">
                <span>{f.label}</span>
                {f.type === 'select' ? (
                  <select className="form-select" value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}>
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="form-input" type={f.type} value={vals[f.key]} max={f.type === 'month' ? thisMonth() : undefined}
                         onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
        )}
        <div className="lib-buttons">
          {r.files.map((f, i) => (
            <button key={f.label} type="button" className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    disabled={!!busy || r.fields.some(x => !vals[x.key])} onClick={() => download(f)}>
              <Icon name="download" />{busy === f.label ? 'Preparing…' : `Download ${f.label}`}
            </button>
          ))}
          {r.page && <Link to={r.page.to} className="btn btn-secondary btn-sm">{r.page.label}</Link>}
        </div>
        {error && <div className="alert alert-error" style={{ marginTop: 10, marginBottom: 0 }}><div>{error}</div></div>}
      </>)}
      {r.schedule && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
          {r.schedule}{user?.role === 'owner' && <> · <Link to="/settings/reports">Change in Notifications</Link></>}
        </div>
      )}
    </div>
  );
}

export default function ReportsLibrary() {
  const { can, hasModule } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const mine = useMemo(() => reportsFor(can, hasModule), [can, hasModule]);
  const words = q.trim().toLowerCase();
  const shown = mine.filter(r => !words || `${r.title} ${r.what} ${r.group}`.toLowerCase().includes(words));
  const groups = [...new Set(shown.map(r => r.group))];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Every report you can print or download, in one place.</div>
        </div>
      </div>
      <div className="page-toolbar">
        <input className="form-input" style={{ maxWidth: 320 }} placeholder="Find a report…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="text-muted" style={{ fontSize: 13 }}>{mine.length} {mine.length === 1 ? 'report' : 'reports'} for you</span>
      </div>

      {mine.length === 0 && <div className="text-muted">No reports for your role.</div>}
      {mine.length > 0 && shown.length === 0 && <div className="text-muted">Nothing matches “{q}”.</div>}

      <div className="lib-groups">
        {groups.map(g => (
          <div key={g} className="card lib-group">
            <div className="stat-label">{g}</div>
            {shown.filter(r => r.group === g).map(r => {
              const isOpen = open === r.id;
              return (
                <div key={r.id} className={`lib-item${isOpen ? ' open' : ''}`}>
                  <button type="button" className="lib-head" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                    <span className="lib-title">
                      <b>{r.title}</b>
                      <span className="text-muted">{r.what}</span>
                    </span>
                    <span className="lib-formats">{r.link ? 'on its page' : r.files.map(f => f.label).join(' · ')}</span>
                  </button>
                  {isOpen && <ReportPanel r={r} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
