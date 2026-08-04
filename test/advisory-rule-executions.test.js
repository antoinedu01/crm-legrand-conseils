// Tests du moteur d'exécution des règles (Legrand Diagnostic 360, Lot 4A).
// Base de test isolée (CRM_DATA_DIR), jamais data/**. Toutes les règles,
// questionnaires et foyers ici sont fictifs et techniques — aucun ne
// constitue un conseil d'assurance réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-rule-exec-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember, removeMember, updateHousehold, AdvisoryError } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');

const REQ = { session: { userEmail: 'conseiller-exec@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-exec@exemple.ch', 'Conseiller', 'x');

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}
function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
// GATE LOT 4A §9 (décision humaine confirmée) : une exécution finale n'est
// possible que sur une session `completed` -- jamais `in_progress` (ni
// draft/suspended/cancelled, déjà refusés avant ce GATE). Idempotent : ne
// finalise que si nécessaire, pour rester appelable sans risque avant
// chaque exécution même quand la session l'est déjà.
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
function uniqueKey(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

let clientCounter = 0;
function insertClient(over = {}) {
  clientCounter += 1;
  const data = { type: 'particulier', first_name: `P${clientCounter}`, last_name: 'Test', status: 'prospect', ...over };
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

// Foyer fictif à deux membres (principal + enfant), utilisé pour les
// quantificateurs all/any du DSL de règles.
function buildHouseholdWithChild() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const childClientId = insertClient();
  const { id: childMemberId } = addMember(householdId, { member_role: 'enfant', client_id: childClientId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalClientId: principalId, principalMemberId: principalMember.id, childMemberId };
}

// Questionnaire technique fictif : une question booléenne de portée foyer,
// une question booléenne de portée membre, une question texte libre.
function buildAndPublishQuestionnaire(domain) {
  const householdKey = uniqueKey(`${domain}-menage`);
  const memberKey = uniqueKey(`${domain}-membre`);
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey(`quest-${domain}`), domain, name: `Démo exécution ${domain}` }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: s1 } = Q.upsertSection(vid, { stable_key: 's_menage', title: 'Foyer', sort_order: 1, applies_to: 'household' }, REQ);
  Q.upsertQuestion(s1, { stable_key: householdKey, advisor_text: 'Question foyer fictive ?', type: 'boolean', sort_order: 1 }, REQ);
  const { id: s2 } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 2, applies_to: 'member' }, REQ);
  Q.upsertQuestion(s2, { stable_key: memberKey, advisor_text: 'Question membre fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  Q.publishVersion(vid, REQ);
  return { vid, householdKey, memberKey };
}

function createAndStartSession(householdId, domain, { versionId }) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain,
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain, module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}

// Session mono-domaine (health/life_pension), MAIS avec le module `common`
// également rattaché (`module_role: 'core'`) -- utilisée par les tests
// MICRO-GATE §3 (sémantique de `common` dans l'état global) : un rule_set
// `common` publié doit pouvoir réellement s'exécuter sur une session
// spécialisée, pas seulement sur une session `mixed`.
function createAndStartSessionWithCommon(domain, versionId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain,
    questionnaire_versions: [
      { questionnaire_version_id: versionId, domain, module_role: 'domain', display_order: 1 },
      { questionnaire_version_id: commonVersionId, domain: 'common', module_role: 'core', display_order: 2 },
    ],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}

function findQuestionId(versionId, stableKey) {
  const detail = Q.getVersionDetail(versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error('question introuvable');
}

function validRuleData(overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE-EXEC'),
    title: 'Règle technique fictive d\'exécution',
    conditions: { op: 'exists', ref: { answer: 'placeholder' } },
    required_data: [],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_exec_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-EXEC-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}

// --- Scénario de base : foyer, questionnaire, session, rule_set publié -----

const { householdId, principalMemberId, childMemberId } = buildHouseholdWithChild();
const { vid: healthVersionId, householdKey: HEALTH_Q, memberKey: HEALTH_MEMBER_Q } = buildAndPublishQuestionnaire('health');
const { vid: lifeVersionId, householdKey: LIFE_Q } = buildAndPublishQuestionnaire('life_pension');
const { vid: commonVersionId, householdKey: COMMON_Q } = buildAndPublishQuestionnaire('common');

// Session « mixed » : rattache une version health ET une version life_pension
// (+ éventuellement common), jamais fusionnées (docs/advisory/DATA_MODEL.md
// §3.2) — utilisée pour vérifier qu'une session mixte peut exécuter jusqu'à
// trois rule_sets distincts (common/health/life_pension), en trois appels
// séparés, jamais en une seule exécution opaque.
function createAndStartMixedSession({ includeCommon = true } = {}) {
  const versions = [
    { questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 },
    { questionnaire_version_id: lifeVersionId, domain: 'life_pension', module_role: 'domain', display_order: 2 },
  ];
  if (includeCommon) versions.push({ questionnaire_version_id: commonVersionId, domain: 'common', module_role: 'core', display_order: 3 });
  const { id: sessionId } = S.createSession({ household_id: householdId, domain: 'mixed', questionnaire_versions: versions }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}

// Politique « un seul rule_set publié par domaine » (GATE LOT 4A, §2) :
// chaque test de ce fichier veut un rule_set health fraîchement isolé, sans
// se soucier des autres tests — archive donc systématiquement toute AUTRE
// famille déjà publiée pour ce domaine avant de publier la nouvelle, plutôt
// que de dupliquer cette étape dans chacun des tests.
function archiveOtherPublishedForDomain(domain, keepRuleSetId) {
  const keep = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(keepRuleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, keep.stable_key);
  for (const o of others) R.archiveRuleSet(o.id, REQ);
}

// Archive TOUT rule_set publié pour ce domaine, sans exception à conserver
// (contrairement à `archiveOtherPublishedForDomain`, qui suppose un id à
// garder) -- utilisé par les tests LOT 4B qui veulent délibérément un
// domaine SANS AUCUN rule_set publié (scénario "skipped_no_published_rule_set").
function archiveAllPublishedForDomain(domain) {
  const rows = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").all(domain);
  for (const r of rows) R.archiveRuleSet(r.id, REQ);
}

// Publie un rule_set health en archivant d'abord toute AUTRE famille déjà
// publiée pour ce domaine (politique « un seul rule_set publié par domaine »,
// GATE LOT 4A §2) — chaque test de ce fichier veut un rule_set isolé, sans
// se soucier des autres tests.
function publishForDomain(domain, ruleSetId) {
  archiveOtherPublishedForDomain(domain, ruleSetId);
  return R.publishRuleSet(ruleSetId, REQ);
}

function publishHealthRuleSet(ruleSetId) {
  archiveOtherPublishedForDomain('health', ruleSetId);
  return R.publishRuleSet(ruleSetId, REQ);
}

function buildBasicPublishedRuleSet() {
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-exec'), domain: 'health', name: 'Ensemble exécution fictif' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-BASIC',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [{ answer: HEALTH_Q }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);
  return ruleSetId;
}

test('executeRuleSetForSession — première exécution : requiert rule_set_id, produit un finding déclenché', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {}),
    (e) => e.status === 400 && /requis/.test(e.message)
  );

  const before = auditCount('exécution lancée');
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.rules_evaluated_count, 1);
  assert.equal(result.findings_count, 1);
  assert.equal(auditCount('exécution lancée'), before + 1);

  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.status, 'completed');
  assert.equal(detail.rule_set_id, ruleSetId);
  assert.equal(detail.findings.length, 1);
  assert.equal(detail.findings[0].finding_type, 'detected_need');
  assert.equal(detail.findings[0].status, 'active');
  assert.ok(detail.inputs_snapshot.answers_used.length >= 1);
});

test('executeRuleSetForSession — le rule_set est figé après la première exécution (reproductibilité)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const otherRuleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: otherRuleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
  // Ré-exécuter sans préciser rule_set_id réutilise silencieusement le même.
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  assert.equal(E.getExecutionDetail(sessionId, result.execution_id).rule_set_id, ruleSetId);
});

test('executeRuleSetForSession — refuse un ensemble non publié', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const { id: draftRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-exec-draft'), domain: 'health', name: 'X' }, REQ);
  ensureCompleted(sessionId);
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: draftRuleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('executeRuleSetForSession — refuse un domaine incompatible avec la session', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

// --- Domaine « common » (GATE LOT 4A §2, décision humaine confirmée) --------

function buildBasicPublishedCommonRuleSet() {
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-common'), domain: 'common', name: 'Ensemble commun fictif' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-COMMON-BASIC',
    conditions: { op: 'equals', ref: { answer: COMMON_Q }, value: true },
    required_data: [{ answer: COMMON_Q }],
  }), REQ);
  publishForDomain('common', ruleSetId);
  return ruleSetId;
}

test('executeRuleSetForSession — un rule_set common s\'exécute sur une session health', () => {
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  // La question common ne fait pas partie de la version health seule ; il
  // faut aussi rattacher la version common pour cette session.
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [
      { questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 },
      { questionnaire_version_id: commonVersionId, domain: 'common', module_role: 'core', display_order: 2 },
    ],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  S.recordAnswers(sessionId, [{ question_id: commonQId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1);
});

test('executeRuleSetForSession — un rule_set common s\'exécute sur une session life_pension', () => {
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'life_pension',
    questionnaire_versions: [
      { questionnaire_version_id: lifeVersionId, domain: 'life_pension', module_role: 'domain', display_order: 1 },
      { questionnaire_version_id: commonVersionId, domain: 'common', module_role: 'core', display_order: 2 },
    ],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  S.recordAnswers(sessionId, [{ question_id: commonQId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1);
});

test('executeRuleSetForSession — une session mixed exécute jusqu\'à trois fois (common, health, life_pension), jamais fusionnées', () => {
  const sessionId = createAndStartMixedSession();
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: commonQId, status: 'answered', value: true },
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  const healthRuleSetId = buildBasicPublishedRuleSet();
  const { id: lifeRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-life'), domain: 'life_pension', name: 'X' }, REQ);
  R.upsertRule(lifeRuleSetId, validRuleData({
    stable_key: 'TEST-RULE-LIFE-BASIC',
    conditions: { op: 'equals', ref: { answer: LIFE_Q }, value: true },
    required_data: [{ answer: LIFE_Q }],
  }), REQ);
  publishForDomain('life_pension', lifeRuleSetId);

  ensureCompleted(sessionId);
  const commonResult = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });
  ensureCompleted(sessionId);
  const healthResult = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: healthRuleSetId });
  ensureCompleted(sessionId);
  const lifeResult = E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: lifeRuleSetId });

  assert.equal(commonResult.findings_count, 1);
  assert.equal(healthResult.findings_count, 1);
  assert.equal(lifeResult.findings_count, 1);
  // Trois exécutions bien DISTINCTES, jamais fusionnées en une seule.
  const executions = E.listExecutions(sessionId, {});
  assert.equal(executions.length, 3);
  assert.deepEqual([...new Set(executions.map((e) => e.domain))].sort(), ['common', 'health', 'life_pension']);
});

test('executeRuleSetForSession — l\'absence de rattachement common est acceptée (facultatif) : le domaine reste exécutable, la règle signale juste une donnée manquante, jamais un plantage', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const ruleSetId = buildBasicPublishedCommonRuleSet();
  // Aucune version common rattachée à cette session -> la question COMMON_Q
  // reste introuvable pour ce couple (session, domaine) -- la règle ne
  // conclut pas silencieusement, elle signale l'insuffisance (§8), et
  // l'exécution elle-même n'échoue jamais pour autant : common reste
  // facultatif, jamais bloquant pour une session qui ne l'utilise pas.
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1);
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings[0].finding_type, 'missing_information');
});

