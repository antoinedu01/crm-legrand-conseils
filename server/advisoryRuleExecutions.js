// Service métier — exécution du moteur de règles sur une session et lecture
// des findings produits (Legrand Diagnostic 360, Lot 4A). Isolé de
// `server/advisoryRules.js` (cycle de vie des règles) exactement comme
// `server/advisorySessions.js` est isolé de `server/advisoryQuestionnaires.js`
// (Lot 3A) : ce module ne modifie JAMAIS une règle ni un rule_set, il ne fait
// que les LIRE et les ÉVALUER contre l'état figé d'une session.

import db from './db.js';
import { assert, inEnum, ValidationError } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError, displayName } from './advisoryHouseholds.js';
import { evaluateRuleCondition, refKind, resolveQuantifierMembers } from './advisoryRuleConditions.js';
import { evaluateCondition } from './advisoryConditions.js';
import { sessionMembersFor, answerValueFor, isSessionWritable } from './advisorySessions.js';
import { getVersionDetail } from './advisoryQuestionnaires.js';
import { getRuleSetDetail, listRuleSets, RULE_SET_DOMAINS } from './advisoryRules.js';

// Identifie la version du MOTEUR lui-même (jamais celle d'un rule_set) —
// à incrémenter si l'algorithme d'exécution change de façon à pouvoir
// distinguer, dans l'historique, une exécution produite par une version
// antérieure du moteur.
export const RULES_ENGINE_VERSION = '4a-1';

const EXECUTION_STATUSES = ['completed', 'failed'];
// Un seul mode pris en charge dans ce lot (voir server/db.js, colonne
// conservée pour complétude de schéma) : la notion d'exécution « preview »
// (non définitive, non tracée dans l'historique officiel) n'a jamais été
// spécifiée précisément pour ce lot — plutôt que d'inventer une sémantique
// non demandée, seul `final` est accepté ; toute autre valeur est refusée
// explicitement (décision d'implémentation documentée, GATE LOT 4A).
const EXECUTION_MODES = ['final'];
// GATE LOT 4A §9 (décision humaine confirmée) : une exécution FINALE et
// persistante n'est possible que sur une session déjà `completed` — jamais
// `in_progress` (même active/en cours de rendez-vous), jamais un brouillon
// (composition du foyer pas encore figée), jamais suspendue ni annulée. Ce
// lot ne connaît qu'un seul mode (`final`, voir EXECUTION_MODES) : il n'y a
// donc aucune façon d'obtenir un aperçu provisoire pendant l'entretien —
// l'exécution du moteur est un acte volontaire et définitif posé une fois
// les réponses finalisées, jamais un calcul en direct pendant la saisie.
const ELIGIBLE_SESSION_STATUSES = ['completed'];

function getSession(id) {
  return db.prepare('SELECT * FROM advisory_sessions WHERE id = ?').get(id);
}
function requireSession(id) {
  const session = getSession(id);
  if (!session) throw new AdvisoryError('Session introuvable.', 404);
  return session;
}
function getHousehold(id) {
  return db.prepare('SELECT * FROM households WHERE id = ?').get(id);
}

function assertExpectedRevision(session, expectedRevision) {
  assert(Number.isInteger(expectedRevision), 'expected_revision est requis (entier).');
  if (expectedRevision !== session.revision) {
    throw new AdvisoryError(
      `Cette session a été modifiée ailleurs depuis votre dernière lecture (révision attendue ${expectedRevision}, révision réelle ${session.revision}). Rechargez avant de réessayer.`,
      409
    );
  }
}

// Préconditions communes à toute exécution (indépendantes du domaine) —
// extraites de `executeRuleSetForSession` (LOT 4B) pour être réutilisées
// TELLES QUELLES par `executeApplicableRuleSetsForSession` : la session doit
// être vérifiée UNE SEULE FOIS avant de lancer plusieurs domaines, jamais
// domaine par domaine (une session `in_progress` ou un foyer archivé n'est
// pas un problème « propre à un domaine », c'est un rejet de l'appel entier
// — à la différence de l'absence de rule_set publié, qui elle reste bien
// spécifique à chaque domaine, voir plus bas).
function assertSessionExecutable(session, household, expectedRevision) {
  if (!ELIGIBLE_SESSION_STATUSES.includes(session.status)) {
    throw new AdvisoryError(`Aucune exécution du moteur de règles n'est possible sur une session « ${session.status} ».`, 409);
  }
  if (household && household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle activité n’est possible sur ses sessions.', 409);
  }
  assertExpectedRevision(session, expectedRevision);
}

// --- Résolution du rule_set figé pour ce couple (session, domaine) ---------

// La toute première exécution RÉUSSIE d'un domaine sur une session
// détermine DÉFINITIVEMENT le rule_set utilisé pour ce couple — jamais
// silencieusement mis à niveau vers une version plus récente publiée par la
// suite, même en cas de ré-exécution après amendement (reproductibilité,
// docs/advisory/RULES_ENGINE.md §10 : « publier une nouvelle version d'un
// rule_set... n'altère jamais les sessions qui référencent une version
// antérieure figée »). Dérivé de l'historique lui-même (`advisory_rule_
// executions`), jamais d'une colonne de figeage sur `advisory_sessions` (qui
// ne pourrait stocker qu'UN SEUL rule_set, incompatible avec une session
// « mixed » qui en a besoin de deux — décision documentée, revue
// `advisory-architect`).
//
// Filtre explicitement `status = 'completed'` (constat GATE LOT 4A, revue
// `advisory-architect`) : une exécution `failed` (erreur interne inattendue,
// jamais un résultat métier) ne doit jamais devenir la référence de figeage
// — sinon un bug technique corrigé depuis, ou un état transitoire, verrouille
// définitivement la session sur un rule_set sans qu'aucun finding valide
// n'ait jamais été produit, sans issue de récupération.
function resolvePinnedRuleSetId(sessionId, domain, providedRuleSetId) {
  const first = db
    .prepare("SELECT rule_set_id FROM advisory_rule_executions WHERE session_id = ? AND domain = ? AND status = 'completed' ORDER BY id ASC LIMIT 1")
    .get(sessionId, domain);
  if (first) {
    if (providedRuleSetId != null && Number(providedRuleSetId) !== first.rule_set_id) {
      throw new AdvisoryError(
        `Ce domaine est déjà lié à l'ensemble de règles #${first.rule_set_id} depuis la première exécution réussie de cette session — impossible d'en utiliser un autre (reproductibilité).`,
        409
      );
    }
    return { ruleSetId: first.rule_set_id, isFirstExecution: false };
  }
  assert(providedRuleSetId != null, "L'identifiant de l'ensemble de règles à utiliser est requis pour la première exécution de ce domaine sur cette session.");
  return { ruleSetId: Number(providedRuleSetId), isFirstExecution: true };
}

// --- Construction du contexte d'exécution -----------------------------------

function buildQuestionIndex(sessionId) {
  const links = db.prepare('SELECT * FROM advisory_session_questionnaires WHERE session_id = ?').all(sessionId);
  const byStableKey = new Map();
  for (const link of links) {
    const detail = getVersionDetail(link.questionnaire_version_id);
    for (const section of detail.sections) {
      for (const q of section.questions) {
        if (!byStableKey.has(q.stable_key)) byStableKey.set(q.stable_key, q);
      }
    }
  }
  return byStableKey;
}

function buildAnswerIndex(sessionId) {
  const rows = db.prepare('SELECT * FROM advisory_answers WHERE session_id = ? AND superseded_by_answer_id IS NULL').all(sessionId);
  return new Map(rows.map((r) => [`${r.question_id}|${r.household_member_id ?? 'household'}`, r]));
}

// Projection minimale contrôlée (jamais le contrat complet, jamais de
// calcul métier réel) — seul le statut d'un contrat de la branche demandée
// est exposé. En cas de contrats multiples pour la même branche, un contrat
// actif prime sur les autres ; à égalité, le plus récemment créé.
//
// Résout contre les `client_id` du SNAPSHOT figé de la session (mêmes
// membres que `sessionMembersFor`, historisés inclus), jamais contre la
// composition ACTUELLE et vivante du foyer (constat GATE LOT 4A, revue
// `advisory-architect`) : sans ce choix, deux ré-exécutions de la même
// session/révision/rule_set pinné pourraient produire des résultats de
// `contract_branch` différents si la composition du foyer a changé
// entre-temps — contredisant la reproductibilité qui justifie le pin du
// rule_set lui-même.
function buildContractBranchResolver(clientIds) {
  return function getContractBranchStatus(branch) {
    if (clientIds.length === 0) return undefined;
    const placeholders = clientIds.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT status FROM contracts
         WHERE client_id IN (${placeholders}) AND branch = ?
         ORDER BY (status = 'actif') DESC, created_at DESC LIMIT 1`
      )
      .get(...clientIds, branch);
    return row ? row.status : undefined;
  };
}

// Surensemble de `collectRuleDependencies` (qui ne collecte que
// questions/règles) : ajoute les branches de contrat référencées, utile ici
// pour la traçabilité (`used_inputs_ref`) et l'empreinte minimale
// (`inputs_snapshot`) — jamais réintégré dans le module DSL partagé, qui n'a
// pas besoin de connaître les contrats pour sa propre validation de format.
function collectAllRefs(condition, into = { answerKeys: new Set(), ruleKeys: new Set(), contractBranches: new Set() }) {
  if (!condition || typeof condition !== 'object') return into;
  if (['and', 'or'].includes(condition.op)) { (condition.conditions || []).forEach((c) => collectAllRefs(c, into)); return into; }
  if (condition.op === 'not' || ['all', 'any'].includes(condition.op)) { collectAllRefs(condition.condition, into); return into; }
  if (condition.ref) {
    if (condition.ref.answer) into.answerKeys.add(condition.ref.answer);
    if (condition.ref.answer_status) into.answerKeys.add(condition.ref.answer_status);
    if (condition.ref.rule_result) into.ruleKeys.add(condition.ref.rule_result);
    if (condition.ref.contract_branch) into.contractBranches.add(condition.ref.contract_branch);
  }
  return into;
}

function isEffectiveToday(rule) {
  const today = new Date().toISOString().slice(0, 10);
  if (rule.effective_from && today < rule.effective_from) return false;
  if (rule.effective_until && today > rule.effective_until) return false;
  return true;
}

// Tri topologique défensif des règles actives/effectives selon leurs
// dépendances `rule_result` — un cycle ne devrait JAMAIS survivre jusqu'ici
// (bloqué à la publication, `advisoryRules.validateRuleSetForPublish`, et un
// rule_set publié est immuable) : s'il en survient tout de même un, c'est le
// signe d'une corruption d'état, jamais une erreur métier normale — cette
// fonction lève alors une exception ordinaire (pas une AdvisoryError),
// délibérément routée vers le chemin d'échec « exécution inattendue » de
// `executeRuleSetForSession` plutôt qu'une réponse 409 habituelle.
function topoOrder(rules) {
  const byKey = new Map(rules.map((r) => [r.stable_key, r]));
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(r) {
    if (visited.has(r.stable_key)) return;
    if (visiting.has(r.stable_key)) {
      throw new Error(`Cycle inattendu détecté à l'exécution entre règles (« ${r.stable_key} ») — devrait avoir été bloqué à la publication.`);
    }
    visiting.add(r.stable_key);
    const deps = collectAllRefs(r.conditions).ruleKeys;
    for (const dep of deps) {
      const depRule = byKey.get(dep);
      // Une référence vers une règle non retenue ici (inactive, ou pas
      // encore effective aujourd'hui) est ignorée pour le tri : elle
      // résoudra simplement « absente » à l'exécution (getRuleResult),
      // jamais une erreur de tri.
      if (depRule) visit(depRule);
    }
    visiting.delete(r.stable_key);
    visited.add(r.stable_key);
    order.push(r);
  }
  for (const r of rules) visit(r);
  return order;
}

