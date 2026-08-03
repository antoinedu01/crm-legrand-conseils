import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { NavigationGuardProvider, useNavigationGuard } from './navigationGuard.jsx';
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
import Households from './pages/Households.jsx';
import HouseholdDetail from './pages/HouseholdDetail.jsx';
import Sessions from './pages/Sessions.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import SessionWorkspace from './pages/SessionWorkspace.jsx';
import SessionFindings from './pages/SessionFindings.jsx';
import SessionRecommendations from './pages/SessionRecommendations.jsx';

const NAV = [
  ['/', '📊', 'Tableau de bord'],
  ['/developpement', '📈', 'Développement'],
  ['/clients', '👥', 'Clients'],
  ['/contrats', '📄', 'Contrats'],
  ['/commissions', '💰', 'Commissions'],
  ['/compagnies', '🏢', 'Compagnies'],
  ['/taches', '✅', 'Tâches'],
  ['/diagnostic-360/foyers', '🧭', 'Diagnostic 360'],
  ['/diagnostic-360/sessions', '🗓️', 'Sessions RDV'],
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

  // `NavigationGuardProvider` doit englober TOUT l'arbre authentifié (barre
  // latérale ET zone de contenu routée) : c'est la seule façon pour le
  // hook `useNavigationGuard` d'intercepter à la fois les liens latéraux/le
  // bouton de déconnexion (portés par `App`) et l'état sale déclaré par une
  // page enfant (`SessionRecommendations.jsx`) -- une seule source de
  // vérité partagée, jamais une garde reconstruite par page (correctif
  // exigé avant commit, GATE LOT 7B).
  return (
    <NavigationGuardProvider>
      <AuthenticatedShell auth={auth} refresh={refresh} />
    </NavigationGuardProvider>
  );
}

function AuthenticatedShell({ auth, refresh }) {
  const navigate = useNavigate();
  const { confirmIfDirty } = useNavigationGuard();

  // Liens latéraux ET déconnexion : chemins de navigation qui NE passent
  // JAMAIS par un `navigate()` de la page elle-même, donc invisibles à
  // toute garde locale à une page -- protégés ici, au niveau de l'app,
  // exactement comme le bouton Précédent/Suivant du navigateur et
  // `beforeunload` le sont déjà à l'intérieur de `NavigationGuardProvider`.
  async function handleNavClick(e, to) {
    // Un modificateur (nouvel onglet/fenêtre) doit garder son comportement
    // natif du navigateur, jamais intercepté par la garde applicative --
    // correctif GATE LOT 7B (correction round, défaut certain relevé par
    // la revue finale `client-meeting-ux`) : `preventDefault()`
    // inconditionnel empêchait Ctrl/Cmd/Maj+clic d'ouvrir un nouvel onglet,
    // une régression pour un écran potentiellement partagé en rendez-vous.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    const ok = await confirmIfDirty();
    if (ok) navigate(to);
  }

  async function handleLogout() {
    const ok = await confirmIfDirty();
    if (!ok) return;
    api.post('/api/auth/logout').then(refresh);
  }

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
          <NavLink
            key={to} to={to} end={to === '/'}
            className={({ isActive }) => `nav${isActive ? ' active' : ''}`}
            onClick={(e) => handleNavClick(e, to)}
          >
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
            onClick={handleLogout}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/developpement" element={<Development />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/contrats" element={<Contracts />} />
          <Route path="/commissions" element={<Commissions />} />
          <Route path="/compagnies" element={<Companies />} />
          <Route path="/taches" element={<Tasks />} />
          <Route path="/diagnostic-360/foyers" element={<Households />} />
          <Route path="/diagnostic-360/foyers/:id" element={<HouseholdDetail />} />
          <Route path="/diagnostic-360/sessions" element={<Sessions />} />
          <Route path="/diagnostic-360/sessions/:id" element={<SessionDetail />} />
          <Route path="/diagnostic-360/sessions/:id/workspace" element={<SessionWorkspace />} />
          <Route path="/diagnostic-360/sessions/:id/findings" element={<SessionFindings />} />
          <Route path="/diagnostic-360/sessions/:id/recommendations" element={<SessionRecommendations />} />
          <Route path="/conformite" element={<Compliance />} />
          <Route path="/parametres" element={<Settings user={auth.user} onSaved={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