test('publishRuleSet — refuse deux rule_sets de familles différentes actifs pour le même domaine (politique retenue, GATE LOT 4A §2)', () => {
  const { id: familyA } = R.createRuleSet({ stable_key: uniqueKey('rs-common-dup-a'), domain: 'common', name: 'A' }, REQ);
  R.upsertRule(familyA, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON_Q } }, required_data: [] }), REQ);
  publishForDomain('common', familyA);

  const { id: familyB } = R.createRuleSet({ stable_key: uniqueKey('rs-common-dup-b'), domain: 'common', name: 'B' }, REQ);
  R.upsertRule(familyB, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON_Q } }, required_data: [] }), REQ);
  assert.throws(
    () => R.publishRuleSet(familyB, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('executeRuleSetForSession — historique reproductible pour un rule_set common (mêmes réponses -> mêmes findings à chaque nouvelle exécution)', () => {
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [
      { questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 },
      { questionnaire_version_id: commonVersionId, domain: 'common', module_role: 'core', display_order: 2 },
    ],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  S.recordAnswers(sessionId, [{ question_id: commonQId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedCommonRuleSet();

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, {});
  const shape = (execId) => E.getExecutionDetail(sessionId, execId).findings.map((f) => ({ stable_key: f.stable_key, finding_type: f.finding_type }));
  assert.deepEqual(shape(first.execution_id), shape(second.execution_id));
});

test('executeRuleSetForSession — refuse sur une session brouillon/en cours/suspendue/annulée : seule « completed » permet une exécution finale (GATE LOT 4A §9, décision humaine confirmée)', () => {
  const { id: draftSessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  assert.throws(
    () => E.executeRuleSetForSession(draftSessionId, 'health', rev(draftSessionId), REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );

  // `in_progress` (session activement en cours d'entretien, réponses déjà
  // enregistrées) est désormais explicitement refusé : une exécution finale
  // exige que la session soit déjà `completed` (GATE LOT 4A §9).
  const inProgressSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(inProgressSessionId, [{ question_id: qId, status: 'answered', value: true }], rev(inProgressSessionId), REQ);
  assert.throws(
    () => E.executeRuleSetForSession(inProgressSessionId, 'health', rev(inProgressSessionId), REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409 && /in_progress/.test(e.message)
  );
  // ... mais devient possible dès que cette même session est finalisée.
  ensureCompleted(inProgressSessionId);
  assert.doesNotThrow(() => E.executeRuleSetForSession(inProgressSessionId, 'health', rev(inProgressSessionId), REQ, { rule_set_id: ruleSetId }));

  const suspendedSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  S.suspendSession(suspendedSessionId, rev(suspendedSessionId), REQ);
  assert.throws(
    () => E.executeRuleSetForSession(suspendedSessionId, 'health', rev(suspendedSessionId), REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );

  const cancelledSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  S.cancelSession(cancelledSessionId, rev(cancelledSessionId), REQ);
  assert.throws(
    () => E.executeRuleSetForSession(cancelledSessionId, 'health', rev(cancelledSessionId), REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('executeRuleSetForSession — refuse une révision attendue obsolète (garde-fou de fraîcheur)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId) + 99, REQ, { rule_set_id: ruleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('executeRuleSetForSession — donnée manquante : produit un finding missing_information, jamais un résultat par défaut', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-missing'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-MISSING',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [{ answer: HEALTH_Q }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);
  // Aucune réponse enregistrée pour HEALTH_Q sur cette session -> donnée manquante.
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1);
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings[0].finding_type, 'missing_information');
  assert.ok(detail.findings[0].missing_data.length === 1);
  assert.equal(detail.findings[0].missing_data[0].stable_key, HEALTH_Q);
});

test('executeRuleSetForSession — quantificateur all/any sur les membres avec une question de portée membre', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-allany'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-ANY',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    result_payload: { category_hint: 'categorie_any_fictive' },
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-ALL',
    conditions: { op: 'all', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], sort_order: 2,
    result_payload: { category_hint: 'categorie_all_fictive' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1, 'seul « any » se déclenche (un membre à true, pas tous)');
  assert.equal(detail.findings[0].stable_key, 'TEST-RULE-EXEC-ANY');
});

// --- finding_scope = member (GATE LOT 4A §3, décision de conception) --------

test('executeRuleSetForSession — finding_scope=member avec any : un finding distinct par membre correspondant, household_member_id obligatoire', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-any'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-ANY',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1, 'un seul membre (le principal) satisfait la condition');
  assert.equal(detail.findings[0].household_member_id, principalMemberId);
  assert.equal(detail.findings[0].finding_scope, 'member');
});

test('executeRuleSetForSession — finding_scope=member avec any : PLUSIEURS membres correspondants produisent PLUSIEURS findings', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-any-multi'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-ANY-MULTI',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2);
  assert.deepEqual(detail.findings.map((f) => f.household_member_id).sort(), [principalMemberId, childMemberId].sort());
  assert.ok(detail.findings.every((f) => f.household_member_id != null), 'household_member_id est obligatoire pour finding_scope=member');
});

test('executeRuleSetForSession — finding_scope=member : AUCUN membre correspondant = ZÉRO finding (jamais une attribution arbitraire)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: false },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-none'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-NONE',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 0);
});

test('executeRuleSetForSession — finding_scope=member avec all : ne produit un finding par membre QUE si tous satisfont', () => {
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-all'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-ALL',
    conditions: { op: 'all', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  // Un seul des deux membres satisfait -> all échoue, zéro finding.
  const partialSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  S.recordAnswers(partialSessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(partialSessionId), REQ);
  ensureCompleted(partialSessionId);
  const partial = E.executeRuleSetForSession(partialSessionId, 'health', rev(partialSessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(partial.findings_count, 0);

  // Les deux satisfont -> all réussit, UN finding PAR membre (tous les deux).
  const fullSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  S.recordAnswers(fullSessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(fullSessionId), REQ);
  ensureCompleted(fullSessionId);
  const full = E.executeRuleSetForSession(fullSessionId, 'health', rev(fullSessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(full.findings_count, 2);
});

test('executeRuleSetForSession — finding_scope=member : un membre RETIRÉ après démarrage reste rattaché (snapshot figé de la session)', () => {
  const { householdId: hh, principalMemberId: principal, childMemberId: child } = buildHouseholdWithChild();
  const sessionId = createAndStartSession(hh, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principal, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: child, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-removed'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-REMOVED',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  removeMember(hh, child, {}, REQ);
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2, 'l\'enfant retiré depuis reste dans le snapshot figé de la session, toujours attribué');
  assert.deepEqual(detail.findings.map((f) => f.household_member_id).sort(), [principal, child].sort());
});

test('executeRuleSetForSession — finding_scope=member : un membre AJOUTÉ après démarrage n\'apparaît jamais (hors snapshot figé)', () => {
  const { householdId: hh, principalMemberId: principal } = buildHouseholdWithChild();
  const sessionId = createAndStartSession(hh, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [{ question_id: memberQId, household_member_id: principal, status: 'answered', value: true }], rev(sessionId), REQ);

  // Nouveau membre ajouté APRÈS le démarrage de la session.
  const newClientId = insertClient();
  addMember(hh, { member_role: 'conjoint', client_id: newClientId }, REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-added'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-ADDED',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1, 'seul le principal (déjà dans le snapshot au démarrage) est attribué, jamais le conjoint ajouté depuis');
  assert.equal(detail.findings[0].household_member_id, principal);
});

test('executeRuleSetForSession — finding_scope=session/household : toujours household_member_id NULL, même avec all/any', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings[0].household_member_id, null);
  assert.equal(detail.findings[0].finding_scope, 'household');
});

test('executeRuleSetForSession — finding_scope=member : ordre déterministe des findings produits (même ordre de membres à chaque exécution)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-order'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-ORDER',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const order = (execId) => E.getExecutionDetail(sessionId, execId).findings.map((f) => f.household_member_id);
  assert.deepEqual(order(first.execution_id), order(second.execution_id), 'même ordre de membres à chaque exécution, déterministe');
});

test('executeRuleSetForSession — finding_scope=member : les findings émis par LA MÊME règle pour plusieurs membres ne se signalent JAMAIS comme en conflit entre eux, même en partageant la même category_hint (constat GATE LOT 4B, QA formelle)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-no-self-conflict'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-NO-SELF-CONFLICT',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
    // `category_hint` volontairement partagé par défaut (validRuleData) --
    // c'est exactement le cas qui déclenchait à tort un recoupement avant
    // le correctif : une seule règle, deux findings (un par membre
    // correspondant), jamais deux avis contradictoires.
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.every((f) => f.needs_review === 0), 'aucun recoupement entre les findings d\'une même règle, même category_hint partagée');
  assert.ok(detail.findings.every((f) => f.conflicts_with.length === 0));
  assert.ok(detail.findings.every((f) => f.conflicts_detected_at_execution.length === 0));
});

test('executeRuleSetForSession — deux RÈGLES DIFFÉRENTES (l\'une scope=member, l\'autre scope=household) partageant une category_hint restent bien détectées en conflit (le correctif n\'affaiblit pas la détection réelle)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const householdQId = findQuestionId(healthVersionId, HEALTH_Q);
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: householdQId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-cross-scope-conflict'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-CROSS-SCOPE-HOUSEHOLD',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [],
    result_payload: { category_hint: 'categorie_cross_scope' },
    sort_order: 1,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-CROSS-SCOPE-MEMBER',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
    result_payload: { category_hint: 'categorie_cross_scope' },
    sort_order: 2,
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.every((f) => f.needs_review === 1), 'deux règles différentes partageant une catégorie restent bien signalées en conflit');
});

test('executeRuleSetForSession — deux RÈGLES DIFFÉRENTES, toutes deux scope=member, ciblant le MÊME membre avec la même category_hint : conflit bien détecté (cas limite du correctif, GATE LOT 4B, revue rules-engine-auditor)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-same-member-diff-rules'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SAME-MEMBER-A',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
    result_payload: { category_hint: 'categorie_meme_membre' },
    sort_order: 1,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SAME-MEMBER-B',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member', result_finding_type: 'gap',
    result_payload: { category_hint: 'categorie_meme_membre' },
    sort_order: 2,
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  // Un seul membre a répondu -> un finding par règle (2 au total), tous
  // deux attribués à CE membre, issus de DEUX règles distinctes : le
  // correctif (exclusion par `rule.id`) ne doit jamais masquer ce conflit
  // réel simplement parce que `household_member_id` coïncide.
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.every((f) => f.household_member_id === principalMemberId));
  assert.ok(detail.findings.every((f) => f.needs_review === 1), 'deux règles différentes ciblant le même membre avec la même catégorie restent bien en conflit');
  assert.ok(detail.findings[0].conflicts_with.includes(detail.findings[1].id));
});

test('executeRuleSetForSession — finding_scope=member : supersession correcte, l\'historique par membre est préservé', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-supersede'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-SUPERSEDE',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const firstDetail = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstDetail.findings.length, 2);
  assert.ok(firstDetail.findings.every((f) => f.status === 'superseded'));
  const active = E.listActiveFindings(sessionId, { domain: 'health' });
  assert.equal(active.length, 2);
  assert.deepEqual(active.map((f) => f.household_member_id).sort(), [principalMemberId, childMemberId].sort());
});

test('executeRuleSetForSession — finding_scope=member fonctionne aussi sur une session mixte', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [{ question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-scope-mixed'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-SCOPE-MIXED',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1);
  assert.equal(detail.findings[0].household_member_id, principalMemberId);
});

test('executeRuleSetForSession — contract_branch résout le statut d\'un contrat existant du foyer', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const company = db.prepare('INSERT INTO companies (name) VALUES (?)').run('Compagnie technique fictive');
  db.prepare("INSERT INTO contracts (client_id, company_id, branch, status) VALUES (?, ?, 'lamal', 'actif')")
    .run(db.prepare('SELECT client_id FROM household_members WHERE id = ?').get(principalMemberId).client_id, company.lastInsertRowid);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-contract'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONTRACT',
    conditions: { op: 'equals', ref: { contract_branch: 'lamal' }, value: 'actif' },
    required_data: [{ contract_branch: 'lamal' }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1);
});

test('executeRuleSetForSession — contract_branch résout contre le snapshot FIGÉ de la session, pas la composition vivante du foyer (reproductibilité, constat GATE LOT 4A)', () => {
  const { householdId: hh, childMemberId: child } = buildHouseholdWithChild();
  const sessionId = createAndStartSession(hh, 'health', { versionId: healthVersionId });
  const company = db.prepare('INSERT INTO companies (name) VALUES (?)').run('Compagnie technique fictive');
  const childClientId = db.prepare('SELECT client_id FROM household_members WHERE id = ?').get(child).client_id;
  db.prepare("INSERT INTO contracts (client_id, company_id, branch, status) VALUES (?, ?, 'lca', 'actif')").run(childClientId, company.lastInsertRowid);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-contract-snap'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONTRACT-SNAP',
    conditions: { op: 'equals', ref: { contract_branch: 'lca' }, value: 'actif' },
    required_data: [{ contract_branch: 'lca' }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  // Retrait de l'enfant du foyer APRÈS le démarrage de la session (donc
  // après la capture du household_snapshot) : le contrat de l'enfant reste
  // pourtant compté, car la résolution utilise le snapshot figé, jamais la
  // composition vivante.
  removeMember(hh, child, {}, REQ);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(result.findings_count, 1, 'le contrat du membre historisé doit encore être compté (snapshot figé, jamais la composition vivante)');
});

test('executeRuleSetForSession — required_data d\'une question de portée membre : conservateur, signale une donnée manquante tant qu\'un membre n\'a pas répondu', () => {
  const { householdId: hh, principalMemberId: principal, childMemberId: child } = buildHouseholdWithChild();
  const { vid: versionId, memberKey: memberQKey } = buildAndPublishQuestionnaire('health');
  const sessionId = createAndStartSession(hh, 'health', { versionId });
  const memberQId = findQuestionId(versionId, memberQKey);
  // Un seul des deux membres répond -- la question est de portée membre.
  S.recordAnswers(sessionId, [{ question_id: memberQId, household_member_id: principal, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-member-missing'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-MEMBER-MISSING',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: memberQKey }, value: true } },
    required_data: [{ answer: memberQKey }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings[0].finding_type, 'missing_information', 'tant qu\'un membre (l\'enfant) n\'a pas répondu, la donnée est déclarée manquante, jamais silencieusement présente');

  // Une fois TOUS les membres répondus, la règle peut conclure normalement.
  // La session est déjà `completed` (exécution finale, GATE LOT 4A §9) --
  // toute réponse supplémentaire passe donc par l'amendement, jamais
  // `recordAnswers` (réservé à une session encore en cours).
  S.amendAnswer(sessionId, {
    question_id: memberQId, household_member_id: child, status: 'answered', value: false,
    amendment_reason: 'Réponse complémentaire fictive de test.', expected_revision: rev(sessionId),
  }, REQ);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const secondDetail = E.getExecutionDetail(sessionId, second.execution_id);
  assert.equal(secondDetail.findings[0].finding_type, 'detected_need', 'any=true grâce au principal, la règle conclut normalement une fois toutes les réponses connues');
});

// Correctif d'intégrité de la complétude de session (§3) : angle mort de
// test signalé indépendamment par les revues compliance-privacy-reviewer et
// rules-engine-auditor -- ce test le comble. L'exclusion des membres
// historisés du CONTRÔLE DE COMPLÉTUDE DE SESSION (validateLinkForCompletion,
// server/advisorySessions.js) ne doit JAMAIS se propager au calcul
// `required_data` DU MOTEUR DE RÈGLES (isRequiredDataPresent, ce fichier,
// volontairement INCHANGÉ par ce correctif) -- deux contrôles distincts, à
// des couches différentes. La session peut désormais se compléter malgré
// l'absence de réponse du membre historisé, mais toute règle référençant sa
// réponse doit continuer à signaler `missing_information`, jamais conclure
// silencieusement à tort.
test('membre historisé jamais répondu — la session se complète (correctif §3), mais le moteur de règles continue de signaler missing_information pour sa réponse absente', () => {
  const { householdId: hh, principalMemberId: principal, childMemberId: child } = buildHouseholdWithChild();

  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-required-member-historical'), domain: 'health', name: 'Démo membre historisé' }, REQ);
  const { id: vidReq } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vidReq, { stable_key: 's1', title: 'S', sort_order: 1, applies_to: 'member' }, REQ);
  const { id: memberQId } = Q.upsertQuestion(sectionId, { stable_key: 'q-member-required-historical', advisor_text: 'Question membre requise fictive ?', type: 'boolean', scope: 'member', required: true, sort_order: 1 }, REQ);
  Q.publishVersion(vidReq, REQ);

  const sessionId = createAndStartSession(hh, 'health', { versionId: vidReq });
  removeMember(hh, child, {}, REQ); // historisé AVANT d'avoir répondu (Cas A)
  S.recordAnswers(sessionId, [{ question_id: memberQId, household_member_id: principal, status: 'answered', value: true }], rev(sessionId), REQ);

  assert.equal(S.validateSessionForCompletion(sessionId).valid, true, 'précondition du test : le correctif §3 doit réellement exclure le membre historisé de la complétude');
  ensureCompleted(sessionId);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-member-historical'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: uniqueKey('TEST-RULE-MEMBER-HISTORICAL'),
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: 'q-member-required-historical' }, value: true } },
    required_data: [{ answer: 'q-member-required-historical' }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings[0].finding_type, 'missing_information', 'la réponse absente du membre historisé reste signalée par le moteur, jamais silencieusement traitée comme présente');
});

