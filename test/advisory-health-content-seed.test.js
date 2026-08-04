// Tests du contenu métier réel Assurance Maladie — LOT 5 phase 1 (Legrand
// Diagnostic 360). Base de test isolée (CRM_DATA_DIR), jamais data/**.
// Le script de provisioning réel (server/seed-advisory-health-content.js)
// ne publie jamais rien (brouillon uniquement, conformément au LOT 5) — les
// tests ci-dessous PUBLIENT une copie du contenu dans cette base de test
// ISOLÉE, uniquement pour prouver que le contenu est structurellement
// publiable et que les règles se déclenchent correctement ; ceci ne publie
// rien dans une base réelle et ne remplace jamais la validation humaine
// (juridique/métier) requise avant toute publication réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-health-seed-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const R = await import('../server/advisoryRules.js');
const S = await import('../server/advisorySessions.js');
const E = await import('../server/advisoryRuleExecutions.js');
const {
  seedAdvisoryHealthContent, QUESTIONNAIRE_STABLE_KEY, RULE_SET_STABLE_KEY,
} = await import('../server/seed-advisory-health-content.js');

const REQ = { session: { userEmail: 'conseiller-sante@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-sante@exemple.ch', 'Conseiller', 'x');

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

// --- Provisioning du contenu réel (première exécution, une fois pour tout le fichier) ---

const seedResult = seedAdvisoryHealthContent(REQ);
assert.equal(seedResult.created, true);

test('seedAdvisoryHealthContent — questionnaire créé en brouillon avec les 9 questions exactes', () => {
  const questionnaire = db.prepare('SELECT * FROM advisory_questionnaires WHERE stable_key = ?').get(QUESTIONNAIRE_STABLE_KEY);
  assert.ok(questionnaire);
  assert.equal(questionnaire.domain, 'health');
  const version = db.prepare('SELECT * FROM advisory_questionnaire_versions WHERE id = ?').get(seedResult.versionId);
  assert.equal(version.status, 'draft');

  const detail = Q.getVersionDetail(seedResult.versionId);
  assert.equal(detail.sections.length, 1);
  assert.equal(detail.sections[0].applies_to, 'member');
  const questions = detail.sections[0].questions;
  assert.equal(questions.length, 9);

  const expectedKeys = [
    'couverture_accident_hors_lamal_declaree', 'accident_inclus_lamal_declare',
    'franchise_actuelle_niveau_declare', 'capacite_absorber_depense_annuelle',
    'tolerance_risque_financier', 'parcours_premier_contact_obligatoire_declare',
    'refus_parcours_impose_declare', 'intention_resilier_complementaire_declare',
    'acceptation_nouvelle_complementaire_confirmee',
  ];
  assert.deepEqual(questions.map((q) => q.stable_key), expectedKeys);
  for (const q of questions) {
    assert.equal(q.type, 'single_choice');
    assert.equal(q.scope, 'member');
    assert.equal(q.allows_unknown, 1);
    assert.equal(q.required, 0);
  }
  const sensitiveKeys = questions.filter((q) => q.sensitive === 1).map((q) => q.stable_key);
  assert.deepEqual(sensitiveKeys.sort(), [
    'acceptation_nouvelle_complementaire_confirmee', 'capacite_absorber_depense_annuelle',
    'franchise_actuelle_niveau_declare', 'intention_resilier_complementaire_declare',
  ].sort());
  assert.equal(sensitiveKeys.length, 4);

  const byKey = Object.fromEntries(questions.map((q) => [q.stable_key, q]));
  assert.deepEqual(byKey.couverture_accident_hors_lamal_declaree.options.map((o) => o.value), ['oui', 'non']);
  assert.deepEqual(byKey.franchise_actuelle_niveau_declare.options.map((o) => o.value), ['basse', 'moyenne', 'elevee']);
  assert.deepEqual(byKey.capacite_absorber_depense_annuelle.options.map((o) => o.value), ['faible', 'moyenne', 'elevee']);
  assert.deepEqual(byKey.tolerance_risque_financier.options.map((o) => o.value), ['faible', 'moyenne', 'elevee']);
  for (const q of questions) {
    assert.ok(!q.options.some((o) => o.value === 'inconnue'), `${q.stable_key} ne doit pas avoir d'option "inconnue" (mécanisme natif allows_unknown utilisé à la place)`);
  }
});

// --- Correction §3 du dossier d'approbation : tolerance_risque_financier ---

test('tolerance_risque_financier — texte client compatible avec les 3 niveaux (faible/moyenne/élevée), plus l’ancienne alternative binaire', () => {
  const detail = Q.getVersionDetail(seedResult.versionId);
  const q = detail.sections[0].questions.find((x) => x.stable_key === 'tolerance_risque_financier');
  assert.ok(q);
  assert.match(q.client_text, /niveau/i, 'le texte doit interroger directement un NIVEAU, cohérent avec les 3 options');
  assert.doesNotMatch(q.client_text, /prime plus stable/i, 'l’ancienne formulation binaire ne doit plus être présente');
  assert.deepEqual(q.options.map((o) => o.value), ['faible', 'moyenne', 'elevee']);
  assert.equal(q.allows_unknown, 1);
  assert.equal(q.required, 0, 'cette question reste required: false, seule la logique de la règle C (LOT 6) est concernée par la correction §5');
});

test('seedAdvisoryHealthContent — ensemble de règles créé en brouillon avec les 5 règles exactes', () => {
  const ruleSet = db.prepare('SELECT * FROM advisory_rule_sets WHERE stable_key = ?').get(RULE_SET_STABLE_KEY);
  assert.ok(ruleSet);
  assert.equal(ruleSet.status, 'draft');
  assert.equal(ruleSet.domain, 'health');

  const detail = R.getRuleSetDetail(seedResult.ruleSetId);
  assert.equal(detail.rules.length, 5);
  const byKey = Object.fromEntries(detail.rules.map((r) => [r.stable_key, r]));

  assert.equal(byKey['accident-coordination-doublon-01'].result_finding_type, 'warning');
  assert.equal(byKey['accident-coordination-doublon-01'].priority, 'medium');
  assert.equal(byKey['accident-coordination-doublon-01'].result_payload.category_hint, 'accident_coordination');

  assert.equal(byKey['accident-coverage-gap-01'].result_finding_type, 'gap');
  assert.equal(byKey['accident-coverage-gap-01'].priority, 'high');
  assert.equal(byKey['accident-coverage-gap-01'].result_payload.category_hint, 'accident_coverage_gap');

  assert.equal(byKey['franchise-capacite-financiere-01'].result_finding_type, 'detected_need');
  assert.equal(byKey['franchise-capacite-financiere-01'].priority, 'medium');

  assert.equal(byKey['modele-soins-comportement-01'].result_finding_type, 'warning');
  assert.equal(byKey['modele-soins-comportement-01'].priority, 'medium');

  assert.equal(byKey['lca-continuite-resiliation-01'].result_finding_type, 'warning');
  assert.equal(byKey['lca-continuite-resiliation-01'].priority, 'high');

  for (const r of detail.rules) {
    assert.equal(r.finding_scope, 'member');
    assert.equal(r.status, 'active');
    assert.ok(r.source && r.source.trim().length > 0, `${r.stable_key} : source non vide requise`);
    assert.ok(r.source_reference && r.source_reference.trim().length > 0, `${r.stable_key} : source_reference non vide requise`);
    assert.ok(r.effective_from, `${r.stable_key} : effective_from requis`);
    assert.ok(r.advisor_explanation && r.advisor_explanation.trim().length > 0);
    const rootOp = r.conditions.op;
    assert.equal(rootOp, 'any', `${r.stable_key} : racine doit être un quantificateur "any" (jamais "all") pour ce noyau`);
  }
  // Aucun assureur nommé ni produit précis ne doit jamais apparaître dans les
  // textes (le mot générique « assureur » est en revanche normal en prose
  // explicative, cohérent avec l'usage déjà établi dans RULES_ENGINE.md).
  const forbidden = /\bcss\b|\bhelvetia\b|\baxa\b|\bzurich\b|\bswisslife\b|\bswiss life\b|\bgroupe mutuel\b|\bsanitas\b|\bvisana\b|\bconcordia\b|\bgenerali\b|\ballianz\b|\bbaloise\b|\bbâloise\b|\bsympany\b/i;
  for (const r of detail.rules) {
    assert.ok(!forbidden.test(r.advisor_explanation), `${r.stable_key} : texte conseiller contient un terme interdit`);
    assert.ok(!forbidden.test(r.client_explanation || ''), `${r.stable_key} : texte client contient un terme interdit`);
  }
});

// --- Correction §2 du dossier d'approbation : source OFSP corrigée ---

test('accident-coordination-doublon-01 / accident-coverage-gap-01 — source OFSP corrigée : art. 8 al. 1 LAMal + art. 11 OAMal, jamais art. 3 al. 2 LAMal, date de consultation présente', () => {
  const detail = R.getRuleSetDetail(seedResult.ruleSetId);
  const byKey = Object.fromEntries(detail.rules.map((r) => [r.stable_key, r]));
  for (const key of ['accident-coordination-doublon-01', 'accident-coverage-gap-01']) {
    const r = byKey[key];
    assert.match(r.source, /art\.\s*8 al\.\s*1 LAMal/, `${key} : doit citer l'art. 8 al. 1 LAMal`);
    assert.match(r.source_reference, /art\.\s*11 OAMal/, `${key} : doit citer l'art. 11 OAMal`);
    assert.doesNotMatch(r.source, /art\.\s*3 al\.\s*2 LAMal/, `${key} : ne doit plus citer l'art. 3 al. 2 LAMal`);
    assert.doesNotMatch(r.source_reference, /art\.\s*3 al\.\s*2 LAMal/, `${key} : ne doit plus citer l'art. 3 al. 2 LAMal`);
    // Date de consultation portée par source_reference, jamais par effective_from
    // (qui reste la date d'entrée en vigueur du contenu, une notion distincte).
    assert.match(r.source_reference, /Consultée le 2026-08-04/, `${key} : date de consultation attendue`);
    assert.notEqual(r.effective_from, '2026-08-04', `${key} : effective_from ne doit pas être détourné pour porter la date de consultation`);
    // Formulation prudente conservée : suspension sur demande, preuve LAA, décision de l'assureur, jamais automatique.
    assert.match(r.source, /demande/i);
    assert.match(r.source, /LAA/);
    assert.match(r.source, /assureur/i);
    assert.match(r.source, /[Jj]amais automatique/);
    assert.ok(r.source.length <= 300, `${key} : source dépasse la limite de 300 caractères`);
  }
});

test('seedAdvisoryHealthContent — idempotent : un second appel ne recrée rien', () => {
  const before = {
    questionnaires: db.prepare('SELECT COUNT(*) AS n FROM advisory_questionnaires').get().n,
    questions: db.prepare('SELECT COUNT(*) AS n FROM advisory_questions').get().n,
    ruleSets: db.prepare('SELECT COUNT(*) AS n FROM advisory_rule_sets').get().n,
    rules: db.prepare('SELECT COUNT(*) AS n FROM advisory_rules').get().n,
  };
  const second = seedAdvisoryHealthContent(REQ);
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
  // Publication UNIQUEMENT dans cette base de test isolée, pour prouver la
  // conformité structurelle complète (y compris type/portée des questions
  // référencées, vérifiable seulement contre un questionnaire publié) ET
  // pour permettre aux tests d'exécution ci-dessous de faire tourner le
  // moteur réel (executeRuleSetForSession exige un rule_set publié). Le
  // script de provisioning réel (server/seed-advisory-health-content.js) ne
  // publie jamais ce contenu — voir l'en-tête de ce fichier.
  Q.publishVersion(seedResult.versionId, REQ);
  const check = R.validateRuleSetForPublish(seedResult.ruleSetId);
  assert.deepEqual(check.errors, []);
  assert.equal(check.valid, true);
  R.publishRuleSet(seedResult.ruleSetId, REQ);
  const published = db.prepare('SELECT status FROM advisory_rule_sets WHERE id = ?').get(seedResult.ruleSetId);
  assert.equal(published.status, 'published');
});

// --- Exécution réelle des 5 règles (publication de test isolée, jamais dans le script réel) ---

function publishedRuleSetIdForExecution() {
  // Le rule_set de provisioning a déjà été publié par le test précédent
  // (même processus, même base isolée) — réutilisé tel quel pour les tests
  // d'exécution ci-dessous plutôt que republié (un rule_set publié ne peut
  // pas être modifié en place).
  return seedResult.ruleSetId;
}

function startedSession(householdId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: seedResult.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
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
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: publishedRuleSetIdForExecution() });
  const findings = E.listActiveFindings(sessionId, {}, REQ);
  return { sessionId, result, findings };
}

