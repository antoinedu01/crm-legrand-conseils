import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { fmtCHF } from '../labels.js';

function CompanyForm({ initial, onSaved, onClose }) {
  const [form, setForm] = useState({
    name: '', finma_number: '', contact_name: '', contact_email: '', contact_phone: '',
    default_acq_rate: 0, default_rec_rate: 0, notes: '', active: 1,
    ...initial,
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (initial?.id) await api.put(`/api/companies/${initial.id}`, form);
      else await api.post('/api/companies', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={initial?.id ? 'Modifier la compagnie' : 'Nouvelle compagnie'} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nom" full>
            <input required value={form.name} onChange={set('name')} />
          </Field>
          <Field label="N° FINMA (assureur)">
            <input value={form.finma_number || ''} onChange={set('finma_number')} />
          </Field>
          <div />
          <Field label="Personne de contact">
            <input value={form.contact_name || ''} onChange={set('contact_name')} />
          </Field>
          <Field label="Téléphone">
            <input value={form.contact_phone || ''} onChange={set('contact_phone')} />
          </Field>
          <Field label="E-mail" full>
            <input type="email" value={form.contact_email || ''} onChange={set('contact_email')} />
          </Field>
          <Field label="Taux acquisition par défaut (%)">
            <input type="number" min="0" step="0.01" value={form.default_acq_rate ?? 0} onChange={set('default_acq_rate')} />
          </Field>
          <Field label="Taux récurrent par défaut (%)">
            <input type="number" min="0" step="0.01" value={form.default_rec_rate ?? 0} onChange={set('default_rec_rate')} />
          </Field>
          <Field label="Notes" full>
            <textarea rows={2} value={form.notes || ''} onChange={set('notes')} />
          </Field>
          <label className="check full">
            <input type="checkbox" checked={!!form.active} onChange={set('active')} />
            Partenaire actif
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Companies() {
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/companies'), []);

  async function remove(co) {
    if (!window.confirm(`Supprimer ${co.name} ?`)) return;
    try {
      await api.del(`/api/companies/${co.id}`);
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compagnies partenaires</h1>
          <div className="sub">Vos partenaires d’assurance et leurs conditions de commissionnement</div>
        </div>
        <button className="primary" onClick={() => setEditing({})}>+ Nouvelle compagnie</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucune compagnie enregistrée.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Compagnie</th><th>Contact</th><th className="num">Taux acq. / réc.</th>
                <th className="num">Contrats actifs</th><th className="num">Comm. perçues</th>
                <th className="num">Comm. attendues</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((co) => (
                <tr key={co.id} style={co.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <strong>{co.name}</strong>
                    {!co.active && <span className="muted"> · inactif</span>}
                    {co.finma_number && <div className="muted" style={{ fontSize: 12 }}>FINMA {co.finma_number}</div>}
                  </td>
                  <td>{co.contact_name || '—'}{co.contact_email && <div className="muted" style={{ fontSize: 12 }}>{co.contact_email}</div>}</td>
                  <td className="num">{co.default_acq_rate || 0}% / {co.default_rec_rate || 0}%</td>
                  <td className="num">{co.active_contracts}</td>
                  <td className="num">{fmtCHF(co.commissions_paid)}</td>
                  <td className="num">{fmtCHF(co.commissions_pending)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" onClick={() => setEditing(co)}>Modifier</button>{' '}
                    <button className="small danger" onClick={() => remove(co)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing !== null && (
        <CompanyForm
          initial={editing.id ? editing : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}
