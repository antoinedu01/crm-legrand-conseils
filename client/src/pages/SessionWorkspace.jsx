import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { SESSION_DOMAINS, SESSION_STATUSES, LINK_DOMAIN_LABELS, MEMBER_ROLES, fmtDateTime } from '../labels.js';

// --- Chargement de la projection, avec annulation propre (Lot 3B) ----------
// Contrairement à `useAsync` (client/src/components/ui.jsx), ce hook annule
// la requête en vol au démontage (AbortController) et ignore toute réponse
// devenue obsolète via un jeton de séquence — nécessaire ici parce que la
// projection est rechargée fréquemment (après chaque écriture) alors que
// `useAsync` ne recharge qu'au changement de `deps` (constat relevé par la
// revue de conception « auditeur généraliste » avant implémentation).
function useWorkspace(sessionId) {
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
    api.get(`/api/advisory/sessions/${sessionId}/workspace`, controller.signal).then(
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

// Préserve la position de lecture lors d'un rechargement déclenché par une
// sauvegarde (évite un saut brutal en haut de page) — capturée juste avant
// le rechargement, restaurée après le nouveau rendu.
function usePreservedScroll(dep) {
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    if (scrollRef.current != null) {
      window.scrollTo(0, scrollRef.current);
      scrollRef.current = null;
    }
  }, [dep]);
  return () => { scrollRef.current = window.scrollY; };
}

function answerKey(questionId, memberId) {
  return `${questionId}|${memberId ?? 'household'}`;
}

// Résout une navigation ENTRANTE depuis l'espace des constats (Lot 4B,
// SessionFindings.jsx « Voir la réponse source ») -- reçue via l'état de
// navigation React Router (`location.state = {questionId, memberId, answerId}`),
// JAMAIS dans l'URL (§16 : aucun identifiant technique de réponse ne doit
// apparaître dans une URL partageable/journalisable). `used_inputs_ref`
// contient déjà un `question_id` résolu (identifiant de base immuable) --
// même principe de résolution que `resolveMissingContext` ci-dessous, mais
// cherchant à travers TOUS les modules (une provenance inconnue a priori),
// jamais un seul module présupposé.
function resolveQuestionAcrossModules(modules, questionId, memberId) {
  for (let modIdx = 0; modIdx < (modules || []).length; modIdx++) {
    for (const section of modules[modIdx].sections) {
      for (const instance of section.instances) {
        if (instance.household_member_id !== (memberId ?? null)) continue;
        const question = instance.questions.find((q) => q.id === questionId);
        if (question) {
          return {
            modIdx, sectionKey: section.stable_key, sectionVisible: section.visible,
            question, instance,
          };
        }
      }
    }
  }
  return null;
}

// Vérifie et localise, pour une navigation entrante annonçant un `answerId`
// précis (GATE LOT 4B §2), la ligne HISTORIQUE exacte réellement utilisée
// par le finding -- jamais seulement la réponse ACTIVE courante (qui a pu
// changer depuis). Réutilise TELLE QUELLE la route d'historique existante
// (GET .../answers/history?question_id=&household_member_id=, déjà scoping
// session_id + question_id + household_member_id via `listAnswerHistory`,
// déjà auditée comme « consultation historique réponse ») : aucune nouvelle
// route, aucun nouvel identifiant technique transmis. La vérification
// anti-IDOR complète (l'answer_id appartient bien à CETTE session, à CETTE
// question annoncée, à CE membre annoncé) découle directement de ce
// filtrage SQL déjà en place -- si `answerId` n'apparaît pas parmi les
// lignes renvoyées, c'est qu'il n'appartient à aucun des trois, ou qu'il
// n'existe simplement pas : les trois cas sont volontairement indiscernables
// pour l'appelant (jamais une réponse qui révélerait LEQUEL des trois
// c'est).
async function fetchAnswerHistoryRows(sessionId, questionId, memberId) {
  const params = memberId != null ? `?question_id=${questionId}&household_member_id=${memberId}` : `?question_id=${questionId}`;
  const res = await api.get(`/api/advisory/sessions/${sessionId}/answers/history${params}`);
  return res.answers;
}

const ACTION_LABELS = {
  start: 'Démarrer', suspend: 'Suspendre', resume: 'Reprendre', cancel: 'Annuler',
};

const CONFLICT_MESSAGE = "Cette session a été modifiée ailleurs (un autre onglet ?) depuis votre dernier chargement — page actualisée.";

