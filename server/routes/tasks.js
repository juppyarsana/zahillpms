const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET /api/tasks
router.get('/', auth, async (req, res) => {
  const { status, assigned_to, type } = req.query;
  let query = `
    SELECT t.*, u.name as unit_name, us.name as assignee_name
    FROM tasks t
    LEFT JOIN units u ON t.unit_id = u.id
    LEFT JOIN users us ON t.assigned_to = us.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { params.push(status); query += ` AND t.status = $${params.length}`; }
  if (assigned_to) { params.push(assigned_to); query += ` AND t.assigned_to = $${params.length}`; }
  if (type) { params.push(type); query += ` AND t.type = $${params.length}`; }
  query += ' ORDER BY CASE t.priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, t.due_time NULLS LAST';

  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', auth, async (req, res) => {
  const { title, description, type, priority, assigned_to, unit_id, booking_id, due_time } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO tasks (title, description, type, priority, assigned_to, unit_id, booking_id, due_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, description, type || 'housekeeping', priority || 'medium', assigned_to || null, unit_id || null, booking_id || null, due_time || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', auth, async (req, res) => {
  const { title, description, type, priority, status, assigned_to, due_time } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE tasks SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        type = COALESCE($3, type),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        assigned_to = COALESCE($6, assigned_to),
        due_time = COALESCE($7, due_time),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [title, description, type, priority, status, assigned_to, due_time, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
