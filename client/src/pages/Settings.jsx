import React, { useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';

export default function Settings({ user, onSaved }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    finma_reg: user?.finma_reg || '',
    cicero_reg: user?.cicero_reg || '',
    current_password: '',
    new_password: '',
  });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.put('/api/auth/profile', {
        name: form.name,
        finma_reg: form.finma_reg,
        cicero_reg: form.cicero_reg,
        ...(form.new_password
          ? { new_password: form.new_password, current_password: form.current_password }
          : {}),
      });
      setMessage('Profil enregistré.');
      setForm({ ...form, current_password: '', new_password: '' });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <div className="sub">Profil du courtier et sécurité</div>
        </div>
      </div>
      {message && <div className="alert ok">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="grid cols-2">
        <div className="card">
          <h2>Profil courtier</h2>
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nom complet" full>
                <input value={form.name} onChange={set('name')} />
              </Field>
              <Field label="N° registre FINMA (art. 42 LSA)">
                <input value={form.finma_reg} onChange={set('finma_reg')} placeholder="F01…" />
              </Field>
              <Field label="N° Cicero (formation continue)">
                <input value={form.cicero_reg} onChange={set('cicero_reg')} />
              </Field>
              <Field label="Mot de passe actuel">
                <input type="password" value={form.current_password} onChange={set('current_password')} autoComplete="current-password" />
              </Field>
              <Field label="Nouveau mot de passe (10 car. min.)">
                <input type="password" value={form.new_password} onChange={set('new_password')} minLength={10} autoComplete="new-password" />
              </Field>
            </div>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button className="primary">Enregistrer</button>
            </div>
          </form>
        </div>
        <div className="card">
          <h2>Sécurité & sauvegardes</h2>
          <table className="data">
            <tbody>
              <tr><td>Mot de passe</td><td>haché avec bcrypt (coût 12), jamais stocké en clair</td></tr>
              <tr><td>Session</td><td>cookie httpOnly, expiration après 8 heures</td></tr>
              <tr><td>Force brute</td><td>verrouillage 5 minutes après 5 échecs de connexion</td></tr>
              <tr><td>Traçabilité</td><td>toutes les actions sont inscrites au journal d’audit</td></tr>
              <tr><td>Données</td><td>base SQLite locale (<code>data/crm.sqlite</code>) — hébergez-la en Suisse</td></tr>
              <tr><td>Sauvegardes</td><td>copiez régulièrement le dossier <code>data/</code> sur un support chiffré</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
