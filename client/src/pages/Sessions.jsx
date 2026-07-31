import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { SESSION_DOMAINS, SESSION_STATUSES, LINK_DOMAIN_LABELS, fmtDateTime } from '../labels.js';

// Sélection d'un foyer existant — jamais de création de foyer depuis cet
// écran (la création de foyer reste le rôle exclusif de la page Foyers).
function HouseholdPicker({ onSelected }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  async function search(value) {
    setQ(value);
    if (value.trim().length < 2) return setResults([]);
    const rows = await api.get(`/api/advisory/households?q=${encodeURIComponent(value)}`);
    setResults(rows.slice(0, 8));
  }

  return (
    <Field label="Foyer" full>
      <input value={q} onChange={(e) => search(e.target.value)} placeholder="Rechercher un foyer (nom, principal)…" autoFocus />
      {results.length > 0 && (
        <table className="data" style={{ marginTop: 8 }}>
          <tbody>
            {results.map((h) => (
              <tr key={h.id} className="click" onClick={() => { onSelected(h); setQ(h.label || h.primary_display_name); setResults([]); }}>
                <td>{h.label || `Foyer ${h.primary_display_name}`}</td>
                <td className="muted">{h.primary_display_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Field>
  );
}

// Un sélecteur de version publiée pour un rôle de domaine donné
// (common/health/life_pension) — aucune donnée métier réelle n'existe
// encore dans ce lot ; si aucune version publiée n'existe pour ce domaine,
// l'écran l'indique clairement plutôt que de bloquer silencieusement.
function VersionPicker({ domain, label, required, onChange }) {
  const { data, loading } = useAsync(() => api.get(`/api/advisory/questionnaires/versions?domain=${domain}&status=published`), [domain]);
  return (
    <Field label={`${label}${required ? '' : ' (facultatif)'}`} full>
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : data.length === 0 ? (
        <p className="muted">Aucune version publiée pour ce domaine pour le moment.</p>
      ) : (
        <select defaultValue="" onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{required ? '— Choisir —' : '— Aucune —'}</option>
          {data.map((v) => (
            <option key={v.id} value={v.id}>{v.questionnaire_name} — v{v.version_number}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

function SessionCreateForm({ onClose, onSaved }) {
  const [household, setHousehold] = useState(null);
  const [domain, setDomain] = useState('health');
  const [versions, setVersions] = useState({ common: null, health: null, life_pension: null });
  const [error, setError] = useState(null);

  const needsHealth = domain === 'health' || domain === 'mixed';
  const needsLife = domain === 'life_pension' || domain === 'mixed';

  async function create() {
    setError(null);
    const questionnaire_versions = [];
    let order = 1;
    if (versions.common) questionnaire_versions.push({ questionnaire_version_id: versions.common, domain: 'common', module_role: 'core', display_order: order++ });
    if (needsHealth) {
      if (!versions.health) return setError('Une version « Assurance Maladie » publiée est requise pour ce domaine.');
      questionnaire_versions.push({ questionnaire_version_id: versions.health, domain: 'health', module_role: 'domain', display_order: order++ });
    }
    if (needsLife) {
      if (!versions.life_pension) return setError('Une version « Vie et Prévoyance » publiée est requise pour ce domaine.');
      questionnaire_versions.push({ questionnaire_version_id: versions.life_pension, domain: 'life_pension', module_role: 'domain', display_order: order++ });
    }
    try {
      const res = await api.post('/api/advisory/sessions', { household_id: household.id, domain, questionnaire_versions });
      onSaved(res.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Nouvelle session de conseil" onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      <HouseholdPicker onSelected={setHousehold} />
      <Field label="Domaine" full>
        <select
          value={domain}
          onChange={(e) => {
            // Réinitialise les sélections santé/vie-prévoyance à chaque
            // changement de domaine : ces sélecteurs sont démontés/remontés
            // conditionnellement, et un <select> non contrôlé (defaultValue)
            // réaffiche « — Choisir — » sans que l'état parent ne soit remis
            // à zéro — sans ce correctif, une ancienne sélection pouvait être
            // soumise silencieusement alors que l'écran semblait vide (bug
            // détecté par la revue client-meeting-ux).
            setDomain(e.target.value);
            setVersions({ common: null, health: null, life_pension: null });
          }}
        >
          {Object.entries(SESSION_DOMAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <VersionPicker key={`common-${domain}`} domain="common" label={LINK_DOMAIN_LABELS.common} required={false} onChange={(id) => setVersions((v) => ({ ...v, common: id }))} />
      {needsHealth && (
        // `key` inclut `domain` : un foyer santé↔mixte garde ce composant
        // monté (needsHealth vrai dans les deux cas), donc son <select> non
        // contrôlé (defaultValue) ne se réinitialiserait jamais visuellement
        // sans ce remontage forcé — l'état parent était bien remis à zéro,
        // mais l'affichage restait trompeur (anomalie relevée en vérification
        // manuelle, au-delà du correctif initial de la revue client-meeting-ux).
        <VersionPicker key={`health-${domain}`} domain="health" label={LINK_DOMAIN_LABELS.health} required onChange={(id) => setVersions((v) => ({ ...v, health: id }))} />
      )}
      {needsLife && (
        <VersionPicker key={`life_pension-${domain}`} domain="life_pension" label={LINK_DOMAIN_LABELS.life_pension} required onChange={(id) => setVersions((v) => ({ ...v, life_pension: id }))} />
      )}
      <div className="actions">
        <button type="button" onClick={onClose}>Annuler</button>
        <button className="primary" disabled={!household} onClick={create}>Créer la session</button>
      </div>
    </Modal>
  );
}

export default function Sessions() {
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/advisory/sessions?status=${status}`), [status]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diagnostic 360 — Sessions</h1>
          <div className="sub">{data ? `${data.length} session(s)` : ''}</div>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>+ Nouvelle session</button>
      </div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(SESSION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucune session. Créez la première avec « + Nouvelle session ».</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Foyer</th><th>Domaine</th><th>Statut</th><th>Prévue</th><th>Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="click" onClick={() => navigate(`/diagnostic-360/sessions/${s.id}`)}>
                  <td>#{s.household_id}</td>
                  <td>{SESSION_DOMAINS[s.domain]}</td>
                  <td><Badge value={s.status} label={SESSION_STATUSES[s.status]} /></td>
                  <td className="muted">{fmtDateTime(s.scheduled_at)}</td>
                  <td className="muted">{fmtDateTime(s.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showForm && (
        <SessionCreateForm
          onClose={() => setShowForm(false)}
          onSaved={(id) => { setShowForm(false); reload(); navigate(`/diagnostic-360/sessions/${id}`); }}
        />
      )}
    </>
  );
}
