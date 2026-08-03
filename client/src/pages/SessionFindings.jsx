import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, Field, Badge, Empty } from '../components/ui.jsx';
import {
  SESSION_STATUSES, LINK_DOMAIN_LABELS, BRANCHES, CONTRACT_STATUS,
  FINDING_TYPES, PRIORITIES, FINDING_SCOPES, FINDING_STATUSES, EXECUTION_STATUSES,
  GLOBAL_ANALYSIS_STATES, fmtDate, fmtDateTime,
} from '../labels.js';

// Ordre d'affichage des onglets de domaine -- toujours le même quel que soit
// l'ordre renvoyé par le serveur dans `by_domain` (un objet JS, jamais un
// ordre garanti) ; ne rend que les domaines réellement applicables à CETTE
// session (`Object.keys(data.by_domain)`), jamais les trois par défaut.
const DOMAIN_ORDER = ['common', 'health', 'life_pension'];

const CONFLICT_MESSAGE = "Cette session a été modifiée ailleurs (un autre onglet ?) depuis votre dernier chargement — page actualisée.";

// Même mécanisme que `useWorkspace` (SessionWorkspace.jsx) : annulation
// propre au démontage, jeton de séquence pour ignorer une réponse devenue
// obsolète -- nécessaire ici aussi car la projection est rechargée après
// chaque analyse/écartement.
function useFindingsWorkspace(sessionId) {
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
    api.get(`/api/advisory/sessions/${sessionId}/findings-workspace`, controller.signal).then(
      (data) => {
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        setState({ loading: false, data, error: null });
      },
      (error) => {
        if (error.name === 'AbortError') return;
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        setState({ loading: false, data: null, error: error.message });
      }
    );
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export default function SessionFindings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFindingsWorkspace(id);

  const revisionRef = useRef(null);
  useEffect(() => {
    if (data?.session?.revision != null) revisionRef.current = data.session.revision;
  }, [data?.session?.revision]);

  const [activeDomain, setActiveDomain] = useState(null);
  const [dismissTarget, setDismissTarget] = useState(null);
  const [historyDomain, setHistoryDomain] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [globalError, setGlobalError] = useState(null);
  // Sélection multiple pour la création groupée d'une recommandation (Lot
  // 7B, §10) -- limitée à un SEUL domaine à la fois : les cases ne sont
  // rendues que sur l'onglet de domaine actif (voir DomainPanel), donc
  // seule la tentative de CHANGER d'onglet avec une sélection non vide doit
  // être gérée explicitement ci-dessous (jamais un mélange silencieux de
  // `common`/`health`/`life_pension`).
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedFindingIds, setSelectedFindingIds] = useState(new Set());
  // Garde SYNCHRONE (constat GATE LOT 4B §7, QA de concurrence) : `analyzing`
  // (état React) ne protège le double-clic qu'APRÈS le rendu qui le reflète
  // dans le DOM (`disabled={analyzing}`) -- deux clics quasi simultanés
  // peuvent tous deux lire la même fermeture obsolète (`analyzing` encore
  // `false`) avant que React n'ait eu l'occasion de re-rendre entre les deux,
  // déclenchant alors deux appels réseau. Une ref, lue et écrite de façon
  // strictement synchrone dès l'entrée de la fonction, ferme cette fenêtre
  // -- `analyzing` (état) reste néanmoins la source de vérité pour l'affichage
  // (désactivation visuelle du bouton, libellé « Analyse en cours… »).
  const analyzingRef = useRef(false);

  const domains = useMemo(() => (data ? DOMAIN_ORDER.filter((d) => data.by_domain[d]) : []), [data]);
  useEffect(() => {
    if (domains.length && !domains.includes(activeDomain)) setActiveDomain(domains[0]);
  }, [domains, activeDomain]);

  // Lance l'analyse sur TOUS les domaines applicables en un seul geste
  // (POST .../analyze, server/advisoryRuleExecutions.js —
  // executeApplicableRuleSetsForSession). Le résultat est STRUCTURÉ par
  // domaine : un échec sur un domaine ne doit jamais être présenté comme un
  // échec global, ni son succès sur les autres masqué (GATE LOT 4B §7).
  async function launchAnalysis() {
    if (analyzingRef.current) return; // anti-double-clic (garde synchrone, voir analyzingRef)
    analyzingRef.current = true;
    setAnalyzing(true);
    setGlobalError(null);
    try {
      const res = await api.post(`/api/advisory/sessions/${id}/analyze`, { expected_revision: revisionRef.current });
      const failed = res.results.filter((r) => r.status === 'failed');
      if (failed.length > 0) {
        setGlobalError(
          `L'analyse a échoué pour : ${failed.map((r) => LINK_DOMAIN_LABELS[r.domain] || r.domain).join(', ')}. `
          + 'Les autres domaines applicables ont bien été analysés — voir le détail par domaine ci-dessous.'
        );
      }
      // Bascule automatiquement vers le premier domaine ayant effectivement
      // produit des constats si l'onglet actuellement affiché n'en a
      // lui-même aucun -- évite de laisser le conseiller sur un onglet vide
      // après un lancement réussi ailleurs (constat UX, rien n'est manqué,
      // le tri des constats eux-mêmes reste entièrement celui du serveur).
      const currentResult = res.results.find((r) => r.domain === activeDomain);
      const currentHasFindings = currentResult?.status === 'completed' && currentResult.findings_count > 0;
      if (!currentHasFindings) {
        const withFindings = res.results.find((r) => r.status === 'completed' && r.findings_count > 0);
        if (withFindings) setActiveDomain(withFindings.domain);
      }
      reload();
    } catch (err) {
      setGlobalError(err.status === 409 ? CONFLICT_MESSAGE : err.message);
      if (err.status === 409) reload();
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }

  // Navigation contextualisée vers la réponse source, jamais dans l'URL
  // (§16) : passée via l'état de navigation React Router, résolue par
  // SessionWorkspace.jsx à l'arrivée (jamais une valeur de réponse
  // transmise ici, seulement des identifiants techniques). `answerId`
  // (GATE LOT 4B §2) est la ligne IMMUABLE de `advisory_answers` réellement
  // utilisée par le finding -- source de vérité pour ouvrir l'historique
  // exactement sur cette réponse, jamais seulement la réponse active
  // courante (qui a pu changer depuis). Absent pour un lien « Répondre » sur
  // une donnée manquante (aucune réponse n'existe encore, donc aucun
  // answer_id possible).
  function goToSourceAnswer(questionId, memberId, answerId) {
    if (questionId == null) return;
    navigate(`/diagnostic-360/sessions/${id}/workspace`, { state: { questionId, memberId: memberId ?? null, answerId: answerId ?? null } });
  }

  // Refuse clairement le changement d'onglet tant qu'une sélection non vide
  // existe (§10) -- jamais un mélange silencieux de domaines dans une même
  // recommandation groupée.
  function switchDomain(domain) {
    if (selectedFindingIds.size > 0 && domain !== activeDomain) return;
    setActiveDomain(domain);
  }

  function toggleSelected(findingId) {
    setSelectedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }

  function clearSelection() { setSelectedFindingIds(new Set()); }

  function createFromFindings(findingIds) {
    navigate(`/diagnostic-360/sessions/${id}/recommendations`, { state: { findingIds, domain: activeDomain } });
  }

  if (loading && !data) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error" role="alert" aria-live="assertive">{error}</div>;
  if (!data) return null;

  const { session, household, by_domain, actions, global_state: globalState, synthesis } = data;
  const domainData = activeDomain ? by_domain[activeDomain] : null;
  // Défense symétrique de `canDismiss` (même source serveur, `actions.
  // can_create_recommendation`) -- corrige un garde manquant sur les deux
  // points d'entrée vers la création d'une recommandation (constat
  // compliance-privacy-reviewer + advisory-architect, revues finales Lot
  // 7B) : la protection principale est désormais côté
  // SessionRecommendations.jsx (garde sur l'écran de création lui-même),
  // ceci évite en complément de laisser apparaître des affordances de
  // création sur un foyer déjà archivé. Réutilise EXACTEMENT le même
  // prédicat serveur que `recommendation_capabilities.create`
  // (`advisorySessions.js`) et `assertSessionWritable`
  // (`advisoryRecommendations.js`) -- plus aucun recalcul frontend depuis
  // `household.status` (GATE LOT 7B ciblé §2B).
  const canCreateRecommendation = actions.can_create_recommendation;

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => navigate(`/diagnostic-360/sessions/${id}`)}>← Fiche session</button>
          <h1>Constats — {session.title || `Session #${session.id}`}</h1>
          <div className="sub">
            <Badge value={session.status} label={SESSION_STATUSES[session.status]} />{' '}
            {globalState && <Badge value={globalState} label={GLOBAL_ANALYSIS_STATES[globalState] || globalState} />}{' '}
            {household.label || household.primary_display_name}
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/workspace`)}>Ouvrir l'espace de rendez-vous</button>
          <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/recommendations`)}>Ouvrir les recommandations</button>
          <button className="primary" disabled={!actions.can_launch_analysis || analyzing} onClick={launchAnalysis}>
            {analyzing ? 'Analyse en cours…' : "Lancer l'analyse"}
          </button>
        </div>
      </div>

      {globalError && <div className="alert error" role="alert" aria-live="assertive">{globalError}</div>}
      {household.status === 'archive' && (
        <div className="alert warn">Ce foyer est archivé : consultation uniquement, aucune nouvelle analyse ni écartement n'est possible.</div>
      )}
      {!actions.can_launch_analysis && household.status !== 'archive' && (
        <div className="alert warn">
          Cette session n'est pas dans un état permettant de lancer une analyse (elle doit être finalisée au préalable).
        </div>
      )}

      {synthesis && domains.length > 1 && <GlobalSynthesis synthesis={synthesis} />}

      {domains.length > 1 && (
        <div className="wksp-modules" role="tablist" aria-label="Domaines">
          {domains.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === activeDomain}
              className={d === activeDomain ? 'active' : ''}
              onClick={() => switchDomain(d)}
            >
              {LINK_DOMAIN_LABELS[d] || d}
              {by_domain[d].findings.some((f) => f.status === 'active' && f.needs_review) && <span aria-hidden> ⚠</span>}
            </button>
          ))}
        </div>
      )}

      {selectedFindingIds.size > 0 && (
        <div className="readonly-banner mb">
          <span>{selectedFindingIds.size} constat(s) sélectionné(s) ({LINK_DOMAIN_LABELS[activeDomain] || activeDomain}) — changer de domaine est désactivé tant que la sélection n'est pas vidée.</span>
          <div className="flex">
            {canCreateRecommendation && <button className="primary small" onClick={() => createFromFindings([...selectedFindingIds])}>Créer une recommandation ({selectedFindingIds.size})</button>}
            <button className="ghost small" onClick={clearSelection}>Vider la sélection</button>
          </div>
        </div>
      )}

      {domainData && (
        <DomainPanel
          key={activeDomain}
          domainKey={activeDomain}
          domainData={domainData}
          canDismiss={actions.can_dismiss_findings}
          onDismiss={setDismissTarget}
          onGoToSource={goToSourceAnswer}
          onOpenHistory={() => setHistoryDomain(activeDomain)}
          multiSelect={multiSelect}
          onToggleMultiSelect={() => { setMultiSelect((v) => !v); clearSelection(); }}
          selectedFindingIds={selectedFindingIds}
          onToggleSelected={toggleSelected}
          onCreateFromFinding={(findingId) => createFromFindings([findingId])}
          canCreateRecommendation={canCreateRecommendation}
        />
      )}

      {dismissTarget && (
        <DismissModal
          sessionId={id}
          finding={dismissTarget}
          getRevision={() => revisionRef.current}
          onClose={() => setDismissTarget(null)}
          onDone={() => { setDismissTarget(null); reload(); }}
        />
      )}
      {historyDomain && (
        <HistoryModal
          sessionId={id}
          domain={historyDomain}
          domainLabel={LINK_DOMAIN_LABELS[historyDomain] || historyDomain}
          onGoToSource={goToSourceAnswer}
          onClose={() => setHistoryDomain(null)}
        />
      )}
    </>
  );
}

