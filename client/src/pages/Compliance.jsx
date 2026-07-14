import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty } from '../components/ui.jsx';
import { fmtDateTime } from '../labels.js';

function Check({ ok }) {
  return ok ? <Badge value="actif" label="OK" /> : <Badge value="attendue" label="Manquant" />;
}

export default function Compliance() {
  const [tab, setTab] = useState('overview');
  const [q, setQ] = useState('');
  const overview = useAsync(() => api.get('/api/compliance/overview'), []);
  const log = useAsync(
    () => (tab === 'audit' ? api.get(`/api/compliance/audit-log?q=${encodeURIComponent(q)}`) : Promise.resolve(null)),
    [tab, q]
  );
  const register = useAsync(
    () => (tab === 'register' ? api.get('/api/compliance/processing-register') : Promise.resolve(null)),
    [tab]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conformité</h1>
          <div className="sub">nLPD (protection des données) · LSA / FINMA (intermédiation d’assurance)</div>
        </div>
      </div>

      <div className="toolbar">
        <button className={tab === 'overview' ? 'primary' : ''} onClick={() => setTab('overview')}>Vue d’ensemble</button>
        <button className={tab === 'audit' ? 'primary' : ''} onClick={() => setTab('audit')}>Journal d’audit</button>
        <button className={tab === 'register' ? 'primary' : ''} onClick={() => setTab('register')}>Registre des traitements</button>
      </div>

      {tab === 'overview' && overview.data && (
        <>
          <div className="tiles mb">
            <div className="tile">
              <div className="label">Dossiers actifs</div>
              <div className="value">{overview.data.activeClients}</div>
            </div>
            <div className="tile">
              <div className="label">Consentements nLPD</div>
              <div className="value">{overview.data.withConsent}/{overview.data.activeClients}</div>
            </div>
            <div className="tile">
              <div className="label">Mandats de courtage signés</div>
              <div className="value">{overview.data.withMandate}/{overview.data.activeClients}</div>
            </div>
            <div className="tile">
              <div className="label">Informations art. 45 LSA remises</div>
              <div className="value">{overview.data.withInfoLsa}/{overview.data.activeClients}</div>
            </div>
            <div className="tile">
              <div className="label">Dossiers anonymisés</div>
              <div className="value">{overview.data.anonymized}</div>
              <div className="hint">droit à l’effacement exercé</div>
            </div>
          </div>
          <div className="card mb">
            <h2>Dossiers incomplets</h2>
            {overview.data.gaps.length === 0 ? (
              <Empty>✅ Tous les dossiers actifs sont en ordre.</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr><th>Client</th><th>Consentement nLPD</th><th>Mandat de courtage</th><th>Info art. 45 LSA</th></tr>
                </thead>
                <tbody>
                  {overview.data.gaps.map((g) => (
                    <tr key={g.id}>
                      <td><Link to={`/clients/${g.id}`}>{g.name}</Link></td>
                      <td><Check ok={g.consent_data} /></td>
                      <td><Check ok={g.mandate_signed} /></td>
                      <td><Check ok={g.info_lsa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h2>Rappels réglementaires</h2>
            <table className="data">
              <tbody>
                <tr>
                  <td><strong>nLPD — droit d’accès (art. 25)</strong></td>
                  <td>Chaque dossier client dispose d’un bouton « Export des données » qui produit un export complet en 30 secondes. Délai légal de réponse : 30 jours.</td>
                </tr>
                <tr>
                  <td><strong>nLPD — droit à l’effacement</strong></td>
                  <td>L’action « Anonymiser » efface toutes les données personnelles ; les données contractuelles sont conservées de manière anonyme (art. 958f CO, 10 ans).</td>
                </tr>
                <tr>
                  <td><strong>nLPD — annonce des violations (art. 24)</strong></td>
                  <td>En cas de violation de la sécurité des données présentant un risque élevé, annonce au PFPDT dans les meilleurs délais.</td>
                </tr>
                <tr>
                  <td><strong>LSA — enregistrement FINMA (art. 41–42)</strong></td>
                  <td>Les courtiers non liés doivent être inscrits au registre FINMA. Renseignez votre n° dans les Paramètres.</td>
                </tr>
                <tr>
                  <td><strong>LSA — devoir d’information (art. 45)</strong></td>
                  <td>Remettre au client, avant la conclusion, les informations sur le courtier, ses liens et sa rémunération. Suivi par dossier dans ce CRM.</td>
                </tr>
                <tr>
                  <td><strong>LSA — formation continue (art. 43)</strong></td>
                  <td>Maintenez vos attestations de formation (p. ex. Cicero) à jour.</td>
                </tr>
                <tr>
                  <td><strong>Sécurité (orientation ISO 27001)</strong></td>
                  <td>Mots de passe hachés, sessions limitées, journal d’audit, données locales. Pensez aux sauvegardes chiffrées régulières du dossier <code>data/</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="toolbar">
            <input placeholder="Filtrer le journal…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
          </div>
          {log.loading ? (
            <p className="muted">Chargement…</p>
          ) : !log.data || log.data.length === 0 ? (
            <Empty>Journal vide.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Date & heure</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Détails</th></tr>
              </thead>
              <tbody>
                {log.data.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                    <td>{l.user_email}</td>
                    <td>{l.action}</td>
                    <td className="muted">{l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'}</td>
                    <td className="muted">{l.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'register' && (
        <div className="grid">
          {register.loading && <p className="muted">Chargement…</p>}
          {(register.data || []).map((r) => (
            <div className="card" key={r.activite}>
              <h2>{r.activite}</h2>
              <table className="data">
                <tbody>
                  <tr><td style={{ width: 200 }} className="muted">Finalité</td><td>{r.finalite}</td></tr>
                  <tr><td className="muted">Base légale</td><td>{r.base_legale}</td></tr>
                  <tr><td className="muted">Catégories de données</td><td>{r.categories_donnees}</td></tr>
                  <tr><td className="muted">Destinataires</td><td>{r.destinataires}</td></tr>
                  <tr><td className="muted">Durée de conservation</td><td>{r.duree_conservation}</td></tr>
                  <tr><td className="muted">Mesures de sécurité</td><td>{r.mesures_securite}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
          {register.data && (
            <p className="muted" style={{ fontSize: 12 }}>
              Registre des activités de traitement au sens de l’art. 12 nLPD. Adaptez ces fiches à votre organisation réelle.
            </p>
          )}
        </div>
      )}
    </>
  );
}
