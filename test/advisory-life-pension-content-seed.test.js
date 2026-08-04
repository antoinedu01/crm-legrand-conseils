// Tests du contenu métier réel Vie et Prévoyance — LOT 6 phase 1 (Legrand
// Diagnostic 360). Base de test isolée (CRM_DATA_DIR), jamais data/**.
// Le script de provisioning réel (server/seed-advisory-life-pension-content.js)
// ne publie jamais rien (brouillon uniquement) — les tests ci-dessous
// PUBLIENT une copie du contenu dans cette base de test ISOLÉE, uniquement
// pour prouver sa conformité structurelle et son comportement réel ; cela
// ne constitue jamais une publication réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-life-pension-seed-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const R = await import('../server/advisoryRules.js');
const S = await import('../server/advisorySessions.js');
const E = await import('../server/advisoryRuleExecutions.js');
const {
  seedAdvisoryLifePensionContent, QUESTIONNAIRE_STABLE_KEY, RULE_SET_STABLE_KEY,
} = await import('../server/seed-advisory-life-pension-content.js');

const REQ = { session: { userEmail: 'conseiller-vie-prevoyance@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-vie-prevoyance@exemple.ch', 'Conseiller', 'x');

function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
let clientCounter = 0;
function insertClient() {
  clientCounter += 1;
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', `P${clientCounter}`, 'Test', 'prospect').lastInsertRowid;
}
function buildHousehold({ withSecondMember = false } = {}) {
  const principalClientId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalClientId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  let secondMemberId = null;
  if (withSecondMember) {
    const secondClientId = insertClient();
    const { id } = addMember(householdId, { member_role: 'conjoint', client_id: secondClientId }, REQ);
    secondMemberId = id;
  }
  return { householdId, principalMemberId: principalMember.id, secondMemberId };
}

// --- Provisioning du contenu réel (une fois pour tout le fichier) ---

const seedResult = seedAdvisoryLifePensionContent(REQ);
assert.equal(seedResult.created, true);

test('seedAdvisoryLifePensionContent — questionnaire créé en brouillon avec les 10 questions exactes', () => {
  const questionnaire = db.prepare('SELECT * FROM advisory_questionnaires WHERE stable_key = ?').get(QUESTIONNAIRE_STABLE_KEY);
  assert.ok(questionnaire);
  assert.equal(questionnaire.domain, 'life_pension');
  const version = db.prepare('SELECT * FROM advisory_questionnaire_versions WHERE id = ?').get(seedResult.versionId);
  assert.equal(version.status, 'draft');

  const detail = Q.getVersionDetail(seedResult.versionId);
  assert.equal(detail.sections.length, 1);
  assert.equal(detail.sections[0].applies_to, 'member');
  const questions = detail.sections[0].questions;
  assert.equal(questions.length, 10);

  const expectedKeys = [
    'statut_professionnel_declare', 'dependance_revenu_professionnel_declare',
    'personnes_dependantes_financierement_declare', 'couverture_deces_connue_declare',
    'couverture_incapacite_gain_connue_declare', 'prevoyance_professionnelle_volontaire_connue_declare',
    'epargne_retraite_volontaire_existante_declare', 'souhait_ameliorer_preparation_retraite_declare',
    'changement_familial_patrimonial_recent_declare', 'revision_recente_beneficiaires_protections_declare',
  ];
  assert.deepEqual(questions.map((q) => q.stable_key), expectedKeys);
  // required: true (correction du dossier d'approbation, §5) sur les 3
  // questions de couverture référencées par la règle C — allows_unknown
  // reste true pour toutes les questions, y compris ces 3.
  const REQUIRED_KEYS = [
    'couverture_deces_connue_declare', 'couverture_incapacite_gain_connue_declare',
    'prevoyance_professionnelle_volontaire_connue_declare',
  ];
  for (const q of questions) {
    assert.equal(q.type, 'single_choice');
    assert.equal(q.scope, 'member');
    assert.equal(q.allows_unknown, 1);
    assert.equal(q.required, REQUIRED_KEYS.includes(q.stable_key) ? 1 : 0, `${q.stable_key} : required inattendu`);
  }
  const sensitiveKeys = questions.filter((q) => q.sensitive === 1).map((q) => q.stable_key).sort();
  assert.deepEqual(sensitiveKeys, [
    'changement_familial_patrimonial_recent_declare', 'couverture_deces_connue_declare',
    'couverture_incapacite_gain_connue_declare', 'personnes_dependantes_financierement_declare',
    'revision_recente_beneficiaires_protections_declare',
  ].sort());
  assert.equal(sensitiveKeys.length, 5);

  const byKey = Object.fromEntries(questions.map((q) => [q.stable_key, q]));
  assert.deepEqual(byKey.statut_professionnel_declare.options.map((o) => o.value), ['salarie', 'independant', 'sans_emploi', 'autre']);
  for (const q of questions) {
    if (q.stable_key === 'statut_professionnel_declare') continue;
    assert.deepEqual(q.options.map((o) => o.value), ['oui', 'non'], `${q.stable_key} doit avoir exactement les options oui/non`);
    assert.ok(!q.options.some((o) => o.value === 'inconnue'), `${q.stable_key} ne doit pas avoir d'option "inconnue" littérale`);
  }

  // Aucune collecte interdite dans les libellés (texte libre non utilisé de toute façon, vérification de contenu).
  const forbidden = /salaire exact|patrimoine exact|diagnostic|traitement médical|numéro de police|nom d.assureur|nom du produit/i;
  for (const q of questions) {
    assert.ok(!forbidden.test(q.advisor_text));
    assert.ok(!forbidden.test(q.client_text || ''));
  }
});

// --- Correction §4 du dossier d'approbation : affiliation facultative,
// jamais un rachat volontaire ---

test('prevoyance_professionnelle_volontaire_connue_declare — texte relatif à l’affiliation facultative, jamais au rachat', () => {
  const detail = Q.getVersionDetail(seedResult.versionId);
  const q = detail.sections[0].questions.find((x) => x.stable_key === 'prevoyance_professionnelle_volontaire_connue_declare');
  assert.ok(q);
  assert.match(q.advisor_text, /affiliation facultative/i);
  assert.match(q.client_text, /affilié/i);
  assert.doesNotMatch(q.advisor_text, /rachat/i, 'le texte conseiller ne doit plus employer le terme « rachat »');
  assert.doesNotMatch(q.client_text, /rachat/i, 'le texte client ne doit plus employer le terme « rachat »');
  assert.deepEqual(q.options.map((o) => o.value), ['oui', 'non']);
  assert.equal(q.allows_unknown, 1);
});

test('seedAdvisoryLifePensionContent — ensemble de règles créé en brouillon avec les 5 règles exactes', () => {
  const ruleSet = db.prepare('SELECT * FROM advisory_rule_sets WHERE stable_key = ?').get(RULE_SET_STABLE_KEY);
  assert.ok(ruleSet);
  assert.equal(ruleSet.status, 'draft');
  assert.equal(ruleSet.domain, 'life_pension');

  const detail = R.getRuleSetDetail(seedResult.ruleSetId);
  assert.equal(detail.rules.length, 5);
  const byKey = Object.fromEntries(detail.rules.map((r) => [r.stable_key, r]));

  assert.equal(byKey['deces-couverture-absente-01'].result_finding_type, 'gap');
  assert.equal(byKey['deces-couverture-absente-01'].priority, 'high');
  assert.equal(byKey['deces-couverture-absente-01'].result_payload.category_hint, 'deces_coverage_gap');

  assert.equal(byKey['incapacite-gain-couverture-absente-01'].result_finding_type, 'gap');
  assert.equal(byKey['incapacite-gain-couverture-absente-01'].priority, 'high');

  assert.equal(byKey['independant-couverture-incertaine-01'].result_finding_type, 'warning');
  assert.equal(byKey['independant-couverture-incertaine-01'].priority, 'medium');
  // Décision délibérée : required_data de C ne référence QUE le statut professionnel.
  assert.deepEqual(byKey['independant-couverture-incertaine-01'].required_data, [{ answer: 'statut_professionnel_declare' }]);

  assert.equal(byKey['retraite-epargne-absente-01'].result_finding_type, 'detected_need');
  assert.equal(byKey['retraite-epargne-absente-01'].priority, 'medium');

  assert.equal(byKey['beneficiaires-situation-a-revoir-01'].result_finding_type, 'warning');
  assert.equal(byKey['beneficiaires-situation-a-revoir-01'].priority, 'medium');

  for (const r of detail.rules) {
    assert.equal(r.finding_scope, 'member');
    assert.equal(r.status, 'active');
    assert.ok(r.source && r.source.trim().length > 0);
    assert.ok(r.source_reference && r.source_reference.trim().length > 0);
    assert.ok(r.effective_from);
    assert.ok(r.advisor_explanation && r.advisor_explanation.trim().length > 0);
    const rootOp = r.conditions.op;
    assert.equal(rootOp, 'any', `${r.stable_key} : racine doit être un quantificateur "any"`);
  }

  // Seuls des assureurs nommés ne doivent JAMAIS apparaître, négation ou
  // pas. Les mentions génériques (« produit », « assureur », « 3a », « 3b »)
  // sont normales dans les clauses de négation (« ne jamais recommander un
  // 3a... ») — mêmes conventions déjà établies au LOT 5.
  const forbidden = /\bcss\b|\bhelvetia\b|\baxa\b|\bzurich\b|\bswisslife\b|\bswiss life\b|\bgroupe mutuel\b|\bsanitas\b|\bvisana\b|\bconcordia\b|\bgenerali\b|\ballianz\b|\bbaloise\b|\bbâloise\b|\bsympany\b/i;
  for (const r of detail.rules) {
    assert.ok(!forbidden.test(r.advisor_explanation), `${r.stable_key} : texte conseiller contient un terme interdit`);
    assert.ok(!forbidden.test(r.client_explanation || ''), `${r.stable_key} : texte client contient un terme interdit`);
  }
});

test('seedAdvisoryLifePensionContent — idempotent : un second appel ne recrée rien', () => {
  const before = {
    questionnaires: db.prepare('SELECT COUNT(*) AS n FROM advisory_questionnaires').get().n,
    questions: db.prepare('SELECT COUNT(*) AS n FROM advisory_questions').get().n,
    ruleSets: db.prepare('SELECT COUNT(*) AS n FROM advisory_rule_sets').get().n,
    rules: db.prepare('SELECT COUNT(*) AS n FROM advisory_rules').get().n,
  };
  const second = seedAdvisoryLifePensionContent(REQ);
  assert.equal(second.created, false);
  const after = {
    questionnaires: db.prepare('SELECT COUNT(*) AS n FROM advisory_questionnaires').get().n,
    questions: db.prepare('SELECT COUNT(*) AS n FROM advisory_questions').get().n,
    ruleSets: db.prepare('SELECT COUNT(*) AS n FROM advisory_rule_sets').get().n,
    rules: db.prepare('SELECT COUNT(*) AS n FROM advisory_rules').get().n,
  };
  assert.deepEqual(after, before);
});

test('validateRuleSetForPublish — les 5 règles sont structurellement publiables une fois le questionnaire publié (preuve empirique, test uniquement)', () => {
  Q.publishVersion(seedResult.versionId, REQ);
  const check = R.validateRuleSetForPublish(seedResult.ruleSetId);
  assert.deepEqual(check.errors, []);
  assert.equal(check.valid, true);
  R.publishRuleSet(seedResult.ruleSetId, REQ);
  const published = db.prepare('SELECT status FROM advisory_rule_sets WHERE id = ?').get(seedResult.ruleSetId);
  assert.equal(published.status, 'published');
});

// --- Exécution réelle des 5 règles ---

function startedSession(householdId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'life_pension',
    questionnaire_versions: [{ questionnaire_version_id: seedResult.versionId, domain: 'life_pension', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
function questionId(stableKey) {
  return db.prepare('SELECT id FROM advisory_questions WHERE questionnaire_version_id = ? AND stable_key = ?').get(seedResult.versionId, stableKey).id;
}
function answer(sessionId, memberId, stableKey, value) {
  S.recordAnswers(sessionId, [{ question_id: questionId(stableKey), household_member_id: memberId, status: 'answered', value }], rev(sessionId), REQ);
}
function answerUnknown(sessionId, memberId, stableKey) {
  S.recordAnswers(sessionId, [{ question_id: questionId(stableKey), household_member_id: memberId, status: 'unknown' }], rev(sessionId), REQ);
}
// required: true (correction §5) sur ces 3 questions — une session ne peut
// plus être finalisée sans réponse (y compris "unknown") à chacune d'elles,
// pour le ou les membres réellement actifs. La plupart des tests ci-dessous
// portent sur une autre règle : `runAndGetFindings` complète automatiquement,
// avec une valeur neutre, celles que le scénario testé n'a pas explicitement
// renseignées, pour ne jamais changer le comportement de la règle réellement
// testée (voir les tests dédiés à la complétude et à la règle C plus bas
// pour les scénarios qui, eux, laissent délibérément ces questions absentes).
const REQUIRED_COVERAGE_KEYS = [
  'couverture_deces_connue_declare', 'couverture_incapacite_gain_connue_declare',
  'prevoyance_professionnelle_volontaire_connue_declare',
];
function runAndGetFindings(householdId, memberId, answers) {
  const sessionId = startedSession(householdId);
  const touched = new Set();
  for (const [key, value] of answers) {
    touched.add(key);
    if (value === 'unknown') answerUnknown(sessionId, memberId, key);
    else answer(sessionId, memberId, key, value);
  }
  for (const key of REQUIRED_COVERAGE_KEYS) {
    if (!touched.has(key)) answer(sessionId, memberId, key, 'oui');
  }
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: seedResult.ruleSetId });
  const findings = E.listActiveFindings(sessionId, {}, REQ);
  return { sessionId, findings };
}

test('Règle A (décès) — déclenchement : dépendants oui + couverture décès non connue', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['personnes_dependantes_financierement_declare', 'oui'],
    ['couverture_deces_connue_declare', 'non'],
  ]);
  const a = findings.find((f) => f.stable_key === 'deces-couverture-absente-01');
  assert.ok(a);
  assert.equal(a.finding_type, 'gap');
  assert.equal(a.household_member_id, principalMemberId);
});