export default function SessionWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, error, reload } = useWorkspace(id);
  const captureScroll = usePreservedScroll(data);

  const [activeModuleIdx, setActiveModuleIdx] = useState(0);
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [activeMemberByModule, setActiveMemberByModule] = useState({});
  const [saveStates, setSaveStates] = useState(new Map());
  const [showFinalize, setShowFinalize] = useState(false);
  const [amendTarget, setAmendTarget] = useState(null); // null = fermé ; {} = ouvert via le bouton global ; {questionId, memberId} = contextualisé
  const [historyFor, setHistoryFor] = useState(null);
  const [globalError, setGlobalError] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  // Navigation entrante depuis l'espace des constats (Lot 4B, §16) : bannière
  // d'information (jamais bloquante) quand la question source n'est plus
  // disponible ou n'est actuellement pas affichée ; cible du surlignage
  // temporaire de la question visée. Aucun des deux n'est jamais persisté
  // (aucun stockage navigateur, §24) -- seulement de l'état React en mémoire.
  const [navBanner, setNavBanner] = useState(null);
  const [highlightTarget, setHighlightTarget] = useState(null);
  const lastHandledNavKeyRef = useRef(null);

  // --- Concurrence optimiste (GATE LOT 3B §2) --------------------------------
  // `revisionRef` reflète toujours la dernière révision connue (mise à jour
  // après chaque rechargement ET immédiatement après chaque écriture réussie,
  // sans attendre le rechargement qu'elle déclenche).
  const revisionRef = useRef(null);
  useEffect(() => {
    if (data?.session?.revision != null) revisionRef.current = data.session.revision;
  }, [data?.session?.revision]);

  // Une seule file de sauvegarde PAR SESSION (pas par question) : la révision
  // est un compteur global de la session, donc deux écritures concurrentes
  // sur deux questions différentes doivent aussi être envoyées dans l'ordre
  // réel des intentions du conseiller, jamais en parallèle -- sinon la
  // seconde échouerait à tort avec un conflit de révision alors qu'elle
  // n'entre en collision avec rien de réel. Un simple jeton qui ignore une
  // réponse HTTP obsolète (mécanisme précédent) ne protégeait que l'état
  // React affiché, jamais l'ordre réel d'écriture en base.
  const writeQueueRef = useRef(Promise.resolve());
  function enqueueWrite(task) {
    const run = () => task(revisionRef.current);
    const result = writeQueueRef.current.then(run, run);
    writeQueueRef.current = result.catch(() => {});
    return result;
  }

  const workspaceMountedRef = useRef(true);
  useEffect(() => () => { workspaceMountedRef.current = false; }, []);

  function setSaveState(key, patch) {
    if (!workspaceMountedRef.current) return;
    setSaveStates((prev) => {
      const next = new Map(prev);
      next.set(key, { ...(next.get(key) || {}), ...patch });
      return next;
    });
  }

  // --- Sauvegardes différées en attente (GATE LOT 3B §3) ---------------------
  // Registre d'une fonction de flush par question actuellement montée
  // (renseignée par QuestionCard). flushPendingSaves() les exécute toutes
  // avant un changement de membre/section/module, une suspension, un
  // contrôle de finalisation ou une sortie explicite du workspace -- jamais
  // au démontage non contrôlé (fermeture d'onglet, navigation externe), où
  // l'on annule simplement les timers sans rien envoyer de plus (voir
  // beforeunload plus bas et le nettoyage de QuestionCard).
  const pendingFlushersRef = useRef(new Map());
  // Identité stable entre les rendus (useCallback) : QuestionCard s'enregistre
  // une seule fois au montage/changement de question, pas à chaque rendu du
  // parent.
  const registerFlush = useCallback((key, fn) => {
    if (fn) pendingFlushersRef.current.set(key, fn);
    else pendingFlushersRef.current.delete(key);
  }, []);
  async function flushPendingSaves() {
    const flushers = [...pendingFlushersRef.current.values()];
    if (!flushers.length) return { ok: true };
    const results = await Promise.all(flushers.map((f) => f().then(() => true).catch(() => false)));
    return { ok: results.every(Boolean) };
  }
  useEffect(() => {
    function handler(e) {
      if (pendingFlushersRef.current.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Sections réellement visibles pour le module actif -- les sections
  // masquées n'encombrent jamais la navigation principale (§9), mais restent
  // comptées discrètement plutôt que simplement disparaître sans explication.
  const activeModule = data?.modules?.[activeModuleIdx] || null;
  const visibleSections = useMemo(() => (activeModule ? activeModule.sections.filter((s) => s.visible) : []), [activeModule]);
  const hiddenSectionsCount = activeModule ? activeModule.sections.length - visibleSections.length : 0;

  useEffect(() => {
    if (visibleSections.length && !visibleSections.some((s) => s.stable_key === activeSectionKey)) {
      setActiveSectionKey(visibleSections[0].stable_key);
    }
  }, [visibleSections, activeSectionKey]);

  const activeSection = visibleSections.find((s) => s.stable_key === activeSectionKey) || null;
  const activeMemberId = activeSection?.applies_to === 'member' ? (activeMemberByModule[activeModuleIdx] ?? activeSection.instances[0]?.household_member_id) : null;
  const activeInstance = activeSection
    ? (activeSection.applies_to === 'member'
        ? activeSection.instances.find((i) => i.household_member_id === activeMemberId) || activeSection.instances[0]
        : activeSection.instances[0])
    : null;

  const saveAnswer = useCallback((questionId, memberId, status, value) => {
    const key = answerKey(questionId, memberId);
    setSaveState(key, { status: 'saving', error: null });
    return enqueueWrite(async (expectedRevision) => {
      try {
        const res = await api.put(`/api/advisory/sessions/${id}/answers`, {
          answers: [{ question_id: questionId, household_member_id: memberId ?? undefined, status, value }],
          expected_revision: expectedRevision,
        });
        revisionRef.current = res.revision;
        setSaveState(key, { status: 'saved', error: null });
        captureScroll();
        reload();
      } catch (err) {
        if (err.status === 409) {
          setSaveState(key, { status: 'error', error: CONFLICT_MESSAGE });
          reload();
        } else {
          setSaveState(key, { status: 'error', error: err.message });
        }
      }
    });
  }, [id, reload, captureScroll]);

  const clearAnswer = useCallback((questionId, memberId) => {
    const key = answerKey(questionId, memberId);
    setSaveState(key, { status: 'saving', error: null });
    return enqueueWrite(async (expectedRevision) => {
      try {
        const res = await api.del(`/api/advisory/sessions/${id}/answers/${questionId}`, {
          household_member_id: memberId ?? undefined, expected_revision: expectedRevision,
        });
        revisionRef.current = res.revision;
        setSaveState(key, { status: 'saved', error: null });
        captureScroll();
        reload();
      } catch (err) {
        if (err.status === 409) {
          setSaveState(key, { status: 'error', error: CONFLICT_MESSAGE });
          reload();
        } else {
          setSaveState(key, { status: 'error', error: err.message });
        }
      }
    });
  }, [id, reload, captureScroll]);

  async function runTransition(action) {
    if (transitioning) return false; // anti-double-clic
    setGlobalError(null);
    setTransitioning(true);
    const ok = await enqueueWrite(async (expectedRevision) => {
      try {
        const res = await api.post(`/api/advisory/sessions/${id}/${action}`, { expected_revision: expectedRevision });
        revisionRef.current = res.revision;
        reload();
        return true;
      } catch (err) {
        setGlobalError(err.status === 409 ? CONFLICT_MESSAGE : err.message);
        if (err.status === 409) reload();
        return false;
      }
    });
    setTransitioning(false);
    return ok;
  }

  // Avant une action consequente (suspension, ouverture du contrôle de
  // finalisation), on s'assure d'abord qu'aucune saisie en attente de
  // débounce ne reste non envoyée (§3) -- sinon on bloque l'action et on
  // prévient le conseiller plutôt que de risquer de perdre une réponse.
  async function withFlushGuard(action) {
    const { ok } = await flushPendingSaves();
    if (!ok) {
      setGlobalError("Une réponse n'a pas pu être enregistrée avant cette action — vérifiez avant de continuer.");
      return false;
    }
    return action();
  }

  function handleMemberSwitch(memberId) {
    flushPendingSaves().then(({ ok }) => {
      if (!ok) setGlobalError("Une réponse n'a pas pu être enregistrée avant ce changement de membre — vérifiez avant de continuer.");
    });
    setActiveMemberByModule((m) => ({ ...m, [activeModuleIdx]: memberId }));
  }

  function handleSectionSwitch(key) {
    flushPendingSaves().then(({ ok }) => {
      if (!ok) setGlobalError("Une réponse n'a pas pu être enregistrée avant ce changement de section — vérifiez avant de continuer.");
    });
    setActiveSectionKey(key);
  }

  function handleModuleSwitch(idx) {
    flushPendingSaves().then(({ ok }) => {
      if (!ok) setGlobalError("Une réponse n'a pas pu être enregistrée avant ce changement de module — vérifiez avant de continuer.");
    });
    setActiveModuleIdx(idx);
  }

  async function handleLeaveWorkspace() {
    const { ok } = await flushPendingSaves();
    if (!ok && !window.confirm("Une réponse n'a pas pu être enregistrée. Quitter quand même ?")) return;
    navigate(`/diagnostic-360/sessions/${id}`);
  }

  function handleSuspend() {
    return withFlushGuard(() => runTransition('suspend'));
  }

  function handleOpenFinalize() {
    return withFlushGuard(() => { setShowFinalize(true); return true; });
  }

  function jumpTo(moduleIdx, sectionKey, memberId) {
    setShowFinalize(false);
    setActiveModuleIdx(moduleIdx);
    setActiveSectionKey(sectionKey);
    if (memberId != null) setActiveMemberByModule((m) => ({ ...m, [moduleIdx]: memberId }));
    setTimeout(() => {
      const el = document.getElementById(`q-${sectionKey}-${memberId ?? 'household'}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  // Variante de jumpTo ciblant une QUESTION précise (jamais seulement sa
  // section) -- utilisée par la navigation entrante depuis l'espace des
  // constats (Lot 4B, §16) : défilement, PUIS focus clavier, PUIS
  // surlignage temporaire (jamais permanent, s'efface après quelques
  // secondes). Ne modifie jamais la réponse elle-même.
  function jumpToQuestion(moduleIdx, sectionKey, memberId, questionId) {
    setShowFinalize(false);
    setAmendTarget(null);
    setHistoryFor(null);
    setActiveModuleIdx(moduleIdx);
    setActiveSectionKey(sectionKey);
    if (memberId != null) setActiveMemberByModule((m) => ({ ...m, [moduleIdx]: memberId }));
    setHighlightTarget({ questionId, memberId: memberId ?? null });
    setTimeout(() => {
      const el = document.getElementById(`question-${questionId}-${memberId ?? 'household'}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus?.({ preventScroll: true });
    }, 50);
    setTimeout(() => setHighlightTarget((t) => (t && t.questionId === questionId ? null : t)), 4000);
  }

  // Consomme UNE SEULE FOIS chaque navigation entrante réelle (`location.key`
  // change à chaque appel de navigate(), même vers le même chemin) --
  // n'attend le chargement de `data` que si nécessaire, ne se redéclenche
  // jamais sur un simple rechargement provoqué par une sauvegarde.
  //
  // GATE LOT 4B §2 : quand la navigation annonce un `answerId`, celui-ci
  // devient la source de vérité -- vérifié AVANT tout effet de bord (aucun
  // changement de module/section/surlignage tant que la vérification n'a
  // pas abouti). Un `answerId` absent (lien « Répondre » sur une donnée
  // manquante, ou navigation plus ancienne) retombe exactement sur le
  // comportement précédent, inchangé.
  useEffect(() => {
    if (!data || !location.state?.questionId) return;
    if (lastHandledNavKeyRef.current === location.key) return;
    lastHandledNavKeyRef.current = location.key;
    const { questionId, memberId, answerId } = location.state;
    let cancelled = false;

    (async () => {
      const resolved = resolveQuestionAcrossModules(data.modules, questionId, memberId ?? null);
      if (!resolved) {
        if (!cancelled) setNavBanner("La question source de ce constat n'est plus disponible dans le questionnaire actuel.");
        return;
      }

      let highlightRow = null;
      let historyRows = null;
      if (answerId != null) {
        try {
          historyRows = await fetchAnswerHistoryRows(id, questionId, memberId ?? null);
        } catch {
          if (!cancelled) setNavBanner("La réponse source de ce constat n'a pas pu être vérifiée — aucune navigation n'a été effectuée.");
          return;
        }
        if (cancelled) return;
        highlightRow = historyRows.find((r) => r.id === answerId) || null;
        // Ni distingué ni précisé PLUS que ce message générique (§2) : ne
        // révèle jamais si l'answer_id est totalement inconnu, appartient à
        // une autre session/un autre foyer, ou correspond à une autre
        // question/un autre membre -- aucune de ces informations n'a de
        // valeur légitime pour l'appelant, et aucune valeur de réponse
        // n'est jamais montrée dans ce cas.
        if (!highlightRow) {
          setNavBanner("La réponse historique demandée n'est pas disponible pour cette session.");
          return;
        }
      }

      if (!resolved.sectionVisible || !resolved.question.visible) {
        setActiveModuleIdx(resolved.modIdx);
        setNavBanner("La question source de ce constat n'est actuellement pas affichée (condition d'affichage non remplie pour les réponses en cours) — sa réponse reste consultable via son historique.");
      } else if (resolved.instance.member && resolved.instance.member.can_answer === false) {
        setNavBanner(`La réponse source provient de ${resolved.instance.member.display_name}, qui n'est plus actif dans ce foyer — elle reste consultable ci-dessous, en lecture seule.`);
        jumpToQuestion(resolved.modIdx, resolved.sectionKey, memberId ?? null, questionId);
      } else {
        setNavBanner(null);
        jumpToQuestion(resolved.modIdx, resolved.sectionKey, memberId ?? null, questionId);
      }

      // Ouvre l'historique SUR LA LIGNE answer_id EXACTE (§2, point 7) --
      // même quand la question source n'est plus affichée actuellement
      // (l'historique reste une vue en lecture seule, indépendante de la
      // visibilité live de la question) : jamais bloqué par les branches
      // ci-dessus, seulement par l'échec de vérification traité plus haut.
      if (highlightRow) {
        setHistoryFor({
          questionId, memberId: memberId ?? null, label: resolved.question.advisor_text,
          preloadedRows: historyRows, highlightAnswerId: answerId,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [data, location.key]);

  if (loading && !data) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  const { session, household, progress, modules, actions } = data;
  const readOnly = !actions.can_record_answers;
  // Un membre historisé (retiré du foyer depuis le démarrage, GATE LOT 3B §5)
  // reste lisible mais n'accepte plus de nouvelle saisie, même si la session
  // elle-même accepte encore des réponses pour les autres membres.
  const instanceReadOnly = readOnly || (activeInstance?.member ? activeInstance.member.can_answer === false : false);

  return (
    <>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={handleLeaveWorkspace}>← Fiche session</button>
          <h1>{session.title || `Session #${session.id}`} — {household.label || `Foyer ${household.primary_display_name}`}</h1>
          <div className="sub">
            <Badge value={session.status} label={SESSION_STATUSES[session.status]} />{' '}
            {SESSION_DOMAINS[session.domain]} · Prévue {fmtDateTime(session.scheduled_at) || '—'} · Dernière activité {fmtDateTime(session.last_activity_at) || '—'} · Conseiller {session.advisor_name || '—'}
          </div>
        </div>
        <div className="actions">
          {['start', 'suspend', 'resume', 'cancel'].filter((a) => actions[`can_${a}`]).map((a) => (
            <button
              key={a}
              disabled={transitioning}
              onClick={() => {
                if (a === 'cancel') { if (window.confirm('Annuler cette session ? Cette action est définitive.')) runTransition(a); return; }
                if (a === 'suspend') { handleSuspend(); return; }
                runTransition(a);
              }}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
          {actions.can_complete && <button className="primary" disabled={transitioning} onClick={handleOpenFinalize}>Vérifier avant de finaliser</button>}
          {actions.can_amend && <button onClick={() => setAmendTarget({})}>Corriger une réponse</button>}
          {/* Accès Synthèse (SYNTH-UI1 §A/§13) : dès que le domaine est Santé
              ou mixte, jamais conditionné au statut de la session. */}
          {(session.domain === 'health' || session.domain === 'mixed') && (
            <button className="ghost" onClick={() => navigate(`/diagnostic-360/sessions/${id}/health-synthesis`)}>
              Ouvrir la synthèse
            </button>
          )}
        </div>
      </div>

      {globalError && <div className="alert error">{globalError}</div>}
      {navBanner && (
        <div className="alert warn">
          {navBanner}{' '}
          <button className="ghost small" onClick={() => setNavBanner(null)}>Fermer</button>
        </div>
      )}
      {household.status === 'archive' && (
        <div className="alert warn">Ce foyer est archivé : consultation uniquement, aucune nouvelle activité n'est possible sur cette session.</div>
      )}
      {readOnly && household.status !== 'archive' && (
        <div className="readonly-banner">
          <span>Session {SESSION_STATUSES[session.status].toLowerCase()} — lecture seule.</span>
          {actions.can_amend && <button className="small" onClick={() => setAmendTarget({})}>Corriger une réponse</button>}
        </div>
      )}

      <div className="tiles mb">
        <div className="tile">
          <div className="label">Progression globale</div>
          <div className="value">{progress.required_answered}/{progress.required_total}</div>
          <div className="hint">obligatoires complétées</div>
        </div>
        {modules.map((m, i) => (
          <div className="tile" key={m.questionnaire_version_id}>
            <div className="label">{LINK_DOMAIN_LABELS[m.domain] || m.domain}</div>
            <div className="value">{m.progress.required_answered}/{m.progress.required_total}</div>
            <div className="hint">{m.progress.required_total - m.progress.required_answered === 0 ? 'complet' : `${m.progress.required_total - m.progress.required_answered} élément(s) à compléter`}</div>
            <button className="ghost small" style={{ padding: 0, marginTop: 4 }} onClick={() => handleModuleSwitch(i)}>Ouvrir →</button>
          </div>
        ))}
      </div>

      {modules.length > 1 && (
        <div className="wksp-modules" role="tablist">
          {modules.map((m, i) => (
            <button key={m.questionnaire_version_id} role="tab" aria-selected={i === activeModuleIdx} className={i === activeModuleIdx ? 'active' : ''} onClick={() => handleModuleSwitch(i)}>
              {LINK_DOMAIN_LABELS[m.domain] || m.domain}
            </button>
          ))}
        </div>
      )}

      {/* Repère de progression persistant sous 900px : sous cette largeur, ni
          les tuiles ni le rail de sections ne restent visibles au défilement
          (revue post-implémentation UX) -- ce bandeau comble ce manque sans
          dupliquer le calcul (mêmes chiffres que la tuile du module actif). */}
      {activeModule && (
        <div className="wksp-progress-sticky">
          <span>{LINK_DOMAIN_LABELS[activeModule.domain] || activeModule.domain}</span>
          <strong>{activeModule.progress.required_answered}/{activeModule.progress.required_total}</strong>
          <span className="muted">obligatoires</span>
        </div>
      )}

      {!activeModule ? (
        <Empty>Aucun module rattaché à cette session.</Empty>
      ) : visibleSections.length === 0 ? (
        <Empty>Aucune section n'est actuellement applicable pour ce module.</Empty>
      ) : (
        <div className="wksp-layout">
          <nav className="wksp-rail" aria-label="Sections">
            {visibleSections.map((s) => {
              const requiredQs = s.instances.flatMap((i) => i.questions).filter((q) => q.required);
              const missingCount = requiredQs.filter((q) => q.missing).length;
              return (
                <button
                  key={s.stable_key}
                  className={`wksp-rail-item${s.stable_key === activeSectionKey ? ' active' : ''}`}
                  onClick={() => handleSectionSwitch(s.stable_key)}
                >
                  <span>{s.title}</span>
                  {requiredQs.length > 0 && (
                    <span className="count">{missingCount === 0 ? '✓' : `${requiredQs.length - missingCount}/${requiredQs.length}`}</span>
                  )}
                </button>
              );
            })}
            {hiddenSectionsCount > 0 && (
              <div className="muted" style={{ fontSize: 11, padding: '6px 10px' }}>
                {hiddenSectionsCount} section(s) non applicable(s) actuellement
              </div>
            )}
          </nav>

          <div>
            {activeSection && activeSection.applies_to === 'member' && (
              <div className="wksp-member-switch">
                <span className="muted" style={{ fontSize: 12.5 }}>Réponses pour :</span>
                <div className="seg">
                  {activeSection.instances.map((inst) => (
                    <button
                      key={inst.household_member_id}
                      className={inst.household_member_id === activeMemberId ? 'active' : ''}
                      onClick={() => handleMemberSwitch(inst.household_member_id)}
                    >
                      {inst.member.display_name} ({MEMBER_ROLES[inst.member.member_role] || inst.member.member_role}){inst.member.historical ? ' · retiré du foyer' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeSection && activeInstance && activeInstance.member?.historical && (
              <div className="alert warn">
                Ce membre n'est plus actif dans ce foyer : ses réponses restent consultables, mais aucune nouvelle réponse ne peut lui être associée.
              </div>
            )}

            {activeSection && activeInstance && (
              <div className="card" id={`q-${activeSection.stable_key}-${activeInstance.household_member_id ?? 'household'}`}>
                <h2>{activeSection.title}</h2>
                {activeInstance.questions.filter((q) => q.visible).length === 0 ? (
                  <Empty>Aucune question applicable pour le moment dans cette section.</Empty>
                ) : (
                  activeInstance.questions.filter((q) => q.visible).map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      readOnly={instanceReadOnly}
                      canAmend={actions.can_amend}
                      saveState={saveStates.get(answerKey(q.id, activeInstance.household_member_id))}
                      highlighted={!!highlightTarget && highlightTarget.questionId === q.id && highlightTarget.memberId === (activeInstance.household_member_id ?? null)}
                      onSave={(status, value) => saveAnswer(q.id, activeInstance.household_member_id, status, value)}
                      onClear={() => clearAnswer(q.id, activeInstance.household_member_id)}
                      onHistory={() => setHistoryFor({ questionId: q.id, memberId: activeInstance.household_member_id, label: q.advisor_text })}
                      onAmend={() => setAmendTarget({ questionId: q.id, memberId: activeInstance.household_member_id })}
                      onRegisterFlush={registerFlush}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showFinalize && (
        <FinalizationModal
          sessionId={id}
          missing={data.missing}
          getRevision={() => revisionRef.current}
          onClose={() => setShowFinalize(false)}
          onJump={jumpTo}
          onFinalized={() => { setShowFinalize(false); reload(); }}
          modules={modules}
        />
      )}
      {amendTarget && (
        <AmendModal
          sessionId={id}
          modules={modules}
          initialTarget={amendTarget.questionId != null ? amendTarget : null}
          getRevision={() => revisionRef.current}
          onClose={() => setAmendTarget(null)}
          onDone={() => { setAmendTarget(null); reload(); }}
        />
      )}
      {historyFor && (
        <HistoryModal sessionId={id} target={historyFor} advisorName={session.advisor_name} onClose={() => setHistoryFor(null)} />
      )}
    </>
  );
}

// --- Rendu d'une question, par type -----------------------------------------

function QuestionCard({ question: q, readOnly, canAmend, saveState, highlighted, onSave, onClear, onHistory, onAmend, onRegisterFlush }) {
  const [local, setLocal] = useState(() => (q.answer?.status === 'answered' ? q.answer.value : q.type === 'multiple_choice' ? [] : ''));
  const debounceRef = useRef(null);
  // Cible du surlignage/focus temporaire depuis l'espace des constats (Lot
  // 4B, §16) -- `tabIndex={-1}` rend le conteneur focusable par script SANS
  // l'ajouter à l'ordre de tabulation naturel (même technique que les autres
  // cibles de défilement programmatique de cette page).
  const cardRef = useRef(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.focus?.({ preventScroll: true });
  }, [highlighted]);
  // Vrai tant qu'une frappe a été tapée mais pas encore confirmée par un
  // aller-retour serveur complet (au sens large : de l'appel debounced à la
  // fin du rechargement qu'il déclenche). Corrige une race condition réelle
  // (revue post-implémentation) : sans ce garde-fou, si l'utilisateur reprend
  // la saisie après que `saveState` soit repassé à `saved` mais avant que la
  // réponse du `reload()` déclenché par la sauvegarde précédente n'arrive,
  // l'effet de resynchronisation écrasait la frappe fraîche avec l'ancienne
  // valeur serveur.
  const debouncePendingRef = useRef(false);
  const localRef = useRef(local);
  useEffect(() => { localRef.current = local; }, [local]);

  const answerStatus = q.answer?.status;
  const answerValue = q.answer?.value;
  // Dépendances volontairement limitées à (answerStatus, answerValue) : ne se
  // resynchronise que sur un changement réel de la réponse serveur, jamais
  // sur un changement de `saveState` (qui varie à chaque frappe/sauvegarde et
  // provoquerait une réinitialisation intempestive de la saisie en cours).
  useEffect(() => {
    if (saveState?.status === 'saving' || debouncePendingRef.current) return; // ne jamais écraser une saisie en cours d'envoi ou pas encore envoyée
    setLocal(answerStatus === 'answered' ? answerValue : q.type === 'multiple_choice' ? [] : '');
  }, [answerStatus, answerValue]);

  function commit(value) {
    return onSave('answered', value);
  }

  function debouncedCommit(value) {
    setLocal(value);
    debouncePendingRef.current = true;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      debouncePendingRef.current = false;
      commit(value);
    }, 600);
  }

  // Fonction de flush explicite pour CETTE question, enregistrée auprès du
  // parent (GATE LOT 3B §3) -- n'agit que s'il y a réellement un timer de
  // débounce en attente. Au démontage (changement de membre/section/module,
  // ou fermeture du workspace), le timer local est toujours annulé ; seul un
  // flush explicitement déclenché par le parent (flushPendingSaves) envoie
  // encore la valeur -- jamais silencieusement après coup.
  useEffect(() => {
    const key = answerKey(q.id, q.household_member_id);
    onRegisterFlush(key, () => {
      if (debounceRef.current == null) return Promise.resolve();
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      debouncePendingRef.current = false;
      return Promise.resolve(commit(localRef.current));
    });
    return () => {
      onRegisterFlush(key, null);
      clearTimeout(debounceRef.current);
    };
  }, [q.id, q.household_member_id, onRegisterFlush]);

  const statusText = {
    saving: 'Enregistrement…', saved: 'Enregistré', error: 'Erreur — nouvelle tentative nécessaire',
  }[saveState?.status];

  return (
    <div
      id={`question-${q.id}-${q.household_member_id ?? 'household'}`}
      ref={cardRef}
      tabIndex={-1}
      className={`wksp-question${highlighted ? ' highlighted' : ''}`}
    >
      <div className="q-head">
        {q.required && <Badge value="critical" label="Obligatoire" />}
        {q.sensitive && <Badge value="serious" label="Donnée sensible" />}
        {q.scope === 'member' && <span className="muted" style={{ fontSize: 12 }}>Portée individuelle</span>}
      </div>
      <div className="q-text">{q.advisor_text}</div>
      {q.help_text && <div className="q-help">{q.help_text}</div>}

      <div className="q-input">
        {renderInput(q, local, {
          onImmediate: (v) => { setLocal(v); commit(v); },
          onDebounced: debouncedCommit,
          disabled: readOnly,
        })}
      </div>
      {saveState?.status === 'error' && saveState.error && (
        <div className="q-error" role="alert" aria-live="assertive">{saveState.error}</div>
      )}

      <div className="q-actions">
        {q.allows_unknown && (
          <button
            type="button"
            disabled={readOnly}
            className={`ghost${q.answer?.status === 'unknown' ? ' toggled' : ''}`}
            onClick={() => onSave('unknown', null)}
          >
            Je ne sais pas encore
          </button>
        )}
        {q.allows_not_applicable && (
          <button
            type="button"
            disabled={readOnly}
            className={`ghost${q.answer?.status === 'not_applicable' ? ' toggled' : ''}`}
            onClick={() => onSave('not_applicable', null)}
          >
            Non applicable
          </button>
        )}
        {q.answer && q.answer.status !== 'cleared' && (
          <button type="button" disabled={readOnly || saveState?.status === 'saving'} className="ghost" onClick={onClear}>Effacer la réponse</button>
        )}
        {q.history_available && (
          <button type="button" className="ghost small" onClick={onHistory}>Historique</button>
        )}
        {canAmend && q.answer && q.answer.status !== 'cleared' && (
          <button type="button" className="ghost small" onClick={onAmend}>Corriger cette réponse</button>
        )}
        <span className={`save-state ${saveState?.status || ''}`} aria-live="polite" aria-atomic="true">
          {statusText && <><span className="dot" />{statusText}</>}
        </span>
      </div>
    </div>
  );
}

function renderInput(q, value, { onImmediate, onDebounced, disabled }) {
  const id = `input-${q.id}`;
  switch (q.type) {
    case 'boolean':
      return (
        <div className="flex" role="radiogroup" aria-label={q.advisor_text}>
          <button type="button" role="radio" aria-checked={value === true} disabled={disabled} className={value === true ? 'primary' : ''} onClick={() => onImmediate(true)}>Oui</button>
          <button type="button" role="radio" aria-checked={value === false} disabled={disabled} className={value === false ? 'primary' : ''} onClick={() => onImmediate(false)}>Non</button>
        </div>
      );
    case 'single_choice':
      return (
        <div className="radiogroup" role="radiogroup" aria-label={q.advisor_text}>
          {q.options.filter((o) => o.status === 'active' || o.value === value).map((o) => (
            <label className="check" key={o.stable_key}>
              <input type="radio" name={id} disabled={disabled} checked={value === o.value} onChange={() => onImmediate(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'multiple_choice': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="radiogroup">
          {q.options.filter((o) => o.status === 'active' || arr.includes(o.value)).map((o) => (
            <label className="check" key={o.stable_key}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={arr.includes(o.value)}
                onChange={(e) => onImmediate(e.target.checked ? [...arr, o.value] : arr.filter((v) => v !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'text':
      return <input type="text" disabled={disabled} value={value || ''} onChange={(e) => onDebounced(e.target.value)} maxLength={200} />;
    case 'long_text':
      return <textarea disabled={disabled} rows={4} value={value || ''} onChange={(e) => onDebounced(e.target.value)} maxLength={5000} />;
    case 'integer':
      return <input type="number" step="1" disabled={disabled} value={value ?? ''} onChange={(e) => onDebounced(e.target.value === '' ? '' : parseInt(e.target.value, 10))} />;
    case 'decimal':
      return <input type="number" step="0.01" disabled={disabled} value={value ?? ''} onChange={(e) => onDebounced(e.target.value === '' ? '' : parseFloat(e.target.value))} />;
    case 'money':
      return <input type="number" step="0.01" disabled={disabled} value={value ?? ''} onChange={(e) => onDebounced(e.target.value === '' ? '' : parseFloat(e.target.value))} />;
    case 'date':
      return <input type="date" disabled={disabled} value={value || ''} onChange={(e) => onImmediate(e.target.value)} />;
    default:
      return <span className="muted">Type non pris en charge : {q.type}</span>;
  }
}

// --- Finalisation ------------------------------------------------------

// Résout un élément manquant (question_id + household_member_id bruts,
// renvoyés par la validation de finalisation) vers son contexte affichable
// (texte de la question, section, membre) -- la validation de finalisation
// elle-même reste calculée exclusivement côté serveur (§16), cette
// résolution ne fait que retrouver, dans la projection déjà reçue, l'objet
// correspondant à afficher.
function resolveMissingContext(modules, moduleIdx, missingItem) {
  const mod = modules[moduleIdx];
  for (const section of mod?.sections || []) {
    for (const instance of section.instances) {
      const question = instance.questions.find((q) => q.id === missingItem.question_id && instance.household_member_id === (missingItem.household_member_id ?? null));
      if (question) {
        return { question, sectionKey: section.stable_key, sectionTitle: section.title, memberName: instance.member?.display_name };
      }
    }
  }
  return null;
}

function FinalizationModal({ sessionId, missing, getRevision, onClose, onJump, onFinalized, modules }) {
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const anyMissing = missing.some((l) => l.missing.length > 0);

  const grouped = missing.map((link) => {
    const modIdx = modules.findIndex((m) => m.questionnaire_version_id === link.questionnaire_version_id);
    const items = link.missing.map((m) => ({ ...m, ...resolveMissingContext(modules, modIdx, m), modIdx }));
    return { ...link, moduleDomain: modules[modIdx]?.domain, items };
  }).filter((l) => l.missing.length > 0);

  async function confirmFinalize() {
    if (submitting) return; // évite un double-clic déclenchant deux finalisations concurrentes
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/advisory/sessions/${sessionId}/complete`, { expected_revision: getRevision() });
      onFinalized();
    } catch (err) {
      setError(err.status === 409 ? CONFLICT_MESSAGE : err.message);
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Vérification avant finalisation" onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {!anyMissing ? (
        <>
          <div className="alert ok">Toutes les réponses obligatoires visibles sont présentes.</div>
          {!confirming ? (
            <div className="actions">
              <button onClick={onClose}>Annuler</button>
              <button className="primary" onClick={() => setConfirming(true)}>Finaliser la session</button>
            </div>
          ) : (
            <div className="actions">
              <span className="muted" style={{ flex: 1 }}>Confirmer : la session passera en lecture seule (les corrections resteront possibles via l'amendement).</span>
              <button onClick={() => setConfirming(false)} disabled={submitting}>Annuler</button>
              <button className="primary" disabled={submitting} onClick={confirmFinalize}>Confirmer la finalisation</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p>Éléments obligatoires manquants, groupés par module puis par section :</p>
          {grouped.map((l) => {
            const bySection = new Map();
            for (const item of l.items) {
              const key = item.sectionKey || '?';
              if (!bySection.has(key)) bySection.set(key, { title: item.sectionTitle || key, items: [] });
              bySection.get(key).items.push(item);
            }
            return (
              <div key={l.questionnaire_version_id} className="mb">
                <strong>{LINK_DOMAIN_LABELS[l.moduleDomain] || l.moduleDomain}</strong> — {l.items.length} élément(s)
                {[...bySection.values()].map((sec) => (
                  <div key={sec.title} style={{ marginLeft: 12, marginTop: 6 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{sec.title}</div>
                    <ul className="missing-list">
                      {sec.items.map((item) => (
                        <li key={`${item.question_id}-${item.household_member_id ?? 'h'}`}>
                          <button className="link-row" onClick={() => onJump(item.modIdx, item.sectionKey, item.household_member_id ?? null)}>
                            <span>{item.question?.advisor_text || item.stable_key}{item.memberName ? ` — ${item.memberName}` : ''}</span>
                            <span className="muted">→</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="actions">
            <button onClick={onClose}>Fermer</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// --- Amendement ----------------------------------------------------------

// Aplatit les questions visibles et répondues de tous les modules, avec leur
// contexte humain (module/section/membre) -- utilisé UNIQUEMENT par le
// sélecteur de recherche global (GATE LOT 3B §8) ; l'ouverture contextualisée
// depuis une question (« Corriger cette réponse ») ne le traverse jamais,
// elle connaît déjà la question exacte.
function flattenAmendableQuestions(modules) {
  return modules.flatMap((m) => m.sections.flatMap((s) => s.instances.flatMap((i) => i.questions
    .filter((q) => q.visible && q.answer && q.answer.status !== 'cleared')
    .map((q) => ({
      ...q,
      moduleDomain: m.domain,
      moduleLabel: LINK_DOMAIN_LABELS[m.domain] || m.domain,
      sectionTitle: s.title,
      memberId: i.household_member_id,
      memberName: i.member?.display_name,
    })))));
}

function AmendModal({ sessionId, modules, initialTarget, getRevision, onClose, onDone }) {
  const allQuestions = useMemo(() => flattenAmendableQuestions(modules), [modules]);
  const initialQuestion = initialTarget
    ? allQuestions.find((q) => q.id === initialTarget.questionId && (q.memberId ?? null) === (initialTarget.memberId ?? null))
    : null;

  const [selected, setSelected] = useState(initialQuestion || null);
  const [search, setSearch] = useState('');
  const [value, setValue] = useState(initialQuestion?.answer?.status === 'answered' ? initialQuestion.answer.value : '');
  const [status, setStatus] = useState('answered');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Regroupement recherché par module puis section, avec libellés humains --
  // remplace le <select> plat unique de la version précédente, qui ne
  // passerait pas à l'échelle avec un questionnaire réel de plusieurs
  // dizaines/centaines de questions et plusieurs membres.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allQuestions;
    return allQuestions.filter((x) => x.advisor_text.toLowerCase().includes(q) || (x.memberName || '').toLowerCase().includes(q) || x.sectionTitle.toLowerCase().includes(q));
  }, [allQuestions, search]);

  const grouped = useMemo(() => {
    const byModule = new Map();
    for (const q of filtered) {
      if (!byModule.has(q.moduleLabel)) byModule.set(q.moduleLabel, new Map());
      const bySection = byModule.get(q.moduleLabel);
      if (!bySection.has(q.sectionTitle)) bySection.set(q.sectionTitle, []);
      bySection.get(q.sectionTitle).push(q);
    }
    return byModule;
  }, [filtered]);

  function pick(q) {
    setSelected(q);
    setValue(q.answer?.status === 'answered' ? q.answer.value : '');
    setStatus('answered');
  }

  async function submit() {
    if (submitting) return; // évite un double-clic déclenchant deux amendements concurrents
    setError(null);
    if (!selected) return setError('Choisissez une question.');
    if (!reason.trim()) return setError('Le motif de correction est obligatoire.');
    setSubmitting(true);
    try {
      await api.post(`/api/advisory/sessions/${sessionId}/answers/amend`, {
        question_id: selected.id,
        household_member_id: selected.memberId ?? undefined,
        status,
        value: status === 'answered' ? value : undefined,
        amendment_reason: reason,
        expected_revision: getRevision(),
      });
      onDone();
    } catch (err) {
      setError(err.status === 409 ? CONFLICT_MESSAGE : err.message);
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Corriger une réponse" onClose={onClose} wide={!selected}>
      {error && <div className="alert error">{error}</div>}
      <div className="alert warn">Cette correction reste tracée dans l'historique — la réponse précédente n'est jamais supprimée.</div>

      {!selected ? (
        <>
          <Field label="Rechercher une question" full>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Texte de la question, section, membre…" autoFocus />
          </Field>
          <div className="amend-picker">
            {[...grouped.entries()].map(([moduleLabel, sections]) => (
              <div key={moduleLabel} className="mb">
                <strong>{moduleLabel}</strong>
                {[...sections.entries()].map(([sectionTitle, qs]) => (
                  <div key={sectionTitle} style={{ marginLeft: 12, marginTop: 6 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{sectionTitle}</div>
                    <ul className="missing-list">
                      {qs.map((q) => (
                        <li key={`${q.id}|${q.memberId ?? 'h'}`}>
                          <button className="link-row" onClick={() => pick(q)}>
                            <span>{q.advisor_text}{q.memberName ? ` — ${q.memberName}` : ''}</span>
                            <span className="muted">→</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <Empty>Aucune question ne correspond à cette recherche.</Empty>}
          </div>
          <div className="actions">
            <button onClick={onClose}>Annuler</button>
          </div>
        </>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            [{selected.moduleLabel}] {selected.sectionTitle}{selected.memberName ? ` — ${selected.memberName}` : ''}
          </div>
          <Field label="Question" full><div style={{ fontWeight: 600 }}>{selected.advisor_text}</div></Field>
          {!initialQuestion && (
            <button type="button" className="ghost small" onClick={() => setSelected(null)}>← Choisir une autre question</button>
          )}
          <Field label="Statut" full>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="answered">Nouvelle réponse</option>
              {selected.allows_unknown && <option value="unknown">Je ne sais pas encore</option>}
              {selected.allows_not_applicable && <option value="not_applicable">Non applicable</option>}
            </select>
          </Field>
          {status === 'answered' && (
            <Field label="Nouvelle valeur" full>
              {renderInput(selected, value, { onImmediate: setValue, onDebounced: setValue, disabled: false })}
            </Field>
          )}
          <Field label="Motif de la correction (obligatoire)" full>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          <div className="actions">
            <button onClick={onClose} disabled={submitting}>Annuler</button>
            <button className="primary" disabled={submitting} onClick={submit}>Enregistrer la correction</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// --- Historique ------------------------------------------------------------

// Formatage d'affichage d'une ancienne valeur d'historique -- réservé au
// dossier conseiller (aucun mode client n'existe dans ce lot, voir §17).
function formatHistoryValue(r) {
  if (r.status !== 'answered') return null;
  if (Array.isArray(r.value)) return r.value.join(', ');
  if (typeof r.value === 'boolean') return r.value ? 'Oui' : 'Non';
  return String(r.value ?? '');
}

// `target.preloadedRows`/`target.highlightAnswerId` (GATE LOT 4B §2) :
// renseignés uniquement quand cette modale est ouverte depuis une navigation
// entrante ayant déjà vérifié l'`answer_id` annoncé (voir l'effet de
// navigation entrante ci-dessus) -- réutilise directement ces lignes déjà
// chargées et déjà auditées pour CE geste, jamais une seconde requête (donc
// jamais une seconde entrée d'audit) pour la même consultation. L'ouverture
// « Historique » ordinaire depuis une QuestionCard (aucun answer_id annoncé)
// charge comme avant.
function HistoryModal({ sessionId, target, advisorName, onClose }) {
  const [rows, setRows] = useState(target.preloadedRows || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (target.preloadedRows) return;
    const params = target.memberId ? `?question_id=${target.questionId}&household_member_id=${target.memberId}` : `?question_id=${target.questionId}`;
    api.get(`/api/advisory/sessions/${sessionId}/answers/history${params}`).then((r) => setRows(r.answers)).catch((err) => setError(err.message));
  }, [sessionId, target]);

  const highlightRef = useRef(null);
  useEffect(() => {
    if (target.highlightAnswerId != null && rows) {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [rows, target.highlightAnswerId]);

  return (
    <Modal title={`Historique — ${target.label}`} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      {!rows ? (
        <p className="muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <Empty>Aucun historique.</Empty>
      ) : (
        <ul className="history-list">
          {rows.map((r) => {
            const value = formatHistoryValue(r);
            // Jamais une substitution silencieuse de la réponse active
            // courante (§2, point 10) : la ligne mise en avant reste
            // TOUJOURS celle de `highlightAnswerId` lui-même, distincte du
            // badge « Active » (qui, lui, désigne la ligne réellement
            // active aujourd'hui — potentiellement une ligne différente si
            // amendée depuis).
            const isHighlighted = target.highlightAnswerId != null && r.id === target.highlightAnswerId;
            return (
              <li key={r.id} ref={isHighlighted ? highlightRef : null} className={isHighlighted ? 'highlighted' : undefined}>
                <div>
                  <Badge value={r.status} /> {r.is_amendment ? <Badge value="serious" label="Amendement" /> : null}
                  {r.superseded_by_answer_id == null && <Badge value="good" label="Active" />}
                  {isHighlighted && <Badge value="source_answer" label="Réponse utilisée lors de cette analyse" />}
                </div>
                {isHighlighted && r.superseded_by_answer_id != null && (
                  <div className="muted" style={{ fontSize: 12 }}>Cette réponse a été remplacée depuis par une correction plus récente.</div>
                )}
                {value != null && <div>{value}</div>}
                <div className="h-meta">
                  {fmtDateTime(r.created_at)} — {advisorName || 'Conseiller'}
                  {r.amendment_reason ? ` — Motif : ${r.amendment_reason}` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
