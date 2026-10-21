import AskConversation, { AskControls } from '../components/AskConversation';

// Ask as a full page (/ask) — the same conversation as the floating panel
// (components/AskFab.jsx), for a direct link or a home-screen shortcut.
export default function Ask() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Ask</div>
          <div className="page-subtitle">Ask about rooms, prices and how busy a date is — by voice or typing, in Indonesian or English.</div>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}><AskControls /></div>
      </div>
      <AskConversation />
    </div>
  );
}