test('Règle A — déclenchement : couverture hors LAMal oui + accident inclus LAMal oui', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_accident_hors_lamal_declaree', 'oui'],
    ['accident_inclus_lamal_declare', 'oui'],
  ]);
  const a = findings.find((f) => f.stable_key === 'accident-coordination-doublon-01');
  assert.ok(a, 'la règle A doit se déclencher');
  assert.equal(a.finding_type, 'warning');
  assert.equal(a.household_member_id, principalMemberId);
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coverage-gap-01'), 'la règle B ne doit jamais se déclencher en même temps que A');
});

test('Règle B — déclenchement : couverture hors LAMal non + accident inclus LAMal non', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_accident_hors_lamal_declaree', 'non'],
    ['accident_inclus_lamal_declare', 'non'],
  ]);
  const b = findings.find((f) => f.stable_key === 'accident-coverage-gap-01');
  assert.ok(b, 'la règle B doit se déclencher');
  assert.equal(b.finding_type, 'gap');
  assert.equal(b.priority, 'high');
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coordination-doublon-01'), 'la règle A ne doit jamais se déclencher en même temps que B');
});

test('Règles A/B — non-déclenchement pour les deux combinaisons mixtes (oui/non et non/oui)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings: f1 } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_accident_hors_lamal_declaree', 'oui'],
    ['accident_inclus_lamal_declare', 'non'],
  ]);
  assert.ok(!f1.some((f) => ['accident-coordination-doublon-01', 'accident-coverage-gap-01'].includes(f.stable_key)));

  const { householdId: h2, principalMemberId: m2 } = buildHousehold();
  const { findings: f2 } = runAndGetFindings(h2, m2, [
    ['couverture_accident_hors_lamal_declaree', 'non'],
    ['accident_inclus_lamal_declare', 'oui'],
  ]);
  assert.ok(!f2.some((f) => ['accident-coordination-doublon-01', 'accident-coverage-gap-01'].includes(f.stable_key)));
});

