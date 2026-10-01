import { Link, useNavigate } from 'react-router-dom';

// The small back link above a page title. It goes back to the page the user
// actually came from (Guest Lists, Check-in / out, the Dashboard…), and reads
// "← Back". Opened directly — a bookmark, a new tab, a link from Telegram —
// there is no page to go back to, so it goes to `to` and reads "← {label}".
// (react-router keeps the position in this tab's history in history.state.idx;
// 0 = the first page of the visit.)
export default function BackLink({ to, label }) {
  const nav = useNavigate();
  const cameFromApp = (window.history.state?.idx ?? 0) > 0;
  return (
    <Link to={to} onClick={e => {
      // a new tab / window (ctrl, cmd, middle click) keeps the plain link
      if (!cameFromApp || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      nav(-1);
    }}>
      ← {cameFromApp ? 'Back' : label}
    </Link>
  );
}