test('Règle A — non-déclenchement : couverture décès connue (oui)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['personnes_dependantes_financierement_declare', 'oui'],
    ['couverture_deces_connue_declare', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'gap'));
});

test('Règle A — réponse "inconnue" explicite à la couverture décès déclenche missing_information, jamais gap', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings: f1 } = runAndGetFindings(householdId, principalMemberId, [
    ['personnes_dependantes_financierement_declare', 'oui'],
    ['couverture_deces_connue_declare', 'unknown'],
  ]);
  assert.ok(!f1.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'gap'));
  assert.ok(f1.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'missing_information'));
});

// L'ancien second cas de ce test (session finalisée avec `couverture_deces_
// connue_declare` totalement absente, jamais posée) n'est plus atteignable
// depuis la correction §5 du dossier d'approbation : voir la section
// « Complétude » plus bas, qui prouve directement que cette absence bloque
// désormais la finalisation au lieu de produire un missing_information a
// posteriori.

test('Règle B (incapacité de gain) — déclenchement : dépendance revenu oui + couverture non connue', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['dependance_revenu_professionnel_declare', 'oui'],
    ['couverture_incapacite_gain_connue_declare', 'non'],
  ]);
  const b = findings.find((f) => f.stable_key === 'incapacite-gain-couverture-absente-01');
  assert.ok(b);
  assert.equal(b.finding_type, 'gap');
  assert.equal(b.priority, 'high');
});

