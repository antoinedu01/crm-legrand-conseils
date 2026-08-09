// Moteur de synthèse Santé pur (SYNTH-BE1, Legrand Diagnostic 360) —
// première brique du futur `buildHealthSynthesis`. Décision humaine
// verrouillée : ce module est STRICTEMENT read-only (aucun audit_log, aucune
// écriture, aucune transaction), ne calcule aucune recommandation, ne
// produit aucune action d'interface, et ne connaît RIEN des contrats
// (LAMal/LCA), assureurs, produits, primes ou tarifs. Il ne fait que
// projeter les réponses déclarées + les findings Santé déjà produits par le
// moteur de règles (`server/advisoryRuleExecutions.js`) en un DTO
// déterministe, membre par membre.
//
// Ne reproduit JAMAIS un second moteur de conditions ni de projection :
// réutilise `getProjectedSessionFindings` (SYNTH-T) pour session/foyer/
// membres/état d'analyse/findings, `evaluateCondition`
// (`server/advisoryConditions.js`) pour la visibilité des questions
// conditionnelles, `getVersionDetail`/`listActiveAnswers` (déjà exportées et
// pures) pour les réponses courantes du questionnaire. N'utilise JAMAIS
// `rule_result`/`getRuleResult` pour une conclusion membre (ce résultat est
// un booléen PAR EXÉCUTION, jamais par membre — contaminerait les membres
// entre eux dans un foyer à plusieurs personnes, exactement le risque déjà
// documenté dans `server/seed-advisory-health-content.js`).
//
// Périmètre de version supporté (première version de ce moteur) :
// UNIQUEMENT `diagnostic-sante-phase1` v2 / `regles-sante-phase1` v2 — une
// session dont le questionnaire Santé ou la dernière exécution Santé
// utilise une autre version est refusée explicitement (§ VERSION GUARD
// ci-dessous), jamais traitée de façon approximative ni rétroactive.

import db from './db.js';
import { AdvisoryError } from './advisoryHouseholds.js';
import { evaluateCondition } from './advisoryConditions.js';
import { getVersionDetail } from './advisoryQuestionnaires.js';
import { getRuleSetDetail } from './advisoryRules.js';
import { listActiveAnswers } from './advisorySessions.js';
import { getProjectedSessionFindings } from './advisoryRuleExecutions.js';
import { QUESTIONNAIRE_STABLE_KEY, RULE_SET_STABLE_KEY } from './seed-advisory-health-content.js';

export const SYNTHESIS_VERSION = 1;
export const SUPPORTED_QUESTIONNAIRE_VERSION = 2;
export const SUPPORTED_RULE_SET_VERSION = 2;
export const HEALTH_SYNTHESIS_UNSUPPORTED_VERSION = 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION';