test('Règles A/B — réponse "inconnue" déclenche missing_information, jamais A ni B', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['couverture_accident_hors_lamal_declaree', 'unknown'],
    ['accident_inclus_lamal_declare', 'oui'],
  ]);
  // A/B eux-mêmes doivent apparaître avec finding_type = missing_information
  // (mécanisme automatique du moteur, même rule_stable_key mais jamais leur
  // type substantif warning/gap) — jamais silencieusement absents, jamais
  // une conclusion warning/gap tirée d'une donnée absente.
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coordination-doublon-01' && f.finding_type === 'warning'));
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coverage-gap-01' && f.finding_type === 'gap'));
  assert.ok(findings.some((f) => f.stable_key === 'accident-coordination-doublon-01' && f.finding_type === 'missing_information'));
  assert.ok(findings.some((f) => f.stable_key === 'accident-coverage-gap-01' && f.finding_type === 'missing_information'));
});

test('Règles A/B — absence totale de réponse déclenche missing_information', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, []);
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coordination-doublon-01' && f.finding_type === 'warning'));
  assert.ok(!findings.some((f) => f.stable_key === 'accident-coverage-gap-01' && f.finding_type === 'gap'));
  assert.ok(findings.some((f) => f.finding_type === 'missing_information'));
});

test('Règle C — déclenchement : franchise élevée + capacité faible', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['franchise_actuelle_niveau_declare', 'elevee'],
    ['capacite_absorber_depense_annuelle', 'faible'],
    ['tolerance_risque_financier', 'moyenne'],
  ]);
  const c = findings.find((f) => f.stable_key === 'franchise-capacite-financiere-01');
  assert.ok(c, 'la règle C doit se déclencher (franchise élevée + capacité faible)');
  assert.equal(c.finding_type, 'detected_need');
});

