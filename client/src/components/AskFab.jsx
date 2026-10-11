import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { useAsk } from '../context/AskContext';
import AskConversation, { AskControls } from './AskConversation';

// Floating "Ask" button on every page (module `assistant` + the assistant
// permission), stacked above the Call a Room button. Opens the conversation
// in a panel — at the right on a wide screen so the page stays visible, full
// screen on a phone. Hidden during a call and on the /ask page itself.
export default function AskFab() {
  const { can, hasModule } = useAuth();
  const { incomingCall, activeCall } = useCall();
  const { open, setOpen, close } = useAsk();
  const { pathname } = useLocation();

  const inCall = !!(incomingCall || activeCall);
  const shown = can('assistant') && hasModule('assistant') && !inCall && pathname !== '/ask';

  useEffect(() => { if (open && !shown) close(); }, [open, shown, close]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!shown) return null;

  if (!open) {
    return (
      <button className={`ask-fab${hasModule('calling') ? '' : ' ask-fab-solo'}`} onClick={() => setOpen(true)} title="Ask" aria-label="Ask">
        🎙
      </button>
    );
  }
  return (
    <aside className="ask-panel" role="dialog" aria-label="Ask">
      <div className="ask-panel-head">
        <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>🎙 Ask</div>
        <AskControls />
        <button className="btn btn-sm btn-secondary" onClick={close} aria-label="Close" title="Close">✕</button>
      </div>
      <AskConversation panel onNavigate={close} />
    </aside>
  );
}