test('Règle B — non-déclenchement : pas de dépendance principale au revenu', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['dependance_revenu_professionnel_declare', 'non'],
    ['couverture_incapacite_gain_connue_declare', 'non'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'incapacite-gain-couverture-absente-01' && f.finding_type === 'gap'));
});

test('Règle C (indépendant incertain) — déclenchement : indépendant + une couverture explicitement inconnue', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['statut_professionnel_declare', 'independant'],
    ['couverture_deces_connue_declare', 'unknown'],
    ['couverture_incapacite_gain_connue_declare', 'oui'],
    ['prevoyance_professionnelle_volontaire_connue_declare', 'non'],
  ]);
  const c = findings.find((f) => f.stable_key === 'independant-couverture-incertaine-01');
  assert.ok(c, 'la règle C doit se déclencher sur une seule incertitude explicite parmi les trois');
  assert.equal(c.finding_type, 'warning');
  // Ne doit jamais produire missing_information pour C : le statut professionnel est connu,
  // et C ne déclare que cette seule donnée en required_data.
  assert.ok(!findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01' && f.finding_type === 'missing_information'));
});

test('Règle C — non-déclenchement : indépendant mais les trois couvertures répondues clairement (oui/non, aucune inconnue)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['statut_professionnel_declare', 'independant'],
    ['couverture_deces_connue_declare', 'oui'],
    ['couverture_incapacite_gain_connue_declare', 'non'],
    ['prevoyance_professionnelle_volontaire_connue_declare', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01'));
});

