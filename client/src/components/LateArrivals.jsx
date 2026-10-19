import { useEffect, useState } from 'react';
import api from '../services/api';

// "Marked no-show last night" — bookings the night audit (03:00) marked
// no-show whose stay isn't over yet. A guest who turns up later still is put
// back here with one press and checked in (Check-in / out, Quick Check-in).
// onRestored({ bookingIds, groupId }) — the parent reloads its arrivals and,
// for a single booking, opens the check-in.
const TEXT = {
  en: {
    title: 'Marked no-show last night',
    hint: 'The guest arrived after all? Put the booking back and check them in.',
    one: 'Arrived late — check in',
    group: n => `Arrived late — put all ${n} rooms back`,
    confirmOne: b => `${b.guest_name} (room ${b.unit_name}) arrived late? The no-show is undone and the check-in opens.`,
    confirmGroup: (name, n) => `The group of ${name} arrived late? All ${n} rooms are put back; then use Check In Whole Group.`,
    working: 'Working…',
    rooms: n => `${n} rooms`,
    due: d => `was due ${d}`,
  },
  id: {
    title: 'Ditandai no-show tadi malam',
    hint: 'Tamu ternyata datang? Kembalikan bookingnya lalu check-in.',
    one: 'Datang terlambat — check-in',
    group: n => `Datang terlambat — kembalikan ${n} kamar`,
    confirmOne: b => `${b.guest_name} (kamar ${b.unit_name}) datang terlambat? Status no-show dibatalkan dan check-in dibuka.`,
    confirmGroup: (name, n) => `Grup ${name} datang terlambat? Semua ${n} kamar dikembalikan; lalu tekan Check In Semua.`,
    working: 'Memproses…',
    rooms: n => `${n} kamar`,
    due: d => `seharusnya ${d}`,
  },
};

function fmtDay(d, lang) {
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short' });
}

export default function LateArrivals({ lang = 'en', refreshKey, onRestored }) {
  const t = TEXT[lang];
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/bookings/late-no-shows').then(r => setRows(r.data)).catch(() => setRows([]));
  }, [refreshKey]);

  if (!rows.length) return null;

  // Singles first, then one entry per group.
  const items = [];
  const groups = new Map();
  for (const b of rows) {
    if (!b.reservation_group_id) { items.push({ key: b.id, single: b }); continue; }
    if (!groups.has(b.reservation_group_id)) {
      const g = { key: b.reservation_group_id, groupId: b.reservation_group_id, booker: b.group_booker, rooms: [] };
      groups.set(b.reservation_group_id, g);
      items.push(g);
    }
    groups.get(b.reservation_group_id).rooms.push(b);
  }

  async function restore(item) {
    const msg = item.single ? t.confirmOne(item.single) : t.confirmGroup(item.booker || item.rooms[0].guest_name, item.rooms.length);
    if (!window.confirm(msg)) return;
    setBusy(item.key); setError('');
    try {
      if (item.single) {
        await api.put(`/api/bookings/${item.single.id}/undo-no-show`, { late_arrival: true });
        onRestored?.({ bookingIds: [item.single.id] });
      } else {
        await api.put(`/api/bookings/group/${item.groupId}/undo-no-show`, { late_arrival: true });
        onRestored?.({ bookingIds: item.rooms.map(r => r.id), groupId: item.groupId });
      }
      setRows(rs => rs.filter(r => item.single ? r.id !== item.single.id : r.reservation_group_id !== item.groupId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card mb-3" style={{ borderColor: '#FED7AA', background: '#FFF7ED' }}>
      <div className="card-title" style={{ color: '#9A3412' }}>🌙 {t.title} ({rows.length})</div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>{t.hint}</div>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}><div>{error}</div></div>}
      {items.map(item => {
        const first = item.single || item.rooms[0];
        return (
          <div key={item.key} className="guest-row" style={{ marginBottom: 8, background: '#fff', cursor: 'default', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {item.single ? first.guest_name : `👥 ${item.booker || first.guest_name} · ${t.rooms(item.rooms.length)}`}
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {item.single ? first.unit_name : item.rooms.map(r => r.unit_name).join(', ')}
                {' · '}{t.due(fmtDay(first.check_in_date, lang))} → {fmtDay(first.check_out_date, lang)}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy === item.key} onClick={() => restore(item)}>
              {busy === item.key ? t.working : item.single ? t.one : t.group(item.rooms.length)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