test('Règle C — déclenchement : franchise élevée + tolérance faible (capacité non faible)', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['franchise_actuelle_niveau_declare', 'elevee'],
    ['capacite_absorber_depense_annuelle', 'elevee'],
    ['tolerance_risque_financier', 'faible'],
  ]);
  assert.ok(findings.some((f) => f.stable_key === 'franchise-capacite-financiere-01'));
});

test('Règle C — non-déclenchement : franchise basse, quelle que soit la capacité/tolérance', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['franchise_actuelle_niveau_declare', 'basse'],
    ['capacite_absorber_depense_annuelle', 'faible'],
    ['tolerance_risque_financier', 'faible'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'franchise-capacite-financiere-01'));
});

test('Règle C — non-déclenchement : franchise élevée mais capacité et tolérance toutes deux non faibles', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['franchise_actuelle_niveau_declare', 'elevee'],
    ['capacite_absorber_depense_annuelle', 'elevee'],
    ['tolerance_risque_financier', 'moyenne'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'franchise-capacite-financiere-01'));
});

test('Règle D — déclenchement : parcours imposé oui + refus oui', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['parcours_premier_contact_obligatoire_declare', 'oui'],
    ['refus_parcours_impose_declare', 'oui'],
  ]);
  const d = findings.find((f) => f.stable_key === 'modele-soins-comportement-01');
  assert.ok(d);
  assert.equal(d.finding_type, 'warning');
});