// --- Exécution ---------------------------------------------------------

function recordFailedExecution(session, ruleSetId, ruleSet, req, err) {
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO advisory_rule_executions
        (session_id, session_revision, domain, rule_set_id, rule_set_version_number, content_hash, status, mode,
         ended_at, executed_by_user_id, rules_evaluated_count, findings_count, error_message, engine_version)
       VALUES (?, ?, ?, ?, ?, ?, 'failed', 'final', datetime('now'), ?, 0, 0, ?, ?)`
    ).run(
      session.id, session.revision, ruleSet.domain, ruleSetId, ruleSet.version_number, ruleSet.content_hash || null,
      userId || null, String(err?.message || err).slice(0, 500), RULES_ENGINE_VERSION
    );
    audit(req, 'exécution échouée', 'advisory_session', session.id, `${ruleSet.domain} — ensemble #${ruleSetId}`);
  })();
}

// Matrice de compatibilité (GATE LOT 4A §2, décision humaine confirmée) :
// `common` est toujours exécutable, quel que soit le domaine de la session
// (constats transverses au foyer) ; `health`/`life_pension` uniquement pour
// une session de ce domaine précis, ou pour une session `mixed` (qui exécute
// alors jusqu'à trois fois — common, health, life_pension — jamais fusionnées
// en une seule exécution opaque).
function allowedExecutionDomainsForSession(sessionDomain) {
  if (sessionDomain === 'mixed') return ['common', 'health', 'life_pension'];
  return ['common', sessionDomain];
}

// Matrice des domaines REQUIS par type de session (GATE LOT 4B §3, décision
// humaine confirmée) : `common` n'est JAMAIS requis, quel que soit le
// domaine de la session (constats transverses, facultatifs par nature) --
// seuls les domaines correspondant explicitement au(x) type(s) déclaré(s)
// de la session le sont. Distincte de `allowedExecutionDomainsForSession`
// (qui liste tout ce qui peut être exécuté, common inclus) : celle-ci ne
// sert QU'à calculer l'état global agrégé ci-dessous, jamais à décider quoi
// exécuter.
function requiredDomainsForSession(sessionDomain) {
  if (sessionDomain === 'mixed') return ['health', 'life_pension'];
  return [sessionDomain];
}

