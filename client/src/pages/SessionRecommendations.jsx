import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, Field, Badge, Empty, ConfirmModal } from '../components/ui.jsx';
import {
  LINK_DOMAIN_LABELS, FINDING_SCOPES, FINDING_TYPES, PRIORITIES, RECOMMENDATION_STATUSES, fmtDateTime,
} from '../labels.js';
import {
  emptyFields, formIsDirty, fieldsFromRecommendation, fieldsToBody, interpretRecommendationError,
} from './sessionRecommendationsPure.js';
import { useNavigationGuard } from '../navigationGuard.jsx';

const DOMAINS = ['common', 'health', 'life_pension'];
const SCOPES = ['session', 'household', 'member'];

// --- Chargement de la page, avec annulation propre -- même mécanisme que
// `useWorkspace`/`useFindingsWorkspace` (session_id + foyer + liste/historique
// en un seul aller-retour logique, jeton de séquence pour ignorer une réponse
// devenue obsolète). Les recommandations ne sont JAMAIS recalculées ici :
// `potentially_stale`, les transitions autorisées, la validité des findings
// et des membres restent exclusivement des réponses serveur, jamais
// redérivées côté client.
function usePageData(sessionId, { history } = {}) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; abortRef.current?.abort(); }, []);

  const reload = useCallback(() => {
    const mySeq = ++seqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const session = await api.get(`/api/advisory/sessions/${sessionId}`, controller.signal);
        const [household, recs, findingHistory] = await Promise.all([
          api.get(`/api/advisory/households/${session.household_id}`, controller.signal),
          history
            ? api.get(`/api/advisory/sessions/${sessionId}/recommendations/history`, controller.signal)
            : api.get(`/api/advisory/sessions/${sessionId}/recommendations`, controller.signal),
          api.get(`/api/advisory/sessions/${sessionId}/findings/history`, controller.signal),
        ]);
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        setState({
          loading: false,
          data: { session, household, recommendations: recs.recommendations, findingsById: new Map(findingHistory.findings.map((f) => [f.id, f])) },
          error: null,
        });
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        setState({ loading: false, data: null, error: error.message });
      }
    })();
  }, [sessionId, history]);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export default function SessionRecommendations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState('active'); // 'active' | 'history'
  const { data, loading, error, reload } = usePageData(id, { history: tab === 'history' });

  const [filters, setFilters] = useState({ domain: 'all', status: 'all', scope: 'all', member: 'all', stale: 'all' });
  const [screen, setScreen] = useState({ kind: 'list' });
  const [globalError, setGlobalError] = useState(null);
  // Une erreur déclenchée par une action tout en bas de page (ex. « Retirer
  // ce constat » dans RecommendationDetail) restait invisible tant que le
  // conseiller ne remontait pas lui-même en haut de page (constat
  // client-meeting-ux, revues finales Lot 7B) -- ramène le bandeau dans le
  // viewport dès son apparition, même mécanisme que le bouton « Voir les
  // constats sources » déjà présent plus bas dans ce fichier.
  const globalErrorRef = useRef(null);
  useEffect(() => {
    if (globalError) globalErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [globalError]);

  // Garde de perte de saisie PARTAGÉE (`navigationGuard.jsx`, correctif
  // exigé avant commit -- remplace l'ancien garde local `formDirtyRef`/
  // `pendingNav` de ce fichier, désormais UNE SEULE implémentation pour
  // toute l'application : boutons d'en-tête ci-dessous, barre latérale et
  // déconnexion (`App.jsx`), bouton Précédent/Suivant du navigateur et
  // `beforeunload` (centralisés dans `NavigationGuardProvider`). `CreateForm`
  // et `RecommendationDetail` déclarent directement leur état sale via le
  // même contexte (`useNavigationGuard()`), aucun état dirty local à cette
  // page.
  const { confirmIfDirty } = useNavigationGuard();

  // Navigation entrante depuis SessionFindings.jsx (§10) -- consommée UNE
  // SEULE FOIS. `location.state` survit pourtant à un rechargement complet
  // (le navigateur conserve `history.state` sur la même entrée d'historique,
  // contrairement à un état React qui repart de zéro) -- un garde en mémoire
  // seul (`consumedNavKeyRef`) ne protège donc QUE contre un second passage
  // de cet effet pendant la même session JS, jamais contre un rechargement
  // (F5) qui rouvrirait sinon inopinément cet écran de création après un
  // « Annuler » explicite (défaut réel détecté en QA live, GATE LOT 7B ciblé
  // §5 -- jamais seulement documenté ici sans être corrigé). Le
  // `navigate(..., { replace: true })` ci-dessous retire `findingIds` de
  // `history.state` dès la consommation, sans ajouter de nouvelle entrée
  // d'historique (le bouton Précédent du navigateur n'est pas affecté).
  //
  // Purge et ouverture d'écran sont deux effets SÉPARÉS et non un seul
  // (constat compliance-privacy-reviewer, revues finales ciblées §11) : la
  // purge de `history.state` ne doit dépendre QUE de la présence de
  // `findingIds`, jamais de la réussite du chargement de `data` -- sinon un
  // premier chargement en échec (session/foyer injoignable) laisse
  // `findingIds`/`domain` indéfiniment dans `history.state`, et un
  // rechargement ultérieur (après correction du problème réseau, ou même
  // simplement F5) rouvrirait l'écran de création de façon inattendue,
  // exactement le défaut que ce mécanisme visait à éliminer. L'intention de
  // navigation est donc capturée immédiatement dans une ref dédiée
  // (`pendingFindingNavRef`), indépendante du sort du chargement.
  const consumedNavKeyRef = useRef(null);
  const pendingFindingNavRef = useRef(null);
  useEffect(() => {
    if (!location.state?.findingIds?.length) return;
    if (consumedNavKeyRef.current === location.key) return;
    consumedNavKeyRef.current = location.key;
    pendingFindingNavRef.current = { findingIds: location.state.findingIds, domain: location.state.domain || null };
    navigate(location.pathname, { replace: true });
  }, [location.key, location.state]);

  // N'ouvre l'écran de création QUE si le serveur l'autorise
  // (`session.recommendation_capabilities.create`, GATE LOT 7B ciblé §2B --
  // jamais un recalcul frontend depuis `household.status`/`session.status`,
  // au même titre que les transitions déjà couvertes par `allowed_actions`)
  // -- défense principale contre ce chemin d'entrée, indépendante du garde
  // déjà posé côté SessionFindings.jsx. Attend `data` séparément de la purge
  // ci-dessus : si le chargement échoue puis réussit après un nouvel essai
  // (`reload`), l'intention capturée est toujours honorée une fois les
  // données disponibles.
  useEffect(() => {
    if (!pendingFindingNavRef.current || !data) return;
    const { findingIds, domain } = pendingFindingNavRef.current;
    pendingFindingNavRef.current = null;
    if (!data.session.recommendation_capabilities.create) {
      setGlobalError("Ce foyer est archivé ou cette session n'est pas finalisée : aucune nouvelle recommandation ne peut être créée.");
      return;
    }
    setScreen({ kind: 'create', findingIds, domain });
  }, [data]);

  if (loading && !data) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error" role="alert" aria-live="assertive">{error}</div>;
  if (!data) return null;

  const { session, household, recommendations, findingsById } = data;
  // `archived` reste utilisé ci-dessous UNIQUEMENT pour choisir entre deux
  // textes d'aide informatifs (jamais pour activer/désactiver un contrôle) --
  // la seule décision de gating pour la CRÉATION est désormais
  // `session.recommendation_capabilities.create` (GATE LOT 7B ciblé §2B),
  // jamais un recalcul frontend.
  const archived = household.status === 'archive';
  const canCreateRecommendation = session.recommendation_capabilities.create;

  const memberOptions = session.members || [];

  const visible = recommendations.filter((r) => {
    if (filters.domain !== 'all' && r.domain !== filters.domain) return false;
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.scope !== 'all' && r.scope !== filters.scope) return false;
    if (filters.member !== 'all' && !r.member_ids.includes(Number(filters.member))) return false;
    if (filters.stale === 'stale' && !r.potentially_stale) return false;
    if (filters.stale === 'fresh' && r.potentially_stale) return false;
    return true;
  });

  function openDetail(recId) { setScreen({ kind: 'detail', id: recId }); }
  function backToList() { setScreen({ kind: 'list' }); reload(); }

  async function guardedNavigate(path) {
    const ok = await confirmIfDirty();
    if (ok) navigate(path);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => guardedNavigate(`/diagnostic-360/sessions/${id}`)}>← Fiche session</button>
          <h1>Recommandations — {session.title || `Session #${session.id}`}</h1>
          <div className="sub">
            {household.label || memberOptions.find((m) => m.member_role === 'principal')?.display_name || `Foyer #${household.id}`}
            {' · '}Révision session {session.revision}
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => guardedNavigate(`/diagnostic-360/sessions/${id}/findings`)}>Ouvrir les constats</button>
          {canCreateRecommendation && screen.kind === 'list' && (
            <button className="primary" onClick={() => setScreen({ kind: 'create', findingIds: [], domain: null })}>Nouvelle recommandation</button>
          )}
        </div>
      </div>

      {globalError && <div ref={globalErrorRef} className="alert error" role="alert" aria-live="assertive">{globalError}</div>}
      {archived && (
        <div className="alert warn">Ce foyer est archivé : consultation uniquement, aucune nouvelle activité n'est possible sur ses recommandations.</div>
      )}
      {!archived && session.status !== 'completed' && (
        <div className="alert warn">Cette session n'est pas finalisée : les recommandations ne peuvent être créées ou modifiées qu'une fois la session finalisée.</div>
      )}

      {screen.kind === 'list' && (
        <>
          <div className="chip-group mb" role="tablist" aria-label="Vue">
            <button role="tab" aria-selected={tab === 'active'} className={`chip${tab === 'active' ? ' active' : ''}`} onClick={() => setTab('active')}>Recommandations</button>
            <button role="tab" aria-selected={tab === 'history'} className={`chip${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>Historique complet</button>
          </div>

          <RecommendationFilters filters={filters} setFilters={setFilters} memberOptions={memberOptions} showStatus={tab === 'history'} />

          {visible.length === 0 ? (
            <Empty>{tab === 'history' ? 'Aucune recommandation dans l\'historique de cette session.' : 'Aucune recommandation ne correspond aux filtres actuels.'}</Empty>
          ) : (
            visible.map((r) => (
              <RecommendationCard key={r.id} rec={r} memberOptions={memberOptions} onOpen={() => openDetail(r.id)} />
            ))
          )}
        </>
      )}

      {screen.kind === 'create' && (
        <CreateForm
          sessionId={id}
          session={session}
          memberOptions={memberOptions}
          findingsById={findingsById}
          initialFindingIds={screen.findingIds}
          initialDomain={screen.domain}
          onCancel={() => setScreen({ kind: 'list' })}
          onCreated={(rec) => setScreen({ kind: 'detail', id: rec.id })}
        />
      )}

      {screen.kind === 'replace' && (
        <CreateForm
          sessionId={id}
          session={session}
          memberOptions={memberOptions}
          findingsById={findingsById}
          initialFindingIds={screen.source.finding_ids || []}
          initialDomain={screen.source.domain}
          replacement={screen.source}
          onCancel={() => setScreen({ kind: 'detail', id: screen.source.id })}
          onCreated={(rec) => setScreen({ kind: 'detail', id: rec.id })}
        />
      )}

      {screen.kind === 'detail' && (
        <RecommendationDetail
          sessionId={id}
          sessionRevision={session.revision}
          recId={screen.id}
          memberOptions={memberOptions}
          findingsById={findingsById}
          allRecommendations={recommendations}
          onBack={backToList}
          onOpenOther={(otherId) => setScreen({ kind: 'detail', id: otherId })}
          onReplace={(source) => setScreen({ kind: 'replace', source })}
          onGlobalError={setGlobalError}
        />
      )}

    </>
  );
}

// --- Filtres --------------------------------------------------------------

function RecommendationFilters({ filters, setFilters, memberOptions, showStatus }) {
  return (
    <>
      <div className="chip-group mb">
        <span className="muted" style={{ fontSize: 12 }}>Domaine :</span>
        <button type="button" aria-pressed={filters.domain === 'all'} className={`chip${filters.domain === 'all' ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, domain: 'all' }))}>Tous</button>
        {DOMAINS.map((d) => (
          <button key={d} type="button" aria-pressed={filters.domain === d} className={`chip${filters.domain === d ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, domain: d }))}>{LINK_DOMAIN_LABELS[d] || d}</button>
        ))}
      </div>
      {showStatus && (
        <div className="chip-group mb">
          <span className="muted" style={{ fontSize: 12 }}>Statut :</span>
          <button type="button" aria-pressed={filters.status === 'all'} className={`chip${filters.status === 'all' ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, status: 'all' }))}>Tous</button>
          {Object.keys(RECOMMENDATION_STATUSES).map((s) => (
            <button key={s} type="button" aria-pressed={filters.status === s} className={`chip${filters.status === s ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, status: s }))}>{RECOMMENDATION_STATUSES[s]}</button>
          ))}
        </div>
      )}
      <div className="chip-group mb">
        <span className="muted" style={{ fontSize: 12 }}>Portée :</span>
        <button type="button" aria-pressed={filters.scope === 'all'} className={`chip${filters.scope === 'all' ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, scope: 'all' }))}>Toutes</button>
        {SCOPES.map((s) => (
          <button key={s} type="button" aria-pressed={filters.scope === s} className={`chip${filters.scope === s ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, scope: s }))}>{FINDING_SCOPES[s] || s}</button>
        ))}
      </div>
      {memberOptions.length > 0 && (
        <div className="chip-group mb">
          <span className="muted" style={{ fontSize: 12 }}>Membre :</span>
          <button type="button" aria-pressed={filters.member === 'all'} className={`chip${filters.member === 'all' ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, member: 'all' }))}>Tous</button>
          {memberOptions.map((m) => (
            <button key={m.id} type="button" aria-pressed={filters.member === String(m.id)} className={`chip${filters.member === String(m.id) ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, member: String(m.id) }))}>{m.display_name}{m.historical ? ' · retiré' : ''}</button>
          ))}
        </div>
      )}
      <div className="chip-group mb">
        <span className="muted" style={{ fontSize: 12 }}>Obsolescence :</span>
        {[['all', 'Toutes'], ['stale', 'Potentiellement obsolètes'], ['fresh', 'À jour']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filters.stale === k} className={`chip${filters.stale === k ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, stale: k }))}>{l}</button>
        ))}
      </div>
    </>
  );
}

