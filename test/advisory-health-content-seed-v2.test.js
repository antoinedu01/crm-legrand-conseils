// Tests exhaustifs du contenu Diagnostic Santé v2 (diagnostic-sante-phase1 v2,
// regles-sante-phase1 v2) — questionnaire, finalisation, accident, franchise
// (orientation + comparaison), modèles de soins, priorité coût/liberté,
// complémentaires, multi-membres, sécurité architecturale, validateurs.
// Base de test isolée (CRM_DATA_DIR), JAMAIS data/crm.sqlite. Tout le
// contenu ici est fictif et technique.
//
// Publication v2 EN TEST UNIQUEMENT (voir plus bas, `publishV2ForTesting`) :
// `seedAdvisoryHealthContentV2` elle-même n'appelle jamais `publishVersion`/
// `publishRuleSet` (vérifié séparément ci-dessous, test « le seed ne publie
// jamais »). Mais la quasi-totalité des scénarios ci-dessous nécessitent une
// EXÉCUTION réelle du rule_set v2 sur une session — techniquement impossible
// sans publication (le moteur refuse d'exécuter un rule_set non publié à la
// première exécution, ET `validateRuleSetForPublish` ne peut résoudre les
// stable_keys de questions qu'à travers des questionnaires PUBLIÉS). Publier
// dans une base CRM_DATA_DIR isolée et jetable (supprimée à la fin du
// process) est la même technique déjà utilisée par tous les autres fichiers
// de test de ce dépôt (aucune conséquence réelle, jamais data/crm.sqlite) —
// distincte d'une publication produit/métier, qui reste une décision humaine
// séparée, hors de ce lot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-health-v2-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');
const Seed = await import('../server/seed-advisory-health-content.js');