test('executeRuleSetForSession — une première exécution échouée ne fige jamais le rule_set (le pin ne compte que les exécutions réussies)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-fail-then-ok'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-CYCLE-BAIT',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [{ answer: HEALTH_Q }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);
  // Corruption délibérée post-publication pour provoquer un échec interne
  // (même technique que le test d'exécution échouée existant) : la
  // première tentative pour ce couple (session, domaine) échoue.
  const badRule = R.getRuleSetDetail(ruleSetId).rules[0];
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: badRule.stable_key }, value: true }), badRule.id);
  ensureCompleted(sessionId);
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));

  // Une seconde tentative, avec un AUTRE rule_set correctement formé, doit
  // pouvoir réussir et devenir la référence figée -- l'échec précédent ne
  // doit jamais avoir verrouillé définitivement ce couple (session, domaine).
  const otherRuleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: otherRuleSetId });
  assert.equal(E.getExecutionDetail(sessionId, result.execution_id).rule_set_id, otherRuleSetId);
});

test('executeRuleSetForSession — une ré-exécution reste possible même si le rule_set déjà figé a été archivé depuis', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  R.archiveRuleSet(ruleSetId, REQ);
  ensureCompleted(sessionId);
  assert.doesNotThrow(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {}));

  // Mais un rule_set encore en BROUILLON ne serait, lui, jamais exécutable
  // (ne peut de toute façon jamais avoir été pinné sans passer par publié).
  const otherSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const { id: draftRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-still-draft'), domain: 'health', name: 'X' }, REQ);
  ensureCompleted(otherSessionId);
  assert.throws(
    () => E.executeRuleSetForSession(otherSessionId, 'health', rev(otherSessionId), REQ, { rule_set_id: draftRuleSetId }),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('executeRuleSetForSession — reproductibilité : la publication d\'une NOUVELLE VERSION du même rule_set (qui archive automatiquement l\'ancienne, GATE LOT 4A §2) ne change jamais le rule_set pinné d\'une session déjà exécutée (GATE LOT 4A §8)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetIdV1 = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetIdV1 });
  const firstHash = R.getRuleSetDetail(ruleSetIdV1).content_hash;

  // Nouvelle version PUBLIÉE de la MÊME famille -> archive automatiquement
  // v1 (politique « un seul rule_set publié par domaine », GATE LOT 4A §2) —
  // scénario réel qui déclenche l'archivage, pas un archivage manuel direct.
  const { id: draftV2 } = R.cloneRuleSetToNewDraft(ruleSetIdV1, REQ);
  R.publishRuleSet(draftV2, REQ);
  assert.equal(R.getRuleSetDetail(ruleSetIdV1).status, 'archived');
  assert.equal(R.getRuleSetDetail(draftV2).status, 'published');

  // Ré-exécution SANS préciser rule_set_id : réutilise silencieusement v1
  // (pinné dès la première exécution réussie), jamais v2 même publiée depuis.
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const secondDetail = E.getExecutionDetail(sessionId, second.execution_id);
  assert.equal(secondDetail.rule_set_id, ruleSetIdV1);
  assert.equal(secondDetail.rule_set_version_number, R.getRuleSetDetail(ruleSetIdV1).version_number);
  assert.equal(secondDetail.content_hash, firstHash);

  // La supersession joue son rôle habituel : la première exécution n'est
  // jamais modifiée, seulement marquée supersédée.
  const firstDetail = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstDetail.superseded_by_execution_id, second.execution_id);
  assert.equal(firstDetail.rule_set_id, ruleSetIdV1);
});

test('executeRuleSetForSession — reproductibilité : une session finalisée puis AMENDÉE peut être ré-exécutée -- la nouvelle exécution utilise la nouvelle révision et supersède l\'ancienne, sans jamais la modifier (GATE LOT 4A §8)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const firstSessionRevision = rev(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', firstSessionRevision, REQ, { rule_set_id: ruleSetId });
  const firstDetailBeforeAmend = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstDetailBeforeAmend.findings.length, 1);

  S.amendAnswer(sessionId, {
    question_id: qId, status: 'answered', value: false, amendment_reason: 'Correction fictive de test.', expected_revision: rev(sessionId),
  }, REQ);
  const revAfterAmend = rev(sessionId);
  assert.ok(revAfterAmend > firstSessionRevision);

  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', revAfterAmend, REQ, {});
  const secondDetail = E.getExecutionDetail(sessionId, second.execution_id);
  assert.equal(secondDetail.session_revision, revAfterAmend);
  assert.equal(secondDetail.rule_set_id, ruleSetId);
  // Réponse amendée à false -> la règle ne se déclenche plus.
  assert.equal(secondDetail.findings.length, 0);

  // L'ancienne exécution n'est JAMAIS modifiée : même révision, même
  // rule_set, mêmes findings d'origine -- seulement marquée supersédée.
  const firstDetailAfter = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstDetailAfter.superseded_by_execution_id, second.execution_id);
  assert.equal(firstDetailAfter.session_revision, firstSessionRevision);
  assert.equal(firstDetailAfter.rule_set_id, ruleSetId);
  assert.equal(firstDetailAfter.content_hash, firstDetailBeforeAmend.content_hash);
  assert.equal(firstDetailAfter.findings.length, 1);
  assert.ok(firstDetailAfter.findings.every((f) => f.status === 'superseded'));
});

// Correctif d'intégrité de la complétude de session (§4/§5) : contrairement
// au test ci-dessus (question NON requise, l'amendement ne rouvre jamais),
// ce test couvre le chemin où l'amendement RETIRE la seule réponse à une
// question REQUISE -- la session est alors automatiquement rouverte
// (`completed` -> `in_progress`), toute exécution est bloquée entre-temps
// (ELIGIBLE_SESSION_STATUSES exige `completed`, inchangé), et une fois
// recomplétée, la ré-exécution manuelle reflète le nouvel état tout en
// préservant intégralement l'historique de l'ancienne exécution.
test('amendAnswer — réponse requise retirée -> réouverture -> recomplétion -> nouvelle exécution manuelle : l’ancienne exécution reste historisée, la nouvelle reflète le nouvel état', () => {
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-required-reopen'), domain: 'health', name: 'Démo réouverture' }, REQ);
  const { id: vidReq } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vidReq, { stable_key: 's1', title: 'S', sort_order: 1 }, REQ);
  const { id: reqQId } = Q.upsertQuestion(sectionId, { stable_key: 'q-required-reopen', advisor_text: 'Question requise fictive ?', type: 'boolean', required: true, sort_order: 1 }, REQ);
  Q.publishVersion(vidReq, REQ);
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vidReq, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  S.recordAnswers(sessionId, [{ question_id: reqQId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-reopen'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: uniqueKey('TEST-RULE-REOPEN'),
    conditions: { op: 'equals', ref: { answer: 'q-required-reopen' }, value: true },
    required_data: [{ answer: 'q-required-reopen' }],
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.equal(E.getExecutionDetail(sessionId, first.execution_id).findings.length, 1);

  const amend = S.amendAnswer(sessionId, {
    question_id: reqQId, status: 'cleared',
    amendment_reason: 'Réponse retirée par erreur — test de réouverture.', expected_revision: rev(sessionId),
  }, REQ);
  assert.equal(amend.session_status, 'in_progress');
  assert.equal(db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status, 'in_progress');

  // Aucune exécution possible tant que la session n'est pas de nouveau completed (régression GATE LOT 4A §9).
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }), (err) => err.status === 409);

  S.recordAnswers(sessionId, [{ question_id: reqQId, status: 'answered', value: false }], rev(sessionId), REQ);
  S.completeSession(sessionId, rev(sessionId), REQ);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const secondDetail = E.getExecutionDetail(sessionId, second.execution_id);
  assert.equal(secondDetail.findings.length, 0, 'la nouvelle réponse (false) ne déclenche plus la règle');

  const firstAfter = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstAfter.superseded_by_execution_id, second.execution_id);
  assert.equal(firstAfter.findings.length, 1, 'l’ancienne exécution garde ses findings d’origine, jamais réécrits rétroactivement');
});

test('executeRuleSetForSession — foyer archivé : l\'historique reste pleinement lisible, mais toute NOUVELLE exécution est refusée (GATE LOT 4A §9, documenté précisément)', () => {
  // Foyer DÉDIÉ à ce test (jamais le foyer partagé du fichier) -- l'archivage
  // testé ici ne doit affecter aucun autre test.
  const dedicatedPrincipalId = insertClient();
  const { id: dedicatedHouseholdId } = createHousehold({ primary_client_id: dedicatedPrincipalId }, REQ);
  const sessionId = createAndStartSession(dedicatedHouseholdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  updateHousehold(dedicatedHouseholdId, { status: 'archive' }, REQ);

  // Lecture historique : PLEINEMENT lisible malgré l'archivage du foyer --
  // aucune des routes de lecture ne vérifie le statut du foyer, seule
  // l'écriture (nouvelle exécution) le fait.
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1);
  assert.equal(E.listActiveFindings(sessionId, { domain: 'health' }).length, 1);
  assert.equal(E.listExecutions(sessionId, {}).length, 1);
  assert.equal(E.listFindingsHistory(sessionId, {}).length, 1);

  // Écriture : toute NOUVELLE exécution est refusée sur un foyer archivé,
  // même si la session elle-même reste `completed` et par ailleurs éligible.
  assert.throws(
    () => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {}),
    (e) => e instanceof AdvisoryError && e.status === 409 && /archivé/.test(e.message)
  );

  // Même garde pour toute AUTRE écriture sur les findings (constat GATE
  // LOT 4A §12, revue advisory-architect) : écarter un finding est une
  // écriture comme une autre, jamais un cas particulier exempté.
  const findingId = detail.findings[0].id;
  assert.throws(
    () => E.dismissFinding(sessionId, findingId, { dismiss_reason: 'Motif fictif.', expected_revision: rev(sessionId) }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409 && /archivé/.test(e.message)
  );
});

test('executeRuleSetForSession — dépendance rule_result entre règles, ordre d\'évaluation correct', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-chain'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-BASE', conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [{ answer: HEALTH_Q }],
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-DEPENDENT',
    conditions: { op: 'equals', ref: { rule_result: 'TEST-RULE-EXEC-BASE' }, value: true },
    required_data: [], sort_order: 2,
    result_payload: { category_hint: 'categorie_dependante_fictive' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.some((f) => f.stable_key === 'TEST-RULE-EXEC-DEPENDENT'));
});

test('getExecutionDetail/listActiveFindings — tri par priorité réel : critical > high > medium > low, même en désordre de création (constat client-meeting-ux GATE LOT 4A §12)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  // Créées dans un ordre volontairement mélangé (low, critical, medium,
  // high) pour ne jamais dépendre d'un tri par sort_order/insertion.
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-priority-order'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIORITY-LOW', conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'low', sort_order: 1,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIORITY-CRITICAL', conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'critical', sort_order: 2,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIORITY-MEDIUM', conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'medium', sort_order: 3,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIORITY-HIGH', conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'high', sort_order: 4,
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const expectedOrder = ['TEST-RULE-PRIORITY-CRITICAL', 'TEST-RULE-PRIORITY-HIGH', 'TEST-RULE-PRIORITY-MEDIUM', 'TEST-RULE-PRIORITY-LOW'];

  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.deepEqual(detail.findings.map((f) => f.stable_key), expectedOrder);

  const active = E.listActiveFindings(sessionId, { domain: 'health' });
  assert.deepEqual(active.map((f) => f.stable_key), expectedOrder);
});

test('executeRuleSetForSession — recoupement en temps réel : deux findings déclenchés sur la même catégorie sont marqués needs_review avec renvoi croisé', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-conflict'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONFLICT-1',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_payload: { category_hint: 'categorie_conflit_fictive' },
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONFLICT-2',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_finding_type: 'gap', sort_order: 2,
    result_payload: { category_hint: 'categorie_conflit_fictive' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.every((f) => f.needs_review === 1));
  assert.ok(detail.findings[0].conflicts_with.includes(detail.findings[1].id));
  assert.ok(detail.findings[1].conflicts_with.includes(detail.findings[0].id));
  // Le constat HISTORIQUE (figé) coïncide avec l'état actif au moment de la
  // production -- mais reste une colonne distincte (GATE LOT 4A §5).
  assert.deepEqual(detail.findings[0].conflicts_detected_at_execution, detail.findings[0].conflicts_with);
  assert.deepEqual(detail.findings[1].conflicts_detected_at_execution, detail.findings[1].conflicts_with);
});

test('getExecutionDetail/listActiveFindings — LOT 4B §11 : les findings en conflit actif (needs_review) passent AVANT la priorité, même un conflit `low` devance un `critical` isolé', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-conflict-vs-priority'), domain: 'health', name: 'X' }, REQ);
  // Une paire en conflit (même category_hint), volontairement en priorité
  // `low` — pour prouver que le conflit prime bien sur la priorité, jamais
  // l'inverse.
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-ORDER-CONFLICT-LOW-1',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'low', sort_order: 1,
    result_payload: { category_hint: 'categorie_conflit_vs_priorite' },
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-ORDER-CONFLICT-LOW-2',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'low', sort_order: 2, result_finding_type: 'gap',
    result_payload: { category_hint: 'categorie_conflit_vs_priorite' },
  }), REQ);
  // Une règle `critical` isolée (aucun conflit) sur une autre catégorie.
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-ORDER-CRITICAL-ALONE',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    priority: 'critical', sort_order: 3,
    result_payload: { category_hint: 'categorie_isolee_critique' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  const expectedOrder = ['TEST-RULE-ORDER-CONFLICT-LOW-1', 'TEST-RULE-ORDER-CONFLICT-LOW-2', 'TEST-RULE-ORDER-CRITICAL-ALONE'];
  assert.deepEqual(detail.findings.map((f) => f.stable_key), expectedOrder);
  assert.deepEqual(detail.findings.map((f) => f.needs_review), [1, 1, 0]);

  const active = E.listActiveFindings(sessionId, { domain: 'health' });
  assert.deepEqual(active.map((f) => f.stable_key), expectedOrder);
});

