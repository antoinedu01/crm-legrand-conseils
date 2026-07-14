import React, { useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';

function TwoFactorCard({ user, onChanged }) {
  const [setup, setSetup] = useState(null); // { secret, otpauth, qr }
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function begin() {
    setError(null);
    const res = await api.post('/api/auth/2fa/setup');
    const qr = await QRCode.toDataURL(res.otpauth, { width: 220, margin: 1 });
    setSetup({ ...res, qr });
  }

  async function confirm(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/2fa/enable', { code });
      setSetup(null);
      setCode('');
      setMessage('Double authentification activée ✅ Elle sera demandée à chaque connexion.');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function disable(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/2fa/disable', { code });
      setCode('');
      setMessage('Double authentification désactivée.');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Double authentification (2FA)</h2>
      {message && <div className="alert ok">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      {user?.totp_enabled ? (
        <>
          <p>✅ <strong>Activée.</strong> Un code à 6 chiffres est demandé à chaque connexion.</p>
          <form onSubmit={disable} className="flex">
            <input
              placeholder="Code à 6 chiffres" inputMode="numeric" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ width: 160 }}
            />
            <button className="danger" disabled={code.length !== 6}>Désactiver</button>
          </form>
        </>
      ) : setup ? (
        <>
          <p>1. Ouvrez votre application d’authentification (Google Authenticator, Microsoft
            Authenticator…) et scannez ce code QR :</p>
          <img src={setup.qr} alt="Code QR 2FA" style={{ borderRadius: 8 }} />
          <p className="muted" style={{ fontSize: 12 }}>
            Ou saisissez la clé manuellement : <code>{setup.secret}</code>
          </p>
          <form onSubmit={confirm} className="flex">
            <input
              placeholder="Code affiché par l’app" inputMode="numeric" maxLength={6} autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ width: 180 }}
            />
            <button className="primary" disabled={code.length !== 6}>Confirmer et activer</button>
            <button type="button" className="ghost" onClick={() => setSetup(null)}>Annuler</button>
          </form>
        </>
      ) : (
        <>
          <p className="muted">
            Ajoute un code à 6 chiffres (application gratuite sur votre téléphone) en plus du mot
            de passe. Fortement recommandé maintenant que le CRM est accessible depuis internet.
          </p>
          <button className="primary" onClick={begin}>Activer la 2FA</button>
        </>
      )}
    </div>
  );
}

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
      <div className="grid cols-2 mb">
        <TwoFactorCard user={user} onChanged={onSaved} />
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
          <p>
            <a href="/api/backup" download>
              <button type="button" className="primary">⬇ Télécharger une sauvegarde complète</button>
            </a>
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            Le fichier contient toute la base (clients, contrats, commissions, journal d’audit).
            Conservez-le sur un support chiffré. Pour restaurer : remplacez <code>data/crm.sqlite</code> par ce fichier.
          </p>
          <table className="data">
            <tbody>
              <tr><td>Mot de passe</td><td>haché avec bcrypt (coût 12), jamais stocké en clair</td></tr>
              <tr><td>Session</td><td>cookie httpOnly, expiration après 8 heures</td></tr>
              <tr><td>Force brute</td><td>verrouillage 5 minutes après 5 échecs de connexion</td></tr>
              <tr><td>Traçabilité</td><td>toutes les actions sont inscrites au journal d’audit</td></tr>
              <tr><td>Données</td><td>base SQLite locale (<code>data/crm.sqlite</code>) — hébergez-la en Suisse</td></tr>
              <tr><td>Sauvegardes</td><td>bouton ci-dessus + sauvegarde automatique quotidienne si hébergé (voir DEPLOIEMENT.md)</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
