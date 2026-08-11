import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/ui.jsx';

function Overview() {
  return (
    <div className="card">
      <h2>Prospects & pipeline</h2>
      <p className="muted">
        Le suivi des prospects, le scoring et le pipeline commercial restent gérés depuis la page
        Développement.
      </p>
      <div className="mt">
        <Link to="/developpement">Voir les prospects & le pipeline →</Link>
      </div>
    </div>
  );
}

function ComingSoon({ label }) {
  return (
    <div className="card">
      <Empty>Le module {label} sera disponible dans une prochaine étape.</Empty>
    </div>
  );
}

export default function Acquisition() {
  const [tab, setTab] = useState('apercu');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Acquisition</h1>
          <div className="sub">Pilotez vos rendez-vous, campagnes et performances d'acquisition.</div>
        </div>
      </div>
      <div className="toolbar">
        <button className={tab === 'apercu' ? 'primary' : ''} onClick={() => setTab('apercu')}>
          Vue d'ensemble
        </button>
        <button className={tab === 'rdv' ? 'primary' : ''} onClick={() => setTab('rdv')}>
          Rendez-vous
        </button>
        <button className={tab === 'campagnes' ? 'primary' : ''} onClick={() => setTab('campagnes')}>
          Campagnes
        </button>
        <button className={tab === 'analytics' ? 'primary' : ''} onClick={() => setTab('analytics')}>
          Analytics
        </button>
      </div>
      {tab === 'apercu' && <Overview />}
      {tab === 'rdv' && <ComingSoon label="Rendez-vous" />}
      {tab === 'campagnes' && <ComingSoon label="Campagnes" />}
      {tab === 'analytics' && <ComingSoon label="Analytics" />}
    </>
  );
}