test('Règle C — non-déclenchement : salarié avec une couverture inconnue (statut non indépendant)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['statut_professionnel_declare', 'salarie'],
    ['couverture_deces_connue_declare', 'unknown'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01'));
});

test('Règle C — le cas autrefois silencieux (indépendant, les trois couvertures jamais répondues du tout) est désormais bloqué à la finalisation, jamais un déclenchement manqué en silence', () => {
  // Correction §5 du dossier d'approbation : avant cette correction, ce
  // scénario finalisait normalement une session sans jamais déclencher la
  // règle C ni aucun missing_information la concernant — un trou d'analyse
  // silencieux. Reproduit ici SANS passer par runAndGetFindings (qui
  // complète désormais automatiquement ces 3 questions pour les autres
  // tests) : construit délibérément la session avec le statut indépendant
  // seul, les 3 questions de couverture jamais posées.
  const { householdId, principalMemberId } = buildHousehold();
  const sessionId = startedSession(householdId);
  answer(sessionId, principalMemberId, 'statut_professionnel_declare', 'independant');
  assert.throws(
    () => S.completeSession(sessionId, rev(sessionId), REQ),
    (err) => err.status === 409,
    'la session ne doit plus jamais pouvoir être finalisée avec ces 3 questions de couverture jamais répondues'
  );
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  assert.equal(status, 'in_progress', 'la session reste non finalisée — aucune exécution du moteur n’a pu avoir lieu');
});