test('Règle D — non-déclenchement : parcours imposé non', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['parcours_premier_contact_obligatoire_declare', 'non'],
    ['refus_parcours_impose_declare', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'modele-soins-comportement-01'));
});

test('Règle E — déclenchement : intention de résilier oui + acceptation non confirmée', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['intention_resilier_complementaire_declare', 'oui'],
    ['acceptation_nouvelle_complementaire_confirmee', 'non'],
  ]);
  const e = findings.find((f) => f.stable_key === 'lca-continuite-resiliation-01');
  assert.ok(e);
  assert.equal(e.finding_type, 'warning');
  assert.equal(e.priority, 'high');
});

test('Règle E — non-déclenchement : acceptation déjà confirmée', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['intention_resilier_complementaire_declare', 'oui'],
    ['acceptation_nouvelle_complementaire_confirmee', 'oui'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'lca-continuite-resiliation-01'));
});

test('Règle E — réponse "inconnue" sur acceptation déclenche missing_information, jamais un finding silencieux "pas encore acceptée"', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const { findings } = runAndGetFindings(householdId, principalMemberId, [
    ['intention_resilier_complementaire_declare', 'oui'],
    ['acceptation_nouvelle_complementaire_confirmee', 'unknown'],
  ]);
  assert.ok(!findings.some((f) => f.stable_key === 'lca-continuite-resiliation-01' && f.finding_type === 'warning'));
  assert.ok(findings.some((f) => f.stable_key === 'lca-continuite-resiliation-01' && f.finding_type === 'missing_information'));
});

test('Portée membre — fan-out correct sur un foyer à deux membres (un seul membre concerné)', () => {
  const { householdId, principalMemberId, secondMemberId } = buildHousehold({ withSecondMember: true });
  const sessionId = startedSession(householdId);
  answer(sessionId, principalMemberId, 'couverture_accident_hors_lamal_declaree', 'oui');
  answer(sessionId, principalMemberId, 'accident_inclus_lamal_declare', 'oui');
  answer(sessionId, secondMemberId, 'couverture_accident_hors_lamal_declaree', 'oui');
  answer(sessionId, secondMemberId, 'accident_inclus_lamal_declare', 'non');
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: publishedRuleSetIdForExecution() });
  const findings = E.listActiveFindings(sessionId, {}, REQ);
  const aFindings = findings.filter((f) => f.stable_key === 'accident-coordination-doublon-01');
  assert.equal(aFindings.length, 1, 'un seul membre remplit la condition A — un seul finding, jamais deux ni un finding de foyer');
  assert.equal(aFindings[0].household_member_id, principalMemberId);
});

test('Aucune recommandation créée automatiquement par les 5 règles', () => {
  const { householdId, principalMemberId } = buildHousehold();
  const before = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  runAndGetFindings(householdId, principalMemberId, [
    ['couverture_accident_hors_lamal_declaree', 'non'],
    ['accident_inclus_lamal_declare', 'non'],
    ['franchise_actuelle_niveau_declare', 'elevee'],
    ['capacite_absorber_depense_annuelle', 'faible'],
    ['intention_resilier_complementaire_declare', 'oui'],
    ['acceptation_nouvelle_complementaire_confirmee', 'non'],
  ]);
  const after = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n;
  assert.equal(after, before, 'aucune recommandation ne doit être créée par une exécution du moteur de règles');
});

test('Aucune valeur de réponse de session (répondue par un client) en clair dans le journal audit', () => {
  // Distinct des entrées d'AUTORISATION de contenu (« option créée » cite
  // légitimement la valeur de catalogue, ex. "oui"/"non" — c'est la
  // définition de l'option elle-même, jamais une réponse d'un client réel).
  // Ce test porte sur les actions de SESSION (réponse enregistrée/remplacée),
  // qui ne doivent jamais journaliser une valeur de réponse réellement saisie
  // — même principe déjà vérifié ailleurs dans ce dépôt (SECURITY_PRIVACY.md).
  const rows = db.prepare("SELECT details FROM audit_log WHERE action IN ('réponse enregistrée', 'réponse remplacée')").all();
  assert.ok(rows.length > 0, 'des réponses de session ont bien été enregistrées pendant ces tests');
  for (const row of rows) {
    assert.ok(!/\boui\b|\bnon\b|\belevee\b|\bfaible\b|\bbasse\b|\bmoyenne\b/i.test(row.details || ''), 'le journal d\'audit ne doit jamais contenir la valeur d\'une réponse de session');
  }
});
