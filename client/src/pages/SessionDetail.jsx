import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty } from '../components/ui.jsx';
import { SESSION_DOMAINS, SESSION_STATUSES, LINK_DOMAIN_LABELS, fmtDateTime } from '../labels.js';

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const { data, loading, error: loadError, reload } = useAsync(() => api.get(`/api/advisory/sessions/${id}`), [id]);

  async function runAction(action) {
    // « Annuler » est irréversible (aucune transition sortante depuis
    // cancelled) : confirmation demandée, même principe que le retrait d'un
    // membre de foyer (HouseholdDetail.jsx) — incohérence relevée par la
    // revue client-meeting-ux.
    if (action === 'cancel' && !window.confirm('Annuler cette session ? Cette action est définitive.')) return;
    setError(null);
    setCheckResult(null);
    try {
      await api.post(`/api/advisory/sessions/${id}/${action}`, {});
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function checkCompletion() {
    setError(null);
    try {
      const res = await api.get(`/api/advisory/sessions/${id}/completion-check`);
      setCheckResult(res);
    } catch (err) {
      setError(err.message);
    }
  }

  async function complete() {
    setError(null);
    try {
      await api.post(`/api/advisory/sessions/${id}/complete`, {});
      setCheckResult(null);
      reload();
    } catch (err) {
      setError(err.message);
      if (err.data?.missing) setCheckResult({ valid: false, byLink: err.data.missing });
    }
  }

  if (loading) return <p className="muted">Chargement…</p>;
  if (loadError) return <div className="alert error">{loadError}</div>;
  if (!data) return null;

  const actions = {
    draft: [{ key: 'start', label: 'Démarrer' }, { key: 'cancel', label: 'Annuler' }],
    in_progress: [{ key: 'suspend', label: 'Suspendre' }, { key: 'cancel', label: 'Annuler' }],
    suspended: [{ key: 'resume', label: 'Reprendre' }, { key: 'cancel', label: 'Annuler' }],
    completed: [],
    cancelled: [],
  }[data.status] || [];

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => navigate('/diagnostic-360/sessions')}>← Sessions</button>
          <h1>{data.title || `Session #${data.id}`}</h1>
          <div className="sub">
            <Badge value={data.status} label={SESSION_STATUSES[data.status]} />
          </div>
        </div>
        <div className="actions">
          {actions.map((a) => <button key={a.key} onClick={() => runAction(a.key)}>{a.label}</button>)}
          {data.status === 'in_progress' && (
            <>
              <button onClick={checkCompletion}>Vérifier la finalisation</button>
              <button onClick={complete}>Finaliser</button>
            </>
          )}
          <button className="primary" onClick={() => navigate(`/diagnostic-360/sessions/${id}/workspace`)}>
            Ouvrir l'espace de rendez-vous
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {checkResult && (
        <div className={`alert ${checkResult.valid ? 'ok' : 'warn'}`}>
          {checkResult.valid ? (
            <p>Toutes les réponses obligatoires visibles sont présentes — la session peut être finalisée.</p>
          ) : (
            <>
              <p>Éléments manquants par domaine :</p>
              <ul>
                {checkResult.byLink.filter((l) => l.missing.length > 0).map((l) => (
                  <li key={l.questionnaire_version_id}>
                    {LINK_DOMAIN_LABELS[l.domain] || l.domain} — {l.missing.length} question(s) obligatoire(s) manquante(s)
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Informations</h2>
        <div className="form-grid">
          <div><span className="muted">Foyer</span><div>#{data.household_id}</div></div>
          <div><span className="muted">Domaine</span><div>{SESSION_DOMAINS[data.domain]}</div></div>
          <div><span className="muted">Prévue</span><div>{fmtDateTime(data.scheduled_at) || '—'}</div></div>
          <div><span className="muted">Démarrée</span><div>{fmtDateTime(data.started_at) || '—'}</div></div>
          <div><span className="muted">Suspendue</span><div>{fmtDateTime(data.suspended_at) || '—'}</div></div>
          <div><span className="muted">Finalisée</span><div>{fmtDateTime(data.completed_at) || '—'}</div></div>
          <div><span className="muted">Dernière activité</span><div>{fmtDateTime(data.last_activity_at) || '—'}</div></div>
          <div><span className="muted">Révision</span><div>{data.revision}</div></div>
          <div><span className="muted">Réponses enregistrées</span><div>{data.answered_count}</div></div>
        </div>
      </div>

      <div className="card">
        <h2>Questionnaires rattachés</h2>
        {data.questionnaire_versions.length === 0 ? (
          <Empty>Aucun questionnaire rattaché.</Empty>
        ) : (
          <table className="data">
            <thead><tr><th>Ordre</th><th>Domaine</th><th>Rôle</th><th>Version</th></tr></thead>
            <tbody>
              {data.questionnaire_versions.map((v) => (
                <tr key={v.id}>
                  <td className="num">{v.display_order}</td>
                  <td>{LINK_DOMAIN_LABELS[v.domain] || v.domain}</td>
                  <td>{v.module_role === 'core' ? 'Commun' : 'Spécifique au domaine'}</td>
                  <td>#{v.questionnaire_version_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Questionnaire et réponses</h2>
        <p className="muted mb">
          Le parcours de questions, la progression et la saisie des réponses se font désormais dans l'espace de rendez-vous dédié.
        </p>
        <button className="primary" onClick={() => navigate(`/diagnostic-360/sessions/${id}/workspace`)}>
          Ouvrir l'espace de rendez-vous
        </button>
      </div>
    </>
  );
}