export function executeRuleSetForSession(sessionId, domain, expectedRevision, req, { rule_set_id } = {}) {
  const session = requireSession(sessionId);
  assert(inEnum(domain, RULE_SET_DOMAINS) && domain != null, 'Domaine d\'exécution inconnu (common, health ou life_pension attendu).');
  // Format valide (assert/400) mais incompatible avec CETTE session déjà
  // existante -- un conflit d'état, pas une entrée malformée (même famille
  // que `assertTransition`/`assertSessionAcceptsAnswers`, toujours une
  // AdvisoryError 409 dans ce module).
  if (!allowedExecutionDomainsForSession(session.domain).includes(domain)) {
    throw new AdvisoryError(`Cette session (domaine « ${session.domain} ») n'accepte pas d'exécution pour le domaine « ${domain} ».`, 409);
  }
  const household = getHousehold(session.household_id);
  assertSessionExecutable(session, household, expectedRevision);

  const { ruleSetId: pinnedRuleSetId, isFirstExecution } = resolvePinnedRuleSetId(sessionId, domain, rule_set_id);
  const ruleSet = getRuleSetDetail(pinnedRuleSetId);
  if (!ruleSet) throw new AdvisoryError('Ensemble de règles introuvable.', 404);
  // La toute première exécution exige un rule_set PUBLIÉ. Une ré-exécution
  // réutilisant le rule_set déjà figé reste possible même si celui-ci a été
  // archivé depuis (constat GATE LOT 4A, revue `advisory-architect`) : son
  // contenu est immuable une fois publié, l'archivage n'est qu'un retrait de
  // la sélection pour de NOUVELLES publications, jamais un blocage
  // rétroactif de la reproductibilité déjà engagée. Un brouillon n'est en
  // revanche jamais exécutable, dans un cas comme dans l'autre (il ne
  // pourrait de toute façon jamais avoir été pinné sans être passé par
  // `published` d'abord).
  const allowedStatuses = isFirstExecution ? ['published'] : ['published', 'archived'];
  if (!allowedStatuses.includes(ruleSet.status)) {
    throw new AdvisoryError(
      isFirstExecution
        ? 'Seul un ensemble de règles publié peut être exécuté.'
        : 'Cet ensemble de règles (déjà figé pour ce domaine) doit être publié ou archivé pour être ré-exécuté — un brouillon ne peut jamais être exécuté.',
      409
    );
  }
  if (ruleSet.domain !== domain) throw new AdvisoryError(`Cet ensemble de règles est du domaine « ${ruleSet.domain} », incompatible avec « ${domain} ».`, 409);

  try {
    return db.transaction(() => {
      const byStableKey = buildQuestionIndex(sessionId);
      const answerIndex = buildAnswerIndex(sessionId);
      const householdSnapshotMembers = sessionMembersFor(session);
      const getContractBranchStatus = buildContractBranchResolver(householdSnapshotMembers.map((m) => m.client_id));
      const members = householdSnapshotMembers.map((m) => ({ id: m.id, member_role: m.member_role }));

      function resolveAnswerFor(stableKey, member) {
        const q = byStableKey.get(stableKey);
        if (!q) return undefined;
        const memberId = q.scope === 'member' ? (member ? member.id : null) : null;
        const key = memberId != null ? `${q.id}|${memberId}` : `${q.id}|household`;
        const row = answerIndex.get(key);
        if (!row) return undefined;
        return { status: row.status, value: answerValueFor(row) };
      }

      // LOT 7A-T : une question dont la `display_condition` évalue à faux
      // pour ce membre (ou pour le foyer, en portée household) n'est jamais
      // « manquante » — elle n'est simplement pas applicable, exactement la
      // même règle déjà appliquée à la complétude de session
      // (`validateSessionForCompletion`, server/advisorySessions.js) et à la
      // visibilité de l'espace de travail (`getSessionWorkspace`). Réutilise
      // le même évaluateur pur `evaluateCondition` (server/advisoryConditions.js)
      // — jamais un second moteur d'évaluation de conditions. Sans
      // `display_condition` (toute question v1 historique, qui n'en définit
      // aucune), retourne `true` immédiatement : comportement strictement
      // inchangé pour tout contenu déjà publié.
      //
      // Limite documentée (LOT 7A-T, docs/advisory/RULES_ENGINE.md §8) :
      // seule la `display_condition` de la QUESTION est prise en compte ici,
      // jamais celle de sa SECTION parente (`advisory_sections.display_condition`)
      // — aucun contenu publié à ce jour n'en utilise, non traité par ce lot.
      function isVisibleForContext(q, member) {
        if (!q.display_condition) return true;
        const cond = JSON.parse(q.display_condition);
        return evaluateCondition(cond, {
          session: { domain: session.domain },
          member: member ? { member_role: member.member_role } : null,
          getAnswer: (stableKey) => resolveAnswerFor(stableKey, member),
        });
      }

      // Constat GATE LOT 4A (revue `rules-engine-auditor`) : une question de
      // portée « member » exige que TOUS les membres du foyer figé aient
      // répondu pour être considérée présente — jamais « au moins un membre
      // quelconque a répondu », qui déclarerait à tort une donnée présente
      // alors qu'un membre reste sans réponse (résoudrait alors silencieusement
      // « faux » pour ce membre dans un `all`/`any`, jamais signalé comme
      // donnée manquante). Conservateur par construction : peut signaler
      // « manquant » un peu plus souvent que strictement nécessaire pour un
      // `any` déjà vrai grâce à un autre membre, mais ne conclut jamais à tort
      // qu'une donnée est complète alors qu'elle ne l'est pas (jamais une
      // hypothèse silencieuse, RULES_ENGINE.md §1/§8).
      function isRequiredDataPresent(ref) {
        const kind = refKind(ref);
        if (kind === 'answer') {
          const q = byStableKey.get(ref.answer);
          if (!q) return false;
          if (q.scope === 'member') {
            if (members.length === 0) return true; // vacuité : aucun membre, rien ne manque
            return members.every((m) => {
              if (!isVisibleForContext(q, m)) return true; // non applicable à ce membre : jamais manquant (LOT 7A-T)
              const row = answerIndex.get(`${q.id}|${m.id}`);
              return !!(row && row.status === 'answered');
            });
          }
          if (!isVisibleForContext(q, null)) return true; // non applicable au foyer : jamais manquant (LOT 7A-T)
          const row = answerIndex.get(`${q.id}|household`);
          return !!(row && row.status === 'answered');
        }
        if (kind === 'contract_branch') return getContractBranchStatus(ref.contract_branch) != null;
        return false;
      }

      // `scope` (constat GATE LOT 4B, revue advisory-architect) : une
      // question de portée `member` est déclarée manquante dès qu'AU MOINS
      // UN membre n'a pas répondu (`isRequiredDataPresent` ci-dessus,
      // vérification `every`, jamais résolue à UN membre précis parmi
      // plusieurs potentiellement concernés) -- `household_member_id` reste
      // donc toujours `null` ici, y compris pour une question de portée
      // membre. Sans ce champ, un écran de lecture ne peut pas distinguer
      // « aucune instance foyer n'existe pour cette question » (portée
      // membre : une navigation directe vers UNE réponse précise n'a pas de
      // sens, plusieurs membres pouvant être concernés) d'une véritable
      // absence de réponse foyer -- risque déjà constaté d'un lien de
      // navigation qui échoue silencieusement faute de pouvoir distinguer
      // les deux cas.
      function structuredDataRef(ref) {
        const kind = refKind(ref);
        if (kind === 'answer') {
          const q = byStableKey.get(ref.answer);
          return { kind: 'answer', stable_key: ref.answer, question_id: q ? q.id : null, scope: q ? q.scope : null };
        }
        return { kind: 'contract_branch', contract_branch: ref.contract_branch };
      }

      // Horodatage unique de LECTURE des entrées, figé pour toute cette
      // exécution (toutes les lectures ci-dessous surviennent dans la même
      // transaction synchrone) — jamais recalculé plus tard à la consultation
      // (GATE LOT 4A §4).
      const executionReadAt = new Date().toISOString();

      // Références résolvables vers les entrées effectivement utilisées par
      // une règle déclenchée — jamais la valeur elle-même (minimisation).
      // `member` (optionnel) résout une référence de portée membre vers CE
      // membre précis (pertinent pour un finding `finding_scope = member`) ;
      // pour un finding session/household, `member` reste `null` et toute
      // référence de portée membre garde `household_member_id: null`
      // (résolue au niveau agrégé, jamais à un membre arbitraire).
      //
      // Classification FIGÉE au moment de l'exécution (GATE LOT 4A §4,
      // revue compliance-privacy-reviewer) : `sensitivity_at_execution`
      // capture `advisory_questions.sensitive` À CET INSTANT PRÉCIS, jamais
      // réévaluée ensuite à la lecture — si la question est reclassée
      // sensible/non-sensible plus tard, cette exécution historique garde
      // son constat d'origine (`auditSensitiveDataAccessIfNeeded` ci-dessous
      // ne relit plus jamais `advisory_questions` en direct). Pour une
      // réponse (append-only), `answer_id` est l'identifiant IMMUABLE de la
      // ligne `advisory_answers` réellement utilisée : jamais la réponse
      // active courante n'est relue plus tard, jamais la valeur elle-même
      // recopiée ici (l'id immuable suffit à retrouver, si nécessaire et
      // autorisé séparément, l'exacte valeur utilisée). Pour un contrat
      // (donnée vivante/mutable), seul le champ minimal réellement utilisé
      // (`status_at_execution`) est figé ici — jamais le contrat complet.
      function buildUsedInputsRef(refs, member) {
        const usedInputsRef = [];
        for (const k of refs.answerKeys) {
          const q = byStableKey.get(k);
          const memberId = q && q.scope === 'member' ? (member ? member.id : null) : null;
          const row = q ? answerIndex.get(memberId != null ? `${q.id}|${memberId}` : `${q.id}|household`) : undefined;
          usedInputsRef.push({
            kind: 'answer',
            stable_key: k,
            question_id: q ? q.id : null,
            questionnaire_version_id: q ? q.questionnaire_version_id : null,
            household_member_id: memberId,
            answer_id: row ? row.id : null,
            sensitivity_at_execution: q ? !!q.sensitive : false,
            read_at: executionReadAt,
          });
        }
        for (const b of refs.contractBranches) {
          usedInputsRef.push({
            kind: 'contract_branch',
            contract_branch: b,
            status_at_execution: getContractBranchStatus(b) ?? null,
            read_at: executionReadAt,
          });
        }
        for (const rk of refs.ruleKeys) {
          const depRule = rulesByKey.get(rk);
          usedInputsRef.push({ kind: 'rule_result', stable_key: rk, rule_id: depRule ? depRule.id : null });
        }
        return usedInputsRef;
      }

      const ruleResults = {};
      const context = {
        session: { domain: session.domain, status: session.status },
        household: { status: household ? household.status : null },
        member: null,
        members,
        getAnswer: resolveAnswerFor,
        getContractBranchStatus,
        getRuleResult: (key) => (key in ruleResults ? ruleResults[key] : undefined),
      };

      const activeRules = ruleSet.rules.filter((r) => r.status === 'active' && isEffectiveToday(r));
      const orderedRules = topoOrder(activeRules);
      const rulesByKey = new Map(activeRules.map((r) => [r.stable_key, r]));

      const usedAnswerKeysGlobal = new Set();
      const usedContractBranchesGlobal = new Set();
      const findingsInMemory = [];

      function missingInformationFinding(rule, missing, memberId) {
        return {
          rule, finding_type: 'missing_information', priority: rule.priority,
          title: `Information manquante pour : ${rule.title}`,
          summary: `Cette règle ne peut pas conclure : ${missing.length} donnée(s) manquante(s).`,
          advisor_explanation: `La règle « ${rule.stable_key} » ne peut pas être évaluée : des données requises sont manquantes. Contexte de la règle : ${rule.advisor_explanation}`,
          client_explanation: null, missing_data: missing, warnings: [], contraindications: [],
          used_inputs_ref: [], result_payload: null, household_member_id: memberId,
        };
      }

      // `required_data` de portée MEMBRE (une question `scope: 'member'')
      // contre le reste (question de portée foyer, `contract_branch`) — seul
      // ce second groupe reste une donnée réellement PARTAGÉE par tous les
      // membres (sa complétude ne varie jamais d'un membre à l'autre, un seul
      // contrôle global reste donc correct pour lui). Correctif du défaut
      // constaté lors du test fonctionnel post-migration 14 : une réponse
      // manquante/`unknown` du membre B sur une question de portée membre ne
      // doit jamais être mélangée à la complétude du membre A.
      function partitionRequiredData(requiredData) {
        const memberRefs = [];
        const otherRefs = [];
        for (const ref of requiredData) {
          const kind = refKind(ref);
          if (kind === 'answer') {
            const q = byStableKey.get(ref.answer);
            if (q && q.scope === 'member') { memberRefs.push(ref); continue; }
          }
          otherRefs.push(ref);
        }
        return { memberRefs, otherRefs };
      }

      // Présence d'une référence de portée MEMBRE pour UN membre précis,
      // jamais `.every()` sur l'ensemble du foyer (contrairement à
      // `isRequiredDataPresent` ci-dessus, dont le contrat `.every()` reste
      // correct et inchangé pour les règles de portée foyer/session ainsi
      // que pour le quantificateur `all` ci-dessous, où la vérité de la
      // règle dépend réellement de TOUS les membres à la fois).
      function isRequiredDataPresentForMember(ref, member) {
        const q = byStableKey.get(ref.answer);
        if (!q) return false;
        if (!isVisibleForContext(q, member)) return true; // non applicable à ce membre : jamais manquant (LOT 7A-T)
        const row = answerIndex.get(`${q.id}|${member.id}`);
        return !!(row && row.status === 'answered');
      }

      for (const rule of orderedRules) {
        const refs = collectAllRefs(rule.conditions);
        for (const k of refs.answerKeys) usedAnswerKeysGlobal.add(k);
        for (const b of refs.contractBranches) usedContractBranchesGlobal.add(b);

        // finding_scope = member (GATE LOT 4A §3, correctif membre isolé) :
        // le quantificateur racine (`any`/`all` over members, garanti par
        // `validateRuleSetForPublish`) déjà utilisé pour l'attribution des
        // findings substantifs (`resolveQuantifierMembers`) pilote AUSSI la
        // vérification de complétude des données, membre par membre pour
        // `any` -- jamais un `.every()` global qui empêcherait à tort
        // l'évaluation d'un membre dont les données sont pourtant complètes
        // simplement parce qu'un AUTRE membre a une réponse manquante/
        // `unknown`. `all` reste un contrôle collectif inchangé (correct :
        // la vérité d'un `all` dépend réellement de tous les membres à la
        // fois, une donnée manquante pour un seul suffit à rendre le
        // résultat collectif indéterminable pour tous).
        if (rule.finding_scope === 'member') {
          const { memberRefs, otherRefs } = partitionRequiredData(rule.required_data);
          const otherMissing = otherRefs.filter((ref) => !isRequiredDataPresent(ref)).map(structuredDataRef);
          if (otherMissing.length > 0) {
            findingsInMemory.push(missingInformationFinding(rule, otherMissing, null));
            continue;
          }

          if (rule.conditions.op === 'all') {
            const collectiveMissing = [];
            for (const member of members) {
              for (const ref of memberRefs) {
                if (!isRequiredDataPresentForMember(ref, member)) collectiveMissing.push(structuredDataRef(ref));
              }
            }
            if (collectiveMissing.length > 0) {
              const seen = new Set();
              const deduped = collectiveMissing.filter((m) => (seen.has(m.stable_key) ? false : (seen.add(m.stable_key), true)));
              findingsInMemory.push(missingInformationFinding(rule, deduped, null));
              continue;
            }
            const triggered = evaluateRuleCondition(rule.conditions, context);
            ruleResults[rule.stable_key] = triggered;
            if (!triggered) continue;
            const matchingMembers = resolveQuantifierMembers(rule.conditions, context);
            for (const member of matchingMembers) {
              findingsInMemory.push({
                rule, finding_type: rule.result_finding_type, priority: rule.priority,
                title: rule.title, summary: rule.description || rule.title,
                advisor_explanation: rule.advisor_explanation, client_explanation: rule.client_explanation,
                missing_data: null, warnings: rule.warnings, contraindications: rule.contraindications,
                used_inputs_ref: buildUsedInputsRef(refs, member), result_payload: rule.result_payload,
                household_member_id: member.id,
              });
            }
            continue;
          }

          // `any` -- évaluation INDÉPENDANTE par membre, coeur du correctif :
          // une donnée manquante pour le membre B produit un
          // `missing_information` RATTACHÉ À CE MEMBRE (household_member_id
          // = son id, jamais `null`) sans jamais empêcher l'évaluation ni la
          // création du finding substantif du membre A.
          let anyTriggered = false;
          let allMembersDetermined = true;
          for (const member of members) {
            const memberMissing = memberRefs.filter((ref) => !isRequiredDataPresentForMember(ref, member)).map(structuredDataRef);
            if (memberMissing.length > 0) {
              allMembersDetermined = false;
              findingsInMemory.push(missingInformationFinding(rule, memberMissing, member.id));
              continue;
            }
            const matches = evaluateRuleCondition(rule.conditions.condition, { ...context, member });
            if (matches) {
              anyTriggered = true;
              findingsInMemory.push({
                rule, finding_type: rule.result_finding_type, priority: rule.priority,
                title: rule.title, summary: rule.description || rule.title,
                advisor_explanation: rule.advisor_explanation, client_explanation: rule.client_explanation,
                missing_data: null, warnings: rule.warnings, contraindications: rule.contraindications,
                used_inputs_ref: buildUsedInputsRef(refs, member), result_payload: rule.result_payload,
                household_member_id: member.id,
              });
            }
          }
          // `rule_result` figé uniquement quand un résultat définitif a pu
          // être établi (au moins un membre a réellement déclenché la règle,
          // ou tous les membres ont pu être évalués sans donnée manquante) --
          // jamais une conclusion `false` silencieuse tirée d'une évaluation
          // partielle (même principe conservateur que le reste de ce
          // module : ne jamais affirmer une complétude qui n'existe pas).
          if (anyTriggered || allMembersDetermined) ruleResults[rule.stable_key] = anyTriggered;
          continue;
        }

        const missing = rule.required_data.filter((ref) => !isRequiredDataPresent(ref)).map(structuredDataRef);

        if (missing.length > 0) {
          findingsInMemory.push(missingInformationFinding(rule, missing, null));
          continue;
        }

        const triggered = evaluateRuleCondition(rule.conditions, context);
        ruleResults[rule.stable_key] = triggered;
        if (!triggered) continue;

        findingsInMemory.push({
          rule, finding_type: rule.result_finding_type, priority: rule.priority,
          title: rule.title, summary: rule.description || rule.title,
          advisor_explanation: rule.advisor_explanation, client_explanation: rule.client_explanation,
          missing_data: null, warnings: rule.warnings, contraindications: rule.contraindications,
          used_inputs_ref: buildUsedInputsRef(refs, null), result_payload: rule.result_payload,
          household_member_id: null,
        });
      }

      // Détection de recoupement en TEMPS RÉEL (complémentaire à la
      // simulation de publication, docs/advisory/RULES_ENGINE.md §4,
      // confirmé par la revue `rules-engine-auditor` : les deux contrôles
      // sont requis, ni l'un ni l'autre n'est un substitut) : deux findings
      // DÉCLENCHÉS dans la MÊME exécution partageant la même catégorie sont
      // tous deux conservés (jamais l'un supprimé au profit de l'autre) et
      // marqués `needs_review` avec renvoi croisé — c'est au conseiller de
      // trancher, jamais au moteur.
      //
      // Constat GATE LOT 4B (QA formelle, écran des constats) : EXCLUT
      // explicitement les findings produits par LA MÊME règle (`finding_
      // scope = member`, un finding distinct par membre correspondant,
      // GATE LOT 4A §3) -- ces findings partagent nécessairement le même
      // `category_hint` (copié depuis la même règle) sans que cela
      // constitue un recoupement réel : ce n'est jamais qu'une même règle
      // s'appliquant normalement à plusieurs membres, jamais deux avis
      // contradictoires. Seuls des findings issus de règles DIFFÉRENTES
      // partageant une catégorie constituent un recoupement à signaler.
      const byCategory = new Map();
      findingsInMemory.forEach((f, idx) => {
        const cat = f.result_payload?.category_hint;
        if (!cat) return;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(idx);
      });
      const conflictGroups = new Map(); // idx -> [other idx...]
      for (const [, idxs] of byCategory) {
        for (const i of idxs) {
          const others = idxs.filter((j) => j !== i && findingsInMemory[j].rule.id !== findingsInMemory[i].rule.id);
          if (others.length > 0) conflictGroups.set(i, others);
        }
      }

      // Empreinte minimale des entrées utilisées (§13) : références
      // résolvables (question_id/stable_key/household_member_id, ligne de
      // réponse EXACTE utilisée) — jamais la valeur elle-même dupliquée ici
      // (minimisation : la valeur reste uniquement dans `advisory_answers`,
      // consultable séparément si besoin et autorisé). `sensitivity_at_
      // execution`/`questionnaire_version_id`/`read_at` figent la même
      // classification que `buildUsedInputsRef` (GATE LOT 4A §4) : cette
      // empreinte est elle-même relue telle quelle par
      // `auditSensitiveDataAccessIfNeeded`, jamais recalculée en direct.
      const answersUsedSnapshot = [...usedAnswerKeysGlobal].map((k) => {
        const q = byStableKey.get(k);
        if (!q) return { stable_key: k, question_id: null, found: false };
        const base = {
          stable_key: k,
          question_id: q.id,
          questionnaire_version_id: q.questionnaire_version_id,
          sensitivity_at_execution: !!q.sensitive,
          read_at: executionReadAt,
        };
        if (q.scope === 'member') {
          const rows = members
            .map((m) => answerIndex.get(`${q.id}|${m.id}`))
            .filter(Boolean)
            .map((row) => ({ household_member_id: row.household_member_id, answer_id: row.id, status: row.status }));
          return { ...base, entries: rows };
        }
        const row = answerIndex.get(`${q.id}|household`);
        return { ...base, entries: row ? [{ household_member_id: null, answer_id: row.id, status: row.status }] : [] };
      });
      const contractsUsedSnapshot = [...usedContractBranchesGlobal].map((b) => ({
        contract_branch: b,
        status_at_execution: getContractBranchStatus(b) ?? null,
        read_at: executionReadAt,
      }));
      const inputsSnapshot = {
        session_revision: session.revision,
        members: members.map((m) => ({ household_member_id: m.id, member_role: m.member_role })),
        answers_used: answersUsedSnapshot,
        contracts_used: contractsUsedSnapshot,
      };

      const email = req?.session?.userEmail;
      const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;

      // Supersession de l'exécution précédente (même couple session/domaine)
      // — jamais recalculée en place, une nouvelle ligne complète toujours
      // l'historique (docs/advisory/RULES_ENGINE.md §10).
      const prior = db
        .prepare("SELECT * FROM advisory_rule_executions WHERE session_id = ? AND domain = ? AND status = 'completed' AND superseded_by_execution_id IS NULL ORDER BY id DESC LIMIT 1")
        .get(sessionId, domain);

      const execInfo = db
        .prepare(
          `INSERT INTO advisory_rule_executions
            (session_id, session_revision, domain, rule_set_id, rule_set_version_number, content_hash, status, mode,
             ended_at, executed_by_user_id, rules_evaluated_count, findings_count, inputs_snapshot, engine_version)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', 'final', datetime('now'), ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId, session.revision, domain, pinnedRuleSetId, ruleSet.version_number, ruleSet.content_hash,
          userId || null, orderedRules.length, findingsInMemory.length, JSON.stringify(inputsSnapshot), RULES_ENGINE_VERSION
        );
      const executionId = execInfo.lastInsertRowid;

      const insertedIds = findingsInMemory.map((f, idx) => {
        const info = db
          .prepare(
            `INSERT INTO advisory_findings
              (rule_execution_id, session_id, rule_id, stable_key, domain, finding_scope, household_member_id, finding_type, priority, title, summary,
               advisor_explanation, client_explanation, missing_data, warnings, contraindications, used_inputs_ref,
               needs_review, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            executionId, sessionId, f.rule.id, f.rule.stable_key, f.rule.domain, f.rule.finding_scope, f.household_member_id ?? null,
            f.finding_type, f.priority, f.title, f.summary,
            f.advisor_explanation, f.client_explanation || null,
            f.missing_data ? JSON.stringify(f.missing_data) : null,
            JSON.stringify(f.warnings || []), JSON.stringify(f.contraindications || []),
            JSON.stringify(f.used_inputs_ref || []), conflictGroups.has(idx) ? 1 : 0, f.rule.sort_order
          );
        return info.lastInsertRowid;
      });
      // `conflicts_detected_at_execution` fige, une fois pour toutes, le
      // recoupement constaté à la PRODUCTION de cette exécution — historique
      // et IMMUABLE, jamais réécrit ensuite (GATE LOT 4A §5). `conflicts_with`
      // porte la même valeur au départ mais reste l'état ACTIF courant,
      // recalculé par `recomputeActiveConflicts` lors d'un écartement.
      for (const [idx, others] of conflictGroups) {
        const otherIds = JSON.stringify(others.map((o) => insertedIds[o]));
        db.prepare('UPDATE advisory_findings SET conflicts_with = ?, conflicts_detected_at_execution = ? WHERE id = ?')
          .run(otherIds, otherIds, insertedIds[idx]);
      }

      if (prior) {
        db.prepare('UPDATE advisory_rule_executions SET superseded_by_execution_id = ? WHERE id = ?').run(executionId, prior.id);
        db.prepare("UPDATE advisory_findings SET status = 'superseded' WHERE rule_execution_id = ?").run(prior.id);
        // Un finding supersédé n'est plus actif : son `needs_review` doit
        // retomber à 0 exactement comme un finding écarté (même invariant,
        // GATE LOT 4A §12, revue rules-engine-auditor) — sinon un conflit
        // resterait signalé indéfiniment sur une exécution devenue obsolète.
        // `conflicts_detected_at_execution` (constat historique) ne bouge pas.
        recomputeActiveConflicts(prior.id);
      }

      audit(req, 'exécution lancée', 'advisory_session', sessionId, `${domain} — ${findingsInMemory.length} finding(s), ${orderedRules.length} règle(s) évaluée(s)`);

      return {
        execution_id: executionId,
        rules_evaluated_count: orderedRules.length,
        findings_count: findingsInMemory.length,
        findings: insertedIds,
      };
    })();
  } catch (err) {
    if (err instanceof AdvisoryError || err instanceof ValidationError) throw err;
    recordFailedExecution(session, pinnedRuleSetId, ruleSet, req, err);
    throw err;
  }
}

