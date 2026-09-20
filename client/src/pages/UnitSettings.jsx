import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';

const STATUS_OPTIONS = [
  ['available', 'available'],
  ['occupied', 'occupied'],
  ['out_of_order', 'Out of Order'],
];
const STATUS_BADGE = { available: 'green', occupied: 'yellow', out_of_order: 'red' };
const STATUS_COLOR = { available: '#16a34a', occupied: '#ca8a04', out_of_order: '#dc2626' };
const STATUS_LABEL = { available: 'Available', occupied: 'Occupied', out_of_order: 'Out of order' };

const BED_CONFIGS = [
  ['double', 'Double bed'],
  ['twin', 'Twin beds'],
  ['twin_or_double', 'Twin or double'],
  ['other', 'Other'],
];
const bedLabel = v => { const m = BED_CONFIGS.find(b => b[0] === v); return m ? m[1] : (v || '—'); };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
const errText = (err, fallback) => err.response?.data?.error || fallback;
const naturalByName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

const EMPTY_TYPE = { name: '', base_rate: '', max_guests: 2, description: '' };

// Local styles for the room tiles and the expand chevron.
const CSS = `
.us-tile { position: relative; border: 1px solid var(--border); border-radius: 12px; background: var(--white);
  padding: 12px 14px; transition: box-shadow .15s, border-color .15s; }
.us-tile:hover { border-color: var(--green-dark); box-shadow: var(--shadow-sm); }
.us-chev { width: 30px; height: 30px; border-radius: 50%; border: 0; background: transparent; color: var(--text-muted);
  font-size: 14px; display: inline-flex; align-items: center; justify-content: center; transition: transform .15s, background .15s; }
.us-chev:hover { background: var(--green-light); }
.us-chev.open { transform: rotate(90deg); }
`;