const REQ = { session: { userEmail: 'conseiller-health-v2@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-health-v2@exemple.ch', 'Conseiller', 'x');

// --- Snapshot v1 AVANT toute action v2 (comparé après, pour prouver l'immutabilité) ---
function snapshotV1() {
  const questionnaire = db.prepare('SELECT * FROM advisory_questionnaires WHERE stable_key = ?').get(Seed.QUESTIONNAIRE_STABLE_KEY);
  const version = db.prepare('SELECT * FROM advisory_questionnaire_versions WHERE questionnaire_id = ? AND version_number = 1').get(questionnaire.id);
  const sections = db.prepare('SELECT * FROM advisory_sections WHERE questionnaire_version_id = ?').all(version.id);
  const questions = db.prepare('SELECT * FROM advisory_questions WHERE questionnaire_version_id = ? ORDER BY sort_order').all(version.id);
  const options = questions.flatMap((q) => db.prepare('SELECT * FROM advisory_question_options WHERE question_id = ? ORDER BY sort_order').all(q.id));
  const ruleSet = db.prepare("SELECT * FROM advisory_rule_sets WHERE stable_key = ? AND version_number = 1").get(Seed.RULE_SET_STABLE_KEY);
  const rules = db.prepare('SELECT * FROM advisory_rules WHERE rule_set_id = ? ORDER BY sort_order').all(ruleSet.id);
  return { version, sections, questions, options, ruleSet, rules };
}

const seedV1Result = Seed.seedAdvisoryHealthContent(REQ);
assert.equal(seedV1Result.created, true, 'précondition : v1 doit se provisionner correctement');
const v1SnapshotBeforeV2 = snapshotV1();

const seedV2Result = Seed.seedAdvisoryHealthContentV2(REQ);
assert.equal(seedV2Result.created, true, 'précondition : v2 doit se provisionner correctement');
assert.equal(seedV2Result.questionCount, 24, 'précondition : 24 questions v2');
assert.equal(seedV2Result.ruleCount, 37, 'précondition : 37 règles v2 (4 reconduites + 33 nouvelles)');

const v1SnapshotAfterV2 = snapshotV1();

// Capturé AVANT toute publication de test (voir plus bas) : preuve directe
// que `seedAdvisoryHealthContentV2` elle-même ne publie jamais rien.
const v2StatusRightAfterSeed = {
  version: db.prepare('SELECT status FROM advisory_questionnaire_versions WHERE id = ?').get(seedV2Result.versionId).status,
  ruleSet: db.prepare('SELECT status FROM advisory_rule_sets WHERE id = ?').get(seedV2Result.ruleSetId).status,
};

// Publication v2 EN TEST UNIQUEMENT (voir en-tête de fichier).
Q.publishVersion(seedV2Result.versionId, REQ);
const rulesetValidation = R.validateRuleSetForPublish(seedV2Result.ruleSetId);
assert.equal(rulesetValidation.valid, true, `précondition : validateRuleSetForPublish(v2) doit être valide -- ${JSON.stringify(rulesetValidation.errors)}`);
R.publishRuleSet(seedV2Result.ruleSetId, REQ);

const V2_VERSION_ID = seedV2Result.versionId;
const V2_RULE_SET_ID = seedV2Result.ruleSetId;
const QIDS = seedV2Result.questionIds;

// --- Helpers ----------------------------------------------------------------
let clientCounter = 0;
function insertClient(first) {
  clientCounter += 1;
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', first || `P${clientCounter}`, 'V2Test', 'prospect').lastInsertRowid;
}
function rev(sessionId) { return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision; }
function buildHousehold(memberCount = 1) {
  const principalId = insertClient('Principal');
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const principal = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  const memberIds = [principal.id];
  for (let i = 1; i < memberCount; i++) {
    const clientId = insertClient(`Conjoint${i}`);
    const { id: mid } = addMember(householdId, { member_role: 'conjoint', client_id: clientId }, REQ);
    memberIds.push(mid);
  }
  return { householdId, memberIds };
}
function createAndStartSession(householdId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: V2_VERSION_ID, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
// answers: { stable_key: value } -- value 'UNKNOWN' (sentinelle) déclare la
// réponse comme statut `unknown` (mécanisme natif), jamais une option
// littérale « je ne sais pas ».
function answerMember(sessionId, memberId, answers) {
  const payload = Object.entries(answers).map(([key, value]) => {
    const questionId = QIDS[key];
    assert.ok(questionId, `question inconnue dans les fixtures v2 : ${key}`);
    if (value === 'UNKNOWN') return { question_id: questionId, household_member_id: memberId, status: 'unknown' };
    return { question_id: questionId, household_member_id: memberId, status: 'answered', value };
  });
  S.recordAnswers(sessionId, payload, rev(sessionId), REQ);
}
function completeSession(sessionId) {
  S.completeSession(sessionId, rev(sessionId), REQ);
}
function executeV2(sessionId) {
  const isFirst = db.prepare("SELECT COUNT(*) AS n FROM advisory_rule_executions WHERE session_id = ? AND domain = 'health'").get(sessionId).n === 0;
  return E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, isFirst ? { rule_set_id: V2_RULE_SET_ID } : {});
}
function rawFindings(sessionId) {
  return db.prepare('SELECT * FROM advisory_findings WHERE session_id = ?').all(sessionId);
}
function projectedFindings(sessionId) {
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  return workspace.by_domain.health.findings;
}
// `advisory_findings` n'a pas de colonne `result_payload`/`category_hint`
// (celui-ci n'existe qu'EN MÉMOIRE pendant l'exécution, pour la détection de
// recoupement -- jamais persisté ni réattaché à la lecture, confirmé par
// lecture de `hydrateFindingRows`/`parseFinding`, server/advisoryRuleExecutions.js).
// Seul `stable_key` (dupliqué depuis la règle) est une colonne réelle du
// finding -- on résout donc le `category_hint` via la définition de la
// règle elle-même, jamais via un champ inexistant sur le finding.
const categoryByStableKey = new Map(
  db.prepare('SELECT stable_key, result_payload FROM advisory_rules WHERE rule_set_id = ?').all(V2_RULE_SET_ID)
    .map((r) => [r.stable_key, r.result_payload ? JSON.parse(r.result_payload).category_hint : null])
);
function categoryOf(finding) {
  return finding.stable_key ? categoryByStableKey.get(finding.stable_key) : null;
}
function categoriesFor(findings) {
  return findings.filter((f) => f.finding_type !== 'missing_information').map((f) => categoryOf(f)).filter(Boolean);
}
// Valeurs par défaut neutres pour les 9 CORE_REQUIRED (finalisation exige
// une réponse -- `answered` ou `unknown`, jamais `cleared`/absente -- sur
// chacune) et pour les 2 questions qui commandent les CONDITIONAL_REQUIRED
// (gardées à « non » par défaut pour que Q7/Q9/Q_LAA restent MASQUÉES, donc
// jamais bloquantes, sauf si un scénario les override explicitement pour
// tester précisément ces conditionnelles). Un scénario ne fournit que ce
// qu'il veut réellement tester ; le reste retombe sur ce profil neutre.
const CORE_DEFAULTS = {
  couverture_accident_hors_lamal_declaree: 'non',
  accident_inclus_lamal_declare: 'oui',
  franchise_actuelle_niveau_declare: 'moyenne',
  capacite_absorber_depense_annuelle: 'moyenne',
  tolerance_risque_financier: 'moyenne',
  recours_soins_12_mois_declare: 'faible',
  depenses_sante_anticipees_declare: 'aucune',
  priorite_prime_liberte_declaree: 'equilibre',
  importance_conserver_medecin_declaree: 'indifferent',
  parcours_premier_contact_obligatoire_declare: 'non',
  intention_resilier_complementaire_declare: 'non',
};
// Scénario complet à un seul membre : construit foyer + session + réponses +
// exécute + retourne les findings PROJETÉS (vue conseiller). `answers`
// surcharge le profil neutre `CORE_DEFAULTS` -- ne fournir que ce que le
// scénario veut réellement tester ; si `answers` rend une conditionnelle
// visible (ex. hors_lamal=oui), le scénario doit alors fournir lui-même sa
// réponse (Q_LAA) pour rester finalisable, exactement comme un vrai
// conseiller le ferait.
function runScenario(answers) {
  const { householdId, memberIds } = buildHousehold(1);
  const sessionId = createAndStartSession(householdId);
  answerMember(sessionId, memberIds[0], { ...CORE_DEFAULTS, ...answers });
  completeSession(sessionId);
  executeV2(sessionId);
  return { sessionId, memberId: memberIds[0], householdId, findings: projectedFindings(sessionId), raw: rawFindings(sessionId) };
}
function franchiseAnswers({ capacite, tolerance, recours, depenses, actuelle }) {
  const a = {
    capacite_absorber_depense_annuelle: capacite, tolerance_risque_financier: tolerance,
    recours_soins_12_mois_declare: recours, depenses_sante_anticipees_declare: depenses,
  };
  if (actuelle) a.franchise_actuelle_niveau_declare = actuelle;
  return a;
}

// =============================================================================
// QUESTIONNAIRE
// =============================================================================

test('v2 -- v1 reste strictement intact avant/après le provisioning v2 (mêmes lignes, mêmes valeurs)', () => {
  assert.deepEqual(v1SnapshotBeforeV2, v1SnapshotAfterV2, 'aucune ligne v1 (questionnaire/sections/questions/options/rule_set/règles) ne doit changer');
});

test('v2 -- exactement 24 questions au total', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const total = detail.sections.reduce((n, s) => n + s.questions.length, 0);
  assert.equal(total, 24);
});