test('Règle C — statut professionnel lui-même absent déclenche missing_information pour C', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_deces_connue_declare', 'unknown'],
  ]);
  assert.ok(findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01' && f.finding_type === 'missing_information'));
});

// --- Complétude (correction §5 du dossier d'approbation) ---
// required: true s'applique à la QUESTION, jamais conditionnellement au
// statut professionnel — vérifié ici pour un membre salarié, pour prouver
// que ce n'est pas une règle réservée aux indépendants.

test('Complétude — une réponse absente à l’une des 3 questions de couverture bloque la finalisation, quel que soit le statut professionnel', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const sessionId = startedSession(householdId);
  answer(sessionId, principalMemberId, 'statut_professionnel_declare', 'salarie');
  answer(sessionId, principalMemberId, 'couverture_deces_connue_declare', 'oui');
  answer(sessionId, principalMemberId, 'couverture_incapacite_gain_connue_declare', 'non');
  // prevoyance_professionnelle_volontaire_connue_declare jamais répondue.
  assert.throws(
    () => S.completeSession(sessionId, rev(sessionId), REQ),
    (err) => err.status === 409,
  );
});

test('Complétude — une réponse "unknown" explicite aux 3 questions de couverture satisfait la finalisation (allows_unknown reste vrai)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const sessionId = startedSession(householdId);
  answerUnknown(sessionId, principalMemberId, 'couverture_deces_connue_declare');
  answerUnknown(sessionId, principalMemberId, 'couverture_incapacite_gain_connue_declare');
  answerUnknown(sessionId, principalMemberId, 'prevoyance_professionnelle_volontaire_connue_declare');
  const result = S.completeSession(sessionId, rev(sessionId), REQ);
  assert.equal(result.ok, true);
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  assert.equal(status, 'completed');
});

test('Complétude — foyer à deux membres : la réponse manquante d’UN SEUL membre suffit à bloquer la finalisation de toute la session', () => {
  const { householdId, principalMemberId, secondMemberId } = buildHousehold({ withSecondMember: true });
  const sessionId = startedSession(householdId);
  for (const key of REQUIRED_COVERAGE_KEYS) answer(sessionId, principalMemberId, key, 'oui');
  // Le second membre ne répond à aucune des 3 questions requises.
  assert.throws(
    () => S.completeSession(sessionId, rev(sessionId), REQ),
    (err) => {
      assert.equal(err.status, 409);
      const missingForSecondMember = err.missing.some((link) => link.missing.some((m) => m.household_member_id === secondMemberId));
      assert.ok(missingForSecondMember, 'le second membre doit bien être identifié comme la cause du blocage');
      return true;
    },
  );
});

test('Règle D (épargne retraite) — déclenchement : aucune épargne + souhait d’amélioration', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['epargne_retraite_volontaire_existante_declare', 'non'],
    ['souhait_ameliorer_preparation_retraite_declare', 'oui'],
  ]);
  const d = findings.find((f) => f.stable_key === 'retraite-epargne-absente-01');
  assert.ok(d);
  assert.equal(d.finding_type, 'detected_need');
});

