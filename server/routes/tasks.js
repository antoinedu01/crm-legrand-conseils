import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT t.*, cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type,
      ct.policy_number
    FROM tasks t
    LEFT JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN contracts ct ON ct.id = t.contract_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  sql += " ORDER BY t.status, COALESCE(t.due_date, '9999') , t.priority = 'haute' DESC";
  res.json(
    db.prepare(sql).all(...params).map((r) => ({
      ...r,
      client_name:
        r.client_type === 'entreprise'
          ? r.client_company
          : [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
    }))
  );
});

tasksRouter.post('/', (req, res) => {
  const { title, description, due_date, priority, client_id, contract_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Le titre est requis.' });
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, due_date, priority, client_id, contract_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(title, description || null, due_date || null, priority || 'normale', client_id || null, contract_id || null);
  audit(req, 'création tâche', 'task', info.lastInsertRowid, title);
  res.status(201).json({ id: info.lastInsertRowid });
});

tasksRouter.put('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  const { title, description, due_date, priority, status } = req.body || {};
  db.prepare(
    `UPDATE tasks SET
      title = COALESCE(?, title), description = COALESCE(?, description),
      due_date = COALESCE(?, due_date), priority = COALESCE(?, priority),
      status = COALESCE(?, status),
      completed_at = CASE WHEN ? = 'terminee' THEN datetime('now')
                          WHEN ? = 'ouverte' THEN NULL ELSE completed_at END
     WHERE id = ?`
  ).run(title || null, description || null, due_date || null, priority || null,
        status || null, status || null, status || null, task.id);
  audit(req, 'modification tâche', 'task', task.id, status || '');
  res.json({ ok: true });
});

tasksRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  audit(req, 'suppression tâche', 'task', Number(req.params.id));
  res.json({ ok: true });
});
