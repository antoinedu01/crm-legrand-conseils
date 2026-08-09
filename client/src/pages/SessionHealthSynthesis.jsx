import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Empty } from '../components/ui.jsx';
import {
  describeSynthesisField, labelForAnalysisStatus, toneForAnalysisStatus,
  labelForCompleteness, toneForCompleteness, collectMissingInfoLabels, formatVigilanceItems, hasVigilance,
  resolveSynthesisErrorMessage,
} from './healthSynthesisLabels.js';
import { MEMBER_ROLES } from '../labels.js';

// SYNTH-UI1 — Synthèse Santé, écran conseiller read-only. Un seul GET, aucune
// écriture depuis cette page (§3/§16 du cadrage) : ni `useWorkspace`
// (annulation/jeton de séquence, nécessaire pour des rechargements fréquents
// après écriture) ni la complexité de file d'écriture de SessionWorkspace.jsx
// ne s'appliquent ici -- un hook minimal suffit, mais conserve l'objet
// d'erreur COMPLET (`.status`/`.data`), contrairement à `useAsync`
// (`components/ui.jsx`) qui ne garde que `.message` -- nécessaire pour
// distinguer 400/404/409 avec les libellés exigés (§14).
function useSynthesis(sessionId) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(`/api/advisory/sessions/${sessionId}/health-synthesis`).then(
      (data) => setState({ loading: false, data, error: null }),
      (error) => setState({ loading: false, data: null, error })
    );
  }, [sessionId]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

const COMPLEMENTARY_DIMENSIONS = [
  ['hospitalisation', 'Hospitalisation'],
  ['alternative_medicine', 'Médecines complémentaires'],
  ['optics', 'Optique'],
  ['dental', 'Dentaire'],
  ['prevention', 'Prévention'],
  ['travel', 'Voyage'],
];

