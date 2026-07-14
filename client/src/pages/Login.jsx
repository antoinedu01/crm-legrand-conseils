import React, { useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';

export default function Login({ setupDone, onDone }) {
  const [form, setForm] = useState({ email: '', password: '', name: '', finma_reg: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(false);
  const [code, setCode] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setupDone) {
        const res = await api.post('/api/auth/login', { email: form.email, password: form.password });
        if (res.requires2fa) {
          setTwofa(true);
          setBusy(false);
          return;
        }
      } else {
        await api.post('/api/auth/setup', form);
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login/2fa', { code });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (twofa) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <div className="brand">
            <div style={{ fontSize: 34 }}>🔐</div>
            <h1>Vérification</h1>
            <p className="muted">Entrez le code à 6 chiffres de votre application d’authentification</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={submitCode}>
            <Field label="Code à 6 chiffres">
              <input
                inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
                autoComplete="one-time-code"
              />
            </Field>
            <button className="primary" disabled={busy || code.length !== 6}>Valider</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">
          <div style={{ fontSize: 34 }}>🛡️</div>
          <h1>Legrand Conseils</h1>
          <p className="muted">
            {setupDone
              ? 'Connexion à votre CRM de courtage'
              : 'Première utilisation — créez votre compte courtier'}
          </p>
        </div>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={submit}>
          {!setupDone && (
            <>
              <Field label="Nom complet">
                <input required value={form.name} onChange={set('name')} autoComplete="name" />
              </Field>
              <Field label="N° registre FINMA (intermédiaire, optionnel)">
                <input value={form.finma_reg} onChange={set('finma_reg')} placeholder="p. ex. F01…" />
              </Field>
            </>
          )}
          <Field label="Adresse e-mail">
            <input type="email" required value={form.email} onChange={set('email')} autoComplete="username" />
          </Field>
          <Field label={setupDone ? 'Mot de passe' : 'Mot de passe (10 caractères minimum)'}>
            <input
              type="password"
              required
              minLength={setupDone ? undefined : 10}
              value={form.password}
              onChange={set('password')}
              autoComplete={setupDone ? 'current-password' : 'new-password'}
            />
          </Field>
          <button className="primary" disabled={busy}>
            {setupDone ? 'Se connecter' : 'Créer le compte'}
          </button>
        </form>
        <p className="muted mt" style={{ fontSize: 12 }}>
          Données hébergées localement · Accès journalisé (nLPD) · Session limitée à 8 h
        </p>
      </div>
    </div>
  );
}