// -----------------------------------------------------------------------
// CATEGORY_HINT_MAPPING — table exhaustive et unique source de vérité des
// 34 `category_hint` distincts produits par les 37 règles de
// `regles-sante-phase1` v2 (contrôlée par un test dédié, « garde de
// couverture », qui échoue explicitement si un hint réel n'y figure pas).
// Chaque entrée documente la destination STRUCTURELLE du finding dans le
// DTO — jamais utilisée pour réinterpréter la valeur ni le texte d'un
// finding, seulement pour savoir OÙ le ranger. Deux natures :
//   - kind: 'warning'  → un avertissement poussé dans <path>.warnings (le
//     tableau désigné par `path`), avec le `code` donné ;
//   - kind: 'field'    → une conclusion qui remplace la valeur du champ
//     désigné par `path`, avec la `value` donnée.
// `care_model_medecin-famille_*` : le hint RÉEL produit par
// `careModelTriplet('ouverture_medecin_famille_declaree', 'medecin-famille', …)`
// (`server/seed-advisory-health-content.js`) contient un TIRET au milieu
// (`medecin-famille`), jamais un tiret bas — écart avec la convention du
// reste des hints (mots séparés par `_`), confirmé par lecture directe du
// code source, jamais corrigé silencieusement ici : la clé ci-dessous doit
// matcher exactement la chaîne réellement produite, sous peine de faire
// échouer la garde de couverture (§ test M).
// Décision humaine explicite (SYNTH-BE1, revue post-implémentation) : ce
// moteur reflète VOLONTAIREMENT le `category_hint` stable déjà publié/commité
// dans `regles-sante-phase1` v2 -- ne JAMAIS « corriger » cette clé ici pour
// la rendre cohérente avec la convention `_` sans d'abord verser une
// nouvelle version du contenu Santé (nouvelle version de rule_set, jamais
// une modification silencieuse d'un contenu déjà publié). Ce sous-lot
// n'a reçu AUCUNE autorisation de toucher `server/seed-advisory-health-content.js` --
// et ne l'a pas fait.
export const CATEGORY_HINT_MAPPING = {
  // --- Avertissements (règles v1 reconduites inchangées) -----------------
  accident_coordination: { kind: 'warning', path: 'accident.warnings', code: 'doublon_potentiel' },
  accident_coverage_gap: { kind: 'warning', path: 'accident.warnings', code: 'lacune_couverture' },
  care_model_compatibility: { kind: 'warning', path: 'care_model.warnings', code: 'parcours_impose_vs_refus' },
  lca_coverage_continuity: { kind: 'warning', path: 'complementary_needs.warnings', code: 'risque_rupture_couverture' },

  // --- Accident — orientation (2 règles) ----------------------------------
  accident_lamal_maintien: { kind: 'field', path: 'accident.orientation', value: 'maintien_potentiellement_adapte' },
  accident_lamal_retrait_examinable: { kind: 'field', path: 'accident.orientation', value: 'retrait_potentiellement_examinable' },

  // --- Franchise — orientation (3 règles) ---------------------------------
  franchise_orientation_elevee: { kind: 'field', path: 'franchise.orientation', value: 'elevee_potentiellement_adaptee' },
  franchise_orientation_prudente: { kind: 'field', path: 'franchise.orientation', value: 'prudente_a_examiner' },
  franchise_orientation_indeterminee: { kind: 'field', path: 'franchise.orientation', value: 'indeterminee' },

  // --- Franchise — comparaison à l'actuelle (7 règles, 4 hints) -----------
  franchise_comparaison_alignee: { kind: 'field', path: 'franchise.current_comparison', value: 'alignee' },
  franchise_comparaison_ecart: { kind: 'field', path: 'franchise.current_comparison', value: 'ecart_a_examiner' },
  franchise_comparaison_contextuelle: { kind: 'field', path: 'franchise.current_comparison', value: 'a_contextualiser' },
  franchise_comparaison_impossible: { kind: 'field', path: 'franchise.current_comparison', value: 'comparaison_impossible' },

  // --- Modèles de soins — triplets compatible/préférée/refusée (9 règles) --
  care_model_telemedecine_compatible: { kind: 'field', path: 'care_model.telemedicine', value: 'compatible' },
  care_model_telemedecine_preferee: { kind: 'field', path: 'care_model.telemedicine', value: 'preferee' },
  care_model_telemedecine_refusee: { kind: 'field', path: 'care_model.telemedicine', value: 'refusee' },
  'care_model_medecin-famille_compatible': { kind: 'field', path: 'care_model.family_doctor', value: 'compatible' },
  'care_model_medecin-famille_preferee': { kind: 'field', path: 'care_model.family_doctor', value: 'preferee' },
  'care_model_medecin-famille_refusee': { kind: 'field', path: 'care_model.family_doctor', value: 'refusee' },
  care_model_hmo_compatible: { kind: 'field', path: 'care_model.hmo', value: 'compatible' },
  care_model_hmo_preferee: { kind: 'field', path: 'care_model.hmo', value: 'preferee' },
  care_model_hmo_refusee: { kind: 'field', path: 'care_model.hmo', value: 'refusee' },

  // --- Modèles de soins — libre choix / médecin actuel (3 règles) --------
  care_model_libre_choix_prioritaire: { kind: 'field', path: 'care_model.free_choice', value: 'prioritaire' },
  care_model_libre_choix_non_prioritaire: { kind: 'field', path: 'care_model.free_choice', value: 'non_prioritaire' },
  care_model_preserve_current_doctor: { kind: 'field', path: 'care_model.preserve_current_doctor', value: 'important_a_conserver' },

  // --- Priorité coût/liberté (3 règles) -----------------------------------
  priorite_cout_eleve: { kind: 'field', path: 'care_model.cost_freedom_priority', value: 'reduire_prime' },
  priorite_equilibre_cout_liberte: { kind: 'field', path: 'care_model.cost_freedom_priority', value: 'equilibre' },
  priorite_liberte_elevee: { kind: 'field', path: 'care_model.cost_freedom_priority', value: 'maximiser_liberte' },

  // --- Complémentaires — à examiner (6 règles) ----------------------------
  complementaire_hospitalisation_a_examiner: { kind: 'field', path: 'complementary_needs.hospitalisation', value: 'a_examiner' },
  complementaire_medecines_alternatives_a_examiner: { kind: 'field', path: 'complementary_needs.alternative_medicine', value: 'a_examiner' },
  complementaire_optique_a_examiner: { kind: 'field', path: 'complementary_needs.optics', value: 'a_examiner' },
  complementaire_dentaire_a_examiner: { kind: 'field', path: 'complementary_needs.dental', value: 'a_examiner' },
  complementaire_prevention_a_examiner: { kind: 'field', path: 'complementary_needs.prevention', value: 'a_examiner' },
  complementaire_voyage_a_examiner: { kind: 'field', path: 'complementary_needs.travel', value: 'a_examiner' },
};