test('dismissFinding — écarte un finding en conflit : recoupement ACTIF recalculé parmi les findings encore actifs, constat HISTORIQUE du recoupement initial jamais réécrit (GATE LOT 4A §5)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-conflict-dismiss'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONFLICT-DISMISS-1',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_payload: { category_hint: 'categorie_conflit_dismiss' },
    sort_order: 1,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-EXEC-CONFLICT-DISMISS-2',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_finding_type: 'gap', sort_order: 2,
    result_payload: { category_hint: 'categorie_conflit_dismiss' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const before = E.getExecutionDetail(sessionId, result.execution_id).findings;
  assert.equal(before.length, 2);
  assert.ok(before.every((f) => f.needs_review === 1));
  const [first, second] = before;

  E.dismissFinding(sessionId, first.id, { dismiss_reason: 'Doublon fonctionnel fictif.', expected_revision: rev(sessionId) }, REQ);

  const after = E.getExecutionDetail(sessionId, result.execution_id).findings;
  const dismissed = after.find((f) => f.id === first.id);
  const remaining = after.find((f) => f.id === second.id);

  // Écarté, jamais supprimé : reste en historique avec son statut/motif.
  assert.equal(after.length, 2);
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(dismissed.dismiss_reason, 'Doublon fonctionnel fictif.');
  assert.equal(dismissed.needs_review, 0);

  // Le finding restant ne conflicte plus avec AUCUN finding encore actif ->
  // état ACTIF recalculé : needs_review retombe à 0, conflicts_with se vide.
  assert.equal(remaining.needs_review, 0);
  assert.deepEqual(remaining.conflicts_with, []);

  // Le constat HISTORIQUE du recoupement initial, lui, ne bouge JAMAIS.
  assert.deepEqual(remaining.conflicts_detected_at_execution, [first.id]);
  assert.deepEqual(dismissed.conflicts_detected_at_execution, [second.id]);

  // Aucune recommandation automatique : le contenu du finding restant est
  // strictement inchangé par l'écartement de l'autre.
  const secondBefore = before.find((f) => f.id === second.id);
  assert.equal(remaining.title, secondBefore.title);
  assert.equal(remaining.summary, secondBefore.summary);
  assert.equal(remaining.finding_type, secondBefore.finding_type);
});

test('dismissFinding — trois findings en conflit mutuel : en écarter un laisse les deux autres toujours en conflit ENTRE EUX (jamais tout le groupe blanchi)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-conflict-3'), domain: 'health', name: 'X' }, REQ);
  for (let i = 1; i <= 3; i += 1) {
    R.upsertRule(ruleSetId, validRuleData({
      stable_key: `TEST-RULE-EXEC-CONFLICT-3-${i}`,
      conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
      result_payload: { category_hint: 'categorie_conflit_trois' },
      sort_order: i,
    }), REQ);
  }
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const [a, b, c] = E.getExecutionDetail(sessionId, result.execution_id).findings;
  assert.ok(a && b && c);
  assert.ok([a, b, c].every((f) => f.needs_review === 1));

  E.dismissFinding(sessionId, a.id, { dismiss_reason: 'Écarté pour ce test fictif.', expected_revision: rev(sessionId) }, REQ);

  const after = E.getExecutionDetail(sessionId, result.execution_id).findings;
  const stillB = after.find((f) => f.id === b.id);
  const stillC = after.find((f) => f.id === c.id);
  const dismissedA = after.find((f) => f.id === a.id);

  assert.equal(dismissedA.status, 'dismissed');
  assert.equal(dismissedA.needs_review, 0);

  // b et c restent en conflit MUTUEL (a écarté ne compte plus comme actif)
  // -> needs_review reste vrai pour les deux, mais leur conflicts_with ACTIF
  // ne référence plus jamais a.
  assert.equal(stillB.needs_review, 1);
  assert.equal(stillC.needs_review, 1);
  assert.deepEqual(stillB.conflicts_with, [c.id]);
  assert.deepEqual(stillC.conflicts_with, [b.id]);

  // Constat HISTORIQUE à trois au moment de la production : jamais réécrit,
  // même après l'écartement de a.
  assert.deepEqual(stillB.conflicts_detected_at_execution.slice().sort((x, y) => x - y), [a.id, c.id].sort((x, y) => x - y));
  assert.deepEqual(stillC.conflicts_detected_at_execution.slice().sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y));
});

test('executeRuleSetForSession — supersession : une nouvelle exécution du même couple (session, domaine) rend l\'ancienne et ses findings obsolètes', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});

  const firstDetail = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstDetail.superseded_by_execution_id, second.execution_id);
  assert.ok(firstDetail.findings.every((f) => f.status === 'superseded'));

  const active = E.listActiveFindings(sessionId, { domain: 'health' });
  assert.ok(active.every((f) => !firstDetail.findings.map((x) => x.id).includes(f.id)));
  assert.ok(active.length >= 1);
});

// Constat GATE LOT 4A §12 (revue rules-engine-auditor) : un finding
// supersédé qui portait `needs_review = true` à sa production le
// conservait indéfiniment -- seul `dismissFinding` recalculait
// `needs_review`, jamais la supersession d'exécution. Corrigé :
// `recomputeActiveConflicts` est désormais aussi appelée lors d'une
// supersession, exactement le même invariant que pour un écartement (un
// finding qui n'est plus actif n'a plus besoin d'être revu).
test('executeRuleSetForSession — supersession : needs_review retombe à 0 sur les findings supersédés qui étaient en conflit (jamais figé indéfiniment)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-conflict-supersede'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-CONFLICT-SUPERSEDE-1',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_payload: { category_hint: 'categorie_conflit_supersede' },
    sort_order: 1,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-CONFLICT-SUPERSEDE-2',
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    result_finding_type: 'gap', sort_order: 2,
    result_payload: { category_hint: 'categorie_conflit_supersede' },
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const firstBefore = E.getExecutionDetail(sessionId, first.execution_id);
  assert.equal(firstBefore.findings.length, 2);
  assert.ok(firstBefore.findings.every((f) => f.needs_review === 1), 'les deux findings doivent bien être en conflit à la production, sinon ce test ne prouve rien');

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});

  const firstAfter = E.getExecutionDetail(sessionId, first.execution_id);
  assert.ok(firstAfter.findings.every((f) => f.status === 'superseded'));
  assert.ok(firstAfter.findings.every((f) => f.needs_review === 0), 'un finding supersédé ne doit plus jamais rester signalé needs_review');
  // Le constat historique du recoupement initial, lui, ne bouge jamais.
  assert.ok(firstAfter.findings.every((f) => f.conflicts_detected_at_execution.length === 1));
});

test('executeRuleSetForSession — reproductibilité : mêmes réponses -> mêmes findings déclenchés (contenu identique) à chaque nouvelle exécution', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  ensureCompleted(sessionId);
  const third = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});

  const shape = (execId) => E.getExecutionDetail(sessionId, execId).findings.map((f) => ({
    stable_key: f.stable_key, finding_type: f.finding_type, title: f.title, summary: f.summary, priority: f.priority,
  }));
  assert.deepEqual(shape(first.execution_id), shape(second.execution_id));
  assert.deepEqual(shape(second.execution_id), shape(third.execution_id));
});

test('listExecutions — ordonne du plus récent au plus ancien, filtre par domaine', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  ensureCompleted(sessionId);
  const second = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const list = E.listExecutions(sessionId, { domain: 'health' });
  assert.equal(list[0].id, second.execution_id);
  assert.equal(list[1].id, first.execution_id);
});

test('listActiveFindings — exclut un finding écarté (dismissed), pas seulement un finding supersédé', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const findingId = E.getExecutionDetail(sessionId, result.execution_id).findings[0].id;

  assert.equal(E.listActiveFindings(sessionId, { domain: 'health' }).length, 1);
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'Non pertinent pour ce foyer fictif.', expected_revision: rev(sessionId) }, REQ);
  assert.equal(E.listActiveFindings(sessionId, { domain: 'health' }).length, 0, 'un finding écarté ne doit plus apparaître comme actif');
});

test('getExecutionDetail/dismissFinding — refusent un identifiant appartenant à une AUTRE session (IDOR)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const findingId = E.getExecutionDetail(sessionId, result.execution_id).findings[0].id;

  const otherSessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  assert.equal(E.getExecutionDetail(otherSessionId, result.execution_id), null);
  assert.throws(
    () => E.dismissFinding(otherSessionId, findingId, { dismiss_reason: 'Motif.', expected_revision: rev(otherSessionId) }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 404
  );
});

test('dismissFinding — écarte un finding actif avec motif obligatoire, journalise, refuse un second écartement', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const findingId = E.getExecutionDetail(sessionId, result.execution_id).findings[0].id;

  assert.throws(() => E.dismissFinding(sessionId, findingId, { dismiss_reason: '', expected_revision: rev(sessionId) }, REQ));
  const before = auditCount('finding écarté');
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'Non pertinent pour ce foyer fictif.', expected_revision: rev(sessionId) }, REQ);
  assert.equal(auditCount('finding écarté'), before + 1);
  assert.throws(
    () => E.dismissFinding(sessionId, findingId, { dismiss_reason: 'Deuxième motif.', expected_revision: rev(sessionId) }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

// Constat GATE LOT 4A (revue compliance-privacy-reviewer) : la documentation
// affirmait que les 12 actions d'audit du Lot 4A étaient « toutes vérifiées
// par test » pour ne jamais fuiter de contenu métier, sans qu'un test ne le
// vérifie réellement (seul le COMPTAGE des entrées était testé, jamais leur
// CONTENU). Ce test comble ce trou : un marqueur distinctif inséré dans
// chaque champ de texte libre (titre de règle, description, explications,
// motif d'écartement) ne doit JAMAIS apparaître dans `audit_log.details`,
// pour aucune des 12 actions.
test('Lot 4A — les 12 actions d\'audit introduites ne contiennent jamais le contenu métier des règles/motifs (constat GATE, revue compliance-privacy-reviewer)', () => {
  const marker = uniqueKey('MARQUEUR-CONTENU-SENSIBLE');
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const ruleStableKey = uniqueKey('TEST-RULE-AUDIT-LEAK');
  const realConditions = { op: 'equals', ref: { answer: HEALTH_Q }, value: true };
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-audit-leak'), domain: 'health', name: `Ensemble ${marker}` }, REQ);
  const { id: ruleId } = R.upsertRule(ruleSetId, validRuleData({
    stable_key: ruleStableKey,
    conditions: realConditions,
    required_data: [{ answer: HEALTH_Q }],
    title: `Titre ${marker}`,
    description: `Description ${marker}`,
    advisor_explanation: `Explication conseiller ${marker}`,
    client_explanation: `Explication client ${marker}`,
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    id: ruleId, stable_key: ruleStableKey, conditions: realConditions, required_data: [{ answer: HEALTH_Q }],
    title: `Titre modifié ${marker}`, advisor_explanation: `Explication modifiée ${marker}`,
  }), REQ);
  const clone = R.cloneRuleSetToNewDraft(ruleSetId, REQ);
  R.archiveRuleSet(clone.id, REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const findingId = E.getExecutionDetail(sessionId, result.execution_id).findings[0].id;
  E.dismissFinding(sessionId, findingId, { dismiss_reason: `Motif d'écartement ${marker}`, expected_revision: rev(sessionId) }, REQ);
  E.listActiveFindings(sessionId, { domain: 'health' }, REQ);
  E.listFindingsHistory(sessionId, { domain: 'health' }, REQ);

  const actions = [
    'rule_set créé', 'rule_set version créée', 'rule_set archivé', 'rule_set cloné', 'règle créée', 'règle modifiée',
    'rule_set publié', 'exécution échouée', 'exécution lancée', 'consultation findings sensibles',
    'consultation historique findings', 'finding écarté',
  ];
  const rows = db.prepare(`SELECT action, details FROM audit_log WHERE action IN (${actions.map(() => '?').join(',')})`).all(...actions);
  assert.ok(rows.length > 0, 'au moins une entrée doit exister pour ce test (sinon il ne teste rien)');
  for (const row of rows) {
    assert.ok(!row.details || !row.details.includes(marker), `l'action « ${row.action} » ne doit jamais contenir le contenu métier de la règle/du motif (trouvé : « ${row.details} »)`);
  }
});

test('listActiveFindings/getExecutionDetail — consultation de findings sensibles journalisée distinctement, dédupliquée, jamais si aucune donnée sensible utilisée', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  // HEALTH_Q n'est pas marquée sensible AU MOMENT DE L'EXÉCUTION -> pas de
  // journalisation dédiée, ni à l'exécution ni à la lecture.
  const before = auditCount('consultation findings sensibles');
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.listActiveFindings(sessionId, { domain: 'health' }, REQ);
  assert.equal(auditCount('consultation findings sensibles'), before);

  // Marquer la question sensible après coup ne change rien à CETTE exécution
  // déjà produite (classification figée, GATE LOT 4A §4) : seule une
  // NOUVELLE exécution capture la nouvelle classification.
  db.prepare('UPDATE advisory_questions SET sensitive = 1 WHERE id = ?').run(qId);
  E.getExecutionDetail(sessionId, result.execution_id, REQ);
  assert.equal(auditCount('consultation findings sensibles'), before, 'reclassification postérieure : jamais rétroactive sur une exécution déjà figée');

  // Une nouvelle exécution, elle, capture la sensibilité désormais active ->
  // journalisation dédiée, puis dédupliquée sur lecture immédiate suivante.
  ensureCompleted(sessionId);
  const result2 = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.getExecutionDetail(sessionId, result2.execution_id, REQ);
  assert.equal(auditCount('consultation findings sensibles'), before + 1);
  E.listActiveFindings(sessionId, { domain: 'health' }, REQ);
  assert.equal(auditCount('consultation findings sensibles'), before + 1);
});

test('exécution/lecture — sensibilité FIGÉE au moment de l\'exécution, jamais réévaluée en direct (GATE LOT 4A §4)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  // Sensible DÈS AVANT l'exécution -> figé sensible pour toujours sur cette
  // exécution précise, même si la question redevient non-sensible ensuite.
  db.prepare('UPDATE advisory_questions SET sensitive = 1 WHERE id = ?').run(qId);
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  // Reclassifiée non-sensible AVANT toute lecture -> ne change rien : la
  // classification figée à l'exécution (sensible) prime sur l'état courant.
  db.prepare('UPDATE advisory_questions SET sensitive = 0 WHERE id = ?').run(qId);

  const before = auditCount('consultation findings sensibles');
  const detail = E.getExecutionDetail(sessionId, result.execution_id, REQ);
  assert.equal(auditCount('consultation findings sensibles'), before + 1, 'reclassification en non-sensible : la lecture de CETTE exécution reste néanmoins journalisée (constat historique figé)');

  const answerRefs = detail.findings.flatMap((f) => f.used_inputs_ref.filter((r) => r.kind === 'answer'));
  assert.ok(answerRefs.length >= 1);
  for (const ref of answerRefs) {
    assert.equal(ref.sensitivity_at_execution, true);
    assert.ok(ref.answer_id, 'référence immuable vers la ligne advisory_answers exacte utilisée');
    assert.equal(ref.questionnaire_version_id, healthVersionId);
    assert.ok(ref.read_at);
  }
  assert.equal(detail.inputs_snapshot.answers_used.find((a) => a.question_id === qId).sensitivity_at_execution, true);

  // Jamais la valeur de réponse elle-même (ni aucune valeur sensible) dans
  // audit_log — seules des références structurées (ids), jamais un contenu.
  const rows = db.prepare("SELECT details FROM audit_log WHERE action = 'consultation findings sensibles'").all();
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(!row.details || !row.details.includes('true'));
});

test('executeRuleSetForSession — une erreur interne inattendue (jamais une AdvisoryError) est enregistrée comme exécution échouée, jamais silencieuse', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  // Corruption délibérée post-publication (impossible via le service normal,
  // qui refuse un cycle à la publication) — simule une exécution qui
  // rencontre un état interne inattendu, pour vérifier le chemin d'échec.
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  const ruleRowId = rules[0].id;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), ruleRowId);

  const before = auditCount('exécution échouée');
  const beforeSuccess = auditCount('exécution lancée');
  ensureCompleted(sessionId);
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));
  assert.equal(auditCount('exécution échouée'), before + 1);
  const failed = db.prepare("SELECT * FROM advisory_rule_executions WHERE session_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1").get(sessionId);
  assert.ok(failed);
  assert.ok(failed.error_message);

  // GATE LOT 4A §9 : aucun finding partiel, aucun audit de succès sur
  // rollback -- la transaction d'exécution échouée n'a laissé AUCUNE trace
  // « completed », ni le moindre finding, seulement la ligne `failed` elle-même.
  assert.equal(auditCount('exécution lancée'), beforeSuccess, 'aucun audit de succès ne doit apparaître pour une exécution qui a échoué');
  const allExecutionsForSession = db.prepare('SELECT status FROM advisory_rule_executions WHERE session_id = ?').all(sessionId);
  assert.ok(allExecutionsForSession.every((e) => e.status === 'failed'), 'aucune exécution "completed" (même partielle) ne doit exister pour cette session');
  const findingsForSession = db.prepare('SELECT id FROM advisory_findings WHERE session_id = ?').all(sessionId);
  assert.equal(findingsForSession.length, 0, 'aucun finding partiel ne doit avoir été inséré avant l’échec (transaction atomique)');
});