test('Règle D — non-déclenchement : épargne déjà existante', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['epargne_retraite_volontaire_existante_declare', 'oui'],
    ['souhait_ameliorer_preparation_retraite_declare', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'retraite-epargne-absente-01'));
});

test('Règle E (bénéficiaires) — déclenchement : changement récent + révision non faite', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['changement_familial_patrimonial_recent_declare', 'oui'],
    ['revision_recente_beneficiaires_protections_declare', 'non'],
  ]);
  const e = findings.find((f) => f.stable_key === 'beneficiaires-situation-a-revoir-01');
  assert.ok(e);
  assert.equal(e.finding_type, 'warning');
});

test('Règle E — non-déclenchement : révision déjà faite', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['changement_familial_patrimonial_recent_declare', 'oui'],
    ['revision_recente_beneficiaires_protections_declare', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'beneficiaires-situation-a-revoir-01'));
});

test('Portée membre — fan-out correct sur un foyer à deux membres (un seul membre concerné)', () => {
  const { householdId, principalMemberId, secondMemberId } = buildHousehold({ withSecondMember: true });
  const sessionId = startedSession(householdId);
  answer(sessionId, principalMemberId, 'personnes_dependantes_financierement_declare', 'oui');
  answer(sessionId, principalMemberId, 'couverture_deces_connue_declare', 'non');
  answer(sessionId, secondMemberId, 'personnes_dependantes_financierement_declare', 'oui');
  answer(sessionId, secondMemberId, 'couverture_deces_connue_declare', 'oui');
  // required: true (correction §5) sur les 2 autres questions de couverture
  // — nécessaire aux DEUX membres pour que la session puisse se finaliser.
  for (const member of [principalMemberId, secondMemberId]) {
    answer(sessionId, member, 'couverture_incapacite_gain_connue_declare', 'oui');
    answer(sessionId, member, 'prevoyance_professionnelle_volontaire_connue_declare', 'oui');
  }
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: seedResult.ruleSetId });
  const findings = E.listActiveFindings(sessionId, {}, REQ);
  const aFindings = findings.filter((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'gap');
  assert.equal(aFindings.length, 1, 'un seul membre remplit la condition — un seul finding, jamais deux ni un finding de foyer');
  assert.equal(aFindings[0].household_member_id, principalMemberId);
});

test('Aucune recommandation, aucun produit, aucun assureur, aucun montant calculé automatiquement', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const before = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['personnes_dependantes_financierement_declare', 'oui'],
    ['couverture_deces_connue_declare', 'non'],
    ['dependance_revenu_professionnel_declare', 'oui'],
    ['couverture_incapacite_gain_connue_declare', 'non'],
    ['statut_professionnel_declare', 'independant'],
    ['prevoyance_professionnelle_volontaire_connue_declare', 'unknown'],
    ['epargne_retraite_volontaire_existante_declare', 'non'],
    ['souhait_ameliorer_preparation_retraite_declare', 'oui'],
    ['changement_familial_patrimonial_recent_declare', 'oui'],
    ['revision_recente_beneficiaires_protections_declare', 'non'],
  ]);
  const after = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  assert.equal(after, before, 'aucune recommandation ne doit être créée par une exécution du moteur de règles');
  // Aucun montant chiffré (capital/rente) ni assureur nommé dans les findings
  // produits. Les mentions génériques (« 3a », « 3b ») restent normales dans
  // les clauses de négation, non interdites ici (même principe que ci-dessus).
  const forbidden = /\bCHF\s*\d|(?<!\w)\d+\s*(francs|CHF)|\bcss\b|\bhelvetia\b|\baxa\b|\bzurich\b|\bswisslife\b|\bswiss life\b/i;
  for (const f of findings) {
    assert.ok(!forbidden.test(f.advisor_explanation || ''), `finding ${f.stable_key} contient un terme interdit`);
    assert.ok(!forbidden.test(f.client_explanation || ''), `finding ${f.stable_key} contient un terme interdit`);
  }
});

test('Aucune valeur de réponse de session en clair dans le journal audit', () => {
  const rows = db.prepare("SELECT details FROM audit_log WHERE action IN ('réponse enregistrée', 'réponse remplacée')").all();
  assert.ok(rows.length > 0, 'des réponses de session ont bien été enregistrées pendant ces tests');
  for (const row of rows) {
    assert.ok(!/\boui\b|\bnon\b|\bindependant\b|\bsalarie\b/i.test(row.details || ''), 'le journal d\'audit ne doit jamais contenir la valeur d\'une réponse de session');
  }
});
