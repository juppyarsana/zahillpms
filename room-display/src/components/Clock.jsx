import { useState, useEffect } from 'react';

export default function Clock({ large, compact }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const ampm = time.getHours() >= 12 ? 'PM' : 'AM';

  if (compact) {
    return <p className="text-slate-700 text-xs font-mono">{h}:{m}</p>;
  }

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