// --- Synthèse active multi-domaines (GATE LOT 4B §3) ---------------------
// Uniquement visible quand plus d'un domaine s'applique à cette session
// (mixte) -- pour un seul domaine, les tuiles déjà affichées par
// DomainPanel suffisent, cette synthèse serait redondante. Compte UNIQUEMENT
// les findings actifs des domaines EUX-MÊMES à jour (`synthesis.domains_current`,
// calculé côté serveur, jamais recalculé différemment ici) : un domaine
// obsolète reste consultable dans son propre onglet mais n'entre jamais dans
// ce total, pour ne jamais laisser croire que la synthèse reflète l'état le
// plus récent alors qu'un domaine a changé depuis sa dernière analyse.
function GlobalSynthesis({ synthesis }) {
  return (
    <>
      <div className="tiles mb">
        <div className="tile"><div className="label">Constats actifs (synthèse)</div><div className="value">{synthesis.active_findings_count}</div></div>
        <div className="tile"><div className="label">Conflits à examiner (synthèse)</div><div className="value">{synthesis.active_conflicts_count}</div></div>
      </div>
      {synthesis.domains_excluded_stale.length > 0 && (
        <div className="alert warn mb">
          {synthesis.domains_excluded_stale.map((d) => LINK_DOMAIN_LABELS[d] || d).join(', ')} — analyse obsolète : ses constats restent consultables dans son onglet, mais ne sont pas comptés dans la synthèse ci-dessus tant qu'une nouvelle analyse n'a pas été relancée pour ce domaine.
        </div>
      )}
    </>
  );
}