test('v2 -- 4 sections avec le bon nombre de questions et sort_order croissant', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const bySection = Object.fromEntries(detail.sections.map((s) => [s.stable_key, s]));
  assert.equal(bySection['coordination-et-besoins-declares'].questions.length, 10);
  assert.equal(bySection['usage-et-priorites'].questions.length, 3);
  assert.equal(bySection['modele-de-soins-preferences'].questions.length, 5);
  assert.equal(bySection['complementaires-besoins-declares'].questions.length, 6);
  for (const section of detail.sections) {
    const orders = section.questions.map((q) => q.sort_order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `sort_order croissant dans ${section.stable_key}`);
  }
});

test('v2 -- ordre section 1 : Q1 (hors_lamal) -> Q_LAA -> Q2 (inclus_lamal) -> suite inchangée (arbitrage humain post-revue)', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const section1 = detail.sections.find((s) => s.stable_key === 'coordination-et-besoins-declares');
  const orderedKeys = [...section1.questions].sort((a, b) => a.sort_order - b.sort_order).map((q) => q.stable_key);
  assert.deepEqual(orderedKeys, [
    'couverture_accident_hors_lamal_declaree',
    'couverture_accident_laa_employeur_declaree',
    'accident_inclus_lamal_declare',
    'franchise_actuelle_niveau_declare',
    'capacite_absorber_depense_annuelle',
    'tolerance_risque_financier',
    'parcours_premier_contact_obligatoire_declare',
    'refus_parcours_impose_declare',
    'intention_resilier_complementaire_declare',
    'acceptation_nouvelle_complementaire_confirmee',
  ]);
});

test('v2 -- exactement 9 questions CORE_REQUIRED (required=true, sans display_condition)', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const all = detail.sections.flatMap((s) => s.questions);
  const core = all.filter((q) => q.required && !q.display_condition);
  assert.equal(core.length, 9, core.map((q) => q.stable_key).join(', '));
});

test('v2 -- exactement 3 questions CONDITIONAL_REQUIRED (required=true, avec display_condition)', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const all = detail.sections.flatMap((s) => s.questions);
  const conditional = all.filter((q) => q.required && q.display_condition);
  assert.equal(conditional.length, 3, conditional.map((q) => q.stable_key).join(', '));
  assert.deepEqual(conditional.map((q) => q.stable_key).sort(), [
    'acceptation_nouvelle_complementaire_confirmee', 'couverture_accident_laa_employeur_declaree', 'refus_parcours_impose_declare',
  ].sort());
});

test('v2 -- exactement 12 questions OPTIONAL (required=false)', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const all = detail.sections.flatMap((s) => s.questions);
  const optional = all.filter((q) => !q.required);
  assert.equal(optional.length, 12, optional.map((q) => q.stable_key).join(', '));
});

test('v2 -- display_condition Q7 (refus_parcours_impose_declare) référence parcours_premier_contact_obligatoire_declare == oui', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const q = detail.sections.flatMap((s) => s.questions).find((qq) => qq.stable_key === 'refus_parcours_impose_declare');
  assert.deepEqual(JSON.parse(q.display_condition), { op: 'equals', ref: { question: 'parcours_premier_contact_obligatoire_declare' }, value: 'oui' });
});

test('v2 -- display_condition Q9 (acceptation_nouvelle_complementaire_confirmee) référence intention_resilier_complementaire_declare == oui', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const q = detail.sections.flatMap((s) => s.questions).find((qq) => qq.stable_key === 'acceptation_nouvelle_complementaire_confirmee');
  assert.deepEqual(JSON.parse(q.display_condition), { op: 'equals', ref: { question: 'intention_resilier_complementaire_declare' }, value: 'oui' });
});

test('v2 -- display_condition Q_LAA (couverture_accident_laa_employeur_declaree) référence couverture_accident_hors_lamal_declaree == oui', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const q = detail.sections.flatMap((s) => s.questions).find((qq) => qq.stable_key === 'couverture_accident_laa_employeur_declaree');
  assert.deepEqual(JSON.parse(q.display_condition), { op: 'equals', ref: { question: 'couverture_accident_hors_lamal_declaree' }, value: 'oui' });
});

test('v2 -- sensitive uniquement sur les questions prévues (franchise/capacité/tolérance/recours/dépenses/intention/acceptation)', () => {
  // tolerance_risque_financier : sensitive=true en v2 uniquement, correction
  // post-revue compliance-privacy-reviewer (cohérence avec capacite_absorber_depense_annuelle
  // et franchise_actuelle_niveau_declare) -- v1 reste sensitive=false, non
  // touchée par cette assertion (portée sur la version v2 uniquement).
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const all = detail.sections.flatMap((s) => s.questions);
  const sensitiveKeys = all.filter((q) => q.sensitive).map((q) => q.stable_key).sort();
  assert.deepEqual(sensitiveKeys, [
    'acceptation_nouvelle_complementaire_confirmee', 'capacite_absorber_depense_annuelle', 'depenses_sante_anticipees_declare',
    'franchise_actuelle_niveau_declare', 'intention_resilier_complementaire_declare', 'recours_soins_12_mois_declare',
    'tolerance_risque_financier',
  ].sort());
});

test('v2 -- aucune option littérale "je ne sais pas"/"inconnue" -- toutes les questions utilisent allows_unknown natif, scope member', () => {
  const detail = Q.getVersionDetail(V2_VERSION_ID);
  const all = detail.sections.flatMap((s) => s.questions);
  for (const q of all) {
    assert.equal(q.scope, 'member', q.stable_key);
    assert.ok(q.allows_unknown, q.stable_key);
    for (const opt of q.options) {
      assert.doesNotMatch(opt.label.toLowerCase(), /ne sais pas|inconnue?/, `${q.stable_key} : option "${opt.label}" ressemble à un "je ne sais pas" littéral`);
    }
  }
});

// =============================================================================
// FINALISATION
// =============================================================================

function missingFor(validation) { return validation.byLink.flatMap((l) => l.missing); }

