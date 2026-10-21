import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import GuideMarkdown, { headings } from '../components/GuideMarkdown';
import { GROUPS, CHAPTERS, chapterText } from '../guide';

// 📘 Guide / Panduan — how to use the PMS, one chapter per part (client/src/guide).
// Open to every signed-in user. Language ID / EN remembered on this device.

const LANG_KEY = 'guideLang';
function storedLang() {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'id'; } catch { return 'id'; }
}

export default function Guide() {
  const { chapter } = useParams();
  const nav = useNavigate();
  const [lang, setLang] = useState(storedLang);
  const current = CHAPTERS.find(c => c.id === chapter) || CHAPTERS[0];
  const source = chapterText(current.id, lang);
  const toc = headings(source);

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* private window */ } }, [lang]);
  useEffect(() => {
    document.querySelector('.main-content')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [current.id]);

  const t = (id, en) => (lang === 'en' ? en : id);
  const go = id => nav(`/guide/${id}`);

  return (
    <div className="guide-page">
      <div className="page-header guide-noprint">
        <div>
          <h1 className="page-title">{t('Panduan', 'Guide')}</h1>
          <p className="page-subtitle">{t('Cara memakai PMS, bab demi bab', 'How to use the PMS, chapter by chapter')}</p>
        </div>
        <div className="flex gap-2">
          <button className={`btn btn-sm ${lang === 'id' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLang('id')}>ID</button>
          <button className={`btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLang('en')}>EN</button>
          <button className="btn btn-sm btn-secondary" onClick={() => window.print()}>🖨 {t('Cetak', 'Print')}</button>
        </div>
      </div>

      <div className="guide-layout">
        <aside className="guide-nav guide-noprint">
          <select className="form-input guide-nav-select" value={current.id} onChange={e => go(e.target.value)}>
            {GROUPS.map(g => (
              <optgroup key={g.label.en} label={g.label[lang]}>
                {g.chapters.map(c => <option key={c.id} value={c.id}>{c.icon} {c.title[lang]}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="guide-nav-list">
            {GROUPS.map(g => (
              <div key={g.label.en} className="guide-nav-group">
                <div className="guide-nav-label">{g.label[lang]}</div>
                {g.chapters.map(c => (
                  <Link key={c.id} to={`/guide/${c.id}`} className={`guide-nav-item${c.id === current.id ? ' active' : ''}`}>
                    <span>{c.icon}</span> {c.title[lang]}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <article className="card guide-article">
          {toc.length > 2 && (
            <div className="guide-toc guide-noprint">
              <span className="text-muted">{t('Di halaman ini:', 'On this page:')}</span>{' '}
              {toc.map((h, i) => (
                <span key={h.id}>{i > 0 && ' · '}<a href={`#${h.id}`} onClick={e => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{h.text}</a></span>
              ))}
            </div>
          )}
          <GuideMarkdown source={source} />
        </article>
      </div>
    </div>
  );
}