// --- Carte de recommandation ------------------------------------------------

function memberNames(memberIds, memberOptions) {
  const byId = new Map(memberOptions.map((m) => [m.id, m]));
  return memberIds.map((id) => {
    const m = byId.get(id);
    return m ? `${m.display_name}${m.historical ? ' (retiré)' : ''}` : `#${id}`;
  });
}

function RecommendationCard({ rec, memberOptions, onOpen }) {
  return (
    <div className={`card recommendation-card${rec.potentially_stale ? ' stale' : ''}${['dismissed', 'withdrawn', 'superseded'].includes(rec.status) ? ' ' + rec.status : ''}`}>
      <div className="f-head">
        <Badge value={rec.status} label={RECOMMENDATION_STATUSES[rec.status] || rec.status} />
        <Badge value="info" label={LINK_DOMAIN_LABELS[rec.domain] || rec.domain} />
        <Badge value="info" label={FINDING_SCOPES[rec.scope] || rec.scope} />
        {rec.scope === 'member' && rec.member_ids.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>{memberNames(rec.member_ids, memberOptions).join(', ')}</span>
        )}
        {rec.potentially_stale && <Badge value="stale" label="Potentiellement obsolète" />}
        <span className="f-title">{rec.title}</span>
      </div>
      {rec.summary && <div className="f-summary">{rec.summary}</div>}
      <div className="muted" style={{ fontSize: 11.5 }}>
        Créée par {rec.created_by_name || 'un conseiller'} le {fmtDateTime(rec.created_at)}
        {rec.status === 'validated' || rec.status === 'withdrawn' || rec.status === 'superseded'
          ? ` · Validée le ${fmtDateTime(rec.validated_at)}` : ''}
        {' · Révision '}{rec.revision}
      </div>
      {rec.supersedes_recommendation_id != null && (
        <div className="muted" style={{ fontSize: 11.5 }}>Remplace la recommandation #{rec.supersedes_recommendation_id}</div>
      )}
      <div className="f-actions">
        <button className="ghost small" onClick={onOpen}>Ouvrir →</button>
      </div>
    </div>
  );
}