// --- executeApplicableRuleSetsForSession (LOT 4B §7 : orchestration) -------

test('executeApplicableRuleSetsForSession — session mixed, les trois domaines ont un rule_set publié : trois exécutions "completed", jamais fusionnées', () => {
  const sessionId = createAndStartMixedSession();
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: commonQId, status: 'answered', value: true },
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  buildBasicPublishedCommonRuleSet();
  buildBasicPublishedRuleSet();
  const { id: lifeRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-life-orch'), domain: 'life_pension', name: 'X' }, REQ);
  R.upsertRule(lifeRuleSetId, validRuleData({
    stable_key: 'TEST-RULE-LIFE-ORCH',
    conditions: { op: 'equals', ref: { answer: LIFE_Q }, value: true },
    required_data: [{ answer: LIFE_Q }],
  }), REQ);
  publishForDomain('life_pension', lifeRuleSetId);

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.domain).sort(), ['common', 'health', 'life_pension']);
  assert.ok(results.every((r) => r.status === 'completed'), 'les trois domaines ont bien un rule_set publié : aucun ne doit être "skipped" ou "failed"');
  assert.ok(results.every((r) => Number.isInteger(r.execution_id)));
  assert.ok(results.every((r) => r.findings_count === 1));

  // Trois lignes bien DISTINCTES en base, jamais une exécution unique
  // opaque mélangeant les domaines (même invariant que l'appel manuel
  // répété, docs/advisory/DATA_MODEL.md §3.2).
  const executions = E.listExecutions(sessionId, {});
  assert.equal(executions.length, 3);
});

test('executeApplicableRuleSetsForSession — un domaine sans rule_set publié est "skipped_no_published_rule_set", jamais une erreur, jamais un blocage des autres domaines', () => {
  const sessionId = createAndStartMixedSession();
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);

  // Ni common ni life_pension n'ont de rule_set publié pour CETTE clé de
  // test (seul health en a un) -- décision volontaire : ne pas publier de
  // rule_set fictif de complaisance pour ces deux domaines, exactement le
  // scénario que ce test veut couvrir (§22, absence de rule_set).
  archiveAllPublishedForDomain('common');
  archiveAllPublishedForDomain('life_pension');
  buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const byDomain = Object.fromEntries(results.map((r) => [r.domain, r]));
  assert.equal(byDomain.health.status, 'completed');
  assert.equal(byDomain.common.status, 'skipped_no_published_rule_set');
  assert.equal(byDomain.life_pension.status, 'skipped_no_published_rule_set');
  assert.equal(byDomain.common.execution_id, undefined);
  assert.equal(byDomain.life_pension.execution_id, undefined);

  // Aucune ligne d'exécution en base pour les domaines "skipped" -- ce
  // n'est jamais une exécution ratée tracée comme telle, juste une absence
  // constatée avant même de tenter quoi que ce soit.
  const executions = E.listExecutions(sessionId, {});
  assert.equal(executions.length, 1);
  assert.equal(executions[0].domain, 'health');
});

test('executeApplicableRuleSetsForSession — session non-mixed (health) : common et health seulement, jamais life_pension', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  buildBasicPublishedRuleSet();
  archiveAllPublishedForDomain('common');

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  assert.deepEqual(results.map((r) => r.domain).sort(), ['common', 'health']);
});

test('executeApplicableRuleSetsForSession — une erreur interne inattendue sur UN domaine est "failed" mais ne bloque jamais les autres domaines (pas d\'atomicité globale, GATE LOT 4B §7)', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  archiveAllPublishedForDomain('common');
  const healthRuleSetId = buildBasicPublishedRuleSet();
  const { id: lifeRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-life-orch-fail'), domain: 'life_pension', name: 'X' }, REQ);
  R.upsertRule(lifeRuleSetId, validRuleData({
    stable_key: 'TEST-RULE-LIFE-ORCH-FAIL',
    conditions: { op: 'equals', ref: { answer: LIFE_Q }, value: true },
    required_data: [{ answer: LIFE_Q }],
  }), REQ);
  publishForDomain('life_pension', lifeRuleSetId);

  // Corruption délibérée du rule_set health, post-publication, pour
  // provoquer une erreur INATTENDUE spécifiquement sur ce domaine (même
  // technique que le test direct de `executeRuleSetForSession` ci-dessus) :
  // un cycle rule_result -> lui-même, impossible à publier normalement.
  const healthRules = R.getRuleSetDetail(healthRuleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: healthRules[0].stable_key }, value: true }), healthRules[0].id);

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const byDomain = Object.fromEntries(results.map((r) => [r.domain, r]));
  assert.equal(byDomain.health.status, 'failed');
  assert.ok(byDomain.health.error, 'un message d\'erreur (générique, jamais brut) doit accompagner le statut "failed"');
  assert.ok(!/SQLITE|constraint|advisory_rules/i.test(byDomain.health.error), 'jamais de détail interne brut exposé dans le résultat renvoyé à l\'appelant');
  assert.equal(byDomain.common.status, 'skipped_no_published_rule_set');
  // L'échec inattendu d'un domaine ne doit JAMAIS empêcher un autre domaine
  // parfaitement valide de compléter normalement (pas d'atomicité globale).
  assert.equal(byDomain.life_pension.status, 'completed');
  assert.ok(Number.isInteger(byDomain.life_pension.execution_id));

  // Le détail réel de l'erreur reste tracé côté serveur (audit + colonne
  // error_message), jamais perdu, seulement non exposé tel quel à l'appelant.
  const failedRow = db.prepare("SELECT * FROM advisory_rule_executions WHERE session_id = ? AND domain = 'health' AND status = 'failed'").get(sessionId);
  assert.ok(failedRow && failedRow.error_message);

  // Constat GATE LOT 4B (revue rules-engine-auditor) : ce drapeau dérivé,
  // directement exposé par la projection de l'espace conseiller des
  // findings, n'était couvert par aucun test -- vérifié ici que le domaine
  // en échec le porte bien, jamais les deux autres domaines (dont un
  // n'a même jamais rien tenté, `skipped_no_published_rule_set`).
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.last_attempt_failed, true);
  assert.equal(workspace.by_domain.health.last_execution, null, 'aucune exécution complétée pour health : seul un essai en échec existe');
  assert.equal(workspace.by_domain.life_pension.last_attempt_failed, false);
  assert.equal(workspace.by_domain.common.last_attempt_failed, false);
});

test('executeApplicableRuleSetsForSession — relance après amendement : le domaine déjà pinné réutilise SON rule_set figé, jamais la dernière version publiée depuis', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const firstRuleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const firstResults = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const firstHealth = firstResults.find((r) => r.domain === 'health');
  assert.equal(firstHealth.status, 'completed');
  const firstExecution = E.getExecutionDetail(sessionId, firstHealth.execution_id);
  assert.equal(firstExecution.rule_set_id, firstRuleSetId);

  // Une NOUVELLE version du même rule_set (même famille) est publiée entre
  // les deux relances -- un amendement de règles tout à fait normal, qui ne
  // doit JAMAIS casser la relance : le domaine reste pinné sur son rule_set
  // d'origine, jamais silencieusement mis à niveau (reproductibilité).
  const { id: newVersionId } = R.cloneRuleSetToNewDraft(firstRuleSetId, REQ);
  publishHealthRuleSet(newVersionId);

  // Ré-amende la réponse pour simuler une correction du conseiller après le
  // premier passage -- `amendAnswer` reste utilisable DIRECTEMENT sur une
  // session `completed` (jamais besoin de repasser par `in_progress`) : ici
  // la réponse amendée reste `status: 'answered'`, donc la complétude reste
  // valide et aucune réouverture n'est déclenchée (correctif d'intégrité de
  // la complétude de session, TRANSITIONS.completed.reopen -- voir
  // server/advisorySessions.js -- qui ne s'active que si l'amendement rend
  // une réponse requise absente).
  S.amendAnswer(sessionId, {
    question_id: healthQId, status: 'answered', value: true,
    amendment_reason: 'Correction technique fictive pour test de relance.',
    expected_revision: rev(sessionId),
  }, REQ);

  const secondResults = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const secondHealth = secondResults.find((r) => r.domain === 'health');
  assert.equal(secondHealth.status, 'completed', 'la relance ne doit jamais échouer avec un conflit "déjà lié à un autre ensemble" simplement parce qu\'une nouvelle version a été publiée entre-temps');
  const secondExecution = E.getExecutionDetail(sessionId, secondHealth.execution_id);
  assert.equal(secondExecution.rule_set_id, firstRuleSetId, 'toujours le rule_set d\'ORIGINE, jamais la nouvelle version publiée depuis (pin de reproductibilité)');
  assert.notEqual(secondHealth.execution_id, firstHealth.execution_id);
});

test('executeApplicableRuleSetsForSession — préconditions de session vérifiées UNE SEULE FOIS avant tout domaine : une session non "completed" rejette l\'appel entier, sans exécution partielle', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  buildBasicPublishedRuleSet();
  archiveAllPublishedForDomain('common');

  // Session encore `in_progress` (jamais complétée) -- rejetée d'emblée.
  assert.throws(
    () => E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ),
    (e) => e.status === 409
  );
  assert.equal(E.listExecutions(sessionId, {}).length, 0, 'aucune exécution, même "skipped", ne doit être produite pour un appel entièrement rejeté');
});

test('executeApplicableRuleSetsForSession — révision attendue obsolète : rejetée avant tout domaine, comme executeRuleSetForSession', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  buildBasicPublishedRuleSet();
  archiveAllPublishedForDomain('common');
  ensureCompleted(sessionId);

  assert.throws(
    () => E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId) - 1, REQ),
    (e) => e.status === 409 && /révision/.test(e.message)
  );
});

// GATE LOT 4B §4 (test explicitement requis) : le premier domaine RÉUSSIT,
// puis un domaine évalué APRÈS lui dans la même orchestration ÉCHOUE --
// distinct du test ci-dessus (`une erreur interne inattendue sur UN
// domaine...`), qui couvre l'ordre inverse (échec PUIS succès). Vérifie que
// le succès du premier domaine n'est ni annulé, ni masqué, ni requalifié en
// échec global simplement parce qu'un domaine suivant a échoué -- chaque
// domaine garde sa propre transaction indépendante (pas d'atomicité
// globale, GATE LOT 4B §7).
test('executeApplicableRuleSetsForSession — le premier domaine réussit, le SECOND échoue ensuite : le succès du premier n\'est ni annulé ni masqué par l\'échec du second', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);

  archiveAllPublishedForDomain('common');
  const healthRuleSetId = buildBasicPublishedRuleSet(); // health : premier domaine réellement exécuté (common est "skipped_no_published_rule_set")
  const { id: lifeRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-life-second-fail'), domain: 'life_pension', name: 'X' }, REQ);
  R.upsertRule(lifeRuleSetId, validRuleData({
    stable_key: 'TEST-RULE-LIFE-SECOND-FAIL',
    conditions: { op: 'equals', ref: { answer: LIFE_Q }, value: true },
    required_data: [{ answer: LIFE_Q }],
  }), REQ);
  publishForDomain('life_pension', lifeRuleSetId);
  // Corruption délibérée du SECOND domaine réellement exécuté (life_pension,
  // dernier dans l'ordre d'itération `allowedExecutionDomainsForSession`),
  // jamais le premier (health) -- ordre inverse du test précédent.
  const lifeRules = R.getRuleSetDetail(lifeRuleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: lifeRules[0].stable_key }, value: true }), lifeRules[0].id);

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const byDomain = Object.fromEntries(results.map((r) => [r.domain, r]));

  assert.equal(byDomain.common.status, 'skipped_no_published_rule_set');
  assert.equal(byDomain.health.status, 'completed', 'le premier domaine réellement exécuté doit rester "completed", jamais requalifié à cause d\'un échec survenu APRÈS lui');
  assert.ok(Number.isInteger(byDomain.health.execution_id));
  assert.equal(byDomain.health.findings_count, 1);
  assert.equal(byDomain.life_pension.status, 'failed');

  // La ligne d'exécution "completed" de health doit RÉELLEMENT exister en
  // base, avec son finding persistant -- jamais un résultat en mémoire
  // seulement, jamais annulé par la transaction indépendante du domaine
  // suivant qui a échoué (pas de SAVEPOINT partagé entre domaines).
  const healthExecution = E.getExecutionDetail(sessionId, byDomain.health.execution_id, REQ);
  assert.equal(healthExecution.status, 'completed');
  assert.equal(healthExecution.rule_set_id, healthRuleSetId);
  assert.equal(healthExecution.findings.length, 1);

  // La projection de l'espace des constats doit elle aussi refléter
  // fidèlement les deux : health à jour et consultable, life_pension marqué
  // "dernier essai en échec", jamais l'un masquant l'autre.
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.state, 'up_to_date');
  assert.equal(workspace.by_domain.health.findings.length, 1);
  assert.equal(workspace.by_domain.life_pension.last_attempt_failed, true);
  assert.equal(workspace.by_domain.life_pension.last_execution, null);
});