// --- Orchestration : lancement groupé sur tous les domaines applicables ---

// Un message d'échec renvoyé à l'appelant (route, UI) ne doit jamais
// exposer le détail brut d'une erreur interne inattendue (même principe que
// pour toute autre route de ce module, constat GATE LOT 4A sur les fuites
// SQL) : seules les erreurs métier volontaires (`AdvisoryError`,
// `ValidationError`, déjà rédigées pour être lues par un humain) sont
// transmises telles quelles ; toute autre erreur devient un message
// générique — le détail réel reste uniquement dans
// `advisory_rule_executions.error_message` (déjà écrit par
// `recordFailedExecution`, déjà couvert par l'audit existant).
// Partagé avec `resolveDomainAnalysisState` (§9 ci-dessous, GATE LOT 4B §3) :
// le message renvoyé pour tout échec autre qu'une AdvisoryError/ValidationError
// (donc pour TOUTE ligne `advisory_rule_executions.status = 'failed'`,
// puisque `recordFailedExecution` n'est jamais appelée pour ces deux
// dernières -- voir le bloc catch d'`executeRuleSetForSession`) doit rester
// EXACTEMENT le même texte générique, qu'il soit lu juste après le lancement
// (résultat de `executeApplicableRuleSetsForSession`) ou relu plus tard sur
// un rechargement de la projection (`resolveDomainAnalysisState`) -- jamais
// le détail brut réellement stocké en base (`error_message`, potentiellement
// technique/SQL), qui lui reste réservé au diagnostic serveur.
const GENERIC_DOMAIN_FAILURE_MESSAGE = 'Une erreur inattendue est survenue pendant cette exécution ; elle a été tracée côté serveur.';
function domainFailureMessage(err) {
  if (err instanceof AdvisoryError || err instanceof ValidationError) return err.message;
  return GENERIC_DOMAIN_FAILURE_MESSAGE;
}

