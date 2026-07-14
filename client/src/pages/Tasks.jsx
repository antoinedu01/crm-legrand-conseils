import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { fmtDate } from '../labels.js';

function TaskForm({ onSaved, onClose }) {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', due_date: '', priority: 'normale', client_id: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    api.get('/api/clients').then((rows) => setClients(rows.filter((c) => c.status !== 'anonymise')));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/tasks', { ...form, client_id: form.client_id || null });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Nouvelle tâche" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Titre" full>
            <input required value={form.title} onChange={set('title')} />
          </Field>
          <Field label="Échéance">
            <input type="date" value={form.due_date} onChange={set('due_date')} />
          </Field>
          <Field label="Priorité">
            <select value={form.priority} onChange={set('priority')}>
              <option value="basse">Basse</option>
              <option value="normale">Normale</option>
              <option value="haute">Haute</option>
            </select>
          </Field>
          <Field label="Client lié (optionnel)" full>
            <select value={form.client_id} onChange={set('client_id')}>
              <option value="">—</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          </Field>
          <Field label="Description" full>
            <textarea rows={3} value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Créer</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Tasks() {
  const [showDone, setShowDone] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/tasks'), []);

  const today = new Date().toISOString().slice(0, 10);
  const tasks = (data || []).filter((t) => showDone || t.status === 'ouverte');

  async function toggle(t) {
    await api.put(`/api/tasks/${t.id}`, { status: t.status === 'ouverte' ? 'terminee' : 'ouverte' });
    reload();
  }
  async function remove(t) {
    if (!window.confirm('Supprimer cette tâche ?')) return;
    await api.del(`/api/tasks/${t.id}`);
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tâches & rappels</h1>
          <div className="sub">{(data || []).filter((t) => t.status === 'ouverte').length} tâche(s) ouverte(s)</div>
        </div>
        <div className="flex">
          <label className="check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Afficher les terminées
          </label>
          <button className="primary" onClick={() => setShowForm(true)}>+ Nouvelle tâche</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : tasks.length === 0 ? (
          <Empty>Aucune tâche. Utilisez les tâches pour vos relances, renouvellements et suivis.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr><th></th><th>Tâche</th><th>Client</th><th>Échéance</th><th>Priorité</th><th></th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const overdue = t.status === 'ouverte' && t.due_date && t.due_date < today;
                return (
                  <tr key={t.id} style={t.status === 'terminee' ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input type="checkbox" checked={t.status === 'terminee'} onChange={() => toggle(t)}
                             aria-label="Marquer comme terminée" />
                    </td>
                    <td>
                      <strong style={t.status === 'terminee' ? { textDecoration: 'line-through' } : undefined}>{t.title}</strong>
                      {t.description && <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>}
                    </td>
                    <td>{t.client_id ? <Link to={`/clients/${t.client_id}`}>{t.client_name}</Link> : '—'}</td>
                    <td>
                      {fmtDate(t.due_date)}
                      {overdue && <> <Badge value="haute" label="En retard" /></>}
                    </td>
                    <td><Badge value={t.priority} label={{ basse: 'Basse', normale: 'Normale', haute: 'Haute' }[t.priority]} /></td>
                    <td className="right">
                      <button className="small danger" onClick={() => remove(t)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {showForm && <TaskForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />}
    </>
  );
}