export default function SessionHealthSynthesis() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useSynthesis(id);
  const [activeMemberId, setActiveMemberId] = useState(null);

  const members = data?.members || [];
  useEffect(() => {
    if (members.length && !members.some((m) => m.household_member_id === activeMemberId)) {
      setActiveMemberId(members[0].household_member_id);
    }
  }, [members, activeMemberId]);

  if (loading && !data) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error" role="alert" aria-live="assertive">{resolveSynthesisErrorMessage(error)}</div>;
  if (!data) return null;

  const activeMember = members.find((m) => m.household_member_id === activeMemberId) || null;

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => navigate(`/diagnostic-360/sessions/${id}`)}>← Fiche session</button>
          <h1>Synthèse Santé</h1>
        </div>
        <div className="actions">
          {/* Libellés alignés sur les conventions déjà utilisées par les
              pages sœurs (correction post-validation humaine SYNTH-UI1) --
              destinations inchangées. */}
          <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/workspace`)}>Ouvrir l'espace de rendez-vous</button>
          <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/findings`)}>Ouvrir les constats</button>
          <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/recommendations`)}>Ouvrir les recommandations</button>
        </div>
      </div>

      {data.requires_reanalysis && (
        <div className="alert warn">
          {data.analysis_status === 'stale'
            ? "Les réponses ont évolué depuis la dernière analyse. Relancez l'analyse avant d'utiliser les orientations."
            : "Aucune analyse n'a encore été exécutée. Les orientations dérivées ne sont pas disponibles — seules les préférences déclarées sont affichées ci-dessous."}
        </div>
      )}

      {members.length === 0 ? (
        <Empty>Aucun membre pour cette session.</Empty>
      ) : (
        <>
          <MemberTabs members={members} activeMemberId={activeMemberId} onSelect={setActiveMemberId} />
          {activeMember && (
            <MemberSynthesis
              key={activeMember.household_member_id}
              member={activeMember}
              analysisStatus={data.analysis_status}
            />
          )}
        </>
      )}
    </>
  );
}

// --- Commutateur membre --------------------------------------------------
// Seul précédent existant (`wksp-member-switch`, SessionWorkspace.jsx) n'a
// aucun rôle ARIA -- amélioration volontaire pour cette nouvelle page
// (SYNTH-UI1 §F) : patron WAI-ARIA « tabs » complet (rôles + navigation
// clavier flèches/Home/End + roving tabindex), sans toucher au composant
// existant. Ordre : celui déjà fourni par `dto.members` (§E, aucun tri
// frontend). Membre historique/retiré : suffixe identique à l'existant,
// jamais un nouveau vocabulaire (§10).
function MemberTabs({ members, activeMemberId, onSelect }) {
  const btnRefs = useRef([]);

  function focusAndSelect(idx) {
    const m = members[idx];
    onSelect(m.household_member_id);
    btnRefs.current[idx]?.focus();
  }

  function onKeyDown(e, idx) {
    if (e.key === 'ArrowRight') { e.preventDefault(); focusAndSelect((idx + 1) % members.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusAndSelect((idx - 1 + members.length) % members.length); }
    else if (e.key === 'Home') { e.preventDefault(); focusAndSelect(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAndSelect(members.length - 1); }
  }

  return (
    <div className="synth-member-tabs" role="tablist" aria-label="Membre du foyer">
      {members.map((m, idx) => {
        const active = m.household_member_id === activeMemberId;
        const retired = m.historical || m.no_longer_active;
        return (
          <button
            key={m.household_member_id}
            ref={(el) => { btnRefs.current[idx] = el; }}
            type="button"
            role="tab"
            id={`synth-tab-${m.household_member_id}`}
            aria-selected={active}
            aria-controls={`synth-panel-${m.household_member_id}`}
            tabIndex={active ? 0 : -1}
            className={active ? 'active' : ''}
            onClick={() => onSelect(m.household_member_id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {m.member_label} ({MEMBER_ROLES[m.member_role] || m.member_role}){retired ? ' · retiré du foyer' : ''}
          </button>
        );
      })}
    </div>
  );
}

// --- Synthèse d'un membre --------------------------------------------------

function MemberSynthesis({ member, analysisStatus }) {
  const missingInfo = collectMissingInfoLabels(member.completeness.by_dimension);
  const vigilanceItems = formatVigilanceItems(member.warnings);

  return (
    <div
      id={`synth-panel-${member.household_member_id}`}
      role="tabpanel"
      aria-labelledby={`synth-tab-${member.household_member_id}`}
    >
      <div className="synth-status-band">
        <strong>{member.member_label}</strong>
        <span className={`badge ${toneForAnalysisStatus(analysisStatus)}`}>{labelForAnalysisStatus(analysisStatus)}</span>
        <span className={`badge ${toneForCompleteness(member.completeness.overall)}`}>{labelForCompleteness(member.completeness.overall)}</span>
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Franchise</h2>
          <FieldRow label="Orientation" field={member.franchise.orientation} analysisStatus={analysisStatus} />
          <FieldRow label="Situation actuelle" field={member.franchise.current_comparison} analysisStatus={analysisStatus} />
        </div>

        <div className="card">
          <div className="synth-block-head">
            <h2>Modèle de soins</h2>
            {hasVigilance(member.care_model.warnings) && <VigilanceIcon />}
          </div>
          <FieldRow label="Priorité" field={member.care_model.cost_freedom_priority} analysisStatus={analysisStatus} />
          <FieldRow label="Médecin actuel" field={member.care_model.preserve_current_doctor} analysisStatus={analysisStatus} />
          <div className="synth-compact-list">
            <CompactRow label="Télémédecine" field={member.care_model.telemedicine} analysisStatus={analysisStatus} />
            <CompactRow label="Médecin de famille" field={member.care_model.family_doctor} analysisStatus={analysisStatus} />
            <CompactRow label="HMO" field={member.care_model.hmo} analysisStatus={analysisStatus} />
            <CompactRow label="Libre choix" field={member.care_model.free_choice} analysisStatus={analysisStatus} />
          </div>
        </div>

        <div className="card">
          <div className="synth-block-head">
            <h2>Accident</h2>
            {hasVigilance(member.accident.warnings) && <VigilanceIcon />}
          </div>
          <FieldRow field={member.accident.orientation} analysisStatus={analysisStatus} />
        </div>

        <div className="card">
          <div className="synth-block-head">
            <h2>Complémentaires</h2>
            {hasVigilance(member.complementary_needs.warnings) && <VigilanceIcon />}
          </div>
          <div className="synth-compact-list">
            {COMPLEMENTARY_DIMENSIONS.map(([key, label]) => (
              <CompactRow key={key} label={label} field={member.complementary_needs[key]} analysisStatus={analysisStatus} />
            ))}
          </div>
        </div>
      </div>

      <div className="card mb">
        <h2>Informations manquantes</h2>
        {missingInfo.length === 0 ? (
          <Empty>Aucune information manquante pour ce membre.</Empty>
        ) : (
          <ul className="missing-list">
            {missingInfo.map((m) => <li key={m.key}>{m.label}</li>)}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Points de vigilance</h2>
        {vigilanceItems.length === 0 ? (
          <Empty>Aucun point de vigilance pour ce membre.</Empty>
        ) : (
          <ul className="missing-list">
            {vigilanceItems.map((w) => (
              <li key={w.key}>
                <VigilanceIcon /> {w.text} <span className="muted" style={{ fontSize: 12 }}>— {w.dimensionLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Indicateur visuel discret (§12 du cadrage) -- jamais le texte du warning
// lui-même ici, seulement un repère qu'un point de vigilance existe pour ce
// bloc ; le texte complet vit uniquement dans « Points de vigilance »
// ci-dessus (source unique member.warnings, jamais dupliqué).
function VigilanceIcon() {
  return <span aria-label="Point de vigilance présent" role="img" className="synth-vigilance-icon">⚠</span>;
}

function FieldRow({ label, field, analysisStatus }) {
  const { text, isDeclaredPreference } = describeSynthesisField(field, analysisStatus);
  const isPlaceholder = field.value == null;
  return (
    <div className="synth-field">
      {label && <div className="muted" style={{ fontSize: 12 }}>{label}</div>}
      <div className={isPlaceholder ? 'muted' : undefined}>
        {text}
        {isDeclaredPreference && <span className="muted" style={{ fontSize: 12 }}> · préférence déclarée</span>}
      </div>
    </div>
  );
}

function CompactRow({ label, field, analysisStatus }) {
  const { text, isDeclaredPreference } = describeSynthesisField(field, analysisStatus);
  const isPlaceholder = field.value == null;
  return (
    <div className="synth-compact-row">
      <span className="muted">{label}</span>
      <span className={isPlaceholder ? 'muted' : undefined}>
        {text}
        {isDeclaredPreference && <span className="muted" style={{ fontSize: 12 }}> · préférence déclarée</span>}
      </span>
    </div>
  );
}