// Room types own the name, base rate and max guests (migration 062); rooms belong to a type.
export default function UnitSettings() {
  const [types, setTypes] = useState([]);
  const [units, setUnits] = useState([]);
  const [msg, setMsg] = useState('');
  // Accordion: only one room type open at a time, and all start collapsed on landing.
  const [openId, setOpenId] = useState(null);

  // room type editing / creating
  const [editingType, setEditingType] = useState(null);   // room type id, or 'new'
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE);
  const [typeError, setTypeError] = useState('');
  const [confirmDeleteType, setConfirmDeleteType] = useState(null);
  const [typeDeleteError, setTypeDeleteError] = useState('');

  // room editing / creating / deleting
  const [editing, setEditing] = useState(null);           // unit id
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [addingTo, setAddingTo] = useState(null);         // room type id
  const [addForm, setAddForm] = useState({ name: '', bed_config: 'double', description: '' });
  const [addError, setAddError] = useState('');

  async function load() {
    const [t, u] = await Promise.all([api.get('/api/room-types'), api.get('/api/units')]);
    setTypes(t.data);
    setUnits(u.data);
  }
  useEffect(() => { load(); }, []);

  function flash(text, ms = 2500) { setMsg(text); setTimeout(() => setMsg(''), ms); }

  const groups = useMemo(() => types.map(t => ({
    ...t, units: units.filter(u => u.room_type_id === t.id).sort(naturalByName),
  })), [types, units]);

  const totals = useMemo(() => {
    const c = { available: 0, occupied: 0, out_of_order: 0 };
    for (const u of units) if (c[u.status] !== undefined) c[u.status]++;
    return c;
  }, [units]);

  // ── room types ──
  function openEditType(t) {
    setEditingType(t.id);
    setTypeForm({ name: t.name, base_rate: t.base_rate, max_guests: t.max_guests, description: t.description || '' });
    setTypeError(''); setConfirmDeleteType(null); setEditing(null); setAddingTo(null);
  }
  function openNewType() {
    setEditingType('new'); setTypeForm(EMPTY_TYPE); setTypeError(''); setEditing(null); setAddingTo(null);
  }
  async function saveType() {
    setTypeError('');
    try {
      const body = { ...typeForm, base_rate: Number(typeForm.base_rate || 0), max_guests: Number(typeForm.max_guests || 2) };
      if (editingType === 'new') await api.post('/api/room-types', body);
      else await api.put(`/api/room-types/${editingType}`, body);
      setEditingType(null);
      flash(editingType === 'new' ? 'Room type added!' : 'Room type saved — all its rooms were updated.');
      load();
    } catch (err) { setTypeError(errText(err, 'Failed to save')); }
  }
  async function deleteType(id) {
    setTypeDeleteError('');
    try {
      await api.delete(`/api/room-types/${id}`);
      setConfirmDeleteType(null);
      flash('Room type deleted.');
      load();
    } catch (err) { setTypeDeleteError(errText(err, 'Failed to delete')); }
  }
  const setT = (k, v) => setTypeForm(f => ({ ...f, [k]: v }));

  // ── rooms ──
  function openEdit(unit) {
    setEditing(unit.id);
    setForm({
      name: unit.name, room_type_id: unit.room_type_id, description: unit.description || '',
      status: unit.status, bed_config: unit.bed_config || 'double', controller_id: unit.controller_id || '',
    });
    setError(''); setConfirmDelete(null); setEditingType(null); setAddingTo(null);
  }
  async function save(id) {
    setError('');
    try {
      await api.put(`/api/units/${id}`, form);
      setEditing(null);
      flash('Saved!', 2000);
      load();
    } catch (err) { setError(errText(err, 'Failed to save')); }
  }
  async function deleteUnit(id) {
    setDeleteError('');
    try {
      await api.delete(`/api/units/${id}`);
      setConfirmDelete(null);
      flash('Unit deleted.');
      load();
    } catch (err) { setDeleteError(errText(err, 'Failed to delete')); }
  }
  async function addUnit(typeId) {
    setAddError('');
    if (!addForm.name.trim()) { setAddError('Room name is required'); return; }
    try {
      await api.post('/api/units', { ...addForm, room_type_id: typeId });
      setAddForm({ name: '', bed_config: 'double', description: '' });
      setAddingTo(null);
      flash('Room added!');
      load();
    } catch (err) { setAddError(errText(err, 'Failed to add room')); }
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setA = (k, v) => setAddForm(f => ({ ...f, [k]: v }));
  const toggleOpen = id => setOpenId(prev => (prev === id ? null : id));

  const typeFormFields = (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Room Type Name *</label>
          <input className="form-input" placeholder="e.g. Deluxe Pool View" value={typeForm.name} onChange={e => setT('name', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Base Rate / Night (IDR)</label>
          <input className="form-input" type="number" min={0} placeholder="0" value={typeForm.base_rate} onChange={e => setT('base_rate', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Max Guests</label>
          <input className="form-input" type="number" min={1} max={20} value={typeForm.max_guests} onChange={e => setT('max_guests', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <input className="form-input" placeholder="Short description of this room type…" value={typeForm.description} onChange={e => setT('description', e.target.value)} />
      </div>
    </>
  );

  const summary = [
    ['Room types', types.length, null],
    ['Total rooms', units.length, null],
    ['Available', totals.available, STATUS_COLOR.available],
    ['Occupied', totals.occupied, STATUS_COLOR.occupied],
    ['Out of order', totals.out_of_order, STATUS_COLOR.out_of_order],
  ];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <style>{CSS}</style>

      <div className="page-header">
        <div>
          <div className="page-title">Unit Settings</div>
          <div className="page-subtitle">Rooms grouped by room type — set the rate and capacity once per type</div>
        </div>
        <button className="btn btn-primary" onClick={openNewType}>+ Add Room Type</button>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}

      {/* ── at-a-glance summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {summary.map(([label, value, color]) => (
          <div key={label} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            {color && <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />}
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {editingType === 'new' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>New Room Type</div>
          {typeFormFields}
          {typeError && <div className="alert alert-error">{typeError}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={saveType}>Add Room Type</button>
            <button className="btn btn-secondary" onClick={() => setEditingType(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {groups.map(g => {
          const open = openId === g.id;
          const counts = { available: 0, occupied: 0, out_of_order: 0 };
          for (const u of g.units) if (counts[u.status] !== undefined) counts[u.status]++;
          return (
            <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid var(--green-dark)',
              // Open state uses ONLY box-shadow: toggling `borderColor` here used to wipe the left accent's colour
              // once a card was closed again (React clears the shorthand, which also clears border-left-color).
              boxShadow: open ? '0 6px 20px rgba(0,0,0,0.10), 0 0 0 1px var(--green-dark)' : undefined }}>
              {/* ── room type header ── */}
              <div style={{ padding: '16px 20px' }}>
                {editingType === g.id ? (
                  <>
                    {typeFormFields}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Saving updates all {g.rooms} room{g.rooms === 1 ? '' : 's'} of this type at once. Existing bookings keep the price they were made at; new quotes use the new rate.
                    </div>
                    {typeError && <div className="alert alert-error">{typeError}</div>}
                    <div className="flex gap-2">
                      <button className="btn btn-primary" onClick={saveType}>Save Room Type</button>
                      <button className="btn btn-secondary" onClick={() => setEditingType(null)}>Cancel</button>
                    </div>
                  </>
                ) : confirmDeleteType === g.id ? (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete room type "{g.name}"?</div>
                    {typeDeleteError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{typeDeleteError}</div>}
                    <div className="flex gap-2">
                      <button className="btn btn-danger" onClick={() => deleteType(g.id)}>Yes, Delete</button>
                      <button className="btn btn-secondary" onClick={() => { setConfirmDeleteType(null); setTypeDeleteError(''); }}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* the whole row toggles the type; the action buttons stop the click from bubbling */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', cursor: 'pointer' }}
                      onClick={() => toggleOpen(g.id)} role="button" aria-expanded={open}>
                      <span className={`us-chev${open ? ' open' : ''}`} aria-hidden="true">▶</span>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: open ? 'var(--green-dark)' : 'var(--green-pale)', color: open ? '#fff' : 'var(--green-dark)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0, transition: 'background .15s, color .15s' }}>
                        {initials(g.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>{g.name}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                          {g.rooms} room{g.rooms === 1 ? '' : 's'} · Max {g.max_guests} guest{g.max_guests === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-dark)', lineHeight: 1.1 }}>{fmtIDR(g.base_rate)}</div>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>per night · base rate</div>
                      </div>
                      <div className="flex gap-2" style={{ alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-secondary" onClick={() => { setAddingTo(g.id); setAddError(''); setEditing(null); setEditingType(null); setOpenId(g.id); }}>+ Add Room</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEditType(g)}>Edit Type</button>
                        <button className="btn btn-sm btn-danger" title={g.rooms > 0 ? 'Move or delete its rooms first' : 'Delete room type'}
                          onClick={() => { setConfirmDeleteType(g.id); setTypeDeleteError(''); setEditingType(null); }}>🗑</button>
                      </div>
                    </div>

                    {g.description && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, marginLeft: 88, maxWidth: 640 }}>{g.description}</div>
                    )}

                    {/* collapsed preview: which rooms are inside, without having to open the card */}
                    {!open && g.units.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginLeft: 88, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'calc(100% - 88px)' }}>
                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10, marginRight: 8 }}>Rooms</span>
                        {g.units.map(u => u.name).join(' · ')}
                      </div>
                    )}

                    {/* availability bar */}
                    {g.rooms > 0 && (
                      <div style={{ marginTop: 14, marginLeft: 88 }}>
                        <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: '#eceae5' }}>
                          {Object.keys(counts).map(k => counts[k] > 0 && (
                            <div key={k} title={`${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`} style={{ width: `${(counts[k] / g.rooms) * 100}%`, background: STATUS_COLOR[k] }} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                          {Object.keys(counts).filter(k => counts[k] > 0).map(k => (
                            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[k] }} />
                              {counts[k]} {STATUS_LABEL[k].toLowerCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── rooms in this type ── */}
              {open && (
                <div style={{ padding: '16px 20px 20px', background: '#faf9f6', borderTop: '1px solid var(--border)' }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Rooms in {g.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {g.units.length}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Each room can have its own bed setup, Room ID and status. The rate and max guests come from the room type above — use “Edit Type” to change them for every room at once.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                    {g.units.map(unit => (
                      editing === unit.id ? (
                        <div key={unit.id} className="us-tile" style={{ gridColumn: '1 / -1', borderColor: 'var(--green-dark)' }}>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label">Room Name</label>
                              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Room Type</label>
                              <select className="form-select" value={form.room_type_id} onChange={e => set('room_type_id', e.target.value)}>
                                {types.map(t => <option key={t.id} value={t.id}>{t.name} — {fmtIDR(t.base_rate)}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label">Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(this room only, optional)</span></label>
                            <input className="form-input" placeholder="Short description…" value={form.description} onChange={e => set('description', e.target.value)} />
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label">Status</label>
                              <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                                {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </div>
                            <div className="form-group">
                              <label className="form-label">Bed Configuration</label>
                              <select className="form-select" value={form.bed_config || 'double'} onChange={e => set('bed_config', e.target.value)}>
                                {BED_CONFIGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Room ID <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                                (for Room Display / TV Display / calling — not shown to guests, defaults to the room name, leave blank to unassign)
                              </span>
                            </label>
                            <input className="form-input" placeholder="e.g. 101" maxLength={32}
                              value={form.controller_id} onChange={e => set('controller_id', e.target.value)} style={{ maxWidth: 200 }} />
                          </div>
                          {error && <div className="alert alert-error">{error}</div>}
                          <div className="flex gap-2">
                            <button className="btn btn-primary" onClick={() => save(unit.id)}>Save</button>
                            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : confirmDelete === unit.id ? (
                        <div key={unit.id} className="us-tile" style={{ gridColumn: '1 / -1', borderColor: '#dc2626' }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Delete "{unit.name}"?</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                            This cannot be undone. Units with active bookings cannot be deleted.
                          </div>
                          {deleteError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{deleteError}</div>}
                          <div className="flex gap-2">
                            <button className="btn btn-danger" onClick={() => deleteUnit(unit.id)}>Yes, Delete</button>
                            <button className="btn btn-secondary" onClick={() => { setConfirmDelete(null); setDeleteError(''); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div key={unit.id} className="us-tile">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 17 }}>{unit.name}</span>
                            <span className={`badge badge-${STATUS_BADGE[unit.status] || 'gray'}`}>{unit.status === 'out_of_order' ? 'Out of Order' : unit.status}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            🛏 {bedLabel(unit.bed_config || 'double')}
                            {unit.controller_id && unit.controller_id !== unit.name && <> · Room ID {unit.controller_id}</>}
                          </div>
                          {unit.description && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{unit.description}</div>
                          )}
                          {/* always visible — hidden hover-only actions made it unclear the rooms were editable */}
                          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => openEdit(unit)}>Edit</button>
                            <button className="btn btn-sm btn-danger" title="Delete room" onClick={() => { setConfirmDelete(unit.id); setDeleteError(''); setEditing(null); }}>🗑</button>
                          </div>
                        </div>
                      )
                    ))}

                    {addingTo === g.id && (
                      <div className="us-tile" style={{ gridColumn: '1 / -1', borderColor: 'var(--green-dark)', borderStyle: 'dashed' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>
                          New room in {g.name} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>({fmtIDR(g.base_rate)}/night, max {g.max_guests} guests)</span>
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Room Name *</label>
                            <input className="form-input" placeholder="e.g. 110" autoFocus value={addForm.name} onChange={e => setA('name', e.target.value)} />
                          </div>
                          <div className="form-group">
                            <label className="form-label">Bed Configuration</label>
                            <select className="form-select" value={addForm.bed_config} onChange={e => setA('bed_config', e.target.value)}>
                              {BED_CONFIGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                        </div>
                        {addError && <div className="alert alert-error">{addError}</div>}
                        <div className="flex gap-2">
                          <button className="btn btn-primary" onClick={() => addUnit(g.id)}>Add Room</button>
                          <button className="btn btn-secondary" onClick={() => { setAddingTo(null); setAddError(''); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {g.units.length === 0 && addingTo !== g.id && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>
                      No rooms in this type yet. Use “+ Add Room” above.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No room types yet. Create one with “+ Add Room Type”, then add rooms to it.
          </div>
        )}
      </div>
    </div>
  );
}
