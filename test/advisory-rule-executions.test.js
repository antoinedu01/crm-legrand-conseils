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