// ============================================================================
// Déclaration à trois états (alternatives / risques / informations
// manquantes, §14) -- non renseigné / rien identifié / décrit. Ne coche
// JAMAIS automatiquement « rien identifié » : l'état initial reflète
// fidèlement les données déjà présentes (jamais un choix implicite).
// ============================================================================

// L'état affiché ('unset'/'none_identified'/'described') est un champ
// EXPLICITE (`value.mode`), jamais dérivé de (texte vide ?) -- un dérivé
// aurait été incapable de représenter « décrit, mais pas encore tapé » (la
// radio « Décrit ci-dessous » retomberait silencieusement sur « Non
// renseigné » tant qu'aucun caractère n'est saisi, un défaut réel détecté
// pendant la QA Playwright de ce lot, corrigé ici).
function DeclarationField({ legend, flagLabel, textLabel, extraTextLabel, value, onChange, disabled }) {
  // Changer d'état ne doit JAMAIS effacer silencieusement un texte déjà tapé
  // (constat client-meeting-ux, revues finales Lot 7B) -- un clic accidentel
  // sur « Non renseigné »/« Aucune … identifiée » depuis « Décrit ci-dessous »
  // perdait sans confirmation le contenu déjà rédigé par le conseiller.
  // Confirmation accessible (GATE LOT 7B ciblé §4/§5) : `window.confirm()` ne
  // peut porter aucun piège de focus/rôle ARIA testable -- remplacé par
  // `ConfirmModal`, l'état à confirmer étant conservé le temps de la réponse.
  const [pendingMode, setPendingMode] = useState(null);

  function applyMode(next) {
    if (next === 'unset') onChange({ mode: 'unset', text: '', extraText: '' });
    else if (next === 'none_identified') onChange({ mode: 'none_identified', text: '', extraText: '' });
    else onChange({ ...value, mode: 'described' });
  }

  function setMode(next) {
    if (next === value.mode) return;
    const hasText = !!(value.text.trim() || value.extraText.trim());
    if (value.mode === 'described' && hasText && next !== 'described') {
      setPendingMode(next);
      return;
    }
    applyMode(next);
  }

  return (
    <fieldset className="declaration-group">
      <legend style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{legend}</legend>
      <label className="check">
        <input type="radio" name={legend} disabled={disabled} checked={value.mode === 'unset'} onChange={() => setMode('unset')} />
        Non renseigné
      </label>
      <label className="check">
        <input type="radio" name={legend} disabled={disabled} checked={value.mode === 'none_identified'} onChange={() => setMode('none_identified')} />
        {flagLabel}
      </label>
      <label className="check">
        <input type="radio" name={legend} disabled={disabled} checked={value.mode === 'described'} onChange={() => setMode('described')} />
        Décrit ci-dessous
      </label>
      {value.mode === 'described' && (
        <div className="mt">
          <Field label={textLabel} full>
            <textarea rows={2} disabled={disabled} value={value.text} maxLength={5000} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          </Field>
          {extraTextLabel && (
            <Field label={extraTextLabel} full>
              <textarea rows={2} disabled={disabled} value={value.extraText} maxLength={5000} onChange={(e) => onChange({ ...value, extraText: e.target.value })} />
            </Field>
          )}
        </div>
      )}

      {pendingMode && (
        <ConfirmModal
          title="Effacer le texte déjà saisi ?"
          message="Le texte déjà saisi sera effacé si vous changez cet état. Continuer ?"
          confirmLabel="Effacer et continuer"
          onConfirm={() => { const next = pendingMode; setPendingMode(null); applyMode(next); }}
          onCancel={() => setPendingMode(null)}
        />
      )}
    </fieldset>
  );
}

