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
  for (const q of questions) {
    assert.equal(q.type, 'single_choice');
    assert.equal(q.scope, 'member');
    assert.equal(q.allows_unknown, 1);
    assert.equal(q.required, 0);
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
function runAndGetFindings(householdId, memberId, answers) {
  const sessionId = startedSession(householdId);
  for (const [key, value] of answers) {
    if (value === 'unknown') answerUnknown(sessionId, memberId, key);
    else answer(sessionId, memberId, key, value);
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

test('Règle A — réponse "inconnue" ou absence totale déclenche missing_information, jamais gap', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings: f1 } = runAndGetFindings(householdId, principalMemberId, [
    ['personnes_dependantes_financierement_declare', 'oui'],
    ['couverture_deces_connue_declare', 'unknown'],
  ]);
  assert.ok(!f1.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'gap'));
  assert.ok(f1.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'missing_information'));

  const { householdId: h2, principalMemberId: m2 } = buildHousehold();
  const { findings: f2 } = runAndGetFindings(h2, m2, []);
  assert.ok(!f2.some((f) => f.stable_key === 'deces-couverture-absente-01' && f.finding_type === 'gap'));
  assert.ok(f2.some((f) => f.finding_type === 'missing_information'));
});

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

test('Règle C — non-déclenchement : indépendant, les trois couvertures jamais répondues du tout (absentes, pas "inconnue" explicite)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['statut_professionnel_declare', 'independant'],
  ]);
  // Absence pure (jamais posée/répondue) != incertitude explicite -- la
  // règle C ne se déclenche que sur un statut de réponse "unknown" réel.
  assert.ok(!findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01'));
});

test('Règle C — statut professionnel lui-même absent déclenche missing_information pour C', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_deces_connue_declare', 'unknown'],
  ]);
  assert.ok(findings.some((f) => f.stable_key === 'independant-couverture-incertaine-01' && f.finding_type === 'missing_information'));
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
