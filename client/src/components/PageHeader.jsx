import { Fragment } from 'react';
import BackLink from './BackLink';

// Header for detail pages (booking, group, event) — same look as the list
// pages' header since 2026-10-22, no card:
//
//   ← Reservations · Booking #880BDFB2
//   Lia Fadlia  [Pending]                        [Call] [Message] [Documents ▾] [More ▾] [Check In]
//   ┌ ROOM ──────┬ STAY ─────────────┬ GUESTS ─┬ SOURCE ─┬ BALANCE DUE ┐
//   │ 103 · Delx │ 16 Oct → 17 Oct   │ 2       │ Direct  │ Rp 869.946  │
//   └────────────┴───────────────────┴─────────┴─────────┴─────────────┘
//   Details   Folio   Activities      ← underline tabs, pinned while scrolling
//
// back:    { to, label }   small back link (BackLink: back to where the user came from)
// kind:    'Booking #…'    what this page is, next to the back link
// title:   the name people know it by (guest, company…)
// badge:   status pill after the title
// tone:    kept for callers (lib/stayTone.js / event status); no longer drawn
// facts:   [{ label, value, sub? }] — the key facts bar (falsy skipped)
// meta:    [node, …] — older one-line facts, joined with dots (when no `facts`)
// actions: node — right side: labeled outline buttons, the More menu, then the primary button
// tabs:    node — the page's tab buttons, under the header, pinned to the top while scrolling
export default function PageHeader({ back, kind, title, badge, tone = 'gray', facts = [], meta = [], actions, tabs }) {
  const strip = facts.filter(Boolean);
  const line = meta.filter(Boolean);
  return (
    <>
    <div className={`detail-header tone-${tone}`}>
      <div className="dh-top">
        <div className="dh-titles">
          {(back || kind) && (
            <div className="page-eyebrow">
              {back && <BackLink to={back.to} label={back.label} />}
              {back && kind && <span className="dot">·</span>}
              {kind && <span>{kind}</span>}
            </div>
          )}
          <div className="dh-title-row">
            <h1 className="dh-title">{title}</h1>
            {badge}
          </div>
          {!strip.length && line.length > 0 && (
            <div className="page-meta">
              {line.map((f, i) => <Fragment key={i}>{i > 0 && <span className="dot">·</span>}<span>{f}</span></Fragment>)}
            </div>
          )}
        </div>
        {actions && <div className="dh-actions">{actions}</div>}
      </div>
      {strip.length > 0 && (
        <div className="dh-facts">
          {strip.map((f, i) => (
            <div key={i} className="dh-fact">
              <div className="dh-fact-label">{f.label}</div>
              <div className="dh-fact-value">{f.value}</div>
              {f.sub && <div className="dh-fact-sub">{f.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
    {/* The tabs sit under the card, right above the content they switch, and
        stay pinned at the top while a long page scrolls (owner, 2026-10-16). */}
    {tabs && <div className="dh-tabs">{tabs}</div>}
    </>
  );
}
