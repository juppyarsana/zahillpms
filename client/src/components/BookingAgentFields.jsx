import AgentPicker from './AgentPicker';
import { HAS_COMMISSION, commissionText, EMPTY_AGENT_VALUE, agentKindForSource } from '../lib/agents';

// "Agent" + "Commission for this booking" (migration 084) — New Booking and
// Edit Details. The commission starts at the agent's default and can be set
// for this booking only; it only shows for an agent that earns commission.
//   value = { agent: row | null, own: bool, type: 'percent'|'amount', amount: string }
// sourceType = the booking source's type — sets the wording (Agent / Company /
// Wholesaler) and the type a new entry starts with.
export default function BookingAgentFields({ value, onChange, hint, sourceType }) {
  const { agent } = value;
  const kind = agentKindForSource(sourceType);
  const withCommission = agent && HAS_COMMISSION.includes(agent.payment_status);
  const def = agent ? commissionText(agent.commission_type, agent.commission_value) : '';
  return (
    <div>
      <div className="form-group">
        <label className="form-label">{kind.label} <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
        <AgentPicker value={agent} onChange={a => onChange({ ...EMPTY_AGENT_VALUE, agent: a })}
          preferType={sourceType ? kind.type : null} noun={kind.noun} placeholder={`Search ${kind.noun}…`} />
        {hint && <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>{hint}</div>}
      </div>
      {withCommission && (
        <div className="form-group">
          <label className="form-label">Commission for this booking</label>
          <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
            <select className="form-select" style={{ maxWidth: 230 }} value={value.own ? 'own' : 'default'}
              onChange={e => onChange({ ...value, own: e.target.value === 'own', type: agent.commission_type || 'percent', amount: '' })}>
              <option value="default">Agent's default{def ? ` (${def})` : ' (none set)'}</option>
              <option value="own">Different for this booking</option>
            </select>
            {value.own && (
              <>
                <select className="form-select" style={{ maxWidth: 110 }} value={value.type} onChange={e => onChange({ ...value, type: e.target.value })}>
                  <option value="percent">%</option>
                  <option value="amount">Rp</option>
                </select>
                <input className="form-input" type="number" min="0" style={{ maxWidth: 140 }} value={value.amount}
                  placeholder={value.type === 'percent' ? 'e.g. 12' : 'e.g. 150000'}
                  onChange={e => onChange({ ...value, amount: e.target.value })} />
              </>
            )}
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
            Worked out at check-out{(value.own ? value.type : agent.commission_type) === 'amount' ? ' — a fixed amount for the whole booking' : ', as a percentage of the stay\'s bill'}.
          </div>
        </div>
      )}
    </div>
  );
}
