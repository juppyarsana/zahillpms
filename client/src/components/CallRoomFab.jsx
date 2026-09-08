import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import CallRoomModal from './CallRoomModal';

// Floating "Call a Room" action — present on every page when the calling
// module is on. Hidden during an incoming/active call (CallBanner owns the
// screen then). Replaces the old loose button that sat inside the sidebar
// nav list among the destination links.
export default function CallRoomFab() {
  const { hasModule } = useAuth();
  const { incomingCall, activeCall } = useCall();
  const [open, setOpen] = useState(false);

  if (!hasModule('calling') || incomingCall || activeCall) return null;

  return (
    <>
      <button
        className="call-fab"
        onClick={() => setOpen(true)}
        title="Call a Room"
        aria-label="Call a Room"
      >
        📞
      </button>
      {open && <CallRoomModal onClose={() => setOpen(false)} />}
    </>
  );
}
