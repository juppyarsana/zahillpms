import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// The small markdown the Guide chapters are written in (client/src/guide/*.md),
// rendered to React elements — no HTML is injected. Supported:
//   # / ## / ### headings · paragraphs · **bold** · *italic* · `code`
//   [text](/path) links (inside the PMS) and [text](https://…) (new tab)
//   - bullets · 1. numbered steps · | tables | · > a note box
//   --- a divider
// Keep chapters to these; anything else shows as plain text.

function inline(text, key = 'i') {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0, m, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k)}</em>);
    else if (m[4] !== undefined) out.push(<code key={k} className="guide-code">{m[4]}</code>);
    else if (m[6].startsWith('/')) out.push(<Link key={k} to={m[6]}>{m[5]}</Link>);
    else out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer">{m[5]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// A heading's anchor id (for the chapter's own "On this page" list).
export const slug = s => s.toLowerCase().replace(/\*|`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The ## headings of a chapter, for its table of contents.
export function headings(md) {
  return md.split('\n').filter(l => /^## /.test(l)).map(l => { const t = l.slice(3).trim(); return { text: t.replace(/\*\*/g, ''), id: slug(t) }; });
}

export default function GuideMarkdown({ source }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      const Tag = `h${h[1].length + 1}`;
      blocks.push(<Tag key={i} id={slug(h[2])} className={`guide-h${h[1].length}`}>{inline(h[2], `h${i}`)}</Tag>);
      i++; continue;
    }
    if (/^---+$/.test(line.trim())) { blocks.push(<hr key={i} className="guide-hr" />); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      const head = cells(rows[0]);
      const body = rows.slice(/^\|\s*:?-{3,}/.test(rows[1] || '') ? 2 : 1).map(cells);
      blocks.push(
        <div key={`t${i}`} className="table-wrap guide-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${i}${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${i}${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (line.startsWith('>')) {
      const parts = [];
      while (i < lines.length && lines[i].startsWith('>')) { parts.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push(<div key={`n${i}`} className="guide-note">{parts.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `n${i}${j}`)}</Fragment>)}</div>);
      continue;
    }
    if (/^(\s*)([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && /^(\s*)([-*]|\d+\.) /.test(lines[i])) {
        const sub = /^\s{2,}/.test(lines[i]);
        const text = lines[i].replace(/^\s*([-*]|\d+\.) /, '');
        if (sub && items.length) items[items.length - 1].subs.push(text);
        else items.push({ text, subs: [] });
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={`l${i}`} className="guide-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it.text, `li${i}${j}`)}
              {it.subs.length > 0 && <ul>{it.subs.map((s, k) => <li key={k}>{inline(s, `ls${i}${j}${k}`)}</li>)}</ul>}
            </li>))}
        </Tag>);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||>|---+$|\s*([-*]|\d+\.) )/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={`p${i}`} className="guide-p">{inline(para.join(' '), `p${i}`)}</p>);
  }
  return <div className="guide-body">{blocks}</div>;
}