// GATE LOT 4B §4 : une RÉEXÉCUTION en échec (sur un domaine ayant déjà une
// exécution complétée antérieure) ne doit JAMAIS superséder cette exécution
// antérieure -- la supersession n'a lieu que DANS la même transaction que la
// nouvelle exécution COMPLÉTÉE (voir executeRuleSetForSession), jamais avant
// de savoir si elle réussit. Sans cette garantie, un échec technique
// transitoire pourrait faire disparaître à tort les constats précédemment
// valides d'un domaine, sans qu'aucun nouveau résultat ne les remplace.
test('executeRuleSetForSession — une réexécution en ÉCHEC ne supersède JAMAIS l\'exécution complétée antérieure de ce domaine (findings précédents intacts)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const first = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  // Corruption délibérée APRÈS la première exécution réussie, pour que la
  // RELANCE échoue précisément (jamais la première).
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);

  // La révision n'a pas changé (aucun amendement) -- utilise donc encore la
  // même révision attendue que la première exécution.
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));

  const firstRow = db.prepare('SELECT * FROM advisory_rule_executions WHERE id = ?').get(first.execution_id);
  assert.equal(firstRow.status, 'completed', 'la première exécution reste "completed", jamais altérée par l\'échec de la relance');
  assert.equal(firstRow.superseded_by_execution_id, null, 'jamais supersédée par une réexécution qui n\'a pas abouti');

  const firstFindings = db.prepare('SELECT status FROM advisory_findings WHERE rule_execution_id = ?').all(first.execution_id);
  assert.ok(firstFindings.length > 0);
  assert.ok(firstFindings.every((f) => f.status === 'active'), 'les findings de la première exécution restent actifs, jamais marqués "superseded" par une relance qui a échoué');

  // La projection continue de présenter la première exécution comme la
  // référence courante -- jamais un trou silencieux.
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.last_execution.id, first.execution_id);
  assert.equal(workspace.by_domain.health.last_attempt_failed, true);
});

// --- getSessionFindingsWorkspace (LOT 4B §5 : projection espace conseiller) -

test('getSessionFindingsWorkspace — session mixed : by_domain regroupe STRICTEMENT par domaine réel, jamais interleaved, chaque domaine porte son propre état', () => {
  const sessionId = createAndStartMixedSession();
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [
    { question_id: commonQId, status: 'answered', value: true },
    { question_id: healthQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);

  archiveAllPublishedForDomain('common');
  archiveAllPublishedForDomain('life_pension');
  buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const before = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.deepEqual(Object.keys(before.by_domain).sort(), ['common', 'health', 'life_pension']);
  assert.equal(before.by_domain.common.state, 'no_rule_set_available');
  assert.equal(before.by_domain.life_pension.state, 'no_rule_set_available');
  assert.equal(before.by_domain.health.state, 'not_yet_run');
  assert.equal(before.session.id, sessionId);
  assert.equal(before.household.members.length, 2);
  assert.equal(before.actions.can_launch_analysis, true);
  assert.equal(before.actions.can_dismiss_findings, true);
  assert.equal(before.actions.can_create_recommendation, true);

  E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const after = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(after.by_domain.health.state, 'up_to_date');
  assert.equal(after.by_domain.health.findings.length, 1);
  // Les deux autres domaines restent inchangés -- jamais un finding health
  // qui « fuit » dans un autre domaine de la même réponse groupée.
  assert.equal(after.by_domain.common.findings.length, 0);
  assert.equal(after.by_domain.life_pension.findings.length, 0);
  assert.equal(after.by_domain.common.state, 'no_rule_set_available');
  assert.equal(after.by_domain.life_pension.state, 'no_rule_set_available');
});

// GATE LOT 7B ciblé §2B : `can_create_recommendation` réutilise le même
// prédicat `isSessionWritable` que `advisorySessions.js`
// (`recommendation_capabilities.create`) et `advisoryRecommendations.js`
// (`assertSessionWritable`) -- foyer dédié isolé (jamais le `householdId`
// partagé par le reste de ce fichier) pour l'archiver sans affecter les
// autres tests.
test('getSessionFindingsWorkspace — actions.can_create_recommendation : faux si le foyer est archivé', () => {
  const dedicatedPrincipalId = insertClient();
  const { id: dedicatedHouseholdId } = createHousehold({ primary_client_id: dedicatedPrincipalId }, REQ);
  const sessionId = createAndStartSession(dedicatedHouseholdId, 'health', { versionId: healthVersionId });
  ensureCompleted(sessionId);
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(dedicatedHouseholdId);
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.actions.can_create_recommendation, false);
});

test('getSessionFindingsWorkspace — finding_scope=member : le membre concerné est résolu via sessionMembersFor (jamais une lecture directe household_members), household_member_id absent -> member null', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-workspace-member'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-WORKSPACE-MEMBER',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const finding = workspace.by_domain.health.findings[0];
  assert.equal(finding.household_member_id, principalMemberId);
  assert.ok(finding.member, 'un finding de portée membre doit porter le membre résolu');
  assert.equal(finding.member.id, principalMemberId);
  assert.equal(finding.member.member_role, 'principal');
  assert.equal(finding.member.historical, false);
});

test('getSessionFindingsWorkspace — finding.member : projection minimale exacte (GATE LOT 7B ciblé §6), client_id/current_status/no_longer_active/can_answer absents', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-workspace-member-minimal'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-WORKSPACE-MEMBER-MINIMAL',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const finding = workspace.by_domain.health.findings[0];
  // Assertion sur l'ensemble EXACT des clés (pas seulement la présence des
  // champs utiles) -- toute clé technique interne ajoutée par erreur
  // (`client_id`, `current_status`, `no_longer_active`, `can_answer`, non
  // consommées par SessionFindings.jsx) ferait échouer ce test.
  assert.deepEqual(Object.keys(finding.member).sort(), ['display_name', 'historical', 'id', 'member_role'].sort());
});

test('getExecutionDetail — finding.member : même projection minimale exacte que getSessionFindingsWorkspace (GATE LOT 7B ciblé §11, revue compliance-privacy-reviewer), client_id/current_status/no_longer_active/can_answer absents', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-detail-member-minimal'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-DETAIL-MEMBER-MINIMAL',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: HEALTH_MEMBER_Q }, value: true } },
    required_data: [], finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  const finding = detail.findings[0];
  assert.ok(finding.member, 'un finding de portée membre doit porter le membre résolu, y compris via getExecutionDetail (HistoryModal)');
  // Assertion sur l'ensemble EXACT des clés : toute clé technique interne
  // ajoutée par erreur (`client_id`, `current_status`, `no_longer_active`,
  // `can_answer`, non consommées par HistoryModal/FindingCard) ferait
  // échouer ce test.
  assert.deepEqual(Object.keys(finding.member).sort(), ['display_name', 'historical', 'id', 'member_role'].sort());
});

test('getSessionFindingsWorkspace — un finding écarté porte le nom du conseiller qui l\'a écarté (dismissed_by_name), hydraté en une seule requête groupée', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const findingId = E.getExecutionDetail(sessionId, result.execution_id).findings[0].id;
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'Non pertinent (fictif, test).', expected_revision: rev(sessionId) }, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const finding = workspace.by_domain.health.findings.find((f) => f.id === findingId);
  assert.equal(finding.status, 'dismissed');
  assert.equal(finding.dismissed_by_name, 'Conseiller');
});

test('getSessionFindingsWorkspace — session introuvable : 404, même garde que les autres projections', () => {
  assert.throws(() => E.getSessionFindingsWorkspace(999999, REQ), (e) => e.status === 404);
});

// --- Navigation historique par answer_id (GATE LOT 4B §2) -------------------
// La projection expose désormais, pour chaque référence `used_inputs_ref` de
// type `answer` : `question_stable_key` (alias explicite), `section_id`
// (retrouver la section sans requête supplémentaire), `is_current_answer`
// (la ligne `answer_id` désigne-t-elle encore la réponse ACTIVE ?) -- les
// trois DÉRIVÉS À LA LECTURE (jamais figés dans le JSON stocké), voir
// hydrateFindingRows. La vérification anti-IDOR de la navigation elle-même
// (SessionWorkspace.jsx) repose sur GET .../answers/history, déjà couverte
// par ses propres tests (server/advisorySessions.js) ; les tests ci-dessous
// couvrent la partie serveur nouvellement exposée par CE module.

test('getSessionFindingsWorkspace — used_inputs_ref answer expose question_stable_key, section_id et is_current_answer=true tant que la réponse n\'a pas été remplacée', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const ref = workspace.by_domain.health.findings[0].used_inputs_ref.find((r) => r.kind === 'answer');
  assert.ok(ref, 'le finding déclenché doit porter au moins une référence de réponse utilisée');
  assert.equal(ref.question_stable_key, HEALTH_Q);
  assert.equal(ref.question_stable_key, ref.stable_key, 'alias explicite de la même valeur, jamais une clé distincte');
  assert.ok(Number.isInteger(ref.section_id), 'la section contenant la question doit être retrouvable sans requête supplémentaire');
  assert.equal(ref.is_current_answer, true, 'la réponse utilisée à l\'exécution n\'a pas été modifiée depuis');
});

test('getExecutionDetail — is_current_answer repasse à false, sur une exécution ANCIENNE et INCHANGÉE, dès que la réponse utilisée est amendée depuis (dérivé à la lecture, jamais figé)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const before = E.getExecutionDetail(sessionId, result.execution_id, REQ);
  const refBefore = before.findings[0].used_inputs_ref.find((r) => r.kind === 'answer');
  assert.equal(refBefore.is_current_answer, true);
  const originalAnswerId = refBefore.answer_id;

  S.amendAnswer(sessionId, {
    question_id: qId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive pour test is_current_answer.',
    expected_revision: rev(sessionId),
  }, REQ);

  // La ligne relue est la MÊME exécution historique, jamais ré-exécutée --
  // son `used_inputs_ref` (answer_id) reste identique (immuable), mais
  // `is_current_answer` bascule à false car la ligne `advisory_answers`
  // désignée n'est plus la ligne active (superseded_by_answer_id renseigné).
  const after = E.getExecutionDetail(sessionId, result.execution_id, REQ);
  const refAfter = after.findings[0].used_inputs_ref.find((r) => r.kind === 'answer');
  assert.equal(refAfter.answer_id, originalAnswerId, 'la référence figée à l\'exécution ne change jamais rétroactivement');
  assert.equal(refAfter.is_current_answer, false, 'la réponse utilisée par cette exécution a depuis été remplacée par un amendement');
});

test('answers/history — la vérification anti-IDOR d\'une navigation par answer_id repose sur le filtrage SQL existant : un answer_id d\'une AUTRE session n\'apparaît jamais dans l\'historique de celle-ci', () => {
  const sessionA = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qIdA = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionA, [{ question_id: qIdA, status: 'answered', value: true }], rev(sessionA), REQ);
  const answerIdA = db.prepare('SELECT id FROM advisory_answers WHERE session_id = ? AND question_id = ?').get(sessionA, qIdA).id;

  const sessionB = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qIdB = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionB, [{ question_id: qIdB, status: 'answered', value: false }], rev(sessionB), REQ);

  // Même question technique (même version de questionnaire réutilisée par
  // les deux sessions), mais deux sessions DISTINCTES -- l'historique de la
  // session B ne doit jamais laisser apparaître la ligne de réponse de la
  // session A, même si elle porte le même question_id.
  const historyB = S.listAnswerHistory(sessionB, qIdB, null, REQ);
  assert.ok(!historyB.some((r) => r.id === answerIdA), 'une ligne de réponse d\'une autre session ne doit jamais apparaître dans cet historique (base de la vérification anti-IDOR de la navigation par answer_id)');
});

// --- Cinq cas distincts d'answer_id invalide (MICRO-GATE §2) ---------------
// Le rapport du GATE précédent notait qu'un seul scénario représentatif
// avait été réellement testé pour les quatre/cinq cas invalides -- ce bloc
// les couvre CHACUN séparément, avec les vérifications explicitement
// requises : aucune valeur retournée, aucune ligne étrangère exposée,
// aucune fuite dans l'audit, réponse structurellement IDENTIQUE (même
// forme, même statut) d'un cas à l'autre -- aucune des cinq situations ne
// doit permettre à l'appelant de distinguer LAQUELLE s'est produite.

function auditRowsSince(action, sinceId) {
  return db.prepare('SELECT details FROM audit_log WHERE action = ? AND id > ?').all(action, sinceId);
}

test('answer_id invalide (1/5) — INEXISTANT : absent de l\'historique, aucune valeur, aucune fuite dans l\'audit', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);

  const nonExistentAnswerId = 999999999;
  assert.equal(db.prepare('SELECT 1 FROM advisory_answers WHERE id = ?').get(nonExistentAnswerId), undefined, 'garde-fou : cet identifiant ne doit exister nulle part en base pour ce test');

  const lastAuditId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM audit_log").get().id;
  const rows = S.listAnswerHistory(sessionId, qId, null, REQ);
  assert.ok(!rows.some((r) => r.id === nonExistentAnswerId));
  assert.ok(rows.length > 0, 'la réponse RÉELLEMENT active de cette session reste, elle, normalement listée -- seul l\'identifiant inexistant est absent');

  // `lastAuditId` capturé AVANT l'appel : `id > lastAuditId` (jamais `- 1`,
  // corrigé après revue compliance-privacy-reviewer, MICRO-GATE §4) ne
  // retient QUE les entrées produites par CET appel, jamais une ligne
  // préexistante d'un test précédent.
  const newRows = auditRowsSince('consultation historique réponse', lastAuditId);
  assert.ok(newRows.length > 0, 'cet appel doit avoir produit au moins une nouvelle entrée d\'audit');
  for (const row of newRows) {
    assert.ok(!row.details || !row.details.includes(String(nonExistentAnswerId)), 'l\'audit ne doit jamais mentionner un answer_id demandé mais invalide, ni aucune valeur');
  }
});

