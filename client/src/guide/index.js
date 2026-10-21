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
    { id: 'late-arrival', icon: '🌙', title: { id: 'Tamu datang lewat tengah malam', en: 'Guests arriving after midnight' } },
    { id: 'room-move', icon: '🔀', title: { id: 'Pindah kamar', en: 'Moving to another room' } },
    { id: 'kids-breakfast', icon: '🧒', title: { id: 'Anak & sarapan gratis', en: 'Children & free breakfast' } },
    { id: 'other-guests', icon: '👥', title: { id: 'Tamu lain di kamar', en: 'Other guests in the room' } },
    { id: 'to-check', icon: '⚠', title: { id: 'Daftar To check', en: 'The To check list' } },
    { id: 'ota-bookings', icon: '🌐', title: { id: 'Booking dari OTA', en: 'Bookings from the OTAs' } },
    { id: 'extras-payments', icon: '💳', title: { id: 'Extras: bayar sebagian & pindah tagihan', en: 'Extras: paying in parts & transferring the bill' } },
    { id: 'agent-payments', icon: '🧾', title: { id: 'Pembayaran dari agen', en: 'Payments from agents' } },
  ] },
  { label: { id: 'Operasional', en: 'Operations' }, chapters: [
    { id: 'lobby-tv', icon: '📺', title: { id: 'TV lobi & Guest Board', en: 'Lobby TV & Guest Board' } },
  ] },
  { label: { id: 'Keuangan', en: 'Finance' }, chapters: [
    { id: 'profit-and-loss', icon: '📊', title: { id: 'Laba Rugi (Profit & Loss)', en: 'Profit & Loss' } },
    { id: 'journal-entries', icon: '✍', title: { id: 'Jurnal manual, neraca & neraca saldo', en: 'Journal entries, balance sheet & trial balance' } },
  ] },
  { label: { id: 'Pengaturan', en: 'Settings' }, chapters: [
    { id: 'room-tablets', icon: '📶', title: { id: 'Tablet kamar — koneksi WiFi', en: 'Room tablets — WiFi connection' } },
  ] },
];

export const CHAPTERS = GROUPS.flatMap(g => g.chapters);
export const chapterText = (id, lang) => text(id, lang);