// ============================================================================
// Champs narratifs partagés (création + édition de brouillon) -- jamais un
// préremplissage automatique de `advisor_rationale`/`summary` depuis un
// finding (§11, §3 rules-engine-auditor) : uniquement les valeurs
// explicitement tapées par le conseiller. Un seul composant pour éviter
// toute divergence entre le formulaire de création et l'édition du
// brouillon (même motif que `renderInput`, réutilisé par QuestionCard ET
// AmendModal dans SessionWorkspace.jsx).
// ============================================================================

// `emptyDeclaration`/`fieldsAreDirty`/`memberIdsEqual`/`formIsDirty`/
// `emptyFields`/`declarationFromRecommendation`/`fieldsFromRecommendation`/
// `fieldsToBody` sont désormais importées de `sessionRecommendationsPure.js`
// (GATE LOT 7B ciblé §9) -- extraites pour être testables directement via
// `node --test`, sans framework de test frontend ni double implémentation.

function NarrativeFieldsForm({ fields, setFields, disabled, autoFocusTitle }) {
  function set(key, value) { setFields((f) => ({ ...f, [key]: value })); }
  return (
    <>
      <Field label="Titre (obligatoire)" full>
        <input type="text" disabled={disabled} value={fields.title} maxLength={300} onChange={(e) => set('title', e.target.value)} autoFocus={autoFocusTitle} />
      </Field>
      <Field label="Justification du conseiller (obligatoire)" full>
        <textarea rows={4} disabled={disabled} value={fields.advisor_rationale} maxLength={5000} onChange={(e) => set('advisor_rationale', e.target.value)} />
      </Field>
      <Field label="Résumé (facultatif au brouillon, requis avant validation)" full>
        <textarea rows={2} disabled={disabled} value={fields.summary} maxLength={2000} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <Field label="Bénéfices attendus" full>
        <textarea rows={2} disabled={disabled} value={fields.expected_benefits} maxLength={5000} onChange={(e) => set('expected_benefits', e.target.value)} />
      </Field>
      <Field label="Limites" full>
        <textarea rows={2} disabled={disabled} value={fields.limitations} maxLength={5000} onChange={(e) => set('limitations', e.target.value)} />
      </Field>

      <DeclarationField
        legend="Alternatives envisagées" flagLabel="Aucune alternative identifiée"
        textLabel="Alternatives envisagées" extraTextLabel="Pourquoi elles n'ont pas été retenues"
        value={fields.alternatives} onChange={(v) => set('alternatives', v)} disabled={disabled}
      />
      <DeclarationField
        legend="Risques complémentaires" flagLabel="Aucun risque complémentaire identifié"
        textLabel="Risques" value={fields.risks} onChange={(v) => set('risks', v)} disabled={disabled}
      />
      <DeclarationField
        legend="Informations manquantes" flagLabel="Aucune information manquante connue"
        textLabel="Informations manquantes" value={fields.missingInfo} onChange={(v) => set('missingInfo', v)} disabled={disabled}
      />

      <Field label="Avertissements" full>
        <textarea rows={2} disabled={disabled} value={fields.warnings} maxLength={5000} onChange={(e) => set('warnings', e.target.value)} />
      </Field>
      <Field label="Réserves" full>
        <textarea rows={2} disabled={disabled} value={fields.reservations} maxLength={5000} onChange={(e) => set('reservations', e.target.value)} />
      </Field>
    </>
  );
}

// Ferme la dernière porte de sortie non couverte par un garde interne : un
// rafraîchissement ou une fermeture d'onglet ignorent tout état React (GATE
// LOT 7B ciblé §5). Écouteur ajouté UNIQUEMENT quand `dirty` est vrai, retiré
// dès qu'il redevient faux (sauvegarde/création réussie, abandon confirmé,
// retour manuel à l'état initial) ou au démontage -- jamais laissé actif au
//-delà de sa condition réelle. Aucun texte de saisie n'est jamais stocké
// (ni ici, ni ailleurs dans ce fichier) : `beforeunload` ne fait que
// déclencher la boîte de dialogue native du navigateur, sans persister quoi
// que ce soit en `localStorage`/`sessionStorage`/URL/historique.
// --- Formulaire de création (et de remplacement, `replacement` fourni) -----

const CREATE_FORM_BASELINE_SCOPE = 'household';
const CREATE_FORM_BASELINE_MEMBER_IDS = [];