test('answer_id invalide (2/5) — appartient à une AUTRE SESSION DU MÊME FOYER : absent de l\'historique de la session consultée', () => {
  const sessionA = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qIdA = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionA, [{ question_id: qIdA, status: 'answered', value: true }], rev(sessionA), REQ);
  const answerIdA = db.prepare('SELECT id FROM advisory_answers WHERE session_id = ? AND question_id = ?').get(sessionA, qIdA).id;

  // Même FOYER (`householdId` partagé), session B DISTINCTE.
  const sessionB = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qIdB = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionB, [{ question_id: qIdB, status: 'answered', value: false }], rev(sessionB), REQ);

  const rows = S.listAnswerHistory(sessionB, qIdB, null, REQ);
  assert.ok(!rows.some((r) => r.id === answerIdA), 'un answer_id d\'une autre session du MÊME foyer ne doit jamais apparaître');
  assert.ok(!rows.some((r) => r.value === true), 'aucune valeur provenant de la session A ne doit fuiter dans les lignes retournées pour la session B');
});

test('answer_id invalide (3/5) — appartient à une session d\'un AUTRE FOYER : absent de l\'historique, aucun accès interfoyer', () => {
  const otherHousehold = buildHouseholdWithChild();
  const sessionOther = createAndStartSession(otherHousehold.householdId, 'health', { versionId: healthVersionId });
  const qIdOther = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionOther, [{ question_id: qIdOther, status: 'answered', value: true }], rev(sessionOther), REQ);
  const answerIdOther = db.prepare('SELECT id FROM advisory_answers WHERE session_id = ? AND question_id = ?').get(sessionOther, qIdOther).id;

  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: false }], rev(sessionId), REQ);

  const rows = S.listAnswerHistory(sessionId, qId, null, REQ);
  assert.ok(!rows.some((r) => r.id === answerIdOther), 'un answer_id d\'un AUTRE foyer ne doit jamais apparaître, quand bien même la question technique est identique');
});

test('answer_id invalide (4/5) — VALIDE mais QUESTION_ID différente de celle annoncée : absent quand on interroge la mauvaise question', () => {
  // Session santé AVEC le module commun rattaché (createAndStartSessionWithCommon)
  // pour disposer de DEUX questions foyer réellement répondues et légitimes
  // sur la même session (HEALTH_Q et COMMON_Q), plutôt qu'une insertion SQL
  // directe -- un answer_id parfaitement valide, simplement rattaché à une
  // AUTRE question que celle annoncée.
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const qStableId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: qStableId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const otherAnswerId = db.prepare('SELECT id FROM advisory_answers WHERE session_id = ? AND question_id = ?').get(sessionId, commonQId).id;

  const rows = S.listAnswerHistory(sessionId, qStableId, null, REQ);
  assert.ok(!rows.some((r) => r.id === otherAnswerId), 'un answer_id valide pour CETTE session mais rattaché à une AUTRE question ne doit jamais apparaître quand on interroge la question annoncée');
});

test('answer_id invalide (5/5) — VALIDE, bonne question, mais MEMBRE incohérent : absent quand on interroge le mauvais membre', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);
  const principalAnswerId = db.prepare(
    'SELECT id FROM advisory_answers WHERE session_id = ? AND question_id = ? AND household_member_id = ?'
  ).get(sessionId, memberQId, principalMemberId).id;

  // Interroge le membre ENFANT alors que l'answer_id appartient au PRINCIPAL.
  const rows = S.listAnswerHistory(sessionId, memberQId, childMemberId, REQ);
  assert.ok(!rows.some((r) => r.id === principalAnswerId), 'un answer_id valide pour la bonne session/question mais un AUTRE membre ne doit jamais apparaître');
});

// Constat compliance-privacy-reviewer (MICRO-GATE §4) : une précédente
// version de ce test (« ... produisent une réponse STRUCTURELLEMENT
// IDENTIQUE... ») n'exerçait qu'UN SEUL appel légitime avec une assertion
// trivialement vraie par construction (`Array.isArray`, toujours vraie vu
// l'implémentation de `listAnswerHistory`) -- elle ne comparait RIEN entre
// les cinq scénarios, contrairement à ce que son nom annonçait. Remplacée
// par une comparaison RÉELLE de la FORME des lignes retournées (mêmes clés,
// dans le même ordre logique) entre un appel légitime et chacun des cinq
// scénarios invalides -- la preuve de neutralité au niveau HTTP (statut,
// forme du corps JSON) reste, elle, portée par le test API dédié
// (`test/advisory-sessions-api.test.js`, désormais étendu aux cinq cas).
test('answer_id invalide — les cinq cas retournent une liste de MÊME FORME qu\'un appel légitime ordinaire (mêmes clés par ligne), jamais un champ ou une structure distinctive', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const qStableId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const memberQId = findQuestionId(healthVersionId, HEALTH_MEMBER_Q);
  S.recordAnswers(sessionId, [
    { question_id: qStableId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: memberQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);

  const referenceRows = S.listAnswerHistory(sessionId, qStableId, null, REQ);
  assert.ok(referenceRows.length > 0);
  const referenceKeys = Object.keys(referenceRows[0]).sort();

  const otherSession = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const otherHousehold = buildHouseholdWithChild();
  const otherHouseholdSession = createAndStartSession(otherHousehold.householdId, 'health', { versionId: healthVersionId });
  S.recordAnswers(otherHouseholdSession, [{ question_id: qStableId, status: 'answered', value: true }], rev(otherHouseholdSession), REQ);

  const scenarios = [
    { label: 'inexistant', rows: S.listAnswerHistory(sessionId, qStableId, null, REQ) },
    { label: 'autre session même foyer (vide, jamais d\'erreur)', rows: S.listAnswerHistory(otherSession, qStableId, null, REQ) },
    { label: 'autre foyer', rows: S.listAnswerHistory(sessionId, qStableId, null, REQ) },
    { label: 'question incohérente (interroge commonQId sur CETTE session)', rows: S.listAnswerHistory(sessionId, commonQId, null, REQ) },
    { label: 'membre incohérent', rows: S.listAnswerHistory(sessionId, memberQId, principalMemberId, REQ) },
  ];

  for (const { label, rows } of scenarios) {
    assert.ok(Array.isArray(rows), `${label} : doit toujours renvoyer un tableau, jamais une exception ni une forme différente`);
    if (rows.length > 0) {
      assert.deepEqual(Object.keys(rows[0]).sort(), referenceKeys, `${label} : les lignes retournées doivent porter EXACTEMENT les mêmes clés qu'un appel légitime ordinaire, jamais un champ supplémentaire ou manquant qui distinguerait ce cas`);
    }
  }
});

// --- État global agrégé et synthèse active (GATE LOT 4B §3) ----------------
// `global_state` ne porte QUE sur les domaines REQUIS par le type de la
// session (`common` en est toujours exclu) ; `synthesis` couvre, elle, tous
// les domaines applicables mais exclut du DÉCOMPTE tout domaine qui n'est
// pas lui-même à jour (ses findings restent consultables dans son propre
// onglet, jamais dans le total).

function publishLifeRuleSet(stableKey, ruleStableKey) {
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey(stableKey), domain: 'life_pension', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: ruleStableKey,
    conditions: { op: 'equals', ref: { answer: LIFE_Q }, value: true },
    required_data: [{ answer: LIFE_Q }],
  }), REQ);
  publishForDomain('life_pension', ruleSetId);
  return ruleSetId;
}

test('global_state — session mixed, les trois domaines (dont common) à jour -> "up_to_date"', () => {
  const sessionId = createAndStartMixedSession();
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: commonQId, status: 'answered', value: true },
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  buildBasicPublishedCommonRuleSet();
  buildBasicPublishedRuleSet();
  publishLifeRuleSet('rs-life-global-1', 'TEST-RULE-LIFE-GLOBAL-1');

  ensureCompleted(sessionId);
  E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.global_state, 'up_to_date');
});

test('global_state — session mixed, common ABSENT (aucun rule_set) alors que health+life_pension sont à jour -> "up_to_date" (common ne bloque jamais)', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  buildBasicPublishedRuleSet();
  publishLifeRuleSet('rs-life-global-2', 'TEST-RULE-LIFE-GLOBAL-2');

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  assert.equal(results.find((r) => r.domain === 'common').status, 'skipped_no_published_rule_set');
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.state, 'no_rule_set_available');
  assert.equal(workspace.global_state, 'up_to_date', 'common est facultatif : son absence ne doit jamais empêcher "up_to_date"');
});

test('global_state — session mixed, health à jour + life_pension obsolète (amendée depuis) -> "stale"', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  buildBasicPublishedRuleSet();
  publishLifeRuleSet('rs-life-global-3', 'TEST-RULE-LIFE-GLOBAL-3');

  ensureCompleted(sessionId);
  E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);

  // Amendement touchant UNIQUEMENT life_pension -- fait avancer la révision
  // de session (globale), donc rend AUSSI health "stale" du point de vue
  // strict de `resolveDomainAnalysisState` (comparaison de révision) --
  // exactement le comportement déjà établi en Lot 4A/4B (la révision est un
  // compteur de SESSION, jamais par domaine) : ce test vérifie donc que le
  // domaine non ré-exécuté reste "stale", jamais silencieusement agrégé
  // comme "up_to_date" avec une révision différente de la session actuelle.
  S.amendAnswer(sessionId, {
    question_id: lifeQId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive life_pension pour test global_state stale.',
    expected_revision: rev(sessionId),
  }, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.state, 'stale');
  assert.equal(workspace.by_domain.life_pension.state, 'stale');
  assert.equal(workspace.global_state, 'stale');
});

test('global_state — session mixed, health réussit + life_pension échoue (erreur interne) -> "partial"', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  buildBasicPublishedRuleSet();
  const lifeRuleSetId = publishLifeRuleSet('rs-life-global-4', 'TEST-RULE-LIFE-GLOBAL-4');
  const lifeRules = R.getRuleSetDetail(lifeRuleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: lifeRules[0].stable_key }, value: true }), lifeRules[0].id);

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  assert.equal(results.find((r) => r.domain === 'health').status, 'completed');
  assert.equal(results.find((r) => r.domain === 'life_pension').status, 'failed');

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.global_state, 'partial');
});

test('global_state — session health seule, jamais lancée, rule_set publié -> "not_analyzed"', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  archiveAllPublishedForDomain('common');
  buildBasicPublishedRuleSet();
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.global_state, 'not_analyzed');
});

test('global_state — session health seule, aucun rule_set jamais publié pour ce domaine -> "unavailable"', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  archiveAllPublishedForDomain('common');
  archiveAllPublishedForDomain('health');
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.state, 'no_rule_set_available');
  assert.equal(workspace.global_state, 'unavailable');
});

test('global_state — session health seule, échec pur (aucune exécution n\'a jamais réussi) -> "error"', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);

  ensureCompleted(sessionId);
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  // Le rule_set publié existe toujours (canLaunch reste vrai) -- l'échec ne
  // change donc jamais l'état PAR DOMAINE lui-même ("not_yet_run", puisque
  // aucune exécution n'a jamais COMPLÉTÉ), seul `last_attempt_failed`
  // signale l'échec. C'est précisément cette combinaison (jamais complété +
  // dernier essai en échec) que l'état global doit reconnaître comme "error".
  assert.equal(workspace.by_domain.health.state, 'not_yet_run');
  assert.equal(workspace.by_domain.health.last_attempt_failed, true);
  assert.equal(workspace.global_state, 'error', 'aucun domaine requis n\'a jamais produit de résultat exploitable, et une tentative a échoué');
});

test('global_state — frontière "partial" vs "error" : un domaine requis échoue pendant qu\'un AUTRE domaine requis reste exploitable -> "partial", jamais "error"', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);
  publishLifeRuleSet('rs-life-global-error', 'TEST-RULE-LIFE-GLOBAL-ERROR');

  ensureCompleted(sessionId);
  const results = E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  assert.equal(results.find((r) => r.domain === 'health').status, 'failed');
  assert.equal(results.find((r) => r.domain === 'life_pension').status, 'completed');

  // life_pension a bien un résultat exploitable (à jour) -- donc "partial",
  // JAMAIS "error" (réservé au cas où AUCUN domaine requis n'a de résultat
  // exploitable). Documente explicitement la frontière entre les deux états.
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.global_state, 'partial', 'life_pension reste exploitable : "partial", pas "error" (réservé à un échec sans AUCUN domaine requis exploitable)');
});

test('synthèse active — un domaine devenu "stale" reste consultable dans son propre onglet mais ses findings ne sont JAMAIS additionnés dans le total actif', () => {
  const sessionId = createAndStartMixedSession({ includeCommon: false });
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  buildBasicPublishedRuleSet();
  publishLifeRuleSet('rs-life-synthesis-1', 'TEST-RULE-LIFE-SYNTHESIS-1');

  ensureCompleted(sessionId);
  E.executeApplicableRuleSetsForSession(sessionId, rev(sessionId), REQ);
  const before = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(before.synthesis.active_findings_count, 2, 'un finding actif par domaine (health + life_pension), tous deux à jour au départ');
  assert.deepEqual(before.synthesis.domains_excluded_stale, []);

  // Amende SEULEMENT life_pension -- fait avancer la révision de la session
  // (compteur global), donc les DEUX domaines devraient déjà être "stale" au
  // regard strict de la révision (voir test global_state ci-dessus) --
  // relance alors UNIQUEMENT health pour recréer précisément le cas GATE §3
  // « un domaine relancé individuellement, l'autre resté obsolète ».
  S.amendAnswer(sessionId, {
    question_id: lifeQId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive pour test synthèse active.',
    expected_revision: rev(sessionId),
  }, REQ);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ);

  const after = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(after.by_domain.health.state, 'up_to_date');
  assert.equal(after.by_domain.life_pension.state, 'stale');
  // Le domaine life_pension obsolète reste CONSULTABLE (son finding est
  // toujours présent dans son propre onglet)...
  assert.equal(after.by_domain.life_pension.findings.length, 1);
  // ...mais n'est JAMAIS additionné dans le total actif -- seul le finding
  // health (lui, à jour) compte désormais.
  assert.equal(after.synthesis.active_findings_count, 1, 'seul le domaine à jour (health) doit compter dans la synthèse active, jamais life_pension (obsolète)');
  assert.deepEqual(after.synthesis.domains_current, ['health']);
  assert.deepEqual(after.synthesis.domains_excluded_stale, ['life_pension']);
});

