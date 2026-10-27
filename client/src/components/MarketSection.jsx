// Market (insights module) on the Overview: competitors' Google ratings,
// Google search interest and the AI weekly briefing. Moved from the old
// Dashboard; loads its own data (server/routes/insights.js).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { SectionHeading } from './DashboardSections';

/* ─── competitor ratings card ──────────────────────────── */
function PriceLevel({ level }) {
  if (level == null) return null;
  return (
    <span style={{ fontSize: 11, color: '#6B7280' }}>
      {'$'.repeat(level + 1)}<span style={{ color: '#E5E7EB' }}>{'$'.repeat(3 - level)}</span>
    </span>
  );
}

function CompetitorRow({ c, highlight, isOwner, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0',
      borderBottom: '1px solid #E5E7EB', background: highlight ? '#F0FDF4' : 'transparent',
      marginBottom: highlight ? 8 : 0, borderRadius: highlight ? 8 : 0, paddingLeft: highlight ? 10 : 0, paddingRight: highlight ? 10 : 0,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{highlight ? 'You — ' : ''}{c.name}</div>
        <div style={{ fontSize: 11, color: '#6B7280', display: 'flex', gap: 6, alignItems: 'center' }}>
          {c.rating != null ? `${c.review_count} reviews` : 'Awaiting first check'}
          <PriceLevel level={c.price_level} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {c.rating != null ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>⭐ {c.rating.toFixed(1)}</div>
            {c.rating_delta != null && c.rating_delta !== 0 && (
              <div style={{ fontSize: 11, color: c.rating_delta > 0 ? '#15803D' : '#DC2626' }}>
                {c.rating_delta > 0 ? '▲' : '▼'} {Math.abs(c.rating_delta).toFixed(1)} rating
              </div>
            )}
            {c.review_count_delta != null && c.review_count_delta !== 0 && (
              <div style={{ fontSize: 11, color: '#6B7280' }}>
                {c.review_count_delta > 0 ? '+' : ''}{c.review_count_delta} reviews this week
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>—</span>
        )}
        {isOwner && !highlight && (
          <button
            onClick={onRemove}
            title="Remove competitor"
            style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 2 }}
          >×</button>
        )}
      </div>
    </div>
  );
}