// GATE LOT 4B §7 (revue advisory-architect) : PAS d'atomicité globale entre
// domaines — chaque domaine garde sa PROPRE transaction indépendante,
// exactement comme des appels manuels répétés à `executeRuleSetForSession`.
// Une atomicité globale (SAVEPOINT imbriqué autour de tous les domaines)
// casserait la garantie « toujours tracer, jamais silencieux » de
// `recordFailedExecution`, et transformerait à tort un état parfaitement
// normal (« aucun ensemble de règles publié pour ce domaine ») en motif
// d'annulation de tout le reste. Retourne un résultat STRUCTURÉ par
// domaine — à l'appelant (route, UI) de lire `status` domaine par domaine ;
// ne JAMAIS présenter un résultat partiel comme une analyse complète.
//
// Les préconditions communes à la SESSION (statut, foyer archivé, révision
// attendue) sont vérifiées AVANT LA BOUCLE, une première fois : si la
// session elle-même n'est pas exécutable, l'appel entier est rejeté
// (409/400) sans qu'aucun domaine ne soit tenté. Chaque appel à
// `executeRuleSetForSession` ci-dessous revérifie ensuite les mêmes
// préconditions par construction (fonction partagée, jamais dupliquée) —
// une revérification intentionnellement redondante, jamais un risque
// d'incohérence : rien ne peut changer la session entre deux domaines
// (transaction synchrone, aucune écriture sur `advisory_sessions` par une
// exécution). Seule l'absence de rule_set PUBLIÉ reste réellement
// spécifique à chaque domaine (`skipped_no_published_rule_set`) : ce n'est
// jamais une erreur, un domaine peut légitimement n'avoir encore aucun
// ensemble de règles publié.
export function executeApplicableRuleSetsForSession(sessionId, expectedRevision, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  assertSessionExecutable(session, household, expectedRevision);

  const domains = allowedExecutionDomainsForSession(session.domain);
  return domains.map((domain) => {
    // Un domaine déjà pinné (première exécution réussie antérieure) doit
    // IMPÉRATIVEMENT être ré-exécuté avec son rule_set déjà figé, jamais
    // avec la dernière version publiée du domaine (reproductibilité,
    // `resolvePinnedRuleSetId`) — sans cette vérification préalable, fournir
    // ici la dernière publication en date romprait à tort le pin avec un
    // 409 « déjà lié à un autre ensemble » dès qu'une nouvelle version a été
    // publiée depuis, alors qu'une simple relance après amendement doit
    // rester silencieusement compatible.
    const alreadyPinned = db
      .prepare("SELECT rule_set_id FROM advisory_rule_executions WHERE session_id = ? AND domain = ? AND status = 'completed' ORDER BY id ASC LIMIT 1")
      .get(sessionId, domain);
    let ruleSetIdToUse;
    if (!alreadyPinned) {
      // Au plus un ensemble publié par domaine, garanti par l'index unique
      // partiel `idx_advisory_rule_sets_one_published_per_domain`
      // (migration 11) — jamais besoin de choisir parmi plusieurs.
      const published = listRuleSets({ domain, status: 'published' });
      if (published.length === 0) return { domain, status: 'skipped_no_published_rule_set' };
      ruleSetIdToUse = published[0].id;
    }
    try {
      const result = executeRuleSetForSession(sessionId, domain, expectedRevision, req, { rule_set_id: ruleSetIdToUse });
      return { domain, status: 'completed', execution_id: result.execution_id, findings_count: result.findings_count };
    } catch (err) {
      return { domain, status: 'failed', error: domainFailureMessage(err) };
    }
  });
}

// --- Lecture -------------------------------------------------------------

// Consultation de données SENSIBLES (revue compliance-privacy-reviewer,
// GATE LOT 4A) : ni un finding ni une exécution n'est jamais sensible « en
// soi » — c'est un critère DÉRIVÉ de la traçabilité déjà exigée
// (`used_inputs_ref`/`inputs_snapshot`) : si au moins une réponse
// effectivement utilisée provient d'une question marquée `sensitive = true`
// (Lot 3A), la LECTURE est elle-même une consultation de donnée sensible et
// doit être journalisée distinctement — jamais seulement une consultation
// générique. Même fenêtre de déduplication que `auditWorkspaceView` (GATE
// LOT 3B §6, même politique à reconfirmer par le responsable protection des
// données avant toute utilisation avec des données réelles) : un
// rafraîchissement répété de l'écran ne doit pas produire des centaines de
// lignes quasi identiques. Appliquée uniformément aux QUATRE routes de
// lecture exposant ce type de référence (`listExecutions`,
// `getExecutionDetail`, `listActiveFindings`, `listFindingsHistory`) —
// constat GATE LOT 4A (revue compliance-privacy-reviewer) : les deux
// premières ne l'appliquaient initialement pas, brèche corrigée.
const SENSITIVE_DATA_VIEW_DEDUP_MINUTES = 15;

// GATE LOT 4A §4 (revue compliance-privacy-reviewer) : la décision d'audit
// « consultation findings sensibles » se fonde EXCLUSIVEMENT sur le drapeau
// `sensitivity_at_execution` déjà figé dans `used_inputs_ref` au moment même
// de l'exécution (voir `buildUsedInputsRef` ci-dessus) — plus aucune requête
// en direct sur `advisory_questions.sensitive` ici. Une reclassification
// ultérieure d'une question (sensible <-> non-sensible) ne change donc
// jamais rétroactivement la décision d'audit d'une exécution historique.
function hasFrozenSensitiveRefInFindings(findings) {
  return findings.some((f) => (f.used_inputs_ref || []).some((ref) => ref.kind === 'answer' && ref.sensitivity_at_execution === true));
}

// Une entrée `entries: []` signifie que la question était référencée par une
// règle mais qu'aucune réponse n'existait encore pour elle — aucune valeur
// sensible n'a alors été effectivement consultée, jamais comptée ici.
function hasFrozenSensitiveRefInSnapshot(snapshot) {
  if (!snapshot) return false;
  return (snapshot.answers_used || []).some((a) => a.sensitivity_at_execution === true && Array.isArray(a.entries) && a.entries.length > 0);
}

function auditSensitiveDataAccessIfNeeded(req, sessionId, domain, hasSensitiveInput) {
  if (!hasSensitiveInput) return;
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation findings sensibles'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${SENSITIVE_DATA_VIEW_DEDUP_MINUTES} minutes`);
  if (recent) return;
  audit(req, 'consultation findings sensibles', 'advisory_session', sessionId, domain || '');
}

export function listExecutions(sessionId, { domain } = {}, req) {
  requireSession(sessionId);
  let sql = 'SELECT * FROM advisory_rule_executions WHERE session_id = ?';
  const params = [sessionId];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  sql += ' ORDER BY id DESC';
  const executions = db.prepare(sql).all(...params).map((r) => ({ ...r, inputs_snapshot: r.inputs_snapshot ? JSON.parse(r.inputs_snapshot) : null }));
  const hasSensitive = executions.some((e) => hasFrozenSensitiveRefInSnapshot(e.inputs_snapshot));
  auditSensitiveDataAccessIfNeeded(req, sessionId, domain, hasSensitive);
  return executions;
}

function parseFinding(r) {
  return {
    ...r,
    missing_data: r.missing_data ? JSON.parse(r.missing_data) : null,
    warnings: r.warnings ? JSON.parse(r.warnings) : [],
    contraindications: r.contraindications ? JSON.parse(r.contraindications) : [],
    used_inputs_ref: r.used_inputs_ref ? JSON.parse(r.used_inputs_ref) : [],
    conflicts_with: r.conflicts_with ? JSON.parse(r.conflicts_with) : [],
    conflicts_detected_at_execution: r.conflicts_detected_at_execution ? JSON.parse(r.conflicts_detected_at_execution) : [],
  };
}

// Vérifie que l'exécution appartient bien à LA session dont l'appelant
// affirme faire partie — même principe que `getQuestionForSession` (Lot
// 3A) : jamais un identifiant technique consultable indépendamment de son
// rattachement réel (IDOR), même si l'exécution existe bel et bien en
// base sous un autre identifiant de session.
export function getExecutionDetail(sessionId, executionId, req) {
  const execution = db.prepare('SELECT * FROM advisory_rule_executions WHERE id = ?').get(executionId);
  if (!execution || execution.session_id !== Number(sessionId)) return null;
  const rows = db.prepare(`SELECT * FROM advisory_findings f WHERE f.rule_execution_id = ? ORDER BY ${FINDINGS_ORDER_BY}`).all(executionId);
  // Même hydratation groupée que `getSessionFindingsWorkspace` (constat
  // GATE LOT 4B, revue advisory-architect) : cette route reste réutilisée
  // telle quelle par l'historique des analyses de l'espace conseiller des
  // findings (`HistoryModal`, `client/src/pages/SessionFindings.jsx`) — sans
  // cette hydratation, l'écran d'historique dégradait silencieusement
  // l'auteur d'un écartement et le texte de question en repli générique,
  // précisément sur l'écran dont la traçabilité est la raison d'être.
  const session = requireSession(sessionId);
  const membersById = new Map(sessionMembersFor(session).map((m) => [m.id, m]));
  // Projection MINIMALE (GATE LOT 7B ciblé §6, revue compliance-privacy-reviewer
  // finale) : même défaut que celui déjà corrigé sur `getSessionFindingsWorkspace`
  // -- `HistoryModal` (`SessionFindings.jsx`) rend `detail.findings` via le
  // MÊME composant `FindingCard` que l'écran principal, qui ne lit jamais que
  // `id`/`display_name`/`member_role`/`historical`. `client_id`/
  // `current_status`/`no_longer_active`/`can_answer` n'ont ici aucun usage
  // frontend, jamais transmis sans besoin réel.
  const findings = hydrateFindingRows(rows, sessionId).map((f) => {
    const fullMember = f.household_member_id != null ? membersById.get(f.household_member_id) : null;
    const member = fullMember ? { id: fullMember.id, display_name: fullMember.display_name, member_role: fullMember.member_role, historical: fullMember.historical } : null;
    return { ...f, member };
  });
  const inputsSnapshot = execution.inputs_snapshot ? JSON.parse(execution.inputs_snapshot) : null;
  const hasSensitive = hasFrozenSensitiveRefInFindings(findings) || hasFrozenSensitiveRefInSnapshot(inputsSnapshot);
  auditSensitiveDataAccessIfNeeded(req, execution.session_id, execution.domain, hasSensitive);
  return { ...execution, inputs_snapshot: inputsSnapshot, findings };
}