function CreateForm({ sessionId, memberOptions, findingsById, initialFindingIds, initialDomain, replacement, onCancel, onCreated }) {
  const initialDomainValue = initialDomain || (replacement ? replacement.domain : 'health');
  const [domain, setDomain] = useState(initialDomainValue);
  const [scope, setScope] = useState(CREATE_FORM_BASELINE_SCOPE);
  const [memberIds, setMemberIds] = useState(CREATE_FORM_BASELINE_MEMBER_IDS);
  const [fields, setFields] = useState(emptyFields());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { setDirty, confirmIfDirty } = useNavigationGuard();

  const domainLocked = !!initialDomain || !!replacement;
  const selectedFindings = initialFindingIds.map((fid) => findingsById.get(fid)).filter(Boolean);

  // Déclare l'état sale au garde PARTAGÉ (`navigationGuard.jsx`, correctif
  // exigé avant commit) -- source UNIQUE désormais pour ce formulaire ET
  // pour toute navigation qui le quitterait (bouton « Annuler » local
  // ci-dessous, boutons d'en-tête, barre latérale, déconnexion, Précédent/
  // Suivant du navigateur, `beforeunload`). Comparaison NORMALISÉE complète
  // (GATE LOT 7B ciblé §5) : domaine/portée/membres inclus, pas seulement
  // les champs narratifs -- si le conseiller ramène tout manuellement à
  // l'état initial, `dirty` redevient faux (pas un drapeau irréversible).
  const dirty = formIsDirty(
    { fields, domain, scope, memberIds },
    { fields: emptyFields(), domain: initialDomainValue, scope: CREATE_FORM_BASELINE_SCOPE, memberIds: CREATE_FORM_BASELINE_MEMBER_IDS }
  );
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  async function handleCancel() {
    const ok = await confirmIfDirty();
    if (ok) onCancel();
  }

  function toggleMember(mid) {
    setMemberIds((ids) => (ids.includes(mid) ? ids.filter((x) => x !== mid) : [...ids, mid]));
  }

  function changeScope(next) {
    setScope(next);
    if (next !== 'member') setMemberIds([]);
  }

  async function submit() {
    if (submittingRef.current) return;
    setError(null);
    if (!fields.title.trim()) return setError('Le titre est obligatoire.');
    if (!fields.advisor_rationale.trim()) return setError('La justification du conseiller est obligatoire.');
    if (scope === 'member' && memberIds.length === 0) return setError('Au moins un membre ciblé est requis pour la portée « membre ».');
    submittingRef.current = true;
    setSubmitting(true);
    const body = { domain, scope, member_ids: memberIds, finding_ids: initialFindingIds, ...fieldsToBody(fields) };
    try {
      let rec;
      if (replacement) {
        rec = await api.post(`/api/advisory/recommendations/${replacement.id}/replacement`, {
          ...body, expected_source_recommendation_revision: replacement.revision,
        });
      } else {
        rec = await api.post(`/api/advisory/sessions/${sessionId}/recommendations`, body);
      }
      onCreated(rec);
    } catch (err) {
      setError(err.message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>{replacement ? `Nouvelle version — remplace la recommandation #${replacement.id}` : 'Nouvelle recommandation'}</h2>
      {replacement && (
        <div className="readonly-banner mb">
          <span>Remplace la recommandation #{replacement.id}, actuellement validée. Elle ne passera à « Remplacée » qu'au moment où cette nouvelle version sera elle-même validée.</span>
        </div>
      )}
      {error && <div className="alert error" role="alert" aria-live="assertive">{error}</div>}

      <div className="rec-form-layout">
        <div className="rec-sources">
          <h3>Constats sources (consultables)</h3>
          {selectedFindings.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>Aucun constat pré-sélectionné. Vous pouvez en lier depuis l'espace des constats après création.</p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 11.5 }}>Aucun texte n'est jamais copié automatiquement depuis ces constats.</p>
              {selectedFindings.map((f) => (
                <div key={f.id} className="card" style={{ padding: 10 }}>
                  <div className="f-head" style={{ marginBottom: 4 }}>
                    <Badge value={f.finding_type} label={FINDING_TYPES[f.finding_type] || f.finding_type} />
                    <Badge value={f.priority} label={PRIORITIES[f.priority] || f.priority} />
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{f.summary}</div>
                </div>
              ))}
            </>
          )}
        </div>

        <div>
          <div className="form-grid">
            <Field label="Domaine">
              <select value={domain} disabled={domainLocked} onChange={(e) => setDomain(e.target.value)}>
                {DOMAINS.map((d) => <option key={d} value={d}>{LINK_DOMAIN_LABELS[d] || d}</option>)}
              </select>
              {domainLocked && (
                <span className="muted" style={{ fontSize: 11 }}>
                  {replacement ? 'Fixé : reprend le domaine de la recommandation remplacée.' : 'Fixé par le(s) constat(s) source(s) sélectionné(s).'}
                </span>
              )}
            </Field>
            <Field label="Portée">
              <select value={scope} onChange={(e) => changeScope(e.target.value)}>
                {SCOPES.map((s) => <option key={s} value={s}>{FINDING_SCOPES[s] || s}</option>)}
              </select>
            </Field>
          </div>

          {scope === 'member' && (
            <Field label="Membres ciblés (au moins un)" full>
              <div className="radiogroup">
                {memberOptions.map((m) => (
                  <label className="check" key={m.id}>
                    <input type="checkbox" checked={memberIds.includes(m.id)} onChange={() => toggleMember(m.id)} />
                    {m.display_name}{m.historical ? ' · retiré du foyer' : ''}
                  </label>
                ))}
              </div>
            </Field>
          )}

          <NarrativeFieldsForm fields={fields} setFields={setFields} autoFocusTitle />

          <div className="actions">
            <button onClick={handleCancel} disabled={submitting}>Annuler</button>
            <button className="primary" disabled={submitting} onClick={submit}>Créer le brouillon</button>
          </div>
        </div>
      </div>

    </div>
  );
}

// ============================================================================
// Détail d'une recommandation -- édition en place pour un brouillon (§15),
// intégralement en lecture seule sinon. Chaque mutation utilise
// `expected_recommendation_revision` (et, pour la validation,
// `expected_session_revision` en plus) ; jamais de succès annoncé avant
// confirmation serveur ; la nouvelle révision retournée devient
// immédiatement la référence pour la mutation suivante.
// ============================================================================

function successorOf(recId, allRecommendations) {
  return (allRecommendations || []).find((r) => r.supersedes_recommendation_id === recId) || null;
}

function RecommendationDetail({ sessionRevision, recId, memberOptions, findingsById, allRecommendations, onBack, onOpenOther, onReplace, onGlobalError }) {
  const [state, setState] = useState({ loading: true, rec: null, error: null });
  const [domain, setDomain] = useState(null);
  const [scope, setScope] = useState(null);
  const [memberIds, setMemberIds] = useState([]);
  const [fields, setFields] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [modal, setModal] = useState(null); // 'validate' | 'dismiss' | 'withdraw' | null
  const { setDirty, confirmIfDirty } = useNavigationGuard();
  // Le bouton « Enregistrer » est en bas d'un formulaire long (9 champs
  // narratifs + 3 déclarations + constats liés) alors que l'erreur s'affiche
  // en haut de la carte -- ramène l'erreur dans le viewport dès son
  // apparition (constat client-meeting-ux, revues finales Lot 7B).
  const saveErrorRef = useRef(null);
  useEffect(() => {
    if (saveError) saveErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [saveError]);

  // Déclare l'état sale au garde PARTAGÉ (`navigationGuard.jsx`, correctif
  // exigé avant commit) -- même source unique que `CreateForm` ci-dessus,
  // couvre à la fois le bouton « ← Recommandations » propre à cet écran
  // (`handleBack` plus bas) et toute navigation le quittant (en-tête, barre
  // latérale, déconnexion, Précédent/Suivant, `beforeunload`).
  // `allowed_actions.edit` (GATE LOT 7B ciblé) remplace ici l'ancien
  // `!readOnly && status === 'draft'` recalculé côté client -- source de
  // vérité exclusivement serveur. Comparaison NORMALISÉE complète (GATE
  // LOT 7B ciblé §5) : domaine/portée/membres inclus contre la dernière
  // version connue du serveur, pas seulement les champs narratifs.
  // `findings` n'est volontairement PAS comparé ici : lier/délier un
  // finding est une mutation IMMÉDIATE (appel réseau propre,
  // `unlinkFinding` ci-dessous), jamais une valeur mise en attente d'un
  // « Enregistrer » -- il n'existe donc aucun état local à comparer pour ce
  // champ (`load()` recharge la vérité serveur après chaque lien/déliaison).
  const dirty = !!(
    state.rec && fields && state.rec.allowed_actions?.edit
    && formIsDirty({ fields, domain, scope, memberIds }, { fields: fieldsFromRecommendation(state.rec), domain: state.rec.domain, scope: state.rec.scope, memberIds: state.rec.member_ids })
  );
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(`/api/advisory/recommendations/${recId}`).then(
      (rec) => {
        setState({ loading: false, rec, error: null });
        setDomain(rec.domain);
        setScope(rec.scope);
        setMemberIds(rec.member_ids);
        setFields(fieldsFromRecommendation(rec));
      },
      (error) => setState({ loading: false, rec: null, error: error.message })
    );
  }, [recId]);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <p className="muted">Chargement…</p>;
  if (state.error) return <div className="alert error" role="alert" aria-live="assertive">{state.error}</div>;
  if (!state.rec) return null;
  const rec = state.rec;
  // Source de vérité EXCLUSIVEMENT serveur (GATE LOT 7B ciblé) : le frontend
  // ne reconstruit plus jamais les transitions autorisées à partir de
  // `rec.status`/`household.status`/`session.status` -- `allowed_actions`
  // (server/advisoryRecommendations.js, `computeAllowedActions`) reflète
  // exactement les mêmes gardes que chaque route d'écriture correspondante.
  const canWrite = rec.allowed_actions.edit;
  const linkedFindings = rec.finding_ids.map((fid) => findingsById.get(fid)).filter(Boolean);
  const successor = successorOf(rec.id, allRecommendations);

  function toggleMember(mid) {
    setMemberIds((ids) => (ids.includes(mid) ? ids.filter((x) => x !== mid) : [...ids, mid]));
  }
  function changeScope(next) {
    setScope(next);
    if (next !== 'member') setMemberIds([]);
  }

  async function handleBack() {
    const ok = await confirmIfDirty();
    if (ok) onBack();
  }

  // Correctif GATE LOT 7B (correction round, défaut certain relevé par la
  // revue finale `client-meeting-ux`) : `onOpenOther` changeait `recId` sur
  // le MÊME `RecommendationDetail` déjà monté (pas de démontage), donc
  // l'effet de chargement écrasait silencieusement `fields`/`domain`/
  // `scope`/`memberIds` d'un brouillon en cours d'édition sans jamais
  // passer par `confirmIfDirty()` -- perte de saisie sans aucun
  // avertissement. Même garde que `handleBack` ci-dessus.
  async function handleOpenOther(otherId) {
    const ok = await confirmIfDirty();
    if (ok) onOpenOther(otherId);
  }

  async function save() {
    if (savingRef.current) return;
    setSaveError(null);
    if (!fields.title.trim()) return setSaveError('Le titre est obligatoire.');
    if (!fields.advisor_rationale.trim()) return setSaveError('La justification du conseiller est obligatoire.');
    if (scope === 'member' && memberIds.length === 0) return setSaveError('Au moins un membre ciblé est requis pour la portée « membre ».');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.put(`/api/advisory/recommendations/${rec.id}`, {
        domain, scope, member_ids: memberIds, expected_recommendation_revision: rec.revision, ...fieldsToBody(fields),
      });
      load();
    } catch (err) {
      // Un 409 sur cette route peut avoir plusieurs causes distinctes
      // (révision, statut devenu non-brouillon, session/foyer non
      // inscriptible) -- distingué sur `err.data.code` (GATE LOT 7B ciblé
      // §3), jamais en supposant que tout 409 est un conflit de révision.
      setSaveError(interpretRecommendationError(err));
      if (err.status === 409) load();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function unlinkFinding(findingId) {
    try {
      await api.del(`/api/advisory/recommendations/${rec.id}/findings/${findingId}`, { expected_recommendation_revision: rec.revision });
      load();
    } catch (err) {
      onGlobalError(interpretRecommendationError(err));
      if (err.status === 409) load();
    }
  }

  return (
    <div className="card">
      <button className="ghost small" onClick={handleBack}>← Recommandations</button>
      <div className="f-head mt">
        <Badge value={rec.status} label={RECOMMENDATION_STATUSES[rec.status] || rec.status} />
        <Badge value="info" label={LINK_DOMAIN_LABELS[rec.domain] || rec.domain} />
        <span className="muted" style={{ fontSize: 12 }}>Révision {rec.revision}</span>
      </div>

      {rec.potentially_stale && (
        <div className="alert warn">
          Potentiellement obsolète — la session ou les constats ont évolué depuis la validation. Ce n'est pas une invalidité juridique certaine, seulement un signal à vérifier.
          {' '}
          <button className="ghost small" onClick={() => document.getElementById('rec-linked-findings')?.scrollIntoView({ behavior: 'smooth' })}>Voir les constats sources</button>
        </div>
      )}
      {rec.supersedes_recommendation_id != null && (
        <div className="readonly-banner mb">
          <span>Remplace la recommandation <button className="ghost small" onClick={() => handleOpenOther(rec.supersedes_recommendation_id)}>#{rec.supersedes_recommendation_id}</button>.</span>
        </div>
      )}
      {successor && (
        <div className="readonly-banner mb">
          <span>Remplacée par la recommandation <button className="ghost small" onClick={() => handleOpenOther(successor.id)}>#{successor.id}</button> (statut : {RECOMMENDATION_STATUSES[successor.status] || successor.status}).</span>
        </div>
      )}
      {rec.status === 'dismissed' && (
        <div className="alert warn">Écartée par {rec.dismissed_by_name || 'un conseiller'} le {fmtDateTime(rec.dismissed_at)} — Motif : {rec.dismiss_reason}</div>
      )}
      {rec.status === 'withdrawn' && (
        <div className="alert warn">
          Retirée par {rec.withdrawn_by_name || 'un conseiller'} le {fmtDateTime(rec.withdrawn_at)} — Motif : {rec.withdraw_reason}.
          Elle reste dans l'historique, son contenu reste immuable, aucun remplacement n'a été créé automatiquement.
        </div>
      )}
      {rec.status === 'validated' && (
        <div className="muted" style={{ fontSize: 12 }}>Validée par {rec.validated_by_name || 'un conseiller'} le {fmtDateTime(rec.validated_at)} (révision de session {rec.validated_session_revision}).</div>
      )}

      {saveError && <div ref={saveErrorRef} className="alert error" role="alert" aria-live="assertive">{saveError}</div>}

      <div className="mt">
        <div className="form-grid">
          <Field label="Domaine">
            <select value={domain} disabled={!canWrite} onChange={(e) => setDomain(e.target.value)}>
              {DOMAINS.map((d) => <option key={d} value={d}>{LINK_DOMAIN_LABELS[d] || d}</option>)}
            </select>
            {!canWrite && (
              <span className="muted" style={{ fontSize: 11 }}>
                {rec.status === 'draft' ? "Lecture seule : cette page n'autorise pas la modification en ce moment." : 'Non modifiable : le contenu est immuable une fois la recommandation validée, écartée ou retirée.'}
              </span>
            )}
          </Field>
          <Field label="Portée">
            <select value={scope} disabled={!canWrite} onChange={(e) => changeScope(e.target.value)}>
              {SCOPES.map((s) => <option key={s} value={s}>{FINDING_SCOPES[s] || s}</option>)}
            </select>
          </Field>
        </div>

        {scope === 'member' && (
          <Field label="Membres ciblés" full>
            <div className="radiogroup">
              {memberOptions.map((m) => (
                <label className="check" key={m.id}>
                  <input type="checkbox" disabled={!canWrite} checked={memberIds.includes(m.id)} onChange={() => toggleMember(m.id)} />
                  {m.display_name}{m.historical ? ' · retiré du foyer' : ''}
                </label>
              ))}
            </div>
          </Field>
        )}

        <NarrativeFieldsForm fields={fields} setFields={setFields} disabled={!canWrite} />
      </div>

      <div id="rec-linked-findings" className="mt">
        <h3>Constats sources</h3>
        {linkedFindings.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5 }}>Aucun constat lié.</p>
        ) : (
          linkedFindings.map((f) => (
            <div key={f.id} className="card" style={{ padding: 10, marginBottom: 6 }}>
              <div className="f-head" style={{ marginBottom: 4 }}>
                <Badge value={f.finding_type} label={FINDING_TYPES[f.finding_type] || f.finding_type} />
                <Badge value={f.priority} label={PRIORITIES[f.priority] || f.priority} />
                <Badge value={f.finding_scope} label={FINDING_SCOPES[f.finding_scope] || f.finding_scope} />
                {f.status !== 'active' && <span className="muted" style={{ fontSize: 11 }}>(constat {f.status === 'dismissed' ? 'écarté' : 'historique'})</span>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{f.summary}</div>
              {rec.allowed_actions.unlink_finding && (
                <div className="f-actions">
                  <button className="ghost small" onClick={() => unlinkFinding(f.id)}>Retirer ce constat</button>
                </div>
              )}
            </div>
          ))
        )}
        {rec.allowed_actions.link_finding && (
          <p className="muted" style={{ fontSize: 12 }}>
            Pour lier d'autres constats, sélectionnez-les depuis l'espace des constats.
          </p>
        )}
      </div>

      <div className="actions">
        {rec.allowed_actions.edit && <button disabled={saving} onClick={save}>Enregistrer</button>}
        {rec.allowed_actions.dismiss && <button className="ghost" disabled={saving} onClick={() => setModal('dismiss')}>Écarter</button>}
        {rec.allowed_actions.validate && <button className="primary" disabled={saving} onClick={() => setModal('validate')}>Valider</button>}
        {rec.allowed_actions.withdraw && <button className="ghost" onClick={() => setModal('withdraw')}>Retirer</button>}
        {rec.allowed_actions.replace && <button onClick={() => onReplace(rec)}>Créer une nouvelle version</button>}
      </div>

      {modal === 'validate' && (
        <ValidateModal
          rec={rec} sessionRevision={sessionRevision}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
        />
      )}
      {modal === 'dismiss' && (
        <DismissRecommendationModal
          rec={rec}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
          onReload={load}
        />
      )}
      {modal === 'withdraw' && (
        <WithdrawModal
          rec={rec}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
          onReload={load}
        />
      )}

    </div>
  );
}

