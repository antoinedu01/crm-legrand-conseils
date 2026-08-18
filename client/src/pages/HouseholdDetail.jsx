import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import {
  HOUSEHOLD_STATUS, MEMBER_ROLES, DEMOTABLE_ROLES, MATCH_LEVELS, fmtDate, fmtDateTime,
  SESSION_DOMAINS, SESSION_STATUSES,
} from '../labels.js';
import { isValidDateStr, getAddMemberErrorMessage } from './householdMemberValidation.js';

function age(birthDate) {
  if (!birthDate) return null;
  const years = (Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.floor(years);
}

function HouseholdEditForm({ household, onClose, onSaved }) {
  const [label, setLabel] = useState(household.label || '');
  const [status, setStatus] = useState(household.status);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/api/advisory/households/${household.id}`, { label, status });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Modifier le foyer" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <Field label="Nom d'usage interne du dossier" full>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Statut" full>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(HOUSEHOLD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

// Ajout d'un membre : personne existante (recherche) ou création rapide
// (enfant, sans email/téléphone/profession requis), avec vérification de
// similarité avant validation (docs/advisory/UX_AND_CLIENT_MODE.md §1.3/§1.2).
function AddMemberForm({ householdId, members, onClose, onSaved }) {
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [newPerson, setNewPerson] = useState({ first_name: '', last_name: '', birth_date: '' });
  const [memberRole, setMemberRole] = useState('enfant');
  const [relationshipDetail, setRelationshipDetail] = useState('');
  const [legalRepId, setLegalRepId] = useState('');
  const [matches, setMatches] = useState(null); // liste des correspondances à arbitrer, ou null
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [added, setAdded] = useState(false);
  const [similarityPreview, setSimilarityPreview] = useState([]);

  const activeMembers = members.filter((m) => m.status === 'actif');

  async function search(value) {
    setQ(value);
    setClientId(null);
    if (value.trim().length < 2) return setResults([]);
    const rows = await api.get(`/api/clients?q=${encodeURIComponent(value)}`);
    setResults(rows.filter((c) => c.status !== 'anonymise').slice(0, 8));
  }

  // Prévisualisation non bloquante des correspondances (y compris
  // « possible_similarity », jamais bloquante — docs/advisory/UX_AND_CLIENT_MODE.md
  // §1.3) pendant la saisie d'une nouvelle personne. La confirmation
  // bloquante (exact_match/probable_match) reste gérée par le 409 de submit().
  useEffect(() => {
    if (mode !== 'new' || !(newPerson.first_name && newPerson.last_name)) {
      setSimilarityPreview([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.post(`/api/advisory/households/${householdId}/members/check-similarity`, {
          first_name: newPerson.first_name,
          last_name: newPerson.last_name,
          birth_date: newPerson.birth_date || undefined,
        });
        if (!cancelled) setSimilarityPreview(res.matches || []);
      } catch {
        if (!cancelled) setSimilarityPreview([]);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, newPerson.first_name, newPerson.last_name, newPerson.birth_date, householdId]);

  function payload(extra = {}) {
    const base = {
      member_role: memberRole,
      relationship_detail: relationshipDetail || undefined,
      legal_representative_client_id: legalRepId || undefined,
      ...extra,
    };
    return mode === 'existing' ? { ...base, client_id: clientId } : { ...base, new_person: newPerson };
  }

  async function submit(extra = {}) {
    setError(null);
    // Date de naissance obligatoire (constat QA-E2E1, FIX-MEMBER-DOB) —
    // uniquement pour la création réelle d'une nouvelle personne (jamais
    // pour « Utiliser cette personne », qui rattache un client existant via
    // extra.client_id sans passer par new_person). Bloque l'appel réseau
    // plutôt que de laisser le serveur le refuser : la validation HTML
    // `required` ne protège pas ce second point d'entrée, rendu hors du
    // `<form>` initial (écran de confirmation de similarité).
    if (mode === 'new' && !extra.client_id) {
      if (!newPerson.birth_date) {
        setError('La date de naissance est obligatoire.');
        return;
      }
      if (!isValidDateStr(newPerson.birth_date)) {
        setError('Veuillez renseigner une date de naissance valide.');
        return;
      }
    }
    try {
      const res = await api.post(`/api/advisory/households/${householdId}/members`, payload(extra));
      if (res.already_in_households?.length) {
        // Même principe que HouseholdCreateForm : ne pas fermer/naviguer
        // avant que l'information ait été vue par le conseiller.
        setInfo(`Cette personne appartient déjà à ${res.already_in_households.length} autre(s) foyer(s) actif(s).`);
        setAdded(true);
      } else {
        onSaved();
      }
    } catch (err) {
      if (err.status === 409 && err.data?.matches) {
        setMatches(err.data.matches);
      } else {
        // Aucun texte backend (message, détail, stack) n'est interpolé ici,
        // volontairement : un message serveur inattendu ne doit jamais
        // atteindre l'interface telle quelle (audit FIX-MEMBER-DOB §4).
        // Mapping pur et testable dans householdMemberValidation.js.
        setError(getAddMemberErrorMessage(err));
      }
    }
  }

  if (added) {
    return (
      <div>
        {info && <div className="alert ok">{info}</div>}
        <div className="actions">
          <button className="primary" onClick={onSaved}>Continuer</button>
        </div>
      </div>
    );
  }

  if (matches) {
    return (
      <div>
        <p>Des personnes similaires existent déjà dans le CRM :</p>
        <table className="data">
          <thead><tr><th>Nom</th><th>Naissance</th><th>Correspondance</th><th></th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.client_id}>
                <td>{m.display_name}</td>
                <td>{fmtDate(m.birth_date)}</td>
                <td><Badge value={m.match_level} label={MATCH_LEVELS[m.match_level]} /></td>
                <td>
                  <button type="button" onClick={() => submit({ client_id: m.client_id, new_person: undefined })}>
                    Utiliser cette personne
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" onClick={() => setMatches(null)}>Annuler</button>
          <button className="primary" onClick={() => submit({ confirmed_despite_match: true })}>
            Confirmer : il s'agit d'une personne différente
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {error && <div className="alert error">{error}</div>}
      <div className="toolbar">
        <label className="check">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Personne existante
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Nouvelle personne (enfant…)
        </label>
      </div>
      {mode === 'existing' ? (
        <>
          <Field label="Rechercher" full>
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="Nom, prénom, e-mail…" />
          </Field>
          {results.length > 0 && (
            <table className="data">
              <tbody>
                {results.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setClientId(c.id)}>
                    <td>{clientId === c.id ? <strong>{c.display_name}</strong> : c.display_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Prénom">
              <input value={newPerson.first_name} onChange={(e) => setNewPerson({ ...newPerson, first_name: e.target.value })} />
            </Field>
            <Field label="Nom">
              <input value={newPerson.last_name} onChange={(e) => setNewPerson({ ...newPerson, last_name: e.target.value })} />
            </Field>
            <Field label="Date de naissance (obligatoire)">
              <input type="date" required value={newPerson.birth_date} onChange={(e) => setNewPerson({ ...newPerson, birth_date: e.target.value })} />
            </Field>
          </div>
          {similarityPreview.length > 0 && (
            <div className="alert warn">
              <p>
                Personne(s) similaire(s) déjà présente(s) dans le CRM — information seulement, la création n'est pas
                bloquée pour une simple similarité :
              </p>
              <ul>
                {similarityPreview.map((m) => (
                  <li key={m.client_id}>
                    {m.display_name}
                    {m.birth_date ? ` (${fmtDate(m.birth_date)})` : ''} —{' '}
                    <Badge value={m.match_level} label={MATCH_LEVELS[m.match_level]} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="form-grid mt">
        <Field label="Rôle dans le foyer">
          <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
            {Object.entries(MEMBER_ROLES).filter(([k]) => k !== 'principal').map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Relation / précision (facultatif)">
          <input value={relationshipDetail} onChange={(e) => setRelationshipDetail(e.target.value)} placeholder="Ex. « partenaire enregistré »" />
        </Field>
        <Field label="Représentant légal (coordonnées de contact déléguées)" full>
          <select value={legalRepId} onChange={(e) => setLegalRepId(e.target.value)}>
            <option value="">— Aucun (coordonnées propres) —</option>
            {activeMembers.map((m) => <option key={m.client_id} value={m.client_id}>{m.display_name}</option>)}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button type="button" onClick={onClose}>Annuler</button>
        <button
          className="primary"
          disabled={mode === 'existing' ? !clientId : !(newPerson.first_name || newPerson.last_name)}
        >
          Ajouter au foyer
        </button>
      </div>
    </form>
  );
}

function SetPrimaryForm({ household, members, onClose, onSaved }) {
  const candidates = members.filter((m) => m.status === 'actif' && m.member_role !== 'principal');
  const [memberId, setMemberId] = useState(candidates[0]?.id || '');
  const [previousRole, setPreviousRole] = useState('conjoint');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/advisory/households/${household.id}/members/${memberId}/set-primary`, {
        previous_primary_new_role: previousRole,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  if (candidates.length === 0) {
    return (
      <Modal title="Changer le client principal" onClose={onClose}>
        <Empty>Aucun autre membre actif ne peut devenir principal.</Empty>
        <div className="actions">
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Changer le client principal" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <Field label="Nouveau client principal" full>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {candidates.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </Field>
        <Field label="Rôle repris par l'ancien principal" full>
          <select value={previousRole} onChange={(e) => setPreviousRole(e.target.value)}>
            {DEMOTABLE_ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLES[r]}</option>)}
          </select>
        </Field>
        <p className="muted">Ce rôle reste purement administratif, sans portée hiérarchique ou juridique.</p>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Confirmer le changement</button>
        </div>
      </form>
    </Modal>
  );
}

// Aperçu minimal des sessions de ce foyer (Lot 3A — socle sessions et
// questionnaires). Le parcours complet du rendez-vous (questions,
// progression, mode présentation) reste réservé au Lot 3B ; ici, seul un
// lien technique vers la fiche session existe.
function HouseholdSessions({ householdId }) {
  const navigate = useNavigate();
  const { data, loading } = useAsync(() => api.get(`/api/advisory/sessions?household_id=${householdId}`), [householdId]);
  return (
    <div className="card">
      <h2>Diagnostics</h2>
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : data.length === 0 ? (
        <Empty>
          Aucune session de conseil pour ce foyer — à créer depuis « Sessions RDV ».
        </Empty>
      ) : (
        <table className="data">
          <thead><tr><th>Domaine</th><th>Statut</th><th>Dernière activité</th></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="click" onClick={() => navigate(`/diagnostic-360/sessions/${s.id}`)}>
                <td>{SESSION_DOMAINS[s.domain]}</td>
                <td><Badge value={s.status} label={SESSION_STATUSES[s.status]} /></td>
                <td className="muted">{fmtDateTime(s.last_activity_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function HouseholdDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showEdit, setShowEdit] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showSetPrimary, setShowSetPrimary] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/advisory/households/${id}`), [id]);

  async function removeMember(member) {
    if (!window.confirm(`Retirer ${member.display_name} du foyer ? L'historique est conservé.`)) return;
    try {
      await api.del(`/api/advisory/households/${id}/members/${member.id}`);
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => navigate('/diagnostic-360/foyers')}>← Foyers</button>
          <h1>{data.label || `Foyer ${data.members?.find((m) => m.member_role === 'principal')?.display_name || `#${data.id}`}`}</h1>
          <div className="sub">
            <Badge value={data.status} label={HOUSEHOLD_STATUS[data.status]} />
          </div>
        </div>
        <div className="actions">
          <button onClick={() => setShowSetPrimary(true)}>Changer le principal</button>
          <button onClick={() => setShowEdit(true)}>Modifier</button>
          <button className="primary" onClick={() => setShowAddMember(true)}>+ Ajouter un membre</button>
        </div>
      </div>

      <div className="card">
        <h2>Membres du foyer</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Personne</th><th>Rôle</th><th>Relation</th><th>Âge</th>
              <th>Entrée</th><th>Sortie</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.display_name}</strong>
                  {!m.email && !m.phone && (
                    <div className="muted">
                      {m.legal_representative_display_name
                        ? `Sans coordonnées propres → contact via ${m.legal_representative_display_name}`
                        : 'Sans coordonnées propres'}
                    </div>
                  )}
                  {m.other_active_households?.length > 0 && (
                    <div className="muted">
                      Également membre de : {m.other_active_households.map((h) => h.label || `#${h.id}`).join(', ')}
                    </div>
                  )}
                </td>
                <td><Badge value={m.member_role} label={MEMBER_ROLES[m.member_role]} /></td>
                <td>{m.relationship_detail || '—'}</td>
                <td>{age(m.birth_date) ?? '—'}</td>
                <td>{fmtDate(m.start_date)}</td>
                <td>{fmtDate(m.end_date)}</td>
                <td><Badge value={m.status} label={m.status === 'actif' ? 'Actif' : 'Sorti'} /></td>
                <td>
                  {m.status === 'actif' && m.member_role !== 'principal' && (
                    <button className="ghost small" onClick={() => removeMember(m)}>Retirer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <HouseholdSessions householdId={id} />

      {showEdit && (
        <HouseholdEditForm household={data} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); reload(); }} />
      )}
      {showAddMember && (
        <Modal title="Ajouter un membre" onClose={() => setShowAddMember(false)} wide>
          <AddMemberForm
            householdId={id}
            members={data.members}
            onClose={() => setShowAddMember(false)}
            onSaved={() => { setShowAddMember(false); reload(); }}
          />
        </Modal>
      )}
      {showSetPrimary && (
        <SetPrimaryForm
          household={data}
          members={data.members}
          onClose={() => setShowSetPrimary(false)}
          onSaved={() => { setShowSetPrimary(false); reload(); }}
        />
      )}
    </>
  );
}