// Ordre de priorité partagé par les routes de lecture de findings (constat
// GATE LOT 4A, revue client-meeting-ux : un même ensemble de findings ne
// doit jamais s'afficher dans un ordre différent selon l'écran qui
// l'interroge) — étendu au LOT 4B §11 (revue rules-engine-auditor) :
// 1. conflits actifs (`needs_review`) d'abord, puis 2. `critical` > 3. `high`
// > 4. `medium` > 5. `low`, puis `sort_order` (ordre d'auteur), puis `id`
// (déterminisme total en cas d'égalité). Le tri reste entièrement calculé
// côté serveur : aucun écran ne doit ré-ordonner ce résultat différemment
// sans le documenter explicitement (source de vérité serveur).
const FINDINGS_ORDER_BY = `
  f.needs_review DESC,
  f.priority = 'critical' DESC, f.priority = 'high' DESC, f.priority = 'medium' DESC, f.sort_order, f.id`;

// Findings ACTIFS : uniquement `status = 'active'` (jamais `!= 'superseded'`,
// qui laisserait à tort réapparaître un finding déjà écarté par le
// conseiller — `dismissed` n'est pas plus « actif » que `superseded`). La
// jointure sur `advisory_rule_executions.superseded_by_execution_id IS NULL`
// reste une garde redondante mais volontairement conservée : le statut du
// finding est déjà mis à jour au moment même de la supersession (jamais
// désynchronisé), mais la double vérification documente explicitement
// l'invariant plutôt que de reposer silencieusement sur une seule colonne.
export function listActiveFindings(sessionId, { domain } = {}, req) {
  requireSession(sessionId);
  let sql = `
    SELECT f.* FROM advisory_findings f
    JOIN advisory_rule_executions e ON e.id = f.rule_execution_id
    WHERE f.session_id = ? AND e.superseded_by_execution_id IS NULL AND f.status = 'active'`;
  const params = [sessionId];
  if (domain) { sql += ' AND f.domain = ?'; params.push(domain); }
  sql += ` ORDER BY ${FINDINGS_ORDER_BY}`;
  const findings = db.prepare(sql).all(...params).map(parseFinding);
  auditSensitiveDataAccessIfNeeded(req, sessionId, domain, hasFrozenSensitiveRefInFindings(findings));
  return findings;
}

export function listFindingsHistory(sessionId, { domain } = {}, req) {
  requireSession(sessionId);
  audit(req, 'consultation historique findings', 'advisory_session', sessionId, domain || 'tous domaines');
  let sql = 'SELECT * FROM advisory_findings WHERE session_id = ?';
  const params = [sessionId];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  sql += ' ORDER BY id DESC';
  const findings = db.prepare(sql).all(...params).map(parseFinding);
  // Constat GATE LOT 4A (revue compliance-privacy-reviewer) : cette route
  // n'appelait initialement jamais la vérification dérivée « consultation
  // findings sensibles », contrairement à `listActiveFindings`/
  // `getExecutionDetail` qui exposent le même type de référence
  // (`used_inputs_ref`) — corrigé pour rester cohérent, l'historique complet
  // (tous statuts, y compris déjà écartés/supersédés) n'a aucune raison
  // d'échapper à cette vigilance.
  auditSensitiveDataAccessIfNeeded(req, sessionId, domain, hasFrozenSensitiveRefInFindings(findings));
  return findings;
}

function getFinding(id) {
  return db.prepare('SELECT * FROM advisory_findings WHERE id = ?').get(id);
}

// GATE LOT 4A §5 (revue rules-engine-auditor) : `conflicts_detected_at_
// execution` est le constat HISTORIQUE et IMMUABLE figé à la production de
// l'exécution (jamais réécrit ici) ; `conflicts_with`/`needs_review` sont
// l'état ACTIF courant, recalculés à chaque écartement à partir de ce même
// constat historique restreint aux findings encore `active` — jamais une
// recommandation automatique, seulement la disparition d'un recoupement qui
// n'a effectivement plus lieu d'être signalé une fois l'un des deux findings
// écarté par le conseiller. Un finding qui n'est plus lui-même actif
// (dismissed/superseded) n'a plus besoin d'être revu : son propre
// `needs_review` est remis à 0, mais sa trace historique
// (`conflicts_detected_at_execution`) ne bouge jamais.
function recomputeActiveConflicts(ruleExecutionId) {
  const rows = db.prepare('SELECT id, status, conflicts_detected_at_execution FROM advisory_findings WHERE rule_execution_id = ?').all(ruleExecutionId);
  const activeIds = new Set(rows.filter((r) => r.status === 'active').map((r) => r.id));
  for (const row of rows) {
    const original = row.conflicts_detected_at_execution ? JSON.parse(row.conflicts_detected_at_execution) : [];
    if (original.length === 0) continue;
    if (row.status !== 'active') {
      db.prepare('UPDATE advisory_findings SET needs_review = 0 WHERE id = ?').run(row.id);
      continue;
    }
    const stillConflicting = original.filter((id) => activeIds.has(id));
    db.prepare('UPDATE advisory_findings SET conflicts_with = ?, needs_review = ? WHERE id = ?')
      .run(JSON.stringify(stillConflicting), stillConflicting.length > 0 ? 1 : 0, row.id);
  }
}

export function dismissFinding(sessionId, findingId, { dismiss_reason, expected_revision } = {}, req) {
  const finding = getFinding(findingId);
  if (!finding || finding.session_id !== Number(sessionId)) throw new AdvisoryError('Finding introuvable pour cette session.', 404);
  const session = requireSession(finding.session_id);
  // Même garde que `executeRuleSetForSession` (constat GATE LOT 4A §12,
  // revue advisory-architect) : écarter un finding est une ÉCRITURE comme
  // une autre, jamais une lecture — un foyer archivé la refuse exactement
  // comme il refuse déjà toute nouvelle réponse, amendement ou exécution.
  const household = getHousehold(session.household_id);
  if (household && household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle activité n’est possible sur ses sessions.', 409);
  }
  assertExpectedRevision(session, expected_revision);
  if (finding.status !== 'active') throw new AdvisoryError(`Seul un finding actif peut être écarté (statut actuel : « ${finding.status} »).`, 409);
  assert(dismiss_reason && dismiss_reason.trim(), 'Le motif d’écartement est obligatoire.');
  assert(dismiss_reason.length <= 2000, 'Le motif dépasse 2000 caractères.');
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  db.transaction(() => {
    db.prepare(
      "UPDATE advisory_findings SET status = 'dismissed', dismiss_reason = ?, dismissed_by_user_id = ?, dismissed_at = datetime('now') WHERE id = ?"
    ).run(dismiss_reason, userId || null, findingId);
    recomputeActiveConflicts(finding.rule_execution_id);
  })();
  audit(req, 'finding écarté', 'advisory_session', finding.session_id, `${finding.stable_key} — ${finding.finding_type}`);
  return { ok: true };
}

// --- Projection « espace conseiller des findings » (LOT 4B) ----------------