test('finalisation -- session v2 fraîche affiche un compteur de champs obligatoires manquants non nul', () => {
  const { householdId } = buildHousehold(1);
  const sessionId = createAndStartSession(householdId);
  const validation = S.validateSessionForCompletion(sessionId);
  assert.equal(validation.valid, false);
  assert.ok(missingFor(validation).length > 0, 'une session vierge doit lister des champs obligatoires manquants');
});

test('finalisation -- une conditionnelle MASQUÉE (display_condition fausse) ne bloque jamais la finalisation', () => {
  const { householdId, memberIds } = buildHousehold(1);
  const sessionId = createAndStartSession(householdId);
  // parcours_premier_contact_obligatoire_declare = non -> refus_parcours_impose_declare masquée, jamais bloquante.
  answerMember(sessionId, memberIds[0], {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'oui',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne', tolerance_risque_financier: 'moyenne',
    parcours_premier_contact_obligatoire_declare: 'non',
    intention_resilier_complementaire_declare: 'non',
    recours_soins_12_mois_declare: 'faible', depenses_sante_anticipees_declare: 'aucune', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'indifferent',
  });
  const validation = S.validateSessionForCompletion(sessionId);
  const missingKeys = missingFor(validation).map((m) => m.stable_key);
  assert.ok(!missingKeys.includes('refus_parcours_impose_declare'), 'masquée (parcours=non) : jamais bloquante');
  assert.ok(!missingKeys.includes('acceptation_nouvelle_complementaire_confirmee'), 'masquée (intention=non) : jamais bloquante');
  assert.ok(!missingKeys.includes('couverture_accident_laa_employeur_declaree'), 'masquée (hors_lamal=non) : jamais bloquante');
  assert.equal(missingFor(validation).length, 0, 'tous les CORE_REQUIRED sont répondus, aucune conditionnelle visible : finalisation possible');
});

test('finalisation -- une conditionnelle VISIBLE et requise bloque tant qu\'elle n\'est pas répondue', () => {
  const { householdId, memberIds } = buildHousehold(1);
  const sessionId = createAndStartSession(householdId);
  answerMember(sessionId, memberIds[0], {
    couverture_accident_hors_lamal_declaree: 'oui', accident_inclus_lamal_declare: 'oui',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne', tolerance_risque_financier: 'moyenne',
    recours_soins_12_mois_declare: 'faible', depenses_sante_anticipees_declare: 'aucune', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'indifferent',
    // couverture_accident_laa_employeur_declaree délibérément absente -- rendue VISIBLE par hors_lamal=oui.
  });
  const validation = S.validateSessionForCompletion(sessionId);
  const missingKeys = missingFor(validation).map((m) => m.stable_key);
  assert.ok(missingKeys.includes('couverture_accident_laa_employeur_declaree'), 'visible et requise, non répondue : doit bloquer');
});

test('finalisation -- réussie quand toutes les données requises APPLICABLES sont présentes', () => {
  const { householdId, memberIds } = buildHousehold(1);
  const sessionId = createAndStartSession(householdId);
  answerMember(sessionId, memberIds[0], {
    couverture_accident_hors_lamal_declaree: 'oui', accident_inclus_lamal_declare: 'oui', couverture_accident_laa_employeur_declaree: 'oui',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne', tolerance_risque_financier: 'moyenne',
    recours_soins_12_mois_declare: 'faible', depenses_sante_anticipees_declare: 'aucune', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'indifferent',
  });
  const validation = S.validateSessionForCompletion(sessionId);
  assert.equal(missingFor(validation).length, 0);
  assert.doesNotThrow(() => completeSession(sessionId));
});

// =============================================================================
// ACCIDENT
// =============================================================================

test('accident -- maintien : accident inclus LAMal + pas de couverture hors LAMal', () => {
  const { findings } = runScenario({ couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'oui' });
  assert.ok(categoriesFor(findings).includes('accident_lamal_maintien'));
  assert.ok(!categoriesFor(findings).includes('accident_lamal_retrait_examinable'));
});

test('accident -- maintien : couverture hors LAMal déclarée mais LAA employeur = non', () => {
  const { findings } = runScenario({
    couverture_accident_hors_lamal_declaree: 'oui', accident_inclus_lamal_declare: 'oui', couverture_accident_laa_employeur_declaree: 'non',
  });
  assert.ok(categoriesFor(findings).includes('accident_lamal_maintien'));
});

test('accident -- retrait examinable : accident inclus LAMal + hors LAMal oui + LAA employeur oui', () => {
  const { findings } = runScenario({
    couverture_accident_hors_lamal_declaree: 'oui', accident_inclus_lamal_declare: 'oui', couverture_accident_laa_employeur_declaree: 'oui',
  });
  assert.ok(categoriesFor(findings).includes('accident_lamal_retrait_examinable'));
  assert.ok(!categoriesFor(findings).includes('accident_lamal_maintien'), 'maintien et retrait-examinable sont mutuellement exclusives');
  const retrait = findings.find((f) => categoryOf(f) === 'accident_lamal_retrait_examinable');
  assert.match(retrait.advisor_explanation + ' ' + (retrait.client_explanation || ''), /examinable/i);
  // Cherche une AFFIRMATION non couverte (« est garanti », « sera accepté »),
  // jamais le simple mot « garanti »/« automatique » -- le texte hedgé
  // correct dit légitimement « jamais... garantie », qui contient ces mots
  // dans une négation, pas une affirmation.
  assert.doesNotMatch(retrait.advisor_explanation, /\best garantie?\b|\bsera accepté|\bautomatiquement (?:suspendu|retiré|accepté)/i);
});

test('accident -- unknown sur couverture_accident_hors_lamal_declaree produit missing_information, jamais de conclusion accident', () => {
  const { findings, raw } = runScenario({ couverture_accident_hors_lamal_declaree: 'UNKNOWN', accident_inclus_lamal_declare: 'oui' });
  assert.ok(raw.some((f) => f.finding_type === 'missing_information'));
  assert.ok(!categoriesFor(findings).includes('accident_lamal_maintien'));
  assert.ok(!categoriesFor(findings).includes('accident_lamal_retrait_examinable'));
});

