import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CashierClosing from './CashierClosing';
import NightAudit from './NightAudit';

// End of day — the money taken per shift (Cashier closing) and the day closed
// (Night audit), one page with a tab each. /cashier-closing and /night-audit
// open the matching tab (their ?date= / ?user= still work).

const STEPS = [
  { n: 1, title: 'End of each shift', text: 'Cashier closing — tick your lines against the cash drawer, EDC slips and transfers. Download the PDF and sign it.' },
  { n: 2, title: 'Before going home', text: 'On Today, check out everyone leaving and sort out arrivals who didn\'t come — or the night audit marks them no-show.' },
  { n: 3, title: '03:00 by itself', text: 'The night audit posts the night and closes the day. Its report is under Night audit the next morning.' },
];

export default function EndOfDay({ initialTab }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    can('cashier_closing') && { id: 'cashier', label: 'Cashier closing' },
    can('night_audit') && { id: 'audit', label: 'Night audit' },
  ].filter(Boolean);
  const asked = params.get('tab') || initialTab;
  const tab = tabs.some(t => t.id === asked) ? asked : tabs[0]?.id;

  function pick(id) {
    // a new tab starts from its own default day / user
    setParams({ tab: id }, { replace: true });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">End of day</div>
          <div className="page-subtitle">Money taken per shift, then the day closed</div>
        </div>
      </div>

      <div className="eod-steps">
        {STEPS.map(s => (
          <div key={s.n} className="eod-step">
            <span className="eod-step-n">{s.n}</span>
            <div>
              <div className="eod-step-title">{s.title}</div>
              <div className="eod-step-text">{s.text}</div>
            </div>
          </div>
        ))}
      </div>

      {tabs.length > 1 && (
        <div className="tab-bar">
          {tabs.map(t => (
            <button key={t.id} type="button" className={`tab-bar-item${tab === t.id ? ' active' : ''}`} onClick={() => pick(t.id)}>{t.label}</button>
          ))}
        </div>
      )}

      {tab === 'cashier' && <CashierClosing embedded />}
      {tab === 'audit' && <NightAudit embedded />}
    </div>
  );
}