// --- Panneau d'un domaine ----------------------------------------------

// Le lien vers l'historique des analyses (§21) est rendu SÉPARÉMENT de cette
// bannière (voir DomainPanel) -- il doit rester atteignable quel que soit
// l'état du domaine dès qu'une exécution existe, jamais seulement dans le
// cas "à jour" (une session devenue "stale"/un dernier essai en échec n'en a
// pas moins un historique à consulter).
function DomainStateBanner({ domainData }) {
  if (domainData.last_attempt_failed) {
    return (
      <div className="alert error">
        Le dernier lancement de l'analyse pour ce domaine a échoué.{' '}
        {domainData.last_execution
          ? "Les constats affichés ci-dessous proviennent de la dernière analyse réussie."
          : "Aucune analyse n'a encore réussi pour ce domaine."}
      </div>
    );
  }
  if (domainData.state === 'no_rule_set_available') {
    return <div className="alert warn">Aucun ensemble de règles n'est actuellement publié pour ce domaine — aucune analyse ne peut être lancée.</div>;
  }
  if (domainData.state === 'not_yet_run') {
    return <div className="alert warn">Aucune analyse n'a encore été lancée pour ce domaine.</div>;
  }
  if (domainData.state === 'stale') {
    return (
      <div className="alert warn">
        Des réponses ont été modifiées depuis la dernière analyse de ce domaine ({fmtDateTime(domainData.last_execution.ended_at)}).
        Les constats ci-dessous restent ceux de cette dernière analyse — relancez l'analyse pour les mettre à jour.
      </div>
    );
  }
  if (domainData.state === 'up_to_date') {
    return <div className="alert ok">Analyse à jour (lancée le {fmtDateTime(domainData.last_execution.ended_at)}).</div>;
  }
  return null;
}