// --- Validation -------------------------------------------------------

function ValidateModal({ rec, sessionRevision, onClose, onDone }) {
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const warnId = useId();
  const missing = [];
  if (!rec.title?.trim()) missing.push('titre');
  if (!rec.summary?.trim()) missing.push('résumé');
  if (!rec.advisor_rationale?.trim()) missing.push('justification du conseiller');
  if (rec.finding_ids.length === 0) missing.push('au moins un constat source');

  async function submit() {
    if (submittingRef.current) return;
    setError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/api/advisory/recommendations/${rec.id}/validate`, {
        expected_recommendation_revision: rec.revision, expected_session_revision: sessionRevision,
      });
      onDone();
    } catch (err) {
      // Les deux révisions ont des causes et des conséquences distinctes
      // (§17) : jamais fusionnées dans un seul message générique. Distingué
      // sur le code machine stable renvoyé par le serveur
      // (`interpretRecommendationError`, GATE LOT 7B ciblé §3) -- jamais sur
      // le texte français de `err.message`, non contractuel et susceptible
      // d'évoluer.
      setError(interpretRecommendationError(err));
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Valider cette recommandation" onClose={onClose} closeDisabled={submitting} describedById={warnId}>
      {error && <div className="alert error" role="alert" aria-live="assertive">{error}</div>}
      {missing.length > 0 && (
        <div className="alert warn">
          Éléments manifestement absents (le serveur revérifiera intégralement) : {missing.join(', ')}.
        </div>
      )}
      <div className="alert warn" id={warnId}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>La validation rend le contenu immuable.</li>
          <li>Les constats sources seront figés comme justification historique.</li>
          {/* Reformulé sans jargon technique (GATE LOT 7B ciblé §11, revue
              client-meeting-ux) : « révision attendue » ne dit rien au
              conseiller sur la cause ni sur l'action à faire -- explique le
              scénario concret (quelqu'un d'autre a modifié entre-temps) et
              l'action de récupération (fermer/rouvrir). */}
          <li>Si les réponses ou les constats de cette session ont été modifiés ailleurs (autre onglet, autre conseiller) pendant que cette fenêtre était ouverte, la validation sera refusée — fermez cette fenêtre et recommencez pour repartir sur les données à jour.</li>
          <li>Vous pouvez valider vous-même votre propre recommandation en v1 : ce n'est pas un contrôle à quatre yeux.</li>
        </ul>
      </div>
      <div className="actions">
        <button onClick={onClose} disabled={submitting}>Annuler</button>
        <button className="primary" disabled={submitting} onClick={submit}>Confirmer la validation</button>
      </div>
    </Modal>
  );
}

// --- Écartement (brouillon) ------------------------------------------------

function DismissRecommendationModal({ rec, onClose, onDone, onReload }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const warnId = useId();
  const errorId = useId();

  async function submit() {
    if (submittingRef.current) return;
    setError(null);
    if (!reason.trim()) return setError("Le motif d'écartement est obligatoire.");
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/api/advisory/recommendations/${rec.id}/dismiss`, {
        dismiss_reason: reason, expected_recommendation_revision: rec.revision,
      });
      onDone();
    } catch (err) {
      // Même traitement que `save()`/`unlinkFinding()` (GATE LOT 7B ciblé
      // §11, revue advisory-architect) : message unifié par code machine,
      // et rechargement de la vérité serveur sur un 409 (révision devenue
      // obsolète ou recommandation déjà écartée par ailleurs entre-temps)
      // -- sans ce rechargement, l'écran restait figé sur une révision
      // périmée sans que le conseiller le sache avant un nouvel essai.
      setError(interpretRecommendationError(err));
      if (err.status === 409) onReload();
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Écarter ce brouillon" onClose={onClose} closeDisabled={submitting} describedById={warnId}>
      {error && <div id={errorId} className="alert error" role="alert" aria-live="assertive">{error}</div>}
      <div className="alert warn" id={warnId}>
        Ce brouillon restera dans l'historique — il n'est jamais supprimé, seulement écarté. Il ne sera plus modifiable ensuite.
      </div>
      <Field label="Motif de l'écartement (obligatoire)" full>
        <textarea
          rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        />
      </Field>
      <div className="actions">
        <button onClick={onClose} disabled={submitting}>Annuler</button>
        <button className="primary" disabled={submitting} onClick={submit}>Écarter</button>
      </div>
    </Modal>
  );
}