// Vide aujourd'hui, par construction (les 34 hints ci-dessus couvrent
// exhaustivement les 37 règles v2, vérifié par le test de garde de
// couverture) — jamais un hint volontairement laissé de côté sans y être
// listé explicitement.
export const IGNORED_CATEGORY_HINTS = [];

// -----------------------------------------------------------------------
// Tables de normalisation directe réponse déclarée → valeur de champ (§8
// du cadrage) — utilisées comme repli TOUJOURS disponible (current, stale
// ou not_run), jamais recalculées par une logique combinatoire (contraire à
// la franchise/l'accident, voir plus bas) : chacune de ces tables reflète
// EXACTEMENT la même normalisation que la règle correspondante produit, un
// simple lookup 1:1 sur une seule réponse.
const CARE_MODEL_TRIPLET_MAP = { accepte: 'compatible', preferee: 'preferee', refuse: 'refusee' };
const CONSERVER_MEDECIN_MAP = {
  important: 'important_a_conserver', non_important: 'non_prioritaire',
  pas_de_medecin_habituel: 'pas_de_medecin_habituel', indifferent: 'indifferent',
};
const PRIORITE_PRIME_MAP = { reduire_prime: 'reduire_prime', equilibre: 'equilibre', maximiser_liberte: 'maximiser_liberte' };
const LIBRE_CHOIX_MAP = { prioritaire: 'prioritaire', non_prioritaire: 'non_prioritaire' };
const COMPLEMENTAIRE_MAP = { important: 'a_examiner', eventuellement: 'a_examiner', pas_important: 'non_prioritaire' };

const COMPLEMENTAIRE_DIMENSIONS = [
  { dim: 'hospitalisation', stable_key: 'interet_complementaire_hospitalisation_declare', hint: 'complementaire_hospitalisation_a_examiner' },
  { dim: 'alternative_medicine', stable_key: 'interet_medecines_complementaires_declare', hint: 'complementaire_medecines_alternatives_a_examiner' },
  { dim: 'optics', stable_key: 'interet_complementaire_optique_declare', hint: 'complementaire_optique_a_examiner' },
  { dim: 'dental', stable_key: 'interet_complementaire_dentaire_declare', hint: 'complementaire_dentaire_a_examiner' },
  { dim: 'prevention', stable_key: 'interet_prevention_declare', hint: 'complementaire_prevention_a_examiner' },
  { dim: 'travel', stable_key: 'interet_couverture_voyage_declare', hint: 'complementaire_voyage_a_examiner' },
];
// Clé de complétude (§11) ↔ clé de dimension DTO (§14) — noms distincts
// imposés par le cadrage (« hospitalisation »/« medecines_complementaires »/
// « optique »/« dentaire »/« prevention »/« voyage » pour `by_dimension`,
// mais « hospitalisation »/« alternative_medicine »/« optics »/« dental »/
// « prevention »/« travel » pour `complementary_needs`) — jamais fusionnés
// silencieusement, la table ci-dessous porte cette correspondance une seule
// fois.
const COMPLETENESS_DIMENSION_KEY = {
  hospitalisation: 'hospitalisation',
  alternative_medicine: 'medecines_complementaires',
  optics: 'optique',
  dental: 'dentaire',
  prevention: 'prevention',
  travel: 'voyage',
};

const ACCIDENT_BASE_KEYS = ['couverture_accident_hors_lamal_declaree', 'accident_inclus_lamal_declare'];
const Q_LAA_KEY = 'couverture_accident_laa_employeur_declaree';
const FRANCHISE_ORIENTATION_KEYS = [
  'capacite_absorber_depense_annuelle', 'tolerance_risque_financier',
  'recours_soins_12_mois_declare', 'depenses_sante_anticipees_declare',
];
const FRANCHISE_ACTUELLE_KEY = 'franchise_actuelle_niveau_declare';
const CARE_MODEL_CORE_KEYS = ['priorite_prime_liberte_declaree', 'importance_conserver_medecin_declaree'];
const CARE_MODEL_OPTIONAL_KEYS = [
  'ouverture_telemedecine_declaree', 'ouverture_medecin_famille_declaree',
  'ouverture_hmo_reseau_declaree', 'priorite_libre_choix_declaree',
];

// -----------------------------------------------------------------------
// Helpers déterministes purs (tri, agrégation) — aucune E/S, jamais de
// Date.now()/Math.random() (interdits dans ce moteur, § DÉTERMINISME).
function sortNums(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}
function sortStrs(arr) {
  return [...new Set(arr)].sort();
}
function sortWarnings(arr) {
  return [...arr].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const idA = a.source_finding_ids[0] ?? 0;
    const idB = b.source_finding_ids[0] ?? 0;
    return idA - idB;
  });
}

