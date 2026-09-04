import { useState } from 'react';

// 24hr "HH:MM" <-> 12hr {hour, minute, ampm} — the picker works in 12hr
// (what a guest expects to tap), the stored/compared value stays 24hr.
export function to12(timeStr) {
  const [h, m] = (timeStr || '07:00').split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hour = h % 12;
  if (hour === 0) hour = 12;
  return { hour, minute: m, ampm };
}

export function to24(hour, minute, ampm) {
  let h = hour % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDisplay(timeStr) {
  const { hour, minute, ampm } = to12(timeStr);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// Large-target stepper picker for a touch tablet — the native <input
// type="time"> dropdown's scroll wheels are too small/fiddly to tap
// reliably on a kiosk screen.
export default function AlarmTimePicker({ time, onChange, onClose }) {
  const initial = to12(time);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [ampm, setAmpm] = useState(initial.ampm);

  const commit = (h, m, ap) => onChange(to24(h, m, ap));

  const bumpHour = (delta) => {
    let h = hour + delta;
    if (h > 12) h = 1;
    if (h < 1) h = 12;
    setHour(h);
    commit(h, minute, ampm);
  };
  const bumpMinute = (delta) => {
    let m = minute + delta;
    if (m > 55) m = 0;
    if (m < 0) m = 55;
    setMinute(m);
    commit(hour, m, ampm);
  };
  const setPeriod = (next) => {
    if (next === ampm) return;
    setAmpm(next);
    commit(hour, minute, next);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-7 p-8 rounded-3xl"
        style={{ background: 'var(--pane)', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,0.4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent">Set Alarm</p>

        <div className="flex items-center gap-3">
          <Stepper value={String(hour).padStart(2, '0')} onUp={() => bumpHour(1)} onDown={() => bumpHour(-1)} />
          <span className="text-5xl font-light text-ink" style={{ marginTop: -8 }}>:</span>
          <Stepper value={String(minute).padStart(2, '0')} onUp={() => bumpMinute(5)} onDown={() => bumpMinute(-5)} />
          <div className="flex flex-col gap-2 ml-3">
            <PeriodButton label="AM" active={ampm === 'AM'} onClick={() => setPeriod('AM')} />
            <PeriodButton label="PM" active={ampm === 'PM'} onClick={() => setPeriod('PM')} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            padding: '14px 40px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--accent-contrast)',
            fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Stepper({ value, onUp, onDown }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <StepperButton icon="keyboard_arrow_up" onClick={onUp} />
      <span className="text-5xl font-light text-ink" style={{ width: 84, textAlign: 'center' }}>{value}</span>
      <StepperButton icon="keyboard_arrow_down" onClick={onDown} />
    </div>
  );
}

function StepperButton({ icon, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 56, height: 56, borderRadius: '50%', border: '1px solid var(--border)',
        background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 28 }}>{icon}</span>
    </button>
  );
}

function PeriodButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 20px', borderRadius: 14, border: 'none', cursor: 'pointer',
        background: active ? 'var(--accent)' : 'var(--surface)',
        color: active ? 'var(--accent-contrast)' : 'var(--text)',
        fontWeight: 800, fontSize: 13, letterSpacing: '0.05em',
      }}
    >
      {label}
    </button>
  );
}