// --- Retrait (recommandation validée) ---------------------------------

function WithdrawModal({ rec, onClose, onDone, onReload }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const warnId = useId();
  const errorId = useId();

  async function submit() {
    if (submittingRef.current) return;
    setError(null);
    if (!reason.trim()) return setError('Le motif de retrait est obligatoire.');
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/api/advisory/recommendations/${rec.id}/withdraw`, {
        withdraw_reason: reason, expected_recommendation_revision: rec.revision,
      });
      onDone();
    } catch (err) {
      // Même traitement que `save()`/`unlinkFinding()` (GATE LOT 7B ciblé
      // §11, revue advisory-architect) : message unifié par code machine,
      // et rechargement de la vérité serveur sur un 409 (révision devenue
      // obsolète ou recommandation déjà retirée par ailleurs entre-temps).
      setError(interpretRecommendationError(err));
      if (err.status === 409) onReload();
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Retirer cette recommandation" onClose={onClose} closeDisabled={submitting} describedById={warnId}>
      {error && <div id={errorId} className="alert error" role="alert" aria-live="assertive">{error}</div>}
      <div className="alert warn" id={warnId}>
        La recommandation reste dans l'historique — elle n'est pas supprimée, son contenu reste immuable. Aucun remplacement n'est créé automatiquement.
      </div>
      <Field label="Motif du retrait (obligatoire)" full>
        <textarea
          rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        />
      </Field>
      <div className="actions">
        <button onClick={onClose} disabled={submitting}>Annuler</button>
        <button className="primary" disabled={submitting} onClick={submit}>Retirer</button>
      </div>
    </Modal>
  );
}