// Décision de provenance PURE (§9 du cadrage), isolée et exportée pour être
// testée unitairement dans les 4 cas prévus — en particulier `not_applicable`,
// qui ne correspond aujourd'hui à AUCUN champ exposé directement dans le DTO
// (les 3 seules questions v2 avec `display_condition` — Q_LAA,
// `refus_parcours_impose_declare`, `acceptation_nouvelle_complementaire_confirmee`
// — n'alimentent respectivement que la complétude accident et deux
// avertissements v1 reconduits, jamais un champ direct) : cette fonction
// reste la source de vérité unique de la règle, utilisée en interne par
// `declaredField` ci-dessous, garantissant qu'aucune divergence n'existe
// entre ce qui est testé isolément et ce qui s'exécute réellement.
export function resolveProvenance(answerStatus, visible) {
  if (!visible) return 'not_applicable';
  if (answerStatus === 'answered') return 'declared_answer';
  return 'unknown';
}

function unsupportedVersionError(message, details) {
  const err = new AdvisoryError(message, 409, HEALTH_SYNTHESIS_UNSUPPORTED_VERSION);
  err.details = details;
  return err;
}

export function buildHealthSynthesis({ sessionId }) {
  // --- Session/foyer/membres/état d'analyse/findings Santé (SYNTH-T) -----
  // Aucune duplication de `requireSession`/`getHousehold`/`sessionMembersFor`/
  // `resolveDomainAnalysisState` ici : entièrement délégué au sous-lot
  // technique préalable, qui reste la SEULE source de vérité pour ces
  // lectures (et valide au passage que le domaine `health` s'applique bien
  // à cette session — sinon 400 « non applicable », jamais un 409 confus).
  const projection = getProjectedSessionFindings(sessionId, { domain: 'health' });
  const { session, members, state } = projection;

  // --- VERSION GUARD (§2, §16) --------------------------------------------
  const link = db
    .prepare('SELECT * FROM advisory_session_questionnaires WHERE session_id = ? AND domain = ?')
    .get(sessionId, 'health');
  const versionDetail = link ? getVersionDetail(link.questionnaire_version_id) : null;
  const actualQuestionnaireVersion = versionDetail ? versionDetail.version_number : null;
  if (
    !versionDetail
    || versionDetail.questionnaire.stable_key !== QUESTIONNAIRE_STABLE_KEY
    || actualQuestionnaireVersion !== SUPPORTED_QUESTIONNAIRE_VERSION
  ) {
    throw unsupportedVersionError(
      `Le questionnaire Santé de cette session (version ${actualQuestionnaireVersion ?? 'inconnue'}) n'est pas pris en charge par le moteur de synthèse (version ${SUPPORTED_QUESTIONNAIRE_VERSION} attendue).`,
      { expected_questionnaire_version: SUPPORTED_QUESTIONNAIRE_VERSION, actual_questionnaire_version: actualQuestionnaireVersion },
    );
  }
  // Chargé une seule fois ici (jamais deux requêtes pour le même rule_set) —
  // réutilisé plus bas pour l'indexation des findings par `category_hint`
  // quand `analysisStatus === 'current'`.
  const lastExecutionRuleSetDetail = state.last_execution ? getRuleSetDetail(state.last_execution.rule_set_id) : null;
  if (
    lastExecutionRuleSetDetail
    && (lastExecutionRuleSetDetail.stable_key !== RULE_SET_STABLE_KEY || state.last_execution.rule_set_version_number !== SUPPORTED_RULE_SET_VERSION)
  ) {
    throw unsupportedVersionError(
      `La dernière exécution Santé de cette session utilise un ensemble de règles (version ${state.last_execution.rule_set_version_number}) non pris en charge par le moteur de synthèse (version ${SUPPORTED_RULE_SET_VERSION} attendue).`,
      { expected_rule_set_version: SUPPORTED_RULE_SET_VERSION, actual_rule_set_version: state.last_execution.rule_set_version_number },
    );
  }

  // --- ANALYSIS STATUS (§3) -----------------------------------------------
  const analysisStatus = state.state === 'up_to_date' ? 'current' : state.state === 'stale' ? 'stale' : 'not_run';
  const requiresReanalysis = analysisStatus !== 'current';

  // --- source_state_at (§13) — dérivé uniquement de données persistées ---
  const executionEndedAt = state.last_execution ? state.last_execution.ended_at : null;
  const sourceStateAt = [session.updated_at, executionEndedAt].filter(Boolean).sort().pop() || session.updated_at;

  // --- Index des réponses courantes du questionnaire Santé v2 (§7, pur) --
  const questionsByStableKey = new Map();
  for (const section of versionDetail.sections) {
    if (section.status !== 'active') continue;
    for (const q of section.questions) {
      if (q.status !== 'active') continue;
      questionsByStableKey.set(q.stable_key, q);
    }
  }
  const answersByKey = new Map(); // `${question_id}|${household_member_id}`
  for (const a of listActiveAnswers(sessionId)) {
    answersByKey.set(`${a.question_id}|${a.household_member_id}`, a);
  }
  function getAnswerFor(memberId, stableKey) {
    const q = questionsByStableKey.get(stableKey);
    if (!q) return undefined;
    return answersByKey.get(`${q.id}|${memberId}`);
  }
  function isVisibleFor(memberId, stableKey, memberRole) {
    const q = questionsByStableKey.get(stableKey);
    if (!q) return false;
    const cond = q.display_condition ? JSON.parse(q.display_condition) : null;
    return evaluateCondition(cond, {
      session: { domain: session.domain },
      getAnswer: (sk) => {
        const row = getAnswerFor(memberId, sk);
        return row ? { status: row.status, value: row.value } : undefined;
      },
      member: { member_role: memberRole },
    });
  }
  function completenessStatusFor(memberId, memberRole, stableKey) {
    if (!isVisibleFor(memberId, stableKey, memberRole)) return 'not_applicable';
    const a = getAnswerFor(memberId, stableKey);
    return a && a.status === 'answered' ? 'answered' : 'missing';
  }
  function applicableAndMissing(keys, memberId, memberRole) {
    return sortStrs(keys.filter((k) => completenessStatusFor(memberId, memberRole, k) === 'missing'));
  }
  // Champ à partir d'une réponse déclarée — repli TOUJOURS disponible,
  // quel que soit `analysisStatus` (§7 CRITIQUE, §8). `valueMap` est la
  // table de normalisation 1:1 de la question (jamais une logique
  // combinatoire, réservée à la franchise/l'accident ci-dessous).
  function declaredField(memberId, memberRole, stableKey, valueMap) {
    const visible = isVisibleFor(memberId, stableKey, memberRole);
    const answer = getAnswerFor(memberId, stableKey);
    const provenance = resolveProvenance(answer ? answer.status : undefined, visible);
    if (provenance === 'not_applicable') {
      return { value: null, provenance, source_finding_ids: [], source_answer_ids: [], source_answer_keys: [] };
    }
    if (provenance === 'unknown') {
      // Une ligne de réponse existe (status unknown/cleared) : référencée
      // pour l'audit. Aucune ligne du tout (jamais répondue) : le stable_key
      // n'apparaît QUE dans `completeness.missing_stable_keys`, jamais ici
      // (§9, clause explicite).
      return {
        value: null, provenance,
        source_finding_ids: [],
        source_answer_ids: answer ? [answer.id] : [],
        source_answer_keys: answer ? [stableKey] : [],
      };
    }
    const mapped = valueMap[answer.value];
    return {
      value: mapped ?? null, provenance: 'declared_answer',
      source_finding_ids: [], source_answer_ids: [answer.id], source_answer_keys: [stableKey],
    };
  }

  // --- Findings Santé courants, indexés par membre + category_hint -------
  // (§5, §9, §12) : uniquement en `analysisStatus === 'current'`, uniquement
  // les findings RÉELLEMENT produits (jamais `missing_information`, qui ne
  // porte aucune conclusion exploitable ici — la complétude, elle, est
  // calculée entièrement à partir des réponses courantes ci-dessus, jamais
  // des findings). Règles chargées en UN SEUL batch (`getRuleSetDetail`),
  // jamais une requête par finding (§5, garde N+1).
  // `f.status === 'active'` (correction post-revue advisory-architect) :
  // `projection.raw` (SYNTH-T, `getProjectedSessionFindings`) retourne TOUS
  // les findings de la dernière exécution SANS filtrer leur statut -- exclure
  // `dismissed`/`superseded` reste explicitement à la charge de chaque
  // appelant (déjà le cas pour `getSessionFindingsWorkspace`, qui filtre
  // `status === 'active'` avant tout agrégat présenté au conseiller,
  // `synthesis.active_findings_count` etc.). Sans ce filtre, un finding
  // qu'un conseiller a explicitement écarté (motif obligatoire, décision
  // humaine tracée) continuerait pourtant à alimenter une conclusion ou un
  // avertissement ici -- silencieusement contradictoire avec l'écran des
  // constats, qui ne le montre plus. Un finding ainsi exclu retombe sur le
  // même repli que s'il n'avait jamais existé (réponse déclarée ou `unknown`
  // selon les cas ci-dessous) -- jamais une 5e valeur de provenance
  // inventée hors du cadrage verrouillé (finding | declared_answer | unknown
  // | not_applicable).
  const findingsByMemberAndHint = new Map();
  if (analysisStatus === 'current' && lastExecutionRuleSetDetail) {
    const rulesById = new Map(lastExecutionRuleSetDetail.rules.map((r) => [r.id, r]));
    for (const f of projection.raw) {
      if (f.status !== 'active') continue;
      if (f.finding_type === 'missing_information') continue;
      if (f.household_member_id == null) continue;
      const rule = rulesById.get(f.rule_id);
      const hint = rule && rule.result_payload ? rule.result_payload.category_hint : null;
      if (!hint || !(hint in CATEGORY_HINT_MAPPING)) continue;
      if (!findingsByMemberAndHint.has(f.household_member_id)) findingsByMemberAndHint.set(f.household_member_id, new Map());
      findingsByMemberAndHint.get(f.household_member_id).set(hint, f);
    }
  }
  function findingFor(memberId, hint) {
    const m = findingsByMemberAndHint.get(memberId);
    return m ? m.get(hint) : undefined;
  }
  function answerIdsFromFinding(f) {
    return (f.used_inputs_ref || []).filter((r) => r.kind === 'answer' && r.answer_id != null).map((r) => r.answer_id);
  }
  // Filtré par `answer_id != null` comme `answerIdsFromFinding` (jamais une
  // clé « source » sans ligne de réponse réelle derrière — une référence de
  // règle sur une question masquée/jamais répondue, présente dans
  // `used_inputs_ref` par construction du moteur mais sans avoir concouru à
  // la valeur du finding, ne doit jamais être présentée comme une
  // provenance).
  function answerKeysFromFinding(f) {
    return (f.used_inputs_ref || [])
      .filter((r) => r.kind === 'answer' && r.answer_id != null)
      .map((r) => r.question_stable_key || r.stable_key)
      .filter(Boolean);
  }
  function findingField(hint, f) {
    return {
      value: CATEGORY_HINT_MAPPING[hint].value,
      provenance: 'finding',
      source_finding_ids: [f.id],
      source_answer_ids: sortNums(answerIdsFromFinding(f)),
      source_answer_keys: sortStrs(answerKeysFromFinding(f)),
    };
  }
  function nullField(provenance) {
    return { value: null, provenance, source_finding_ids: [], source_answer_ids: [], source_answer_keys: [] };
  }
  function collectWarnings(memberId, hint, code) {
    if (analysisStatus !== 'current') return [];
    const f = findingFor(memberId, hint);
    return f ? [{ code, source_finding_ids: [f.id] }] : [];
  }

  // --- Accident.orientation (§8) ------------------------------------------
  // Cas déclaratif explicite TOUJOURS disponible (n'importe quel
  // analysisStatus) : prioritaire sur toute conclusion dérivée.
  function accidentOrientation(memberId) {
    const accidentInclus = getAnswerFor(memberId, 'accident_inclus_lamal_declare');
    if (accidentInclus && accidentInclus.status === 'answered' && accidentInclus.value === 'non') {
      return {
        value: 'not_applicable_accident_not_included', provenance: 'declared_answer',
        source_finding_ids: [], source_answer_ids: [accidentInclus.id], source_answer_keys: ['accident_inclus_lamal_declare'],
      };
    }
    if (analysisStatus === 'current') {
      for (const hint of ['accident_lamal_maintien', 'accident_lamal_retrait_examinable']) {
        const f = findingFor(memberId, hint);
        if (f) return findingField(hint, f);
      }
    }
    return nullField('unknown');
  }

  // --- Franchise (§8) — conclusions purement dérivées, jamais recalculées
  // depuis les réponses directement dans ce moteur (logique combinatoire à
  // 4/5 variables, propriété exclusive du moteur de règles).
  function franchiseOrientation(memberId) {
    if (analysisStatus !== 'current') return nullField('unknown');
    for (const hint of ['franchise_orientation_elevee', 'franchise_orientation_prudente', 'franchise_orientation_indeterminee']) {
      const f = findingFor(memberId, hint);
      if (f) return findingField(hint, f);
    }
    return nullField('unknown');
  }
  function franchiseCurrentComparison(memberId) {
    if (analysisStatus !== 'current') return nullField('unknown');
    for (const hint of ['franchise_comparaison_alignee', 'franchise_comparaison_ecart', 'franchise_comparaison_contextuelle', 'franchise_comparaison_impossible']) {
      const f = findingFor(memberId, hint);
      if (f) return findingField(hint, f);
    }
    return nullField('unknown');
  }

  // --- Care model / complémentaires (§8) — repli déclaré toujours
  // disponible, remplacé par la conclusion du finding UNIQUEMENT en
  // `current` (même valeur par construction — la règle correspondante
  // n'existe que pour cette même normalisation — mais provenance et
  // traçabilité correctes). La réponse déclarée reste conservée en
  // provenance secondaire même quand `current` (§8 « conserver
  // source_answer_ids/source_answer_keys »).
  function simpleField(memberId, memberRole, stableKey, valueMap, hints) {
    const declared = declaredField(memberId, memberRole, stableKey, valueMap);
    if (analysisStatus === 'current' && declared.provenance !== 'not_applicable') {
      for (const hint of hints) {
        const f = findingFor(memberId, hint);
        if (f) {
          return {
            value: CATEGORY_HINT_MAPPING[hint].value,
            provenance: 'finding',
            source_finding_ids: [f.id],
            source_answer_ids: declared.source_answer_ids,
            source_answer_keys: declared.source_answer_keys,
          };
        }
      }
    }
    return declared;
  }

  // --- Complétude (§11) ---------------------------------------------------
  function accidentCompleteness(memberId, memberRole) {
    const missing = applicableAndMissing([...ACCIDENT_BASE_KEYS, Q_LAA_KEY], memberId, memberRole);
    return missing.length === 0
      ? { state: 'complete', missing_stable_keys: [] }
      : { state: 'blocked_by_missing_information', missing_stable_keys: missing };
  }
  function franchiseOrientationCompleteness(memberId, memberRole) {
    const missing = applicableAndMissing(FRANCHISE_ORIENTATION_KEYS, memberId, memberRole);
    return missing.length === 0
      ? { state: 'complete', missing_stable_keys: [] }
      : { state: 'blocked_by_missing_information', missing_stable_keys: missing };
  }
  function franchiseComparisonCompleteness(memberId, memberRole, orientationCompleteness) {
    const actuelleMissing = applicableAndMissing([FRANCHISE_ACTUELLE_KEY], memberId, memberRole);
    if (orientationCompleteness.state === 'blocked_by_missing_information' || actuelleMissing.length > 0) {
      return {
        state: 'blocked_by_missing_information',
        missing_stable_keys: sortStrs([...orientationCompleteness.missing_stable_keys, ...actuelleMissing]),
      };
    }
    return { state: 'complete', missing_stable_keys: [] };
  }
  function careModelCompleteness(memberId, memberRole) {
    const missingCore = applicableAndMissing(CARE_MODEL_CORE_KEYS, memberId, memberRole);
    const missingOptional = applicableAndMissing(CARE_MODEL_OPTIONAL_KEYS, memberId, memberRole);
    if (missingCore.length > 0) {
      return { state: 'blocked_by_missing_information', missing_stable_keys: sortStrs([...missingCore, ...missingOptional]) };
    }
    if (missingOptional.length > 0) {
      return { state: 'partial', missing_stable_keys: missingOptional };
    }
    return { state: 'complete', missing_stable_keys: [] };
  }
  function complementaireCompleteness(memberId, memberRole, stableKey) {
    const missing = applicableAndMissing([stableKey], memberId, memberRole);
    return missing.length === 0
      ? { state: 'complete', missing_stable_keys: [] }
      : { state: 'partial', missing_stable_keys: missing };
  }
  function overallCompleteness(byDimension) {
    const CORE_DIMS = ['accident', 'franchise_orientation', 'franchise_current_comparison', 'care_model'];
    const ALL_DIMS = [...CORE_DIMS, 'hospitalisation', 'medecines_complementaires', 'optique', 'dentaire', 'prevention', 'voyage'];
    if (CORE_DIMS.some((d) => byDimension[d].state === 'blocked_by_missing_information')) return 'blocked_by_missing_information';
    if (ALL_DIMS.some((d) => byDimension[d].state === 'partial')) return 'partial';
    return 'complete';
  }

  // --- Assemblage par membre ------------------------------------------------
  function buildMember(member) {
    const memberId = member.id;
    const memberRole = member.member_role;

    const accidentCompl = accidentCompleteness(memberId, memberRole);
    const franchiseOrientCompl = franchiseOrientationCompleteness(memberId, memberRole);
    const franchiseCompCompl = franchiseComparisonCompleteness(memberId, memberRole, franchiseOrientCompl);
    const careModelCompl = careModelCompleteness(memberId, memberRole);

    const byDimension = {
      accident: accidentCompl,
      franchise_orientation: franchiseOrientCompl,
      franchise_current_comparison: franchiseCompCompl,
      care_model: careModelCompl,
    };
    for (const { dim, stable_key: stableKey } of COMPLEMENTAIRE_DIMENSIONS) {
      byDimension[COMPLETENESS_DIMENSION_KEY[dim]] = complementaireCompleteness(memberId, memberRole, stableKey);
    }
    const overall = overallCompleteness(byDimension);

    const accidentWarnings = sortWarnings([
      ...collectWarnings(memberId, 'accident_coordination', 'doublon_potentiel'),
      ...collectWarnings(memberId, 'accident_coverage_gap', 'lacune_couverture'),
    ]);
    const careModelWarnings = sortWarnings(collectWarnings(memberId, 'care_model_compatibility', 'parcours_impose_vs_refus'));
    const complementaryWarnings = sortWarnings(collectWarnings(memberId, 'lca_coverage_continuity', 'risque_rupture_couverture'));

    const accident = { orientation: accidentOrientation(memberId), warnings: accidentWarnings };
    const franchise = { orientation: franchiseOrientation(memberId), current_comparison: franchiseCurrentComparison(memberId) };
    const careModel = {
      cost_freedom_priority: simpleField(memberId, memberRole, 'priorite_prime_liberte_declaree', PRIORITE_PRIME_MAP, ['priorite_cout_eleve', 'priorite_equilibre_cout_liberte', 'priorite_liberte_elevee']),
      preserve_current_doctor: simpleField(memberId, memberRole, 'importance_conserver_medecin_declaree', CONSERVER_MEDECIN_MAP, ['care_model_preserve_current_doctor']),
      telemedicine: simpleField(memberId, memberRole, 'ouverture_telemedecine_declaree', CARE_MODEL_TRIPLET_MAP, ['care_model_telemedecine_compatible', 'care_model_telemedecine_preferee', 'care_model_telemedecine_refusee']),
      family_doctor: simpleField(memberId, memberRole, 'ouverture_medecin_famille_declaree', CARE_MODEL_TRIPLET_MAP, ['care_model_medecin-famille_compatible', 'care_model_medecin-famille_preferee', 'care_model_medecin-famille_refusee']),
      hmo: simpleField(memberId, memberRole, 'ouverture_hmo_reseau_declaree', CARE_MODEL_TRIPLET_MAP, ['care_model_hmo_compatible', 'care_model_hmo_preferee', 'care_model_hmo_refusee']),
      free_choice: simpleField(memberId, memberRole, 'priorite_libre_choix_declaree', LIBRE_CHOIX_MAP, ['care_model_libre_choix_prioritaire', 'care_model_libre_choix_non_prioritaire']),
      warnings: careModelWarnings,
    };
    const complementaryNeeds = { warnings: complementaryWarnings };
    for (const { dim, stable_key: stableKey, hint } of COMPLEMENTAIRE_DIMENSIONS) {
      complementaryNeeds[dim] = simpleField(memberId, memberRole, stableKey, COMPLEMENTAIRE_MAP, [hint]);
    }

    const memberWarnings = sortWarnings([
      ...accidentWarnings.map((w) => ({ ...w, dimension: 'accident' })),
      ...careModelWarnings.map((w) => ({ ...w, dimension: 'care_model' })),
      ...complementaryWarnings.map((w) => ({ ...w, dimension: 'complementary_needs' })),
    ]);

    const allFields = [
      accident.orientation, franchise.orientation, franchise.current_comparison,
      careModel.cost_freedom_priority, careModel.preserve_current_doctor, careModel.telemedicine,
      careModel.family_doctor, careModel.hmo, careModel.free_choice,
      ...COMPLEMENTAIRE_DIMENSIONS.map(({ dim }) => complementaryNeeds[dim]),
    ];
    const allWarnings = [...accidentWarnings, ...careModelWarnings, ...complementaryWarnings];

    return {
      household_member_id: memberId,
      member_role: memberRole,
      member_label: member.display_name,
      // Métadonnées propagées TELLES QUELLES depuis `sessionMembersFor`
      // (via SYNTH-T, `projection.members`) -- jamais une réinterprétation :
      // un membre historique/sorti du foyer reste pleinement synthétisé
      // (réponses et conclusions de CETTE session inchangées, complétude et
      // analysis_status jamais affectés), seulement identifiable comme tel
      // (décision humaine, correction post-revue advisory-architect).
      historical: !!member.historical,
      no_longer_active: !!member.no_longer_active,
      completeness: { overall, by_dimension: byDimension },
      accident,
      franchise,
      care_model: careModel,
      complementary_needs: complementaryNeeds,
      warnings: memberWarnings,
      source_answer_ids_used: sortNums(allFields.flatMap((f) => f.source_answer_ids)),
      source_finding_ids_all: sortNums([...allFields.flatMap((f) => f.source_finding_ids), ...allWarnings.flatMap((w) => w.source_finding_ids)]),
    };
  }

  const memberDTOs = [...members].sort((a, b) => a.id - b.id).map(buildMember);

  // --- household_summary (§14) — jamais une conclusion de foyer, seulement
  // des rollups factuels déterministes.
  const householdSummary = {
    franchise_orientations_present: sortStrs(memberDTOs.map((m) => m.franchise.orientation.value).filter((v) => v != null)),
    members_with_missing_information: sortNums(memberDTOs.filter((m) => m.completeness.overall !== 'complete').map((m) => m.household_member_id)),
  };

  return {
    synthesis_version: SYNTHESIS_VERSION,
    session_id: session.id,
    domain: 'health',
    analysis_status: analysisStatus,
    requires_reanalysis: requiresReanalysis,
    source_state_at: sourceStateAt,
    members: memberDTOs,
    household_summary: householdSummary,
  };
}