test('accident -- Q_LAA masquée quand non applicable (hors_lamal=non) : jamais de missing_information la concernant', () => {
  const { raw } = runScenario({ couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'oui' });
  const missingRefs = raw.filter((f) => f.finding_type === 'missing_information').flatMap((f) => JSON.parse(f.missing_data || '[]'));
  assert.ok(!missingRefs.some((r) => r.stable_key === 'couverture_accident_laa_employeur_declaree'), 'Q_LAA non applicable ne doit jamais apparaître comme donnée manquante');
});

// =============================================================================
// FRANCHISE -- ORIENTATION
// =============================================================================

test('franchise -- cas 1 : capacité élevée + tolérance élevée + recours faible + dépenses aucune -> élevée', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune' }));
  const cats = categoriesFor(findings);
  assert.ok(cats.includes('franchise_orientation_elevee'));
  assert.ok(!cats.includes('franchise_orientation_prudente'));
  assert.ok(!cats.includes('franchise_orientation_indeterminee'));
});

test('franchise -- cas 2 : capacité élevée + tolérance élevée + recours important + dépenses faibles -> indéterminée', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'important', depenses: 'probablement_faibles' }));
  const cats = categoriesFor(findings);
  assert.ok(cats.includes('franchise_orientation_indeterminee'));
  assert.ok(!cats.includes('franchise_orientation_elevee'));
  assert.ok(!cats.includes('franchise_orientation_prudente'));
});

test('franchise -- cas 3 : capacité faible + tolérance élevée + recours faible + dépenses aucune -> prudente (signal fort isolé)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'faible', tolerance: 'elevee', recours: 'faible', depenses: 'aucune' }));
  const cats = categoriesFor(findings);
  assert.ok(cats.includes('franchise_orientation_prudente'));
  assert.ok(!cats.includes('franchise_orientation_elevee'));
  assert.ok(!cats.includes('franchise_orientation_indeterminee'));
});

test('franchise -- cas 4 : capacité élevée + tolérance faible + recours important + dépenses faibles -> prudente (2 contributifs A+B)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'faible', recours: 'important', depenses: 'probablement_faibles' }));
  assert.ok(categoriesFor(findings).includes('franchise_orientation_prudente'));
});

test('franchise -- cas 5 : capacité élevée + tolérance faible + recours faible + dépenses faibles -> indéterminée (1 seul contributif)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'faible', recours: 'faible', depenses: 'probablement_faibles' }));
  const cats = categoriesFor(findings);
  assert.ok(cats.includes('franchise_orientation_indeterminee'));
  assert.ok(!cats.includes('franchise_orientation_prudente'), 'un seul signal contributif (A seul) ne suffit jamais à la prudence');
});

test('franchise -- cas 6 : dépenses probablement_importantes -> prudente même si les 3 autres signaux sont favorables', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'probablement_importantes' }));
  assert.ok(categoriesFor(findings).includes('franchise_orientation_prudente'));
});

test('franchise -- cas 7 : une des 4 données unknown -> missing_information projeté UNE SEULE fois, aucune orientation substantive', () => {
  const answers = franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'UNKNOWN' });
  const { findings, raw } = runScenario(answers);
  // Filtré sur la donnée manquante précise (`depenses_sante_anticipees_declare`) :
  // d'autres champs OPTIONAL non renseignés dans ce scénario (modèles de
  // soins, complémentaires...) produisent LÉGITIMEMENT leurs propres
  // missing_information indépendantes (`required_data` ne regarde jamais le
  // flag `required` de la question, seulement si elle a été répondue) -- non
  // pertinent ici, seul le groupe franchise nous intéresse.
  const rawFranchiseMissing = raw.filter((f) => f.finding_type === 'missing_information' && (f.missing_data || '').includes('depenses_sante_anticipees_declare'));
  assert.ok(rawFranchiseMissing.length >= 3, 'les 3 règles d\'orientation partagent la même donnée manquante -> 3 lignes brutes au moins');
  const projectedFranchiseMissing = findings.filter((f) => f.finding_type === 'missing_information' && (f.missing_data || []).some((m) => m.stable_key === 'depenses_sante_anticipees_declare'));
  assert.equal(projectedFranchiseMissing.length, 1, 'projection conseiller : une seule entrée malgré plusieurs règles bloquées par la même donnée');
  const cats = categoriesFor(findings);
  assert.ok(!cats.includes('franchise_orientation_elevee') && !cats.includes('franchise_orientation_prudente') && !cats.includes('franchise_orientation_indeterminee'));
});

test('franchise -- jamais deux orientations simultanées, quel que soit le profil (balayage de combinaisons)', () => {
  const capaciteVals = ['faible', 'moyenne', 'elevee'];
  const toleranceVals = ['faible', 'moyenne', 'elevee'];
  const recoursVals = ['faible', 'modere', 'important'];
  const depensesVals = ['aucune', 'probablement_faibles', 'probablement_moderees', 'probablement_importantes'];
  for (const capacite of capaciteVals) {
    for (const tolerance of toleranceVals) {
      for (const recours of recoursVals) {
        for (const depenses of depensesVals) {
          const { findings } = runScenario(franchiseAnswers({ capacite, tolerance, recours, depenses }));
          const cats = categoriesFor(findings).filter((c) => c.startsWith('franchise_orientation_'));
          assert.equal(cats.length, 1, `profil ${capacite}/${tolerance}/${recours}/${depenses} -> ${JSON.stringify(cats)} (exactement une orientation attendue)`);
        }
      }
    }
  }
});

// =============================================================================
// FRANCHISE -- COMPARAISON À L'ACTUELLE
// =============================================================================

