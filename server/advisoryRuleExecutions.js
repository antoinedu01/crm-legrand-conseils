// Service métier — exécution du moteur de règles sur une session et lecture
// des findings produits (Legrand Diagnostic 360, Lot 4A). Isolé de
// `server/advisoryRules.js` (cycle de vie des règles) exactement comme
// `server/advisorySessions.js` est isolé de `server/advisoryQuestionnaires.js`
// (Lot 3A) : ce module ne modifie JAMAIS une règle ni un rule_set, il ne fait
// que les LIRE et les ÉVALUER contre l'état figé d'une session.

import db from './db.js';
import { assert, inEnum, ValidationError } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError } from './advisoryHouseholds.js';
import { evaluateRuleCondition, refKind, resolveQuantifierMembers } from './advisoryRuleConditions.js';
import { sessionMembersFor, answerValueFor } from './advisorySessions.js';
import { getVersionDetail } from './advisoryQuestionnaires.js';
import { getRuleSetDetail, RULE_SET_DOMAINS } from './advisoryRules.js';

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
  if (!ELIGIBLE_SESSION_STATUSES.includes(session.status)) {
    throw new AdvisoryError(`Aucune exécution du moteur de règles n'est possible sur une session « ${session.status} ».`, 409);
  }
  const household = getHousehold(session.household_id);
  if (household && household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle activité n’est possible sur ses sessions.', 409);
  }
  assertExpectedRevision(session, expectedRevision);

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
              const row = answerIndex.get(`${q.id}|${m.id}`);
              return !!(row && row.status === 'answered');
            });
          }
          const row = answerIndex.get(`${q.id}|household`);
          return !!(row && row.status === 'answered');
        }
        if (kind === 'contract_branch') return getContractBranchStatus(ref.contract_branch) != null;
        return false;
      }

      function structuredDataRef(ref) {
        const kind = refKind(ref);
        if (kind === 'answer') {
          const q = byStableKey.get(ref.answer);
          return { kind: 'answer', stable_key: ref.answer, question_id: q ? q.id : null };
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

      for (const rule of orderedRules) {
        const refs = collectAllRefs(rule.conditions);
        for (const k of refs.answerKeys) usedAnswerKeysGlobal.add(k);
        for (const b of refs.contractBranches) usedContractBranchesGlobal.add(b);

        const missing = rule.required_data.filter((ref) => !isRequiredDataPresent(ref)).map(structuredDataRef);

        if (missing.length > 0) {
          findingsInMemory.push({
            rule, finding_type: 'missing_information', priority: rule.priority,
            title: `Information manquante pour : ${rule.title}`,
            summary: `Cette règle ne peut pas conclure : ${missing.length} donnée(s) manquante(s).`,
            advisor_explanation: `La règle « ${rule.stable_key} » ne peut pas être évaluée : des données requises sont manquantes. Contexte de la règle : ${rule.advisor_explanation}`,
            client_explanation: null, missing_data: missing, warnings: [], contraindications: [],
            used_inputs_ref: [], result_payload: null, household_member_id: null,
          });
          continue;
        }

        const triggered = evaluateRuleCondition(rule.conditions, context);
        ruleResults[rule.stable_key] = triggered;
        if (!triggered) continue;

        // finding_scope = member (GATE LOT 4A §3) : un finding DISTINCT par
        // membre correspondant réellement à la condition, jamais une
        // attribution arbitraire — `resolveQuantifierMembers` identifie ces
        // membres de façon déterministe à partir du quantificateur racine
        // déjà vérifié à la publication (`validateRuleSetForPublish`).
        // `session`/`household` restent un unique finding agrégé, comme
        // avant, `household_member_id` toujours NULL.
        if (rule.finding_scope === 'member') {
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
      const byCategory = new Map();
      findingsInMemory.forEach((f, idx) => {
        const cat = f.result_payload?.category_hint;
        if (!cat) return;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(idx);
      });
      const conflictGroups = new Map(); // idx -> [other idx...]
      for (const [, idxs] of byCategory) {
        if (idxs.length > 1) for (const i of idxs) conflictGroups.set(i, idxs.filter((j) => j !== i));
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
  const findings = db.prepare(`SELECT * FROM advisory_findings f WHERE f.rule_execution_id = ? ORDER BY ${FINDINGS_ORDER_BY}`).all(executionId).map(parseFinding);
  const inputsSnapshot = execution.inputs_snapshot ? JSON.parse(execution.inputs_snapshot) : null;
  const hasSensitive = hasFrozenSensitiveRefInFindings(findings) || hasFrozenSensitiveRefInSnapshot(inputsSnapshot);
  auditSensitiveDataAccessIfNeeded(req, execution.session_id, execution.domain, hasSensitive);
  return { ...execution, inputs_snapshot: inputsSnapshot, findings };
}

// Ordre de priorité partagé par les 3 routes de lecture de findings (constat
// GATE LOT 4A, revue client-meeting-ux : un même ensemble de findings ne
// doit jamais s'afficher dans un ordre différent selon l'écran qui
// l'interroge) — `critical` > `high` > `medium` > `low`, puis `sort_order`
// (ordre d'auteur), puis `id` (déterminisme total en cas d'égalité).
const FINDINGS_ORDER_BY = `
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

export { EXECUTION_STATUSES, EXECUTION_MODES };