const STATUS_FILTERS = [['active', 'Actifs'], ['dismissed', 'Écartés'], ['all', 'Tous']];
const PRIORITY_FILTERS = [['all', 'Toutes'], ['critical', 'Critique'], ['high', 'Élevée'], ['medium', 'Moyenne'], ['low', 'Faible']];
const TYPE_FILTERS = [['all', 'Tous'], ...Object.entries(FINDING_TYPES)];

function DomainPanel({ domainData, canDismiss, onDismiss, onGoToSource, onOpenHistory, multiSelect, onToggleMultiSelect, selectedFindingIds, onToggleSelected, onCreateFromFinding, canCreateRecommendation }) {
  const [filters, setFilters] = useState({ status: 'active', priority: 'all', type: 'all', member: 'all' });
  const findings = domainData.findings;

  const activeCount = findings.filter((f) => f.status === 'active').length;
  const conflictCount = findings.filter((f) => f.status === 'active' && f.needs_review).length;
  const dismissedCount = findings.filter((f) => f.status === 'dismissed').length;

  const memberOptions = useMemo(() => {
    const seen = new Map();
    for (const f of findings) if (f.member) seen.set(f.member.id, f.member.display_name);
    return [...seen.entries()];
  }, [findings]);

  // Titre par id, pour que le badge « Conflit actif » d'une carte puisse
  // nommer explicitement le(s) constat(s) concerné(s) (constat
  // client-meeting-ux, GATE LOT 4B : un décompte seul ne dit pas LEQUEL).
  const titleById = useMemo(() => new Map(findings.map((f) => [f.id, f.title])), [findings]);

  // FILTRE UNIQUEMENT (partition stable) -- préserve intégralement l'ordre
  // déjà calculé par le serveur (conflits actifs, puis priorité, puis ordre
  // déterministe). Ne jamais introduire ici un nouveau comparateur de tri
  // (constat GATE LOT 4B, revue rules-engine-auditor : « source de vérité
  // serveur », voir server/advisoryRuleExecutions.js, FINDINGS_ORDER_BY).
  const visible = findings.filter((f) => {
    if (filters.status !== 'all' && f.status !== filters.status) return false;
    if (filters.priority !== 'all' && f.priority !== filters.priority) return false;
    if (filters.type !== 'all' && f.finding_type !== filters.type) return false;
    if (filters.member !== 'all' && String(f.member?.id ?? '') !== filters.member) return false;
    return true;
  });

  return (
    <>
      <DomainStateBanner domainData={domainData} />
      {domainData.last_execution && (
        <button className="ghost small mb" onClick={onOpenHistory}>Voir l'historique des analyses</button>
      )}
      {canCreateRecommendation && (
        <button type="button" className={`chip mb${multiSelect ? ' active' : ''}`} aria-pressed={multiSelect} onClick={onToggleMultiSelect}>
          Sélection multiple
        </button>
      )}

      {domainData.last_execution && (
        <>
          <div className="tiles mb">
            <div className="tile"><div className="label">Constats actifs</div><div className="value">{activeCount}</div></div>
            <div className="tile"><div className="label">Conflits à examiner</div><div className="value">{conflictCount}</div></div>
            <div className="tile"><div className="label">Écartés</div><div className="value">{dismissedCount}</div></div>
          </div>

          <div className="chip-group mb">
            <span className="muted" style={{ fontSize: 12 }}>Statut :</span>
            {STATUS_FILTERS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filters.status === k} className={`chip${filters.status === k ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, status: k }))}>{l}</button>
            ))}
          </div>
          <div className="chip-group mb">
            <span className="muted" style={{ fontSize: 12 }}>Priorité :</span>
            {PRIORITY_FILTERS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filters.priority === k} className={`chip${filters.priority === k ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, priority: k }))}>{l}</button>
            ))}
          </div>
          <div className="chip-group mb">
            <span className="muted" style={{ fontSize: 12 }}>Type :</span>
            {TYPE_FILTERS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filters.type === k} className={`chip${filters.type === k ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, type: k }))}>{l}</button>
            ))}
          </div>
          {memberOptions.length > 0 && (
            <div className="chip-group mb">
              <span className="muted" style={{ fontSize: 12 }}>Membre :</span>
              <button type="button" aria-pressed={filters.member === 'all'} className={`chip${filters.member === 'all' ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, member: 'all' }))}>Tous</button>
              {memberOptions.map(([mid, name]) => (
                <button key={mid} type="button" aria-pressed={filters.member === String(mid)} className={`chip${filters.member === String(mid) ? ' active' : ''}`} onClick={() => setFilters((f) => ({ ...f, member: String(mid) }))}>{name}</button>
              ))}
            </div>
          )}
        </>
      )}

      {/* L'absence d'exécution est déjà expliquée par DomainStateBanner
          ci-dessus (constat client-meeting-ux, GATE LOT 4B : le même texte
          apparaissait auparavant en double) -- rien de plus à afficher ici
          dans ce cas. */}
      {!domainData.last_execution ? null : visible.length === 0 ? (
        <Empty>Aucun constat ne correspond aux filtres actuels.</Empty>
      ) : (
        visible.map((f) => (
          <FindingCard
            key={f.id} finding={f} canDismiss={canDismiss} onDismiss={() => onDismiss(f)} onGoToSource={onGoToSource} titleById={titleById}
            multiSelect={multiSelect} selected={selectedFindingIds?.has(f.id)} onToggleSelected={() => onToggleSelected(f.id)}
            onCreateFromFinding={() => onCreateFromFinding(f.id)}
            canCreateRecommendation={canCreateRecommendation}
          />
        ))
      )}
    </>
  );
}