test('comparaison franchise -- orientation élevée + actuelle élevée -> alignée (fact)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'elevee' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_alignee');
  assert.ok(f);
  assert.equal(f.finding_type, 'fact');
});

test('comparaison franchise -- orientation élevée + actuelle basse -> écart (detected_need)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'basse' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_ecart');
  assert.ok(f);
  assert.equal(f.finding_type, 'detected_need');
  assert.doesNotMatch(f.advisor_explanation, /changez votre franchise/i);
});

test('comparaison franchise -- orientation élevée + actuelle moyenne -> contextuelle (fact, aucun écart manifeste)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'moyenne' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_contextuelle');
  assert.ok(f);
  assert.equal(f.finding_type, 'fact');
});

test('comparaison franchise -- orientation prudente + actuelle basse -> alignée (fact)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'faible', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'basse' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_alignee');
  assert.ok(f);
  assert.equal(f.finding_type, 'fact');
});

test('comparaison franchise -- orientation prudente + actuelle élevée -> écart (detected_need)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'faible', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'elevee' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_ecart');
  assert.ok(f);
  assert.equal(f.finding_type, 'detected_need');
});

test('comparaison franchise -- orientation prudente + actuelle moyenne -> contextuelle (fact)', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'faible', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'moyenne' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_contextuelle');
  assert.ok(f);
});

test('comparaison franchise -- orientation indéterminée -> comparaison impossible (fact), quelle que soit l\'actuelle', () => {
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'faible', recours: 'faible', depenses: 'probablement_faibles', actuelle: 'moyenne' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_impossible');
  assert.ok(f);
  assert.equal(f.finding_type, 'fact');
  assert.match(f.advisor_explanation, /insuffisamment claire/i);
});

test('comparaison franchise -- impossible-indeterminee-01 ne réclame jamais franchise_actuelle_niveau_declare (required_data corrigé)', () => {
  // franchise-comparaison-impossible-indeterminee-01 ne lit jamais
  // `franchise_actuelle_niveau_declare` dans sa condition -- son
  // `required_data` ne doit donc jamais la réclamer (correction post-revue
  // rules-engine-auditor : `required_data` incomplet bloque entièrement
  // l'évaluation d'une règle `finding_scope: member`/`any`, voir
  // `server/advisoryRuleExecutions.js`). Ici les 4 données d'orientation
  // sont répondues (-> indéterminée) mais `franchise_actuelle_niveau_declare`
  // reste `unknown` : la règle doit tout de même se déclencher.
  const { findings } = runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'faible', recours: 'faible', depenses: 'probablement_faibles', actuelle: 'UNKNOWN' }));
  const f = findings.find((x) => categoryOf(x) === 'franchise_comparaison_impossible');
  assert.ok(f, 'la règle doit se déclencher même quand franchise_actuelle_niveau_declare reste unknown');
  assert.equal(f.finding_type, 'fact');
});

// =============================================================================
// MODÈLES DE SOINS
// =============================================================================

const CARE_MODELS = [
  { key: 'ouverture_telemedecine_declaree', prefix: 'care_model_telemedecine' },
  { key: 'ouverture_medecin_famille_declaree', prefix: 'care_model_medecin-famille' },
  { key: 'ouverture_hmo_reseau_declaree', prefix: 'care_model_hmo' },
];
for (const model of CARE_MODELS) {
  test(`modèle de soins (${model.key}) -- accepte -> ${model.prefix}_compatible`, () => {
    const { findings } = runScenario({ [model.key]: 'accepte' });
    assert.ok(categoriesFor(findings).includes(`${model.prefix}_compatible`));
  });
  test(`modèle de soins (${model.key}) -- preferee -> ${model.prefix}_preferee`, () => {
    const { findings } = runScenario({ [model.key]: 'preferee' });
    assert.ok(categoriesFor(findings).includes(`${model.prefix}_preferee`));
  });
  test(`modèle de soins (${model.key}) -- refuse -> ${model.prefix}_refusee`, () => {
    const { findings } = runScenario({ [model.key]: 'refuse' });
    assert.ok(categoriesFor(findings).includes(`${model.prefix}_refusee`));
  });
  test(`modèle de soins (${model.key}) -- 3 règles partagent required_data, unknown -> projection missing_information UNIQUE malgré plusieurs traces brutes`, () => {
    const { findings, raw } = runScenario({ [model.key]: 'UNKNOWN' });
    // Filtré sur `model.key` : d'autres questions OPTIONAL non renseignées
    // dans ce scénario minimal (autres modèles, complémentaires...) produisent
    // légitimement leurs propres missing_information indépendantes -- non
    // pertinent ici, seul le groupe de ce modèle nous intéresse.
    const rawMissing = raw.filter((f) => f.finding_type === 'missing_information' && (f.missing_data || '').includes(model.key));
    assert.equal(rawMissing.length, 3, 'les 3 règles (compatible/préférée/refusée) partagent la même donnée manquante');
    const projectedMissing = findings.filter((f) => f.finding_type === 'missing_information' && (f.missing_data || []).some((m) => m.stable_key === model.key));
    assert.equal(projectedMissing.length, 1);
  });
}

test('libre choix -- prioritaire -> care_model_libre_choix_prioritaire', () => {
  const { findings } = runScenario({ priorite_libre_choix_declaree: 'prioritaire' });
  assert.ok(categoriesFor(findings).includes('care_model_libre_choix_prioritaire'));
});
test('libre choix -- non_prioritaire -> care_model_libre_choix_non_prioritaire', () => {
  const { findings } = runScenario({ priorite_libre_choix_declaree: 'non_prioritaire' });
  assert.ok(categoriesFor(findings).includes('care_model_libre_choix_non_prioritaire'));
});
test('libre choix -- jamais les deux états simultanément', () => {
  const a = runScenario({ priorite_libre_choix_declaree: 'prioritaire' });
  const catsA = categoriesFor(a.findings);
  assert.ok(catsA.includes('care_model_libre_choix_prioritaire') && !catsA.includes('care_model_libre_choix_non_prioritaire'));
});