// GATE LOT 4B §6 : complète le test « les 12 actions d'audit... » ci-dessus
// (Lot 4A) avec les DEUX actions supplémentaires propres à ce lot --
// 'consultation espace constats session' (nouvelle, `auditFindingsWorkspaceView`)
// et 'consultation historique réponse' (Lot 3B, RÉUTILISÉE telle quelle par
// la navigation par answer_id, §2 -- jamais une action dédiée distincte,
// décision volontaire pour ne jamais dupliquer l'entrée d'audit d'un même
// geste réel).
test('Lot 4B — les deux actions d\'audit propres à l\'espace des constats ne contiennent jamais le contenu métier des règles (marqueur de test absent de details)', () => {
  const marker = uniqueKey('MARQUEUR-CONTENU-SENSIBLE-4B');
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-audit-4b-leak'), domain: 'health', name: `Ensemble ${marker}` }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: uniqueKey('TEST-RULE-AUDIT-4B-LEAK'),
    conditions: { op: 'equals', ref: { answer: HEALTH_Q }, value: true },
    required_data: [{ answer: HEALTH_Q }],
    title: `Titre ${marker}`, description: `Description ${marker}`,
    advisor_explanation: `Explication conseiller ${marker}`, client_explanation: `Explication client ${marker}`,
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.getSessionFindingsWorkspace(sessionId, REQ); // -> 'consultation espace constats session'
  S.listAnswerHistory(sessionId, qId, null, REQ); // -> 'consultation historique réponse' (réutilisée par la navigation §2)

  const actions = ['consultation espace constats session', 'consultation historique réponse'];
  const rows = db.prepare(`SELECT action, details FROM audit_log WHERE action IN (${actions.map(() => '?').join(',')}) AND entity_id = ?`).all(...actions, sessionId);
  assert.ok(actions.every((a) => rows.some((r) => r.action === a)), 'les deux actions doivent bien avoir été journalisées pour ce test');
  for (const row of rows) {
    assert.ok(!row.details || !row.details.includes(marker), `l'action « ${row.action} » ne doit jamais contenir le contenu métier de la règle (trouvé : « ${row.details} »)`);
  }
});

test('resolveDomainAnalysisState — last_attempt_error est un message MINIMISÉ générique, jamais le contenu brut de error_message stocké en base', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);

  ensureCompleted(sessionId);
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));

  const failedRow = db.prepare("SELECT error_message FROM advisory_rule_executions WHERE session_id = ? AND status = 'failed'").get(sessionId);
  assert.ok(failedRow.error_message, 'le détail réel reste tracé en base pour le diagnostic serveur');

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.last_attempt_failed, true);
  assert.ok(workspace.by_domain.health.last_attempt_error, 'un message minimisé doit accompagner un dernier essai en échec');
  assert.notEqual(workspace.by_domain.health.last_attempt_error, failedRow.error_message, 'jamais le contenu brut stocké en base, seulement un message générique sûr');
  assert.ok(!/Cycle inattendu|SQLITE|advisory_rules/i.test(workspace.by_domain.health.last_attempt_error), 'jamais de détail technique interne exposé dans ce champ');
});

// --- Sémantique du domaine `common` dans l'état global (MICRO-GATE §3) -----
// Correction humaine explicite : la facultativité de `common` signifie
// « son absence est acceptable » (couvert par les tests global_state §3
// ci-dessus, `common` alors exclu du calcul), jamais « un `common` EXISTANT
// peut échouer/être obsolète sans affecter l'état global ». Dès qu'un
// rule_set `common` est publié pour la session, il doit peser exactement
// comme un domaine requis dans `resolveGlobalAnalysisState`.

test('global_state — session health seule, AUCUN rule_set common publié -> "up_to_date" (rappel : l\'absence de common reste acceptable)', () => {
  const sessionId = createAndStartSession(householdId, 'health', { versionId: healthVersionId });
  const qId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = buildBasicPublishedRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.state, 'no_rule_set_available');
  assert.equal(workspace.global_state, 'up_to_date');
});

test('global_state — session life_pension seule, AUCUN rule_set common publié -> "up_to_date"', () => {
  const sessionId = createAndStartSession(householdId, 'life_pension', { versionId: lifeVersionId });
  const qId = findQuestionId(lifeVersionId, LIFE_Q);
  S.recordAnswers(sessionId, [{ question_id: qId, status: 'answered', value: true }], rev(sessionId), REQ);
  archiveAllPublishedForDomain('common');
  const ruleSetId = publishLifeRuleSet('rs-life-common-1', 'TEST-RULE-LIFE-COMMON-1');
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.global_state, 'up_to_date');
});

test('global_state — session health seule, un rule_set common EST publié et son exécution est également à jour -> "up_to_date" (common pèse désormais comme un domaine requis)', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });
  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.state, 'up_to_date');
  assert.equal(workspace.global_state, 'up_to_date');
});

test('global_state — common publié en ÉCHEC (dernière tentative), domaine spécialisé à jour -> "partial" (jamais masqué au motif que common est facultatif)', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  const commonRules = R.getRuleSetDetail(commonRuleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: commonRules[0].stable_key }, value: true }), commonRules[0].id);

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId }));

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.last_attempt_failed, true);
  assert.equal(workspace.by_domain.health.state, 'up_to_date');
  assert.equal(workspace.global_state, 'partial');
});

test('global_state — common publié et OBSOLÈTE (amendé depuis), domaine spécialisé à jour (relancé) -> "partial" (mélange à jour/obsolète, jamais uniformément "stale")', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });

  // Amende health (fait avancer la révision de session) puis RELANCE
  // uniquement health -- common reste sur l'ancienne révision, désormais
  // "stale", pendant que health redevient "up_to_date" : un mélange
  // authentique, jamais un cas où TOUT est simplement obsolète.
  S.amendAnswer(sessionId, {
    question_id: healthQId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive MICRO-GATE §3 pour test common stale.',
    expected_revision: rev(sessionId),
  }, REQ);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.state, 'stale');
  assert.equal(workspace.by_domain.health.state, 'up_to_date');
  assert.equal(workspace.global_state, 'partial', 'mélange à jour (health) / obsolète (common) -- jamais uniformément "stale", qui donnerait à tort l\'impression qu\'aucune partie n\'est fiable');
});

test('global_state — common publié mais JAMAIS ENCORE EXÉCUTÉ, domaine spécialisé à jour -> jamais "up_to_date" (état "partial")', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.recordAnswers(sessionId, [{ question_id: healthQId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  buildBasicPublishedCommonRuleSet(); // publié, mais jamais exécuté sur CETTE session
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.state, 'not_yet_run');
  assert.notEqual(workspace.global_state, 'up_to_date', 'common publié mais jamais lancé sur cette session : l\'état global ne doit jamais afficher "à jour"');
  assert.equal(workspace.global_state, 'partial');
});

test('global_state — common en échec PUR et le seul domaine spécialisé également en échec pur (aucun n\'a jamais produit de résultat exploitable) -> "error"', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const rules = R.getRuleSetDetail(ruleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  const commonRules = R.getRuleSetDetail(commonRuleSetId).rules;
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: commonRules[0].stable_key }, value: true }), commonRules[0].id);

  ensureCompleted(sessionId);
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId }));
  assert.throws(() => E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId }));

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.health.last_attempt_failed, true);
  assert.equal(workspace.by_domain.common.last_attempt_failed, true);
  assert.equal(workspace.global_state, 'error');
});

test('synthèse active — un common publié devenu obsolète/en échec reste consultable dans son propre onglet mais n\'est jamais additionné au total actif', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });

  const before = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(before.synthesis.active_findings_count, 2, 'health + common, tous deux à jour au départ');

  // Amende health uniquement -- fait avancer la révision globale, rendant
  // AUSSI common "stale" (jamais relancé) -- relance UNIQUEMENT health.
  S.amendAnswer(sessionId, {
    question_id: healthQId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive MICRO-GATE §3 pour test synthèse common.',
    expected_revision: rev(sessionId),
  }, REQ);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const after = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(after.by_domain.common.state, 'stale');
  assert.equal(after.by_domain.common.findings.length, 1, 'le finding common obsolète reste consultable dans son propre onglet');
  assert.equal(after.synthesis.active_findings_count, 1, 'seul health (à jour) doit compter -- common (obsolète) jamais additionné');
  assert.deepEqual(after.synthesis.domains_current, ['health']);
  assert.ok(after.synthesis.domains_excluded_stale.includes('common'));
});

test('historique — les anciennes exécutions de common restent consultables (jamais perdues) même après que son état global bascule plusieurs fois', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  const firstCommon = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  S.amendAnswer(sessionId, {
    question_id: commonQId, status: 'answered', value: true,
    amendment_reason: 'Correction fictive MICRO-GATE §3 pour test historique common.',
    expected_revision: rev(sessionId),
  }, REQ);
  const secondCommon = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });

  const executions = E.listExecutions(sessionId, { domain: 'common' }, REQ);
  assert.equal(executions.length, 2, 'les deux exécutions common (avant/après amendement) restent toutes deux dans l\'historique, jamais supprimées');
  assert.ok(executions.some((e) => e.id === firstCommon.execution_id && e.superseded_by_execution_id === secondCommon.execution_id));
  assert.ok(executions.some((e) => e.id === secondCommon.execution_id && e.superseded_by_execution_id === null));
});

// --- Applicabilité EXACTE de common : statut ACTUEL, jamais historique ---
// (Correction humaine finale, micro-GATE §1) : `commonApplicable` doit
// reposer STRICTEMENT sur `status = 'published'` AU MOMENT DE LA LECTURE
// (`has_published_rule_set`), jamais sur le fait qu'un ensemble ait un jour
// été publié -- un ensemble `common` seulement ARCHIVÉ, même s'il porte une
// exécution passée toujours `up_to_date` au sens strict de la révision
// (reproductibilité : une exécution déjà pinnée reste exécutable/valide
// après archivage de son rule_set), ne doit JAMAIS rendre `common`
// applicable à l'analyse courante.

test('global_state — health actuel, common publié PUIS ARCHIVÉ (aucun common actuellement publié) -> "up_to_date" (l\'historique de common ne doit jamais le rendre applicable)', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  const commonExecution = E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  // Archive le rule_set common APRÈS son exécution -- reste valide/pinné
  // pour cette session (reproductibilité), mais n'est plus PUBLIÉ.
  R.archiveRuleSet(commonRuleSetId, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  // `state` continue de refléter honnêtement la dernière exécution
  // (toujours "up_to_date" au sens strict de la révision) -- c'est
  // `has_published_rule_set` qui, lui, bascule à false et pilote
  // désormais l'applicabilité.
  assert.equal(workspace.by_domain.common.state, 'up_to_date', 'la dernière exécution common reste honnêtement "up_to_date" au sens strict de la révision, même après archivage de son rule_set');
  assert.equal(workspace.by_domain.common.has_published_rule_set, false);
  assert.equal(workspace.global_state, 'up_to_date', 'aucun common actuellement publié : son historique ne doit jamais le rendre applicable, health seul détermine l\'état global');

  // L'ancienne exécution common reste consultable dans l'historique --
  // jamais perdue par le seul fait de l'archivage du rule_set.
  const executions = E.listExecutions(sessionId, { domain: 'common' }, REQ);
  assert.equal(executions.length, 1);
  assert.equal(executions[0].id, commonExecution.execution_id);

  // Ses findings ne figurent PLUS dans la synthèse active (alors qu'ils
  // l'auraient été avant l'archivage, voir le test "common publié et son
  // exécution est également à jour" ci-dessus) -- mais restent consultables
  // dans son propre onglet.
  assert.equal(workspace.by_domain.common.findings.length, 1, 'le finding common reste consultable dans son propre onglet');
  assert.equal(workspace.synthesis.active_findings_count, 1, 'seul health doit compter désormais -- common (rule_set archivé, non actuellement publié) jamais additionné malgré state="up_to_date"');
  assert.deepEqual(workspace.synthesis.domains_current, ['health']);
  assert.ok(workspace.synthesis.domains_excluded_stale.includes('common'));
});

test('global_state — un ancien common ARCHIVÉ puis une NOUVELLE version common publiée : seule la version ACTUELLEMENT publiée détermine l\'applicabilité', () => {
  const sessionId = createAndStartSessionWithCommon('health', healthVersionId);
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildBasicPublishedRuleSet();

  // Premier rule_set common publié puis ARCHIVÉ SANS JAMAIS être exécuté
  // sur cette session (aucun pin n'existe encore pour ce domaine) --
  // représente un ensemble antérieur totalement révolu.
  const { id: oldCommonRuleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-common-old'), domain: 'common', name: 'Ancien commun (révolu)' }, REQ);
  R.upsertRule(oldCommonRuleSetId, validRuleData({
    stable_key: 'TEST-RULE-COMMON-OLD', conditions: { op: 'equals', ref: { answer: COMMON_Q }, value: true }, required_data: [{ answer: COMMON_Q }],
  }), REQ);
  publishForDomain('common', oldCommonRuleSetId);
  R.archiveRuleSet(oldCommonRuleSetId, REQ);

  // Nouvelle version, réellement distincte, publiée ET exécutée.
  const newCommonRuleSetId = buildBasicPublishedCommonRuleSet();
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: newCommonRuleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.has_published_rule_set, true, 'la version common ACTUELLEMENT publiée (la nouvelle) doit seule déterminer l\'applicabilité');
  assert.equal(workspace.by_domain.common.state, 'up_to_date');
  assert.equal(workspace.by_domain.common.last_execution.rule_set_id, newCommonRuleSetId, 'pinné sur la version RÉELLEMENT exécutée (la nouvelle), jamais l\'ancienne, jamais révolue');
  assert.equal(workspace.global_state, 'up_to_date');
});

test('global_state — session MIXED, common publié PUIS ARCHIVÉ (aucun actuellement publié), health et life_pension actuels -> "up_to_date"', () => {
  const sessionId = createAndStartMixedSession();
  const healthQId = findQuestionId(healthVersionId, HEALTH_Q);
  const lifeQId = findQuestionId(lifeVersionId, LIFE_Q);
  const commonQId = findQuestionId(commonVersionId, COMMON_Q);
  S.recordAnswers(sessionId, [
    { question_id: healthQId, status: 'answered', value: true },
    { question_id: lifeQId, status: 'answered', value: true },
    { question_id: commonQId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const healthRuleSetId = buildBasicPublishedRuleSet();
  const lifeRuleSetId = publishLifeRuleSet('rs-life-common-archived', 'TEST-RULE-LIFE-COMMON-ARCHIVED');
  const commonRuleSetId = buildBasicPublishedCommonRuleSet();

  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: healthRuleSetId });
  E.executeRuleSetForSession(sessionId, 'life_pension', rev(sessionId), REQ, { rule_set_id: lifeRuleSetId });
  E.executeRuleSetForSession(sessionId, 'common', rev(sessionId), REQ, { rule_set_id: commonRuleSetId });

  R.archiveRuleSet(commonRuleSetId, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.by_domain.common.has_published_rule_set, false);
  assert.equal(workspace.by_domain.health.state, 'up_to_date');
  assert.equal(workspace.by_domain.life_pension.state, 'up_to_date');
  assert.equal(workspace.global_state, 'up_to_date', 'les deux domaines requis suffisent -- common archivé (non actuellement publié) ne doit jamais empêcher "up_to_date" en session mixte');
});