function CompetitorRatingsCard({ competitors, isOwner, onChanged }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const notConfigured = competitors.length > 0 && competitors.every(c => !c.configured);
  const self = competitors.find(c => c.is_self);
  const others = competitors.filter(c => !c.is_self);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.post('/api/insights/competitors', { name: name.trim() });
      setName('');
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add competitor');
    }
    setAdding(false);
  }

  async function handleRemove(id) {
    if (!confirm('Remove this competitor from tracking?')) return;
    try {
      await api.delete(`/api/insights/competitors/${id}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove competitor');
    }
  }

  return (
    <div className="card">
      <div className="card-title">Competitor Ratings</div>
      {notConfigured ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          Not configured yet — add a Google Places API key to start tracking competitors.
        </p>
      ) : (
        <>
          {self && <CompetitorRow c={self} highlight />}
          {!self && isOwner && (
            <p style={{ color: '#6B7280', fontSize: 12, margin: '0 0 8px' }}>
              Compare with your own rating: set your Google listing in{' '}
              <Link to="/settings/property">Settings → Property Details → Market Insights</Link>.
            </p>
          )}
          {others.length > 0 ? (
            others.map(c => <CompetitorRow key={c.id} c={c} isOwner={isOwner} onRemove={() => handleRemove(c.id)} />)
          ) : (
            <p style={{ color: '#6B7280', fontSize: 13, marginTop: 8, marginBottom: isOwner ? 12 : 0 }}>
              No competitors added yet — add one below to start tracking its Google rating.
            </p>
          )}
          {isOwner && (
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <input
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Competitor name (e.g. Toteme Glamping)"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <button className="btn btn-secondary btn-sm" type="submit" disabled={adding}>
                {adding ? '…' : '+ Add'}
              </button>
            </form>
          )}
          {error && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

/* ─── search trends card ───────────────────────────────── */
function formatShortDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function trendAverage(points) {
  if (points.length === 0) return null;
  return points.reduce((sum, p) => sum + p.interest, 0) / points.length;
}

function SearchTrendsCard({ trends, isOwner }) {
  const terms = Object.keys(trends);
  if (terms.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Search Interest</div>
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          No data yet — follow the Google searches your guests make (e.g. "ubud villa")
          {isOwner
            ? <> in <Link to="/settings/property">Settings → Property Details → Market Insights</Link>.</>
            : '. The owner sets them in Settings.'}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Search Interest (90 days)</div>
      {terms.map(term => {
        const points = trends[term].slice(-30); // last ~30 days for a readable sparkline
        const max = Math.max(...points.map(p => p.interest), 1);
        const latest = points[points.length - 1]?.interest ?? 0;

        const last7Avg = trendAverage(points.slice(-7));
        const prev7Avg = trendAverage(points.slice(-14, -7));
        const delta = (last7Avg != null && prev7Avg != null) ? Math.round(last7Avg - prev7Avg) : null;

        const rangeLabel = points.length > 0
          ? `${formatShortDate(points[0].date)} – ${formatShortDate(points[points.length - 1].date)}`
          : '';

        return (
          <div key={term} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{term}</span>
              <span style={{ fontSize: 12, color: '#6B7280' }}>{latest}/100 today</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>{rangeLabel}</span>
              {delta != null && delta !== 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: delta > 0 ? '#15803D' : '#DC2626' }}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs prior 7 days
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
              {points.map((p, i) => (
                <div key={i} title={`${p.date}: ${p.interest}`} style={{
                  flex: 1, height: `${Math.max(6, Math.round((p.interest / max) * 100))}%`,
                  background: '#8FBC6A', borderRadius: '2px 2px 0 0',
                }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── AI weekly briefing card ───────────────────────────── */
function AiSummaryCard({ summary }) {
  if (!summary) return null;
  const briefing = summary.summary;

  return (
    <div className="card">
      <div className="card-title">AI Weekly Briefing</div>
      {!summary.configured ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>
          Not configured yet — add an Anthropic API key to generate a weekly briefing.
        </p>
      ) : briefing ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4, marginBottom: 14 }}>
            {briefing.headline}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {briefing.highlights?.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                  color: 'var(--green-dark)', background: 'var(--green-light)', borderRadius: 4, padding: '3px 8px',
                  flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap',
                }}>{h.label}</span>
                <span style={{ fontSize: 13, lineHeight: 1.5 }}>{h.text}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 14 }}>
            Generated {new Date(summary.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </div>
        </>
      ) : (
        <p style={{ color: '#6B7280', fontSize: 13 }}>No briefing yet — generates weekly, Monday mornings.</p>
      )}
    </div>
  );
}

export default function MarketSection({ isOwner }) {
  const [competitors, setCompetitors] = useState([]);
  const [trends, setTrends] = useState({});
  const [summary, setSummary] = useState(null);

  function load() {
    const get = (url, set, fallback) => api.get(url).then(r => set(r.data)).catch(() => set(fallback));
    get('/api/insights/competitors', setCompetitors, []);
    get('/api/insights/trends', setTrends, {});
    get('/api/insights/summary', setSummary, null);
  }
  useEffect(load, []);

  return (
    <div style={{ marginTop: 24 }}>
      <SectionHeading title="Market" />
      <div className="grid-2" style={{ gap: 16 }}>
        <CompetitorRatingsCard competitors={competitors} isOwner={isOwner} onChanged={load} />
        <SearchTrendsCard trends={trends} isOwner={isOwner} />
      </div>
      <div style={{ marginTop: 16 }}>
        <AiSummaryCard summary={summary} />
      </div>
    </div>
  );
}
