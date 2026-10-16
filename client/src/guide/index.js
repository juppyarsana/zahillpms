// The Guide (📘 /guide): one chapter per part of the PMS, each written twice —
// <id>.id.md (Bahasa Indonesia) and <id>.en.md (English) — in the small
// markdown components/GuideMarkdown.jsx renders. Bundled with the app, so it
// works offline in the installed app.
//
// When a feature changes how staff work, update its chapter in the SAME commit
// (both languages). A new chapter = its two .md files + one line below, in the
// group where it belongs (groups follow the sidebar).

const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true });
const text = (id, lang) => files[`./${id}.${lang}.md`] || files[`./${id}.id.md`] || '';

export const GROUPS = [
  { label: { id: 'Mulai', en: 'Start' }, chapters: [
    { id: 'about', icon: '📘', title: { id: 'Tentang panduan ini', en: 'About this guide' } },
  ] },
  { label: { id: 'Front Desk', en: 'Front Desk' }, chapters: [
    { id: 'to-check', icon: '⚠', title: { id: 'Daftar To check', en: 'The To check list' } },
    { id: 'agent-payments', icon: '🧾', title: { id: 'Pembayaran dari agen', en: 'Payments from agents' } },
  ] },
  { label: { id: 'Akuntansi', en: 'Accounting' }, chapters: [
    { id: 'profit-and-loss', icon: '📊', title: { id: 'Laba Rugi (Profit & Loss)', en: 'Profit & Loss' } },
  ] },
];

export const CHAPTERS = GROUPS.flatMap(g => g.chapters);
export const chapterText = (id, lang) => text(id, lang);