// États résumés d'un domaine pour l'en-tête de l'écran des constats (§9) —
// TOUJOURS dérivés à la lecture, jamais une colonne stockée (même principe
// que `allowedActions` en Lot 3B, dérivé de TRANSITIONS) :
// - `no_rule_set_available` : aucune exécution complétée pour ce domaine
//   sur cette session ET aucun ensemble de règles publié pour en lancer une
//   première -- un état parfaitement normal (un domaine facultatif, ou pas
//   encore équipé), jamais présenté comme une erreur.
// - `not_yet_run` : aucune exécution complétée pour ce domaine, mais un
//   ensemble de règles est publié -- un lancement est possible. Dans cet
//   état, `hasEverCompleted` est nécessairement faux lui aussi (constat
//   GATE LOT 4B, revue rules-engine-auditor) : la chaîne de supersession
//   garantit qu'une exécution complétée n'est JAMAIS orpheline (la
//   dernière du couple session/domaine n'a, par construction, jamais de
//   `superseded_by_execution_id` tant qu'aucune nouvelle ne l'a remplacée)
//   -- il ne peut donc pas exister de domaine « déjà pinné mais jamais
//   réussi » distinct de ce cas.
// - `up_to_date` : la dernière exécution complétée porte la révision
//   COURANTE de la session -- rien n'a changé depuis.
// - `stale` : la session a été amendée (`amendAnswer`) depuis cette
//   dernière exécution -- une relance est SUGGÉRÉE, jamais automatique
//   (§7.5) : les findings affichés restent ceux de la dernière exécution
//   réussie jusqu'à ce que le conseiller relance explicitement l'analyse.
function resolveDomainAnalysisState(sessionId, domain, sessionRevision) {
  const lastCompleted = db
    .prepare("SELECT * FROM advisory_rule_executions WHERE session_id = ? AND domain = ? AND status = 'completed' AND superseded_by_execution_id IS NULL ORDER BY id DESC LIMIT 1")
    .get(sessionId, domain);
  const lastAny = db
    .prepare('SELECT id, status FROM advisory_rule_executions WHERE session_id = ? AND domain = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId, domain);
  const hasEverCompleted = !!db
    .prepare("SELECT 1 FROM advisory_rule_executions WHERE session_id = ? AND domain = ? AND status = 'completed' LIMIT 1")
    .get(sessionId, domain);
  // Au plus un ensemble publié par domaine (index unique partiel, migration
  // 11) -- une simple présence suffit, jamais besoin d'en choisir un.
  const hasPublished = listRuleSets({ domain, status: 'published' }).length > 0;
  const canLaunch = hasEverCompleted || hasPublished;

  let state;
  if (!lastCompleted) state = canLaunch ? 'not_yet_run' : 'no_rule_set_available';
  else state = lastCompleted.session_revision === sessionRevision ? 'up_to_date' : 'stale';

  const lastAttemptFailed = !!(lastAny && lastAny.status === 'failed' && (!lastCompleted || lastAny.id > lastCompleted.id));

  return {
    state,
    can_launch: canLaunch,
    // Statut de publication ACTUEL et RIEN d'autre (jamais « a déjà été
    // publié un jour ») -- distinct de `state`, qui, lui, dérive de la
    // dernière exécution COMPLÉTÉE indépendamment de son statut de
    // publication courant (une exécution reste valide même après archivage
    // du rule_set qui l'a produite, reproductibilité oblige). Ce champ sert
    // spécifiquement à trancher l'APPLICABILITÉ de `common` à l'analyse
    // COURANTE (MICRO-GATE LOT 4B, correction humaine finale) : un rule_set
    // `common` seulement archivé ne doit jamais rendre ce domaine
    // « applicable », même si une exécution passée (via ce même rule_set,
    // avant son archivage) reste `up_to_date`/`stale` au sens de `state`.
    has_published_rule_set: hasPublished,
    last_execution: lastCompleted
      ? {
          id: lastCompleted.id,
          ended_at: lastCompleted.ended_at,
          session_revision: lastCompleted.session_revision,
          rules_evaluated_count: lastCompleted.rules_evaluated_count,
          findings_count: lastCompleted.findings_count,
          rule_set_id: lastCompleted.rule_set_id,
          rule_set_version_number: lastCompleted.rule_set_version_number,
          content_hash: lastCompleted.content_hash,
          engine_version: lastCompleted.engine_version,
        }
      : null,
    // Un DERNIER essai en échec, plus récent que la dernière exécution
    // complétée (ou en l'absence de toute exécution complétée) -- jamais
    // masqué : le conseiller doit savoir qu'un lancement a été tenté et a
    // échoué, même si ce domaine affiche par ailleurs `not_yet_run`/`stale`.
    last_attempt_failed: lastAttemptFailed,
    // Erreur MINIMISÉE (GATE LOT 4B §3) : jamais le contenu brut de
    // `advisory_rule_executions.error_message` (potentiellement technique,
    // voir `recordFailedExecution`) -- seulement le même texte générique
    // sûr que la réponse de lancement elle-même (`domainFailureMessage`),
    // pour que ce champ reste identique qu'il soit lu juste après le
    // lancement ou relu plus tard sur un rechargement de la page. `null`
    // quand aucune tentative récente n'a échoué.
    last_attempt_error: lastAttemptFailed ? GENERIC_DOMAIN_FAILURE_MESSAGE : null,
  };
}

// État global agrégé (GATE LOT 4B §3, affiné par le MICRO-GATE §3 --
// décision humaine confirmée) : DISTINCT de `state` par domaine ci-dessus --
// combine les états des domaines APPLICABLES à ce calcul en une seule
// valeur résumée pour l'en-tête de l'écran des constats. Priorité stricte,
// la première règle qui s'applique l'emporte -- jamais recalculée
// différemment ailleurs (même principe que `FINDINGS_ORDER_BY` : une seule
// source de vérité, jamais un second calcul divergent côté client).
//
// « Applicable » (voir l'appelant, `getSessionFindingsWorkspace`) désigne
// TOUJOURS les domaines REQUIS par le type de session
// (`requiredDomainsForSession`), PLUS `common` SI ET SEULEMENT SI un
// ensemble de règles lui a déjà été publié pour cette session (`state !==
// 'no_rule_set_available'`) -- la facultativité de `common` ne signifie
// « son absence est acceptable » (exclu du calcul quand aucun ensemble ne
// lui a jamais été publié) et JAMAIS « un `common` existant peut échouer ou
// être obsolète sans affecter l'état global » (MICRO-GATE §3, correction
// humaine explicite) : dès qu'un ensemble `common` publié existe, ce
// domaine est traité EXACTEMENT comme un domaine requis par cette fonction
// -- aucune branche spéciale ci-dessous ne le traite différemment.
function resolveGlobalAnalysisState(applicableDomainStates) {
  if (applicableDomainStates.length === 0) return 'not_analyzed'; // vacuité défensive, ne devrait jamais survenir (chaque type de session a toujours >= 1 domaine requis)

  const everCompleted = (s) => !!s.last_execution;
  const isUpToDate = (s) => s.state === 'up_to_date';
  const isStale = (s) => s.state === 'stale';
  const isUnavailable = (s) => s.state === 'no_rule_set_available';
  const isNeverRun = (s) => s.state === 'not_yet_run';
  const hasFailed = (s) => !!s.last_attempt_failed;
  const isUsable = (s) => isUpToDate(s) || isStale(s);

  // 1. Aucun domaine applicable n'a JAMAIS été équipé du moindre ensemble
  // de règles publié -- rien n'est simplement possible pour cette session,
  // jamais confondu avec « pas encore lancé » (qui reste actionnable) --
  // règle GATE §3 explicite : « ensemble de règles spécialisé manquant ->
  // unavailable ».
  if (applicableDomainStates.every(isUnavailable)) return 'unavailable';

  // 2. Aucun domaine applicable n'a jamais complété la moindre exécution, et
  // aucune tentative n'a échoué -- point de départ normal d'une session tout
  // juste finalisée, jamais présenté comme une erreur.
  if (applicableDomainStates.every((s) => !everCompleted(s) && !hasFailed(s))) return 'not_analyzed';

  // 3. Tous les domaines applicables ont une exécution complétée à la
  // révision COURANTE (jamais un mélange de révisions différentes, règle
  // GATE §3 : ce contrôle par-domaine est déjà celui de
  // `resolveDomainAnalysisState` lui-même, jamais recalculé différemment
  // ici) et aucune tentative plus récente n'a échoué depuis -- seul cas
  // réellement « à jour ».
  if (applicableDomainStates.every((s) => isUpToDate(s) && !hasFailed(s))) return 'up_to_date';

  // 4. Aucun domaine applicable n'a JAMAIS produit le moindre résultat
  // exploitable (ni à jour, ni obsolète) alors qu'au moins une tentative a
  // échoué quelque part -- rien à montrer, un échec pur et sans issue de
  // secours (contrairement au cas 5 ci-dessous, où au moins un AUTRE
  // domaine applicable reste consultable).
  if (applicableDomainStates.every((s) => !isUsable(s)) && applicableDomainStates.some(hasFailed)) return 'error';

  // 5. Au moins un domaine applicable porte un résultat exploitable (à jour
  // ou obsolète) tandis qu'un AUTRE domaine applicable a échoué, n'a jamais
  // pu être équipé, ou n'a encore jamais été lancé -- couverture requise
  // incomplète. Règle GATE §3 explicite : « succès sur un domaine requis +
  // échec sur un autre = partiel » -- généralisée ici aux trois façons dont
  // un autre domaine applicable peut rester sans résultat exploitable
  // (échoué, jamais équipé, ou simplement jamais lancé), pas seulement
  // l'échec. Couvre aussi « common publié mais non exécuté alors qu'un
  // domaine spécialisé est à jour » (MICRO-GATE §3).
  if (applicableDomainStates.some(isUsable) && applicableDomainStates.some((s) => hasFailed(s) || isUnavailable(s) || isNeverRun(s))) return 'partial';

  // 6. Ce qui reste : tous les domaines applicables portent un résultat
  // exploitable, aucun n'a échoué, mais pas tous à jour (au moins un est
  // obsolète, sinon l'étape 3 aurait déjà conclu). Deux cas distingués
  // (MICRO-GATE §3, correction humaine explicite -- absent de la première
  // version de cette fonction, qui renvoyait uniformément `stale`) :
  // - AUCUN domaine applicable n'est à jour (tous obsolètes) -> `stale`,
  //   une relance est SUGGÉRÉE, jamais automatique ;
  // - AU MOINS UN domaine applicable est à jour pendant qu'un AUTRE reste
  //   obsolète (mélange) -> `partial`, la couverture n'est que
  //   partiellement à jour, jamais présentée comme simplement « obsolète »
  //   (qui donnerait à tort l'impression qu'AUCUNE partie n'est fiable).
  if (applicableDomainStates.some(isUpToDate)) return 'partial';
  return 'stale';
}

// Hydratation groupée (jamais requête par finding, constat GATE LOT 4B,
// revue advisory-architect) : `source`/`source_reference`/`effective_from`/
// `effective_until` ne vivent que sur `advisory_rules` (jamais dupliqués sur
// le finding, contrairement à `title`/`summary`/`advisor_explanation`) ; le
// nom d'un conseiller ayant écarté un finding, de même. Le texte de
// question (`advisor_text`) associé à chaque référence `used_inputs_ref` de
// type `answer` est également hydraté ici -- pour que le panneau de
// traçabilité affiche l'intitulé de la question réellement utilisée, jamais
// seulement un identifiant technique brut -- en réutilisant `buildQuestionIndex`
// (déjà appelé par le moteur d'exécution lui-même), jamais une résolution
// distincte.
//
// GATE LOT 4B (§2, navigation historique par answer_id) : trois champs
// supplémentaires, TOUS dérivés à la lecture (jamais dupliqués dans le JSON
// figé `used_inputs_ref`, qui reste la trace immuable écrite par
// `buildUsedInputsRef` à l'exécution) -- même principe que `advisor_text`
// ci-dessus. `question_stable_key` est un simple alias explicite de
// `stable_key` (déjà la clé stable de la QUESTION, pas de la règle) : exposé
// sous ce nom précis pour que le contrat de la projection soit sans
// ambiguïté. `section_id` permet au front de retrouver la section contenant
// la question sans requête supplémentaire. `is_current_answer` indique si
// `answer_id` désigne encore la ligne ACTIVE de `advisory_answers` pour ce
// couple (question, membre) -- `null` quand `answer_id` est lui-même absent
// (aucune réponse n'existait au moment de l'exécution, cas déjà normal et
// distinct d'une réponse depuis remplacée).
function hydrateFindingRows(findingRows, sessionId) {
  if (findingRows.length === 0) return [];
  const parsed = findingRows.map(parseFinding);
  const ruleIds = [...new Set(parsed.map((f) => f.rule_id))];
  const rulePlaceholders = ruleIds.map(() => '?').join(',');
  const ruleSourceById = new Map(
    db
      .prepare(`SELECT id, source, source_reference, effective_from, effective_until FROM advisory_rules WHERE id IN (${rulePlaceholders})`)
      .all(...ruleIds)
      .map((r) => [r.id, r])
  );

  const dismissedByIds = [...new Set(parsed.filter((f) => f.dismissed_by_user_id).map((f) => f.dismissed_by_user_id))];
  const dismissedByName = new Map();
  if (dismissedByIds.length > 0) {
    const placeholders = dismissedByIds.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).all(...dismissedByIds)) {
      dismissedByName.set(row.id, row.name);
    }
  }

  const byStableKey = buildQuestionIndex(sessionId);
  const byQuestionId = new Map([...byStableKey.values()].map((q) => [q.id, q]));

  const answerIds = [...new Set(
    parsed.flatMap((f) => f.used_inputs_ref).filter((r) => r.kind === 'answer' && r.answer_id != null).map((r) => r.answer_id)
  )];
  const currentAnswerIds = new Set();
  if (answerIds.length > 0) {
    const placeholders = answerIds.map(() => '?').join(',');
    for (const row of db
      .prepare(`SELECT id FROM advisory_answers WHERE id IN (${placeholders}) AND superseded_by_answer_id IS NULL`)
      .all(...answerIds)) {
      currentAnswerIds.add(row.id);
    }
  }

  return parsed.map((f) => {
    const ruleSource = ruleSourceById.get(f.rule_id) || {};
    return {
      ...f,
      source: ruleSource.source || null,
      source_reference: ruleSource.source_reference || null,
      effective_from: ruleSource.effective_from || null,
      effective_until: ruleSource.effective_until || null,
      dismissed_by_name: f.dismissed_by_user_id ? dismissedByName.get(f.dismissed_by_user_id) || null : null,
      used_inputs_ref: f.used_inputs_ref.map((ref) => {
        if (ref.kind !== 'answer') return ref;
        const q = ref.question_id != null ? byQuestionId.get(ref.question_id) : null;
        return {
          ...ref,
          advisor_text: q ? q.advisor_text : null,
          question_stable_key: ref.stable_key,
          section_id: q ? q.section_id : null,
          is_current_answer: ref.answer_id != null ? currentAnswerIds.has(ref.answer_id) : null,
        };
      }),
    };
  });
}

