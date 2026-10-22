import { ExpensesTab } from './BackOffice';

// Finance → Expenses: money spent (electricity, laundry, repairs, OTA
// commission bills…) — owner or the accountant. Moved out of Back Office,
// which is now Purchasing & Stock under Operations.
export default function Expenses() {
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Expenses</div>
          <div className="page-subtitle">Money spent by category — on the Profit &amp; Loss and in the daily journal</div>
        </div>
      </div>
      <ExpensesTab />
    </div>
  );
}
