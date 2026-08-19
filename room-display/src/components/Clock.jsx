import { useState, useEffect } from 'react';

export default function Clock({ large, compact }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours24 = time.getHours();
  const m = time.getMinutes().toString().padStart(2, '0');

  if (compact) {
    const h24 = hours24.toString().padStart(2, '0');
    return <p className="text-slate-700 text-xs font-mono">{h24}:{m}</p>;
  }

  // getHours() is 24-hour — convert to 12-hour before pairing with AM/PM,
  // otherwise afternoon/evening shows e.g. "13:44 PM".
  const h = (hours24 % 12 || 12).toString().padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';

  if (large) {
    return (
      <p className="text-3xl font-light text-white tracking-tighter">
        {h}:{m} <span className="text-sm font-bold" style={{ color: '#c9a227' }}>{ampm}</span>
      </p>
    );
  }

  return (
    <p className="text-2xl font-light text-white tracking-tighter">
      {h}:{m} <span className="text-xs font-bold" style={{ color: '#c9a227' }}>{ampm}</span>
    </p>
  );
}