// Fenêtre de déduplication distincte de `auditWorkspaceView` (Lot 3B,
// server/advisorySessions.js) : cet écran (constats) est un écran
// DIFFÉRENT du workspace de saisie des réponses -- même politique de
// déduplication (15 minutes), jamais la même ligne d'action, pour que la
// traçabilité distingue toujours clairement lequel des deux écrans a été
// consulté (§25, aucune confusion entre les deux historiques).
const FINDINGS_WORKSPACE_VIEW_DEDUP_MINUTES = 15;
function auditFindingsWorkspaceView(req, sessionId, revision, status) {
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation espace constats session'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${FINDINGS_WORKSPACE_VIEW_DEDUP_MINUTES} minutes`);
  if (recent) return;
  audit(req, 'consultation espace constats session', 'advisory_session', sessionId, `révision ${revision} — ${status}`);
}

// Projection complète et prête à afficher pour l'espace conseiller des
// findings (LOT 4B, GET /api/advisory/sessions/:id/findings-workspace) --
// mirroir délibéré de `getSessionWorkspace` (Lot 3B, server/advisorySessions.js)
// dans son esprit (une fonction, un audit de consultation, un objet
// `actions` dérivé) mais un objet SÉPARÉ : ce lot ne modifie jamais la
// projection existante du workspace de réponses. `by_domain` groupe
// STRUCTURELLEMENT les résultats par domaine réel (jamais une liste
// interleaved) -- rend structurellement impossible un mélange accidentel de
// domaines à l'affichage (constat client-meeting-ux, GATE LOT 4B §5).
export function getSessionFindingsWorkspace(sessionId, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  const members = sessionMembersFor(session);
  const membersById = new Map(members.map((m) => [m.id, m]));

  const domains = allowedExecutionDomainsForSession(session.domain);
  const allFindingsForAudit = [];

  const byDomain = {};
  for (const domain of domains) {
    const state = resolveDomainAnalysisState(sessionId, domain, session.revision);
    let findings = [];
    if (state.last_execution) {
      const rows = db
        .prepare(`SELECT * FROM advisory_findings f WHERE f.rule_execution_id = ? ORDER BY ${FINDINGS_ORDER_BY}`)
        .all(state.last_execution.id);
      findings = hydrateFindingRows(rows, sessionId).map((f) => {
        // Le membre concerné est résolu via `sessionMembersFor` -- JAMAIS
        // une consultation directe de `household_members` (constat GATE
        // LOT 4B, revues rules-engine-auditor/compliance-privacy-reviewer :
        // risque d'IDOR si un membre appartenant à un AUTRE foyer était
        // consulté indépendamment de son rattachement réel à CETTE
        // session). Projection MINIMALE (GATE LOT 7B ciblé §6) : `id`/
        // `display_name`/`member_role`/`historical` sont ceux réellement
        // utiles (libellé, distinction principal/conjoint/enfant, filtre,
        // mention « retiré du foyer ») -- `client_id` (identifiant technique
        // interne), `current_status`/`no_longer_active` (doublons stricts
        // de `historical`) et `can_answer` (nécessaire ailleurs, à
        // `SessionWorkspace.jsx` pour le statut de réponse d'un membre,
        // sans usage ici) n'ont aucun usage frontend sur cet écran, jamais
        // transmis sans besoin réel.
        const fullMember = f.household_member_id != null ? membersById.get(f.household_member_id) : null;
        const member = fullMember ? { id: fullMember.id, display_name: fullMember.display_name, member_role: fullMember.member_role, historical: fullMember.historical } : null;
        return { ...f, member };
      });
      allFindingsForAudit.push(...findings);
    }
    byDomain[domain] = { domain, ...state, findings };
  }

  auditSensitiveDataAccessIfNeeded(req, sessionId, 'tous domaines applicables', hasFrozenSensitiveRefInFindings(allFindingsForAudit));
  auditFindingsWorkspaceView(req, sessionId, session.revision, session.status);

  // État global agrégé (GATE LOT 4B §3, affiné par deux corrections
  // humaines successives du MICRO-GATE §1/§3) -- porte sur les domaines
  // REQUIS par ce type de session, PLUS `common` SI ET SEULEMENT SI un
  // ensemble de règles `common` est ACTUELLEMENT publié pour cette session
  // (`has_published_rule_set`, dérivé à la lecture d'une requête `status =
  // 'published'` -- JAMAIS « un ensemble a déjà été publié un jour »,
  // correction humaine finale explicite). Un ensemble `common` seulement
  // ARCHIVÉ ne rend donc plus ce domaine applicable, même si une exécution
  // passée via ce même ensemble (avant son archivage) reste `up_to_date`/
  // `stale` au sens de `state` (reproductibilité : une exécution déjà
  // pinnée reste valide même après archivage de son rule_set, voir
  // `executeRuleSetForSession`) -- ces deux notions sont désormais
  // délibérément DÉCORRÉLÉES pour cette décision d'applicabilité. La
  // facultativité de `common` signifie « son absence (ou son
  // indisponibilité actuelle) est acceptable » et JAMAIS « un `common`
  // ACTUELLEMENT publié peut échouer/être obsolète sans affecter l'état
  // global » : dès qu'un ensemble `common` publié existe MAINTENANT, ce
  // domaine entre dans le calcul EXACTEMENT comme un domaine requis.
  const requiredDomains = requiredDomainsForSession(session.domain);
  const commonApplicable = !!(byDomain.common && byDomain.common.has_published_rule_set);
  const applicableDomainsForGlobalState = commonApplicable ? ['common', ...requiredDomains] : requiredDomains;
  const globalState = resolveGlobalAnalysisState(applicableDomainsForGlobalState.map((d) => byDomain[d]));

  // Synthèse ACTIVE (GATE LOT 4B §3) : les tuiles/compteurs PRINCIPAUX ne
  // doivent jamais sommer que les findings actifs d'exécutions COMPLETED à
  // la révision COURANTE de domaines eux-mêmes courants -- un domaine
  // `stale` reste consultable dans son propre onglet (`by_domain[d].findings`
  // n'est jamais vidé), mais ses findings ne sont jamais additionnés dans ce
  // total-ci (jamais un mélange silencieux de révisions différentes dans un
  // même chiffre agrégé). Porte sur TOUS les domaines applicables -- pour
  // les domaines REQUIS, `state === 'up_to_date'` suffit (ils comptent
  // toujours, publiés ou non n'a pas de sens pour un domaine requis) ; pour
  // `common` spécifiquement, la même condition d'applicabilité ACTUELLE que
  // pour `global_state` s'applique en plus (`commonApplicable`, MICRO-GATE
  // §1) -- un `common` dont le dernier rule_set utilisé a depuis été
  // archivé (sans republication) ne doit plus jamais alimenter ce total,
  // même si son `state` affiche encore `up_to_date` au sens strict de la
  // révision. Distincte de `globalState` ci-dessus, qui, elle, ne regarde
  // que les domaines requis (+ common si applicable).
  const synthesis = { active_findings_count: 0, active_conflicts_count: 0, domains_current: [], domains_excluded_stale: [] };
  for (const domain of domains) {
    const d = byDomain[domain];
    const countsTowardSynthesis = d.state === 'up_to_date' && (domain !== 'common' || commonApplicable);
    if (countsTowardSynthesis) {
      synthesis.domains_current.push(domain);
      synthesis.active_findings_count += d.findings.filter((f) => f.status === 'active').length;
      synthesis.active_conflicts_count += d.findings.filter((f) => f.status === 'active' && f.needs_review).length;
    } else if (d.findings.length > 0) {
      synthesis.domains_excluded_stale.push(domain);
    }
  }

  const advisor = db.prepare('SELECT name FROM users WHERE id = ?').get(session.advisor_user_id);
  const primaryClient = db.prepare('SELECT * FROM clients WHERE id = ?').get(household.primary_client_id);

  return {
    session: {
      id: session.id,
      status: session.status,
      domain: session.domain,
      title: session.title,
      revision: session.revision,
      completed_at: session.completed_at,
      advisor_name: advisor ? advisor.name : null,
    },
    household: {
      id: household.id,
      label: household.label,
      primary_display_name: displayName(primaryClient),
      status: household.status,
      members,
    },
    by_domain: byDomain,
    global_state: globalState,
    synthesis,
    // Dérivées, jamais une seconde source de vérité (même principe que
    // `allowedActions` en Lot 3B) : `can_launch_analysis` couvre
    // `executeApplicableRuleSetsForSession` (préconditions de session
    // partagées, `assertSessionExecutable`) ; `can_dismiss_findings` couvre
    // `dismissFinding` (un foyer archivé refuse déjà l'écriture là-bas,
    // reflété ici pour que le bouton n'apparaisse jamais activé à tort).
    // `can_create_recommendation` (GATE LOT 7B ciblé §2B) réutilise
    // EXACTEMENT le même prédicat `isSessionWritable` que
    // `server/advisorySessions.js` (`recommendation_capabilities.create`)
    // et `server/advisoryRecommendations.js` (`assertSessionWritable`,
    // `computeAllowedActions`) -- `SessionFindings.jsx` recalculait
    // jusqu'ici cette même capacité de son côté à partir de
    // `household.status`, une duplication de la même classe que celle déjà
    // corrigée pour `SessionRecommendations.jsx`.
    actions: {
      can_launch_analysis: session.status === 'completed' && household.status !== 'archive',
      can_dismiss_findings: household.status !== 'archive',
      can_create_recommendation: isSessionWritable(session, household),
    },
  };
}

export { EXECUTION_STATUSES, EXECUTION_MODES };