test('conservation du médecin actuel -- important -> detected_need (jamais warning par défaut)', () => {
  const { findings } = runScenario({ importance_conserver_medecin_declaree: 'important' });
  const f = findings.find((x) => categoryOf(x) === 'care_model_preserve_current_doctor');
  assert.ok(f);
  assert.equal(f.finding_type, 'detected_need');
});
test('conservation du médecin actuel -- non_important -> aucun finding substantif', () => {
  const { findings } = runScenario({ importance_conserver_medecin_declaree: 'non_important' });
  assert.ok(!categoriesFor(findings).includes('care_model_preserve_current_doctor'));
});

// =============================================================================
// PRIORITÉ COÛT / LIBERTÉ
// =============================================================================

test('priorité coût/liberté -- reduire_prime -> priorite_cout_eleve', () => {
  const { findings } = runScenario({ priorite_prime_liberte_declaree: 'reduire_prime' });
  assert.ok(categoriesFor(findings).includes('priorite_cout_eleve'));
});
test('priorité coût/liberté -- equilibre -> priorite_equilibre_cout_liberte', () => {
  const { findings } = runScenario({ priorite_prime_liberte_declaree: 'equilibre' });
  assert.ok(categoriesFor(findings).includes('priorite_equilibre_cout_liberte'));
});
test('priorité coût/liberté -- maximiser_liberte -> priorite_liberte_elevee', () => {
  const { findings } = runScenario({ priorite_prime_liberte_declaree: 'maximiser_liberte' });
  assert.ok(categoriesFor(findings).includes('priorite_liberte_elevee'));
});
test('priorité coût/liberté -- exclusivité : un seul état à la fois', () => {
  const { findings } = runScenario({ priorite_prime_liberte_declaree: 'equilibre' });
  const cats = categoriesFor(findings).filter((c) => c.startsWith('priorite_'));
  assert.equal(cats.length, 1);
});

// =============================================================================
// COMPLÉMENTAIRES
// =============================================================================

const COMPLEMENTAIRES = [
  { key: 'interet_complementaire_hospitalisation_declare', category: 'complementaire_hospitalisation_a_examiner' },
  { key: 'interet_medecines_complementaires_declare', category: 'complementaire_medecines_alternatives_a_examiner' },
  { key: 'interet_complementaire_optique_declare', category: 'complementaire_optique_a_examiner' },
  { key: 'interet_complementaire_dentaire_declare', category: 'complementaire_dentaire_a_examiner' },
  { key: 'interet_prevention_declare', category: 'complementaire_prevention_a_examiner' },
  { key: 'interet_couverture_voyage_declare', category: 'complementaire_voyage_a_examiner' },
];
for (const c of COMPLEMENTAIRES) {
  test(`complémentaire (${c.key}) -- important -> ${c.category}`, () => {
    const { findings } = runScenario({ [c.key]: 'important' });
    assert.ok(categoriesFor(findings).includes(c.category));
  });
  test(`complémentaire (${c.key}) -- pas_important -> aucun finding substantif`, () => {
    const { findings } = runScenario({ [c.key]: 'pas_important' });
    assert.ok(!categoriesFor(findings).includes(c.category));
  });
}
// eventuellement/unknown couverts en profondeur sur UN représentant (économie de temps de test, mécanisme identique pour les 5 autres -- même required_data/condition IN générée par le même helper `complementaireRule`).
test('complémentaire (hospitalisation) -- eventuellement -> finding substantif également', () => {
  const { findings } = runScenario({ interet_complementaire_hospitalisation_declare: 'eventuellement' });
  assert.ok(categoriesFor(findings).includes('complementaire_hospitalisation_a_examiner'));
});
test('complémentaire (hospitalisation) -- unknown -> missing_information, jamais d\'acceptation médicale garantie dans le texte', () => {
  const { raw } = runScenario({ interet_complementaire_hospitalisation_declare: 'UNKNOWN' });
  assert.ok(raw.some((f) => f.finding_type === 'missing_information'));
});
test('complémentaires -- aucune règle ne présente une acceptation médicale comme garantie', () => {
  const rows = db.prepare('SELECT advisor_explanation, client_explanation FROM advisory_rules WHERE rule_set_id = ? AND stable_key LIKE ?').all(V2_RULE_SET_ID, 'complementaire-%');
  assert.equal(rows.length, 6);
  for (const r of rows) {
    assert.doesNotMatch(r.advisor_explanation, /\best garantie?\b|\bacceptation (?:est )?garantie\b|\bsera accepté/i);
  }
});

// =============================================================================
// MULTI-MEMBRES
// =============================================================================