// --- Carte d'un constat --------------------------------------------------

function FindingCard({ finding: f, canDismiss, onDismiss, onGoToSource, readOnly, titleById, multiSelect, selected, onToggleSelected, onCreateFromFinding, canCreateRecommendation }) {
  const answerRefs = (f.used_inputs_ref || []).filter((r) => r.kind === 'answer');
  const contractRefs = (f.used_inputs_ref || []).filter((r) => r.kind === 'contract_branch');
  const ruleRefCount = (f.used_inputs_ref || []).filter((r) => r.kind === 'rule_result').length;
  const resolvedConflicts = f.status === 'active' && (f.conflicts_detected_at_execution || []).length > (f.conflicts_with || []).length;
  const activeConflict = f.status === 'active' && !!f.needs_review;
  // Le décompte seul du badge ne dit pas LEQUEL constat est concerné
  // (constat client-meeting-ux, GATE LOT 4B) -- nomme explicitement le(s)
  // titre(s) en conflit quand ils sont connus (même domaine, déjà chargé).
  const conflictTitles = activeConflict ? (f.conflicts_with || []).map((id) => titleById?.get(id)).filter(Boolean) : [];

  return (
    <div className={`card finding-card${activeConflict ? ' needs-review' : ''}${f.status !== 'active' ? ' dismissed' : ''}`}>
      <div className="f-head">
        {multiSelect && f.status === 'active' && (
          <label className="check" style={{ marginRight: 2 }}>
            <input type="checkbox" checked={!!selected} onChange={onToggleSelected} aria-label={`Sélectionner « ${f.title} » pour une recommandation groupée`} />
          </label>
        )}
        <Badge value={f.finding_type} label={FINDING_TYPES[f.finding_type] || f.finding_type} />
        <Badge value={f.priority} label={PRIORITIES[f.priority] || f.priority} />
        <Badge value={f.finding_scope} label={FINDING_SCOPES[f.finding_scope] || f.finding_scope} />
        {f.member && <span className="muted" style={{ fontSize: 12 }}>{f.member.display_name}{f.member.historical ? ' · retiré du foyer' : ''}</span>}
        {f.status !== 'active' && <Badge value={f.status} label={FINDING_STATUSES[f.status] || f.status} />}
        {activeConflict && <Badge value="stale" label={`Conflit actif (${(f.conflicts_with || []).length})`} />}
        <span className="f-title">{f.title}</span>
      </div>
      <div className="f-summary">{f.summary}</div>
      {activeConflict && conflictTitles.length > 0 && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          En conflit avec : {conflictTitles.join(', ')}
        </div>
      )}
      {resolvedConflicts && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Un conflit initialement détecté a depuis été résolu (l'autre constat concerné a été écarté).
        </div>
      )}

      <div className="f-explanation">{f.advisor_explanation}</div>
      {f.client_explanation && (
        <div className="f-explanation client">
          <span className="f-explanation-label">Formulation préparatoire — à valider par le conseiller.</span>
          {f.client_explanation}
        </div>
      )}

      {f.finding_type === 'missing_information' && (f.missing_data || []).length > 0 && (
        <ul className="missing-list">
          {f.missing_data.map((m, i) => (
            <li key={i}>
              {m.kind === 'answer' && m.question_id != null && m.scope !== 'member' ? (
                <button className="link-row" onClick={() => onGoToSource(m.question_id, null)}>
                  <span>{m.stable_key}</span><span className="muted">Répondre →</span>
                </button>
              ) : m.kind === 'answer' && m.scope === 'member' ? (
                // Portée membre : la donnée est déclarée manquante dès qu'AU
                // MOINS UN membre du foyer n'a pas répondu (jamais résolue à
                // un membre précis parmi plusieurs potentiellement
                // concernés) -- jamais un lien de navigation vers une seule
                // réponse, qui n'aurait pas de sens ici et échouerait de
                // toute façon (aucune instance foyer n'existe pour une
                // question de portée membre).
                <span>{m.stable_key} <span className="muted">— une ou plusieurs personnes du foyer n'ont pas encore répondu</span></span>
              ) : (
                <span>{m.stable_key || m.contract_branch}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {((f.warnings || []).length > 0 || (f.contraindications || []).length > 0) && (
        <div className="mt">
          {f.warnings.map((w, i) => <div key={`w${i}`} className="alert warn" style={{ marginBottom: 6 }}>{w}</div>)}
          {f.contraindications.map((c, i) => <div key={`c${i}`} className="alert error" style={{ marginBottom: 6 }}>{c}</div>)}
        </div>
      )}

      <details>
        <summary>Sources et traçabilité</summary>
        <div className="mt">
          {f.source && <div>{f.source}{f.source_reference ? ` (${f.source_reference})` : ''}</div>}
          {f.effective_from && (
            <div className="muted" style={{ fontSize: 12 }}>
              En vigueur depuis le {fmtDate(f.effective_from)}{f.effective_until ? ` jusqu'au ${fmtDate(f.effective_until)}` : ''}
            </div>
          )}
          {answerRefs.length > 0 && (
            <div className="mt">
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Réponses utilisées :</div>
              <ul className="missing-list">
                {answerRefs.map((r, i) => (
                  <li key={i}>
                    <button className="link-row" disabled={r.question_id == null} onClick={() => onGoToSource(r.question_id, r.household_member_id, r.answer_id)}>
                      <span>
                        {r.advisor_text || r.stable_key}{r.sensitivity_at_execution ? ' · donnée sensible' : ''}
                        {r.is_current_answer === false && <span className="muted"> · réponse modifiée depuis</span>}
                      </span>
                      <span className="muted">Voir la réponse →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {contractRefs.length > 0 && (
            <div className="mt">
              {contractRefs.map((r, i) => (
                <div key={i} className="muted" style={{ fontSize: 12 }}>
                  Contrat — branche {BRANCHES[r.contract_branch] || r.contract_branch} :
                  statut au moment de l'analyse « {r.status_at_execution ? (CONTRACT_STATUS[r.status_at_execution] || r.status_at_execution) : 'aucun contrat'} »
                </div>
              ))}
            </div>
          )}
          {ruleRefCount > 0 && (
            <div className="mt muted" style={{ fontSize: 12 }}>Dépend également du résultat d'une autre règle interne ({ruleRefCount}).</div>
          )}
          {answerRefs.length === 0 && contractRefs.length === 0 && ruleRefCount === 0 && !f.source && (
            <div className="muted" style={{ fontSize: 12 }}>Aucune référence enregistrée pour ce constat.</div>
          )}
        </div>
      </details>

      {!readOnly && f.status === 'active' && (
        <div className="f-actions">
          {canDismiss && <button className="ghost small" onClick={onDismiss}>Écarter ce constat</button>}
          {!multiSelect && canCreateRecommendation && <button className="ghost small" onClick={onCreateFromFinding}>Créer une recommandation à partir de ce constat</button>}
        </div>
      )}
      {f.status === 'dismissed' && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Écarté par {f.dismissed_by_name || 'un conseiller'} le {fmtDateTime(f.dismissed_at)} — Motif : {f.dismiss_reason}
        </div>
      )}
    </div>
  );
}

// --- Écartement d'un constat ---------------------------------------------

function DismissModal({ sessionId, finding, getRevision, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Garde synchrone -- même constat que `analyzingRef` ci-dessus (GATE LOT
  // 4B §7) : `submitting` (état React) laisse une fenêtre de course entre
  // deux clics quasi simultanés avant le premier re-rendu.
  const submittingRef = useRef(false);

  async function submit() {
    if (submittingRef.current) return; // évite un double-clic déclenchant deux écartements concurrents
    setError(null);
    if (!reason.trim()) return setError("Le motif d'écartement est obligatoire.");
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/api/advisory/sessions/${sessionId}/findings/${finding.id}/dismiss`, {
        dismiss_reason: reason, expected_revision: getRevision(),
      });
      onDone();
    } catch (err) {
      setError(err.status === 409 ? CONFLICT_MESSAGE : err.message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Écarter ce constat" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <Field label="Constat" full><div style={{ fontWeight: 600 }}>{finding.title}</div></Field>
      <div className="alert warn">Ce constat reste tracé dans l'historique — il n'est jamais supprimé, seulement écarté.</div>
      <Field label="Motif de l'écartement (obligatoire)" full>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoFocus />
      </Field>
      <div className="actions">
        <button onClick={onClose} disabled={submitting}>Annuler</button>
        <button className="primary" disabled={submitting} onClick={submit}>Écarter</button>
      </div>
    </Modal>
  );
}

// --- Historique des analyses (§21) ---------------------------------------

function HistoryModal({ sessionId, domain, domainLabel, onGoToSource, onClose }) {
  const [executions, setExecutions] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const detailTitleById = useMemo(() => new Map((detail?.findings || []).map((f) => [f.id, f.title])), [detail]);

  useEffect(() => {
    api.get(`/api/advisory/sessions/${sessionId}/rule-executions?domain=${domain}`)
      .then((r) => setExecutions(r.executions))
      .catch((err) => setError(err.message));
  }, [sessionId, domain]);

  async function openDetail(executionId) {
    setError(null);
    try {
      const d = await api.get(`/api/advisory/sessions/${sessionId}/rule-executions/${executionId}`);
      setDetail(d);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={`Historique des analyses — ${domainLabel}`} onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {!detail ? (
        !executions ? (
          <p className="muted">Chargement…</p>
        ) : executions.length === 0 ? (
          <Empty>Aucune exécution pour ce domaine.</Empty>
        ) : (
          <ul className="history-list">
            {executions.map((e) => (
              <li key={e.id}>
                <button className="link-row" style={{ width: '100%' }} onClick={() => openDetail(e.id)}>
                  <span>
                    <Badge value={e.status} label={EXECUTION_STATUSES[e.status] || e.status} />{' '}
                    {fmtDateTime(e.ended_at || e.started_at)} — {e.findings_count} constat(s), {e.rules_evaluated_count} règle(s) évaluée(s)
                    {e.superseded_by_execution_id ? ' · remplacée depuis' : ''}
                  </span>
                  <span className="muted">→</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <button className="ghost small" onClick={() => setDetail(null)}>← Liste des exécutions</button>
          <div className="mt muted" style={{ fontSize: 11 }}>
            Empreinte de contenu : {detail.content_hash || '—'} — sert à vérifier la reproductibilité, ne constitue pas une preuve juridique.
          </div>
          <div className="mt">
            {detail.findings.length === 0 ? (
              <Empty>Aucun constat pour cette exécution.</Empty>
            ) : (
              detail.findings.map((f) => (
                <FindingCard key={f.id} finding={f} readOnly canDismiss={false} onDismiss={() => {}} onGoToSource={onGoToSource} titleById={detailTitleById} />
              ))
            )}
          </div>
        </>
      )}
      <div className="actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
