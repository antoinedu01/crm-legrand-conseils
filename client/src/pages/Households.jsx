import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { HOUSEHOLD_STATUS, fmtDateTime } from '../labels.js';
import { ClientForm } from './Clients.jsx';

// Sélection d'une personne existante comme principal, ou création via le
// mécanisme client existant (ClientForm) — jamais une saisie parallèle
// d'identité (docs/advisory/UX_AND_CLIENT_MODE.md §1.2).
function PrincipalPicker({ onSelected }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [showClientForm, setShowClientForm] = useState(false);

  async function search(value) {
    setQ(value);
    if (value.trim().length < 2) return setResults([]);
    const rows = await api.get(`/api/clients?q=${encodeURIComponent(value)}`);
    setResults(rows.filter((c) => c.status !== 'anonymise').slice(0, 8));
  }

  return (
    <div>
      <Field label="Rechercher une personne existante" full>
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="Nom, prénom, e-mail…"
          autoFocus
        />
      </Field>
      {results.length > 0 && (
        <table className="data" style={{ marginTop: 8 }}>
          <tbody>
            {results.map((c) => (
              <tr key={c.id} className="click" onClick={() => onSelected(c.id)}>
                <td>{c.display_name}</td>
                <td className="muted">{[c.npa, c.city].filter(Boolean).join(' ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setShowClientForm(true)}>+ Créer une nouvelle personne</button>
      </div>
      {showClientForm && (
        <ClientForm
          onClose={() => setShowClientForm(false)}
          onSaved={(id) => { setShowClientForm(false); onSelected(id); }}
        />
      )}
    </div>
  );
}

function HouseholdCreateForm({ onClose, onSaved }) {
  const [principalId, setPrincipalId] = useState(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [createdId, setCreatedId] = useState(null);

  async function create() {
    setError(null);
    try {
      const res = await api.post('/api/advisory/households', { primary_client_id: principalId, label: label || undefined });
      if (res.already_in_households?.length) {
        // Non bloquant, mais l'information doit rester visible avant de
        // quitter la modale : on attend une confirmation explicite au lieu
        // de naviguer immédiatement (bug relevé par la revue client-meeting-ux).
        setInfo(`Cette personne appartient déjà à ${res.already_in_households.length} autre(s) foyer(s) actif(s).`);
        setCreatedId(res.id);
      } else {
        onSaved(res.id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Nouveau foyer" onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {createdId ? (
        <div>
          {info && <div className="alert ok">{info}</div>}
          <div className="actions">
            <button className="primary" onClick={() => onSaved(createdId)}>Continuer vers le foyer</button>
          </div>
        </div>
      ) : !principalId ? (
        <PrincipalPicker onSelected={setPrincipalId} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); create(); }}>
          <Field label="Nom d'usage interne du dossier (facultatif)" full>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. « Foyer Moret–Ricci »" />
          </Field>
          <div className="actions">
            <button type="button" onClick={() => setPrincipalId(null)}>← Changer de personne</button>
            <button className="primary">Créer le foyer</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function Households() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/advisory/households?q=${encodeURIComponent(q)}&status=${status}`),
    [q, status]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diagnostic 360 — Foyers</h1>
          <div className="sub">{data ? `${data.length} foyer(s)` : ''}</div>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>+ Nouveau foyer</button>
      </div>
      <div className="toolbar">
        <input
          placeholder="Rechercher (nom du foyer, du principal)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(HOUSEHOLD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucun foyer. Créez le premier avec « + Nouveau foyer ».</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Foyer</th><th>Client principal</th><th>Statut</th>
                <th>Commune / canton</th><th className="num">Membres actifs</th><th>Dernière modification</th>
              </tr>
            </thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id} className="click" onClick={() => navigate(`/diagnostic-360/foyers/${h.id}`)}>
                  <td><strong>{h.label || `Foyer ${h.primary_display_name}`}</strong></td>
                  <td>{h.primary_display_name}</td>
                  <td><Badge value={h.status} label={HOUSEHOLD_STATUS[h.status]} /></td>
                  <td>{[h.canton, h.city].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="num">{h.active_member_count}</td>
                  <td className="muted">{fmtDateTime(h.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showForm && (
        <HouseholdCreateForm
          onClose={() => setShowForm(false)}
          onSaved={(id) => { setShowForm(false); reload(); navigate(`/diagnostic-360/foyers/${id}`); }}
        />
      )}
    </>
  );
}
