import { useState, useEffect } from 'react';
import api from '../services/api';

const COLS = ['todo', 'in_progress', 'done'];
const COL_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const PRIORITY_BADGE = { high: 'red', medium: 'orange', low: 'gray' };
const TYPE_ICONS = { housekeeping: '🧹', maintenance: '🔧', supplies: '📦', grounds: '🌿', guest_request: '🙋' };

export default function Operations() {
  const [tasks, setTasks] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'housekeeping', priority: 'medium', status: 'todo', description: '', due_time: '' });
  const [error, setError] = useState('');

  async function load() {
    const r = await api.get('/api/tasks');
    setTasks(r.data);
  }
  useEffect(() => { load(); }, []);

  async function createTask() {
    if (!form.title.trim()) { setError('Title required'); return; }
    try {
      await api.post('/api/tasks', form);
      setModal(false);
      setForm({ title: '', type: 'housekeeping', priority: 'medium', status: 'todo', description: '', due_time: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error');
    }
  }

  async function moveTask(task, newStatus) {
    await api.put(`/api/tasks/${task.id}`, { status: newStatus });
    load();
  }

  async function deleteTask(id) {
    if (!confirm('Delete task?')) return;
    await api.delete(`/api/tasks/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Operations Board</div>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ New Task</button>
      </div>

      <div className="kanban">
        {COLS.map(col => (
          <div key={col} className="kanban-col">
            <div className="kanban-col-title">
              {COL_LABELS[col]} · {tasks.filter(t => t.status === col).length}
            </div>
            {tasks.filter(t => t.status === col).map(t => (
              <div key={t.id} className="task-card">
                <div className="flex-between">
                  <div className="task-title">{TYPE_ICONS[t.type]} {t.title}</div>
                  <button className="btn btn-icon" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => deleteTask(t.id)}>✕</button>
                </div>
                {t.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t.description}</div>}
                <div className="task-meta">
                  <span className={`badge badge-${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                  {t.unit_name && <span>📍 {t.unit_name}</span>}
                  {t.assignee_name && <span>👤 {t.assignee_name}</span>}
                  {t.due_time && <span>⏰ {t.due_time?.slice(0,16)}</span>}
                </div>
                <div className="flex gap-2 mt-2">
                  {col !== 'todo' && <button className="btn btn-sm btn-secondary" onClick={() => moveTask(t, COLS[COLS.indexOf(col)-1])}>← Back</button>}
                  {col !== 'done' && <button className="btn btn-sm btn-primary" onClick={() => moveTask(t, COLS[COLS.indexOf(col)+1])}>→ Next</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">New Task</div>
              <button className="btn btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-input" value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} autoFocus />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-select" value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}>
                    <option value="housekeeping">Housekeeping</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="supplies">Supplies</option>
                    <option value="grounds">Grounds</option>
                    <option value="guest_request">Guest Request</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={form.priority} onChange={e => setForm(f=>({...f,priority:e.target.value}))}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Time</label>
                <input className="form-input" type="datetime-local" value={form.due_time} onChange={e => setForm(f=>({...f,due_time:e.target.value}))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createTask}>Create Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
