import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// Standard page header for detail pages:
//   ← Reservations · GROUP BOOKING        [primary] [icons] | [⋮]
//   PT Telkom
//   1 Oct → 3 Oct 2026 · 2 nights · 3 rooms  [Upcoming]
// back:    { to, label }        — small back link above the title
// kind:    'Group booking'      — what this page is, next to the back link
// title:   the name people know it by (guest, company…)
// meta:    [node, …]            — key facts, joined with dots (falsy skipped)
// badge:   node                 — status pill after the facts
// actions: node                 — right side; wraps under the title when narrow
export default function PageHeader({ back, kind, title, meta = [], badge, actions }) {
  const facts = meta.filter(Boolean);
  return (
    <div className="page-header">
      <div>
        {(back || kind) && (
          <div className="page-eyebrow">
            {back && <Link to={back.to}>← {back.label}</Link>}
            {back && kind && <span className="dot">·</span>}
            {kind && <span>{kind}</span>}
          </div>
        )}
        <div className="page-title">{title}</div>
        {(facts.length > 0 || badge) && (
          <div className="page-meta">
            {facts.map((f, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="dot">·</span>}
                <span>{f}</span>
              </Fragment>
            ))}
            {badge}
          </div>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}
