import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clients from './pages/Clients.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import Contracts from './pages/Contracts.jsx';
import Companies from './pages/Companies.jsx';
import Commissions from './pages/Commissions.jsx';
import Tasks from './pages/Tasks.jsx';
import Compliance from './pages/Compliance.jsx';
import Settings from './pages/Settings.jsx';
import Development from './pages/Development.jsx';
import Acquisition from './pages/Acquisition.jsx';

const NAV = [
  ['/', '📊', 'Tableau de bord'],
  ['/developpement', '📈', 'Développement'],
  ['/acquisition', '🎯', 'Acquisition'],
  ['/clients', '👥', 'Clients'],
  ['/contrats', '📄', 'Contrats'],
  ['/commissions', '💰', 'Commissions'],
  ['/compagnies', '🏢', 'Compagnies'],
  ['/taches', '✅', 'Tâches'],
  ['/conformite', '🛡️', 'Conformité'],
  ['/parametres', '⚙️', 'Paramètres'],
];

export default function App() {
  const [auth, setAuth] = useState(null); // null = chargement

  const refresh = useCallback(() => {
    api.get('/api/auth/status').then(setAuth).catch(() => setAuth({ setupDone: true, authenticated: false }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUnauthorized = () => setAuth((a) => (a ? { ...a, authenticated: false, user: null } : a));
    window.addEventListener('crm:unauthorized', onUnauthorized);
    return () => window.removeEventListener('crm:unauthorized', onUnauthorized);
  }, []);

  if (auth === null) return null;
  if (!auth.authenticated) return <Login setupDone={auth.setupDone} onDone={refresh} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>🛡️</span>
          <div>
            Legrand Conseils
            <small>CRM Courtage — Suisse</small>
          </div>
        </div>
        {NAV.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>
            <span aria-hidden>{icon}</span> {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          {auth.user?.name}
          <br />
          <button
            className="ghost small"
            style={{ padding: 0 }}
            onClick={() => api.post('/api/auth/logout').then(refresh)}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/developpement" element={<Development />} />
          <Route path="/acquisition" element={<Acquisition />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/contrats" element={<Contracts />} />
          <Route path="/commissions" element={<Commissions />} />
          <Route path="/compagnies" element={<Companies />} />
          <Route path="/taches" element={<Tasks />} />
          <Route path="/conformite" element={<Compliance />} />
          <Route path="/parametres" element={<Settings user={auth.user} onSaved={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
