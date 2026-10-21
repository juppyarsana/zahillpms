import Icon from './Icon';

// The one date control for list pages (Guest Lists, Cashier Closing,
// Forecast…): ‹ [date] › joined into one box, plus Today when another day is
// shown. onPrev / onNext decide the step (a day, a week…).
export default function DateNav({ value, onChange, onPrev, onNext, today, onToday, prevLabel = 'Previous day', nextLabel = 'Next day', dateLabel = 'Date' }) {
  return (
    <>
      <div className="date-nav">
        <button type="button" onClick={onPrev} aria-label={prevLabel} title={prevLabel}><Icon name="chevronLeft" /></button>
        <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} aria-label={dateLabel} />
        <button type="button" onClick={onNext} aria-label={nextLabel} title={nextLabel}><Icon name="chevronRight" /></button>
      </div>
      {onToday && value !== today && <button type="button" className="btn btn-secondary btn-sm" onClick={onToday}>Today</button>}
    </>
  );
}