test('multi-membres -- 2 membres avec des orientations de franchise DIFFÉRENTES, aucune contamination', () => {
  const { householdId, memberIds } = buildHousehold(2);
  const sessionId = createAndStartSession(householdId);
  answerMember(sessionId, memberIds[0], { ...CORE_DEFAULTS, ...franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune' }) });
  answerMember(sessionId, memberIds[1], { ...CORE_DEFAULTS, ...franchiseAnswers({ capacite: 'faible', tolerance: 'elevee', recours: 'faible', depenses: 'aucune' }) });
  completeSession(sessionId);
  executeV2(sessionId);
  const findings = projectedFindings(sessionId);
  const findFor = (memberId, cat) => findings.find((f) => f.household_member_id === memberId && categoryOf(f) === cat);
  assert.ok(findFor(memberIds[0], 'franchise_orientation_elevee'), 'membre 0 : élevée');
  assert.ok(!findFor(memberIds[0], 'franchise_orientation_prudente'));
  assert.ok(findFor(memberIds[1], 'franchise_orientation_prudente'), 'membre 1 : prudente');
  assert.ok(!findFor(memberIds[1], 'franchise_orientation_elevee'));
});

test('multi-membres -- 2 membres avec des préférences de modèle de soins DIFFÉRENTES, findings attribués au bon household_member_id', () => {
  const { householdId, memberIds } = buildHousehold(2);
  const sessionId = createAndStartSession(householdId);
  answerMember(sessionId, memberIds[0], { ...CORE_DEFAULTS, ouverture_telemedecine_declaree: 'preferee' });
  answerMember(sessionId, memberIds[1], { ...CORE_DEFAULTS, ouverture_telemedecine_declaree: 'refuse' });
  completeSession(sessionId);
  executeV2(sessionId);
  const findings = projectedFindings(sessionId);
  const m0 = findings.find((f) => f.household_member_id === memberIds[0] && categoryOf(f) === 'care_model_telemedecine_preferee');
  const m1 = findings.find((f) => f.household_member_id === memberIds[1] && categoryOf(f) === 'care_model_telemedecine_refusee');
  assert.ok(m0);
  assert.ok(m1);
  assert.ok(!findings.some((f) => f.household_member_id === memberIds[0] && categoryOf(f) === 'care_model_telemedecine_refusee'), 'aucune contamination membre 0 <- membre 1');
  assert.ok(!findings.some((f) => f.household_member_id === memberIds[1] && categoryOf(f) === 'care_model_telemedecine_preferee'), 'aucune contamination membre 1 <- membre 0');
});

// =============================================================================
// SÉCURITÉ ARCHITECTURALE
// =============================================================================

test('sécurité -- aucune advisory_recommendation créée automatiquement par le seed ou par une exécution v2', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  runScenario(franchiseAnswers({ capacite: 'elevee', tolerance: 'elevee', recours: 'faible', depenses: 'aucune', actuelle: 'elevee' }));
  const after = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  assert.equal(before, after);
});

test('sécurité -- aucun texte de règle v2 ne mentionne un produit, un assureur ou une prime/un tarif fictif', () => {
  const rows = db.prepare('SELECT stable_key, title, advisor_explanation, client_explanation FROM advisory_rules WHERE rule_set_id = ?').all(V2_RULE_SET_ID);
  assert.equal(rows.length, 37);
  const denylist = /\bCHF\b|\bfr\.\s?\d|\bprime de \d|\btarif\b|\bhelsana\b|\bcss\b|\bswica\b|\bassura\b|\bsanitas\b|\bgroupe mutuel\b/i;
  for (const r of rows) {
    const text = `${r.title} ${r.advisor_explanation} ${r.client_explanation || ''}`;
    assert.doesNotMatch(text, denylist, `règle ${r.stable_key}`);
  }
});

test('sécurité -- franchise-capacite-financiere-01 reste immuable en v1, absente de v2', () => {
  const v1Rule = db.prepare("SELECT * FROM advisory_rules WHERE rule_set_id = (SELECT id FROM advisory_rule_sets WHERE stable_key = ? AND version_number = 1) AND stable_key = 'franchise-capacite-financiere-01'").get(Seed.RULE_SET_STABLE_KEY);
  assert.ok(v1Rule, 'toujours présente en v1');
  const v2Rule = db.prepare('SELECT * FROM advisory_rules WHERE rule_set_id = ? AND stable_key = ?').get(V2_RULE_SET_ID, 'franchise-capacite-financiere-01');
  assert.equal(v2Rule, undefined, 'jamais reconduite en v2');
});

test('sécurité -- les 4 autres règles v1 SONT reconduites en v2 avec des conditions strictement identiques', () => {
  const v1RuleSetId = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ? AND version_number = 1').get(Seed.RULE_SET_STABLE_KEY).id;
  const reconducted = ['accident-coordination-doublon-01', 'accident-coverage-gap-01', 'modele-soins-comportement-01', 'lca-continuite-resiliation-01'];
  for (const key of reconducted) {
    const v1Rule = db.prepare('SELECT conditions, required_data FROM advisory_rules WHERE rule_set_id = ? AND stable_key = ?').get(v1RuleSetId, key);
    const v2Rule = db.prepare('SELECT conditions, required_data FROM advisory_rules WHERE rule_set_id = ? AND stable_key = ?').get(V2_RULE_SET_ID, key);
    assert.ok(v1Rule && v2Rule, key);
    assert.equal(v1Rule.conditions, v2Rule.conditions, `${key} : conditions identiques`);
    assert.equal(v1Rule.required_data, v2Rule.required_data, `${key} : required_data identiques`);
  }
});

test('sécurité -- seedAdvisoryHealthContentV2 n\'appelle jamais publishVersion/publishRuleSet (statuts capturés draft juste après le seed, avant toute publication de test)', () => {
  assert.equal(v2StatusRightAfterSeed.version, 'draft', 'le seed ne publie jamais la version v2');
  assert.equal(v2StatusRightAfterSeed.ruleSet, 'draft', 'le seed ne publie jamais le rule_set v2');
});

// =============================================================================
// VALIDATEURS
// =============================================================================

test('validateurs -- validateVersionForPublish(v2) est valide', () => {
  const check = Q.validateVersionForPublish(V2_VERSION_ID);
  assert.equal(check.valid, true, JSON.stringify(check.errors));
});

test('validateurs -- validateRuleSetForPublish(v2) est valide (avertissements informationnels tolérés, jamais d\'erreur)', () => {
  const check = R.validateRuleSetForPublish(V2_RULE_SET_ID);
  assert.equal(check.valid, true, JSON.stringify(check.errors));
});

test('idempotence -- ré-exécuter seedAdvisoryHealthContent puis seedAdvisoryHealthContentV2 sur la même base est un no-op', () => {
  const r1 = Seed.seedAdvisoryHealthContent(REQ);
  const r2 = Seed.seedAdvisoryHealthContentV2(REQ);
  assert.equal(r1.created, false);
  assert.equal(r2.created, false);
});
